import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import { paged, pageOf } from '../../http/paging.ts';
import type { MachineBinding } from '../../http/transitions.ts';

/** The Device machine on the till (§22.12): registered, then activated before it can trade (`RT-423`). */
export const deviceMachine: MachineBinding = {
  machine: 'Device',
  noun: 'till',
  table: 'pos_terminal',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
};

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });
const text = z.string().trim().min(1).max(200);
const NewTill = z.object({ code: text, label: text, sellFromLocationId: z.uuid().optional() });
const OpenShift = z.object({ openingFloat: z.number().int().min(0) });

export interface Till {
  terminalId: string;
  drawerId: string;
  locationId: string;
}

/**
 * The till this request is at: its session's, which must be in the store the gate authorized (`PT-01`, `PT-02`). A
 * till is never taken from the request body (architecture §7.4).
 */
export async function tillOf(db: Queryable, request: FastifyRequest): Promise<Till> {
  const terminalId = request.principal!.terminalId;
  if (terminalId === null) throw new AppError(409, 'not_at_a_till', 'Sign in at a till to do this.');
  const { rows } = await db.query<{ drawer: string | null; location: string }>(
    `SELECT d.id AS drawer, t.sell_from_location_id AS location FROM pos_terminal t
     LEFT JOIN cash_drawer d ON d.pos_terminal_id = t.id WHERE t.id = $1 AND t.store_id = $2`,
    [terminalId, request.storeId],
  );
  if (rows.length === 0) throw new AppError(409, 'not_at_a_till', 'This session is at a till of another store.');
  if (rows[0]!.drawer === null) throw new AppError(409, 'no_drawer', 'This till has no cash drawer.');
  return { terminalId, drawerId: rows[0]!.drawer, locationId: rows[0]!.location };
}

const SHIFT = `id, status, opened_by AS "openedBy", opened_at AS "openedAt",
  (SELECT amount FROM cash_transaction x WHERE x.cash_shift_id = s.id AND x.type = 'OpeningFloat') AS "openingFloat"`;

/** Tills, cash drawers and till shifts (organization-model §6, §7; cash-management §2; D4 §2). */
export async function tillRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/stores/:storeId/terminals', inStore('Device.View'), async (request) => {
    const page = pageOf(request.query);
    const { rows } = await pool.query(
      `SELECT t.id, t.code, t.label, t.mode, t.status, t.sell_from_location_id AS "sellFromLocationId", d.id AS "drawerId"
       FROM pos_terminal t LEFT JOIN cash_drawer d ON d.pos_terminal_id = t.id WHERE t.store_id = $1
       ORDER BY t.code, t.id LIMIT $2 OFFSET $3`,
      [request.storeId, page.limit, page.offset],
    );
    return paged(rows, page);
  });

  /**
   * Registers a till with its drawer (§22.12 creation: `Device.Register`; `CD-01`: v1 has one drawer per till). It sells
   * from a sellable location of its own store (OQ-019), named here or, when the store has exactly one, that one. It
   * trades only once activated (`Device.Edit`, through the transition endpoint).
   */
  app.post('/stores/:storeId/terminals', inStore('Device.Register'), async (request, reply) => {
    const body = NewTill.parse(request.body);
    const principal = request.principal!;
    const created = await withTransaction(pool, auditContext(request), async (c) => {
      let location = body.sellFromLocationId ?? null;
      if (location === null) {
        const sellable = await c.query<{ id: string }>(
          `SELECT l.id FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id
           WHERE w.store_id = $1 AND l.is_sellable`,
          [request.storeId],
        );
        if (sellable.rows.length !== 1) {
          throw new AppError(400, 'invalid_request', 'Name the sellable location this till sells from.');
        }
        location = sellable.rows[0]!.id;
      }
      const till = await c.query<{ id: string }>(
        `INSERT INTO pos_terminal (store_id, organization_id, code, label, sell_from_location_id, status_changed_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [request.storeId, principal.organizationId, body.code, body.label, location, principal.employeeId],
      );
      const drawer = await c.query<{ id: string }>(
        `INSERT INTO cash_drawer (store_id, pos_terminal_id, label, currency_code)
         SELECT $1, $2, $3, currency_code FROM store WHERE id = $1 RETURNING id`,
        [request.storeId, till.rows[0]!.id, `${body.label} drawer`],
      );
      return { id: till.rows[0]!.id, drawerId: drawer.rows[0]!.id };
    });
    return reply.status(201).send(created);
  });

  /**
   * The shift at this till's drawer that is not yet closed, if any (`CD-01`: at most one, by the same index): trading, or
   * held for counting. The till shows which (`UX-35`), and a shift being counted keeps the till in its counting mode
   * (`UX-33`) rather than offering to open another.
   */
  app.get('/stores/:storeId/shift', inStore('Sale.Create'), async (request) => {
    const till = await tillOf(pool, request);
    const { rows } = await pool.query(`SELECT ${SHIFT} FROM cash_shift s WHERE s.cash_drawer_id = $1 AND s.status IN ('Open', 'Reconciling')`, [
      till.drawerId,
    ]);
    return { shift: rows[0] ?? null };
  });

  /**
   * Opens a shift at this till with its counted opening float, possibly zero (§22.11 creation: `Shift.Open`; `CD-02`,
   * `CD-11`, `CD-14`). One open shift per drawer and per employee (`CD-01`, `CD-03`) is the database's.
   */
  app.post('/stores/:storeId/shift', inStore('Shift.Open'), async (request, reply) => {
    const body = OpenShift.parse(request.body);
    const till = await tillOf(pool, request);
    const principal = request.principal!;
    const shift = await withTransaction(pool, auditContext(request), async (c) => {
      const opened = await c.query<{ id: string }>(
        `INSERT INTO cash_shift (store_id, pos_terminal_id, cash_drawer_id, opened_by, status_changed_by)
         VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [request.storeId, till.terminalId, till.drawerId, principal.employeeId],
      );
      await c.query(
        `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by)
         SELECT $1, $2, $3, 'OpeningFloat', 'In', $4, currency_code, $5 FROM store WHERE id = $3`,
        [opened.rows[0]!.id, till.drawerId, request.storeId, body.openingFloat, principal.employeeId],
      );
      return (await c.query(`SELECT ${SHIFT} FROM cash_shift s WHERE s.id = $1`, [opened.rows[0]!.id])).rows[0];
    });
    return reply.status(201).send({ shift });
  });
}
