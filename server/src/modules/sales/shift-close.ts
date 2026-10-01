import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';

/**
 * The Shift machine on the till shift (§22.11; cash-management §2, §6). Its edges, keys and audit types are data:
 * `Open → Reconciling` (begin count) and `Reconciling → Closed` (close) both need `Shift.Close` (`CD-20`), and the
 * database refuses everything else, including the two edges OQ-014 leaves undecided. A shift belongs to its store's
 * organization; it has no organization column of its own.
 */
export const shiftMachine: MachineBinding = {
  machine: 'Shift',
  noun: 'shift',
  table: 'cash_shift',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  organizationColumn: '(SELECT o.organization_id FROM store o WHERE o.id = cash_shift.store_id)',
};

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });
const ShiftRef = z.object({ storeId: z.uuid(), shiftId: z.uuid() });
const CountRef = z.object({ storeId: z.uuid(), shiftId: z.uuid(), countId: z.uuid() });
const Acknowledgement = z.object({ reasonCodeId: z.uuid() });
// CD-04: a counted amount is an observation of cash, in whole minor units (ADR-04), never negative.
const NewCount = z.object({ countedAmount: z.number().int().safe().min(0) });

/** One counting pass as the server recorded it: the expected amount and the variance are the database's (`CD-22`). */
const COUNT = `c.id, c.pass_number AS "passNumber", c.counted_amount AS "countedAmount", c.expected_amount AS "expectedAmount",
  c.variance, c.counted_by AS "countedBy", c.counted_at AS "countedAt", c.acknowledged_by AS "acknowledgedBy",
  c.acknowledged_at AS "acknowledgedAt", c.reason_code_id AS "reasonCodeId"`;

/** The shift, locked, in the store the gate authorized (`MS-02`); another store's is not found here. */
async function lockedShift(db: Queryable, shiftId: string, storeId: string): Promise<{ status: string }> {
  const { rows } = await db.query<{ status: string }>('SELECT status FROM cash_shift WHERE id = $1 AND store_id = $2 FOR UPDATE', [shiftId, storeId]);
  if (rows[0] === undefined) throw new AppError(404, 'not_found', 'There is no such shift in this store.');
  return rows[0];
}

/** Counting, acknowledging and reading a till shift's close (cash-management §6, §8). */
export async function shiftCloseRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  /**
   * One blind counting pass (`CD-20`, `CD-21`, `RT-243`, `RT-526`). The counter states what is in the drawer, and only
   * then is shown what was expected and the difference (`CD-31`). The database computes both, numbers the pass, and
   * takes a count only while the shift is reconciling (`CD-22`, `SM-57`, `SS042`). A recount is a new pass; earlier
   * passes stand. The shift is locked first, so two counts at once are numbered one after the other.
   */
  app.post('/stores/:storeId/shifts/:shiftId/counts', inStore('Shift.Close'), async (request, reply) => {
    const { shiftId } = ShiftRef.parse(request.params);
    const body = NewCount.parse(request.body);
    const principal = request.principal!;
    const pass = await withTransaction(pool, auditContext(request), async (c) => {
      const shift = await lockedShift(c, shiftId, request.storeId!);
      if (shift.status !== 'Reconciling') {
        throw new AppError(409, 'not_counting', `This shift is ${shift.status}. Begin the count before counting the drawer.`);
      }
      const { rows } = await c.query(
        `INSERT INTO shift_count (cash_shift_id, store_id, organization_id, counted_amount, counted_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [shiftId, request.storeId, principal.organizationId, body.countedAmount, principal.employeeId],
      );
      return (await c.query(`SELECT ${COUNT} FROM shift_count c WHERE c.id = $1`, [rows[0]!.id])).rows[0];
    });
    return reply.status(201).send(pass);
  });

  /**
   * Acknowledges a counted variance: an act of accountability, with `Cash.Variance.Acknowledge` and a reason
   * (`CD-23`, `RT-245`, `BI-25`). The variance stays exactly as counted (`CD-24`). The database writes who and when once,
   * with server time (`SS001`), and only while the shift is being counted (`SS042`).
   * - Tolerance is zero (OQ-020), so every non-zero variance is beyond it, and a matching count has nothing to
   *   acknowledge.
   * - The different approver required "beyond a higher threshold" is not applied, because no threshold is configured
   *   (OQ-020).
   * - The reason must be a live code of the organization (`SS024`'s rule).
   */
  app.post('/stores/:storeId/shifts/:shiftId/counts/:countId/acknowledge', inStore('Cash.Variance.Acknowledge'), async (request) => {
    const { shiftId, countId } = CountRef.parse(request.params);
    const body = Acknowledgement.parse(request.body);
    const principal = request.principal!;
    return withTransaction(pool, auditContext(request), async (c) => {
      await lockedShift(c, shiftId, request.storeId!);
      const found = await c.query<{ variance: number }>('SELECT variance FROM shift_count WHERE id = $1 AND cash_shift_id = $2', [countId, shiftId]);
      if (found.rows[0] === undefined) throw new AppError(404, 'not_found', 'There is no such count of this shift.');
      if (Number(found.rows[0].variance) === 0) {
        throw new AppError(409, 'nothing_to_acknowledge', 'This count matches the expected amount, so there is no variance to acknowledge.');
      }
      const reason = await c.query<{ archived: boolean }>(
        'SELECT archived_at IS NOT NULL AS archived FROM reason_code WHERE id = $1 AND organization_id = $2',
        [body.reasonCodeId, principal.organizationId],
      );
      if (reason.rows[0] === undefined) throw new AppError(422, 'invalid_reference', 'Something this refers to does not exist.');
      if (reason.rows[0].archived) throw new AppError(409, 'SS024', 'That reason code is archived. Choose a live one.');
      await c.query('UPDATE shift_count SET acknowledged_by = $2, reason_code_id = $3 WHERE id = $1', [countId, principal.employeeId, body.reasonCodeId]);
      return (await c.query(`SELECT ${COUNT} FROM shift_count c WHERE c.id = $1`, [countId])).rows[0];
    });
  });
}
