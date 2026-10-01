import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access, type Principal } from '../../http/gate.ts';
import type { MachineBinding } from '../../http/transitions.ts';

// CD-20: the close declares the float handed to the next shift, in whole minor units (ADR-04); zero is a declaration.
// zod 4's int() admits only safe integers, so the amount reaches bigint exactly; safe() would repeat the same check.
const Closing = z.object({ closingFloat: z.number().int().min(0) });

/**
 * Before `Reconciling → Closed` (§22.11 close): the latest pass decides (`SM-57`). There must be one (`CD-20`), and its
 * variance must be zero or acknowledged (`CD-23`, `CD-25`; the tolerance is zero, OQ-020). Then the declared float is
 * written as a `ClosingFloat` cash movement, out of the drawer (`CD-20`, `CD-19`, cash-management §5). The database
 * checks all three again when the status changes (`SS042`).
 */
async function beforeClose(c: pg.PoolClient, shiftId: string, to: string, principal: Principal, payload: unknown): Promise<void> {
  if (to !== 'Closed') return;
  const latest = await c.query<{ id: string; variance: string; acknowledged: boolean }>(
    `SELECT id, variance, acknowledged_by IS NOT NULL AS acknowledged FROM shift_count
     WHERE cash_shift_id = $1 ORDER BY pass_number DESC LIMIT 1`,
    [shiftId],
  );
  const pass = latest.rows[0];
  if (pass === undefined) throw new AppError(409, 'not_counted', 'Count the drawer before closing the shift.');
  if (Number(pass.variance) !== 0 && !pass.acknowledged) {
    throw new AppError(
      409,
      'variance_unacknowledged',
      'The latest count differs from the expected amount, and nobody has acknowledged the difference. Acknowledge it with a reason, or count the drawer again.',
      { countId: pass.id },
    );
  }
  // The engine parsed the payload with `Closing` before anything else (architecture §24.2).
  const { closingFloat } = payload as z.infer<typeof Closing>;
  await c.query(
    `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
     SELECT s.id, s.cash_drawer_id, s.store_id, 'ClosingFloat', 'Out', $2, o.currency_code, $3
     FROM cash_shift s JOIN store o ON o.id = s.store_id WHERE s.id = $1`,
    [shiftId, closingFloat, principal.employeeId],
  );
}

/**
 * The Shift machine on the till shift (§22.11; cash-management §2, §6). Its edges, keys and audit types are data:
 * `Open → Reconciling` (begin count) and `Reconciling → Closed` (close) both need `Shift.Close` (`CD-20`), and the
 * database refuses everything else, including the two edges OQ-014 leaves undecided. A shift belongs to its store's
 * organization; it has no organization column of its own. The close records who closed it (`closed_by`; the database
 * stamps when, and requires both exactly when `Closed`).
 */
export const shiftMachine: MachineBinding = {
  machine: 'Shift',
  noun: 'shift',
  table: 'cash_shift',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  organizationColumn: '(SELECT o.organization_id FROM store o WHERE o.id = cash_shift.store_id)',
  actorColumnsFor: (to) => (to === 'Closed' ? ['closed_by'] : []),
  payloads: { close: Closing },
  before: (c, shiftId, _from, to, principal, payload) => beforeClose(c, shiftId, to, principal, payload),
};

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });
const ShiftRef = z.object({ storeId: z.uuid(), shiftId: z.uuid() });
const CountRef = z.object({ storeId: z.uuid(), shiftId: z.uuid(), countId: z.uuid() });
const Acknowledgement = z.object({ reasonCodeId: z.uuid() });
// CD-04: a counted amount is an observation of cash, in whole minor units (ADR-04), never negative.
const NewCount = z.object({ countedAmount: z.number().int().min(0) });

/** One counting pass as the server recorded it: the expected amount and the variance are the database's (`CD-22`). */
const COUNT = `c.id, c.pass_number AS "passNumber", c.counted_amount AS "countedAmount", c.expected_amount AS "expectedAmount",
  c.variance, c.counted_by AS "countedBy", c.counted_at AS "countedAt", c.acknowledged_by AS "acknowledgedBy",
  c.acknowledged_at AS "acknowledgedAt", c.reason_code_id AS "reasonCodeId"`;

const Listing = z.object({
  status: z.enum(['Open', 'Reconciling', 'Closed', 'Reopened']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * A shift with its latest pass, the one its close is decided on (`SM-57`). The figures come only from a submitted
 * pass: before one, nothing says what the drawer should hold (`CD-21`, `CD-31`, `RT-243`).
 */
const SCREEN = `
  SELECT s.id, s.status, s.pos_terminal_id AS "terminalId", s.opened_by AS "openedBy", s.opened_at AS "openedAt",
         s.closed_by AS "closedBy", s.closed_at AS "closedAt",
         c.expected_amount AS expected, c.counted_amount AS counted, c.variance,
         c.reason_code_id AS "reasonCodeId", r.name AS reason, c.acknowledged_by AS "acknowledgedBy", c.acknowledged_at AS "acknowledgedAt"
  FROM cash_shift s
  LEFT JOIN LATERAL (SELECT * FROM shift_count x WHERE x.cash_shift_id = s.id ORDER BY x.pass_number DESC LIMIT 1) c ON true
  LEFT JOIN reason_code r ON r.id = c.reason_code_id`;

interface ScreenRow {
  status: string;
  counted: number | null;
  variance: number | null;
  reasonCodeId: string | null;
  reason: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

/**
 * The shift screen's four answers, and only these (`CD-30`, `RT-527`): what should be here (`expected`), what is here
 * (`counted`), the difference against its threshold (`variance`, `tolerance`), and why (`why`: the reason and who
 * acknowledged it; `next`: what happens now, an event of §22.11 or a step of the close).
 * - The tolerance is zero until the owner sets one (OQ-020).
 * - A closed shift has no next step: reopening is undecided (OQ-014).
 */
function answers(row: ScreenRow) {
  const { reasonCodeId, reason, acknowledgedBy, acknowledgedAt, ...shift } = row;
  let next: string | null = null;
  if (row.status === 'Open') next = 'begin count';
  else if (row.status === 'Reconciling') {
    if (row.counted === null) next = 'count';
    else next = row.variance !== 0 && acknowledgedBy === null ? 'acknowledge' : 'close';
  }
  return {
    ...shift,
    tolerance: 0,
    why: acknowledgedBy === null ? null : { reasonCodeId, reason, acknowledgedBy, acknowledgedAt },
    next,
  };
}

/**
 * The shift, locked, in the store the gate authorized (`MS-02`; another store's is not found here), while its drawer is
 * being counted: counts and acknowledgements happen only in `Reconciling` (`SM-55`, `SM-57`; the database's `SS042`
 * is the backstop). Locking it orders a count, an acknowledgement and the close one after the other.
 */
async function countingShift(db: Queryable, shiftId: string, storeId: string): Promise<void> {
  const { rows } = await db.query<{ status: string }>('SELECT status FROM cash_shift WHERE id = $1 AND store_id = $2 FOR UPDATE', [shiftId, storeId]);
  if (rows[0] === undefined) throw new AppError(404, 'not_found', 'There is no such shift in this store.');
  const { status } = rows[0];
  if (status === 'Open') throw new AppError(409, 'not_counting', 'This shift is Open. Begin the count before counting the drawer.');
  if (status !== 'Reconciling') throw new AppError(409, 'not_counting', `This shift is ${status}, so its drawer is no longer being counted.`);
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
      await countingShift(c, shiftId, request.storeId!);
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
      await countingShift(c, shiftId, request.storeId!);
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

  /**
   * The store's shifts, newest first, each with the shift screen's four answers (`CD-30`, `MS-02`), under
   * `Cash.Count.View`, "see counts and variance history" (actors-and-roles §2.10).
   */
  app.get('/stores/:storeId/shifts', inStore('Cash.Count.View'), async (request) => {
    const query = Listing.parse(request.query);
    const { rows } = await pool.query<ScreenRow>(
      `${SCREEN} WHERE s.store_id = $1 AND ($2::text IS NULL OR s.status = $2) ORDER BY s.opened_at DESC, s.id DESC LIMIT $3`,
      [request.storeId, query.status ?? null, query.limit],
    );
    return { items: rows.map(answers) };
  });

  /** One shift's screen (`CD-30`, `RT-527`), with its variance history: every pass, in order, as it stands (`SM-57`). */
  app.get('/stores/:storeId/shifts/:shiftId', inStore('Cash.Count.View'), async (request) => {
    const { shiftId } = ShiftRef.parse(request.params);
    const { rows } = await pool.query<ScreenRow>(`${SCREEN} WHERE s.id = $1 AND s.store_id = $2`, [shiftId, request.storeId]);
    if (rows[0] === undefined) throw new AppError(404, 'not_found', 'There is no such shift in this store.');
    const passes = await pool.query(
      `SELECT ${COUNT}, r.name AS reason FROM shift_count c LEFT JOIN reason_code r ON r.id = c.reason_code_id
       WHERE c.cash_shift_id = $1 ORDER BY c.pass_number`,
      [shiftId],
    );
    return { ...answers(rows[0]), passes: passes.rows };
  });
}
