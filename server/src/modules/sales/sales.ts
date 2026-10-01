import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool.ts';
import { AppError } from '../../http/errors.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import { employeeName } from '../identity/names.ts';
import type { QuoteSigner } from './quotes.ts';
import { tillOf, type Till } from './till.ts';

const inStore = (key: string): { config: { access: Access } } => ({ config: { access: { kind: 'permission', key, scope: 'store' } } });

/** A cash sale as the till sends it: the cart's lines as quoted, and the cash handed over (`SP-01`, `UX-09`). */
const NewSale = z.object({
  clientOperationId: z.uuid(),
  lines: z.array(z.object({ quote: z.string().min(1).max(4000), quantity: z.number().int().min(1).max(1_000_000) })).min(1).max(500),
  cash: z.object({ tendered: z.number().int().safe().min(0) }),
});
const SaleRef = z.object({ storeId: z.uuid(), saleId: z.uuid() });

/** A page of the store's sales (architecture §18.5): newest first, `before` a document number to continue. */
const SaleListing = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  terminalId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  // `Failed` is the reprint queue (SP-58); `None` is a sale whose first print has not been reported.
  receipt: z.enum(['Printed', 'Failed', 'Reprinted', 'None']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().min(1).optional(),
});
// SP-03: the till reports the first print's outcome after the commit. A reprint is its own act (SP-57).
const PrintOutcome = z.object({ status: z.enum(['Printed', 'Failed']) });
const Reprint = z.object({ reasonCodeId: z.uuid() });

/**
 * The receipt: a rendering of the stored sale, never a second source of truth (`SP-57`). It carries the mandatory core
 * (`SP-59`: the store, the number, the date, the lines with prices, the tax, the total, the payments and the change) and
 * no cost or margin, because nothing that carries them is read (`SP-60`). Every value is the sale's own snapshot, so a
 * reprint years later repeats the original numbers (`SP-06`, `BI-11`).
 */
async function receiptOf(db: Queryable, saleId: string) {
  const sale = await db.query(
    `SELECT s.id AS "saleId", s.document_number AS "documentNumber", s.business_date::text AS "businessDate",
            s.completed_at AS "completedAt",
            json_build_object('name', o.name, 'code', o.code, 'address', o.address, 'contactDetails', o.contact_details) AS store,
            s.tax_mode AS "taxMode", s.currency_code AS "currencyCode", c.minor_unit_exponent AS "minorUnitExponent",
            s.subtotal, s.tax_total AS "taxTotal", s.total_due AS "totalDue", s.change_given AS change,
            s.receipt_status AS "receiptStatus"
     FROM sale s JOIN store o ON o.id = s.store_id JOIN currency c ON c.code = s.currency_code WHERE s.id = $1`,
    [saleId],
  );
  const lines = await db.query(
    `SELECT line_number AS "lineNumber", description, trim_scale(quantity)::text AS quantity, unit_name AS "unitName",
            unit_price AS "unitPrice", line_total AS "lineTotal"
     FROM sale_line WHERE sale_id = $1 ORDER BY line_number`,
    [saleId],
  );
  const payments = await db.query(
    `SELECT m.name AS method, p.amount, p.tendered_amount AS tendered
     FROM sale s JOIN payment p ON p.checkout_id = s.checkout_id JOIN payment_method m ON m.id = p.payment_method_id
     WHERE s.id = $1 AND p.status = 'Captured' ORDER BY p.sequence_number`,
    [saleId],
  );
  return { ...sale.rows[0], lines: lines.rows, payments: payments.rows, reprint: null as null | { reprintedAt: string; reason: string } };
}

export interface SaleSummary {
  saleId: string;
  documentNumber: number;
  businessDate: string;
  completedAt: Date;
  currencyCode: string;
  subtotal: number;
  taxTotal: number;
  totalDue: number;
  tendered: number;
  change: number;
  receiptStatus: string;
  lines: { lineNumber: number; description: string; quantity: string; unitPrice: number; lineTotal: number }[];
}

interface PlannedLine {
  n: number;
  variant_id: string;
  product_name: string;
  variant_name: string | null;
  unit_name: string;
  quantity_kind: string;
  tax_rate_id: string | null;
  gross: number | null;
  tax: number | null;
  unit_cost: number | null;
  expired: boolean;
}

async function summary(db: Queryable, saleId: string): Promise<SaleSummary> {
  const sale = await db.query<Omit<SaleSummary, 'lines' | 'tendered'> & { tendered: number }>(
    `SELECT s.id AS "saleId", s.document_number AS "documentNumber", s.business_date::text AS "businessDate",
            s.completed_at AS "completedAt", s.currency_code AS "currencyCode", s.subtotal, s.tax_total AS "taxTotal",
            s.total_due AS "totalDue", s.total_due + s.change_given AS tendered, s.change_given AS change,
            s.receipt_status AS "receiptStatus"
     FROM sale s WHERE s.id = $1`,
    [saleId],
  );
  const lines = await db.query<SaleSummary['lines'][number]>(
    `SELECT line_number AS "lineNumber", description, quantity::text AS quantity, unit_price AS "unitPrice", line_total AS "lineTotal"
     FROM sale_line WHERE sale_id = $1 ORDER BY line_number`,
    [saleId],
  );
  return { ...sale.rows[0]!, lines: lines.rows };
}

const one = async <T>(db: Queryable, sql: string, params: unknown[]): Promise<T | undefined> =>
  (await db.query<T & pg.QueryResultRow>(sql, params)).rows[0];

/**
 * Completes a cash sale in one transaction (§22.6: `Sale.Create`; `SP-01`, `SP-02`, `PY-38`, `RT-119`):
 * - the checkout, at this till and its open shift (`BI-39`);
 * - the cash tender, created, authorized and captured as the sale's own side effect ("payment captured", §22.6; OQ-018's
 *   Step 3 reading);
 * - the sale, server-numbered, on the settings in force (`REQ-AU-06`), for the walk-in customer (`CU-01`);
 * - its lines, each at its signed quote (`RT-124`), with the rate and standard cost in force, and amounts computed in
 *   exact numeric (`ADR-04`): inclusive tax is extracted from the gross (`PR-39`);
 * - a `SALE` movement per stocked line, through the ledger's write path, in a fixed order (D4 §1 lock order);
 * - the change, from the drawer (`CD-18`).
 * The database checks the whole at commit (`assert_sale_complete()`), and refuses anything short.
 */
async function completeCashSale(
  pool: pg.Pool,
  request: FastifyRequest,
  till: Till,
  body: z.infer<typeof NewSale>,
  quotes: QuoteSigner,
  quoteMaxAgeMinutes: number,
  lockTimeoutMs: number,
): Promise<string> {
  const principal = request.principal!;
  const store = request.storeId!;
  const quoted = body.lines.map((line, i) => ({ n: i + 1, quantity: line.quantity, ...quotes.verify(line.quote, store) }));

  return withTransaction(pool, auditContext(request, { clientOperationId: body.clientOperationId }), async (c) => {
    const settings = await one<{ id: string; tax_mode: 'Inclusive' | 'Exclusive' }>(
      c,
      `SELECT id, tax_mode FROM store_setting_version WHERE store_id = $1 AND effective_from <= now()
       ORDER BY effective_from DESC LIMIT 1`,
      [store],
    );
    if (settings === undefined) throw new AppError(409, 'no_settings', 'This store has no settings in force, so it cannot trade yet.');
    const shift = await one<{ id: string }>(c, `SELECT id FROM cash_shift WHERE cash_drawer_id = $1 AND status = 'Open'`, [till.drawerId]);
    if (shift === undefined) throw new AppError(409, 'no_open_shift', 'Open a shift at this till first.');
    const cash = await one<{ id: string }>(
      c,
      `SELECT m.id FROM payment_method m
       JOIN store_payment_method e ON e.payment_method_id = m.id AND e.store_id = $1 AND e.is_enabled
       WHERE m.organization_id = $2 AND m.method_type = 'Cash' ORDER BY m.code LIMIT 1`,
      [store, principal.organizationId],
    );
    if (cash === undefined) throw new AppError(409, 'cash_not_accepted', 'This store does not take cash.');
    const walkIn = await one<{ id: string }>(c, 'SELECT id FROM customer WHERE organization_id = $1 AND is_walk_in', [principal.organizationId]);
    if (walkIn === undefined) throw new AppError(409, 'no_walk_in', 'This organization has no walk-in customer record.');
    const currency = (await one<{ code: string }>(c, 'SELECT currency_code AS code FROM store WHERE id = $1', [store]))!.code;

    const planned = await c.query<PlannedLine>(
      `SELECT x.n, x.variant_id, p.name AS product_name, v.name AS variant_name, u.name AS unit_name, u.quantity_kind,
              r.id AS tax_rate_id, round(x.quantity * x.unit_price)::bigint AS gross,
              (CASE WHEN $3 = 'Inclusive'
                    THEN round(x.quantity * x.unit_price) - round(round(x.quantity * x.unit_price) / (1 + r.rate_percent / 100))
                    ELSE round(round(x.quantity * x.unit_price) * r.rate_percent / 100) END)::bigint AS tax,
              (SELECT amount FROM variant_standard_cost k WHERE k.variant_id = x.variant_id AND k.effective_from <= now()
               ORDER BY k.effective_from DESC LIMIT 1) AS unit_cost,
              now() - x.quoted_at > make_interval(secs => $4 * 60.0) AS expired
       FROM jsonb_to_recordset($1::jsonb) AS x(n int, variant_id uuid, quantity numeric, unit_price bigint, quoted_at timestamptz)
       JOIN product_variant v ON v.id = x.variant_id AND v.organization_id = $2
       JOIN product p ON p.id = v.product_id
       JOIN unit u ON u.id = v.base_unit_id
       LEFT JOIN LATERAL (SELECT id, rate_percent FROM tax_rate WHERE tax_category_id = v.tax_category_id AND effective_from <= now()
                          ORDER BY effective_from DESC LIMIT 1) r ON true
       ORDER BY x.n`,
      [
        JSON.stringify(quoted.map((q) => ({ n: q.n, variant_id: q.variantId, quantity: q.quantity, unit_price: q.unitPrice, quoted_at: q.quotedAt }))),
        principal.organizationId,
        settings.tax_mode,
        quoteMaxAgeMinutes,
      ],
    );
    const lines = planned.rows;
    const describe = (l: PlannedLine) => (l.variant_name === null ? l.product_name : `${l.product_name} — ${l.variant_name}`);
    if (lines.some((l) => l.expired)) throw new AppError(409, 'quote_expired', 'A price on this cart is too old. Scan the items again.');
    const untaxed = lines.find((l) => l.tax_rate_id === null);
    if (untaxed !== undefined) {
      throw new AppError(409, 'no_tax_rate', `${describe(untaxed)} has no tax rate in force, so it cannot be sold.`);
    }

    const inclusive = settings.tax_mode === 'Inclusive';
    const totals = lines.map((l) => (inclusive ? l.gross! : l.gross! + l.tax!));
    const subtotal = lines.reduce((sum, l) => sum + l.gross!, 0);
    const taxTotal = lines.reduce((sum, l) => sum + l.tax!, 0);
    const totalDue = totals.reduce((sum, t) => sum + t, 0);
    // UX-17: an underpayment is named. The credit-sale option is deferred with credit (BUILD-STATUS).
    if (body.cash.tendered < totalDue) {
      throw new AppError(409, 'underpaid', 'The cash given is less than the total due.', { totalDue, tendered: body.cash.tendered });
    }
    const change = body.cash.tendered - totalDue;

    const checkout = (await one<{ id: string }>(
      c,
      `INSERT INTO checkout (store_id, pos_terminal_id, cash_drawer_id, cash_shift_id, client_operation_id, currency_code,
                             created_by, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [store, till.terminalId, till.drawerId, shift.id, body.clientOperationId, currency, principal.employeeId, request.id],
    ))!.id;
    const payment = (await one<{ id: string }>(
      c,
      `INSERT INTO payment (checkout_id, store_id, organization_id, payment_method_id, method_type, currency_code, amount,
                            tendered_amount, sequence_number, created_by, status_changed_by, correlation_id)
       VALUES ($1, $2, $3, $4, 'Cash', $5, $6, $7, 1, $8, $8, $9) RETURNING id`,
      [checkout, store, principal.organizationId, cash.id, currency, totalDue, body.cash.tendered, principal.employeeId, request.id],
    ))!.id;
    for (const status of ['Authorized', 'Captured']) {
      await c.query('UPDATE payment SET status = $2, status_changed_by = $3 WHERE id = $1', [payment, status, principal.employeeId]);
    }
    const sale = (await one<{ id: string }>(
      c,
      `INSERT INTO sale (store_id, organization_id, checkout_id, pos_terminal_id, cash_drawer_id, cash_shift_id,
                         client_operation_id, employee_id, customer_id, store_setting_version_id, tax_mode, currency_code,
                         subtotal, tax_total, total_due, total_tendered, change_given, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17) RETURNING id`,
      [store, principal.organizationId, checkout, till.terminalId, till.drawerId, shift.id, body.clientOperationId,
        principal.employeeId, walkIn.id, settings.id, settings.tax_mode, currency, subtotal, taxTotal, totalDue, change, request.id],
    ))!.id;

    const lineIds: string[] = [];
    for (const [i, l] of lines.entries()) {
      const q = quoted[i]!;
      const inserted = await one<{ id: string }>(
        c,
        `INSERT INTO sale_line (sale_id, store_id, organization_id, line_number, variant_id, description, unit_name, quantity,
                                unit_price, price_quoted_at, gross_amount, tax_rate_id, tax_amount, line_total, settled_amount,
                                unit_cost, storage_location_id, entry_method, scanned_barcode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16, $17, $18) RETURNING id`,
        [sale, store, principal.organizationId, l.n, l.variant_id, describe(l), l.unit_name, q.quantity, q.unitPrice, q.quotedAt,
          l.gross, l.tax_rate_id, l.tax, totals[i], l.unit_cost, till.locationId, q.barcode === null ? 'Selected' : 'Scanned', q.barcode],
      );
      lineIds.push(inserted!.id);
    }

    const stocked = lines.map((l, i) => ({ l, id: lineIds[i]!, q: quoted[i]! })).filter((x) => x.l.quantity_kind !== 'Service');
    if (stocked.length > 0) {
      const movement = (await one<{ id: string }>(
        c,
        'INSERT INTO inventory_transaction (store_id, created_by, correlation_id) VALUES ($1, $2, $3) RETURNING id',
        [store, principal.employeeId, request.id],
      ))!.id;
      // One order for every sale (variant, then location), so concurrent sales lock balances alike and cannot deadlock.
      stocked.sort((a, b) => a.l.variant_id.localeCompare(b.l.variant_id));
      for (const { l, id, q } of stocked) {
        await c.query(
          `INSERT INTO inventory_movement (inventory_transaction_id, store_id, organization_id, variant_id, storage_location_id,
                                           movement_type, direction, quantity, sale_id, sale_line_id)
           VALUES ($1, $2, $3, $4, $5, 'SALE', 'Out', $6, $7, $8)`,
          [movement, store, principal.organizationId, l.variant_id, till.locationId, q.quantity, sale, id],
        );
      }
    }
    if (change > 0) {
      await c.query(
        `INSERT INTO cash_transaction (cash_shift_id, cash_drawer_id, store_id, type, direction, amount, currency_code, created_by, sale_id)
         VALUES ($1, $2, $3, 'ChangeDisbursed', 'Out', $4, $5, $6, $7)`,
        [shift.id, till.drawerId, store, change, currency, principal.employeeId, sale],
      );
    }
    return sale;
  }, { lockTimeoutMs });
}

/** The till's sale routes (sales-pos-domain; D4). */
export async function saleRoutes(
  app: FastifyInstance,
  options: { pool: pg.Pool; quotes: QuoteSigner; quoteMaxAgeMinutes: number; lockTimeoutMs: number },
): Promise<void> {
  const { pool } = options;

  /**
   * Completes a cash sale at this till. The cart's operation id makes a repeat return the sale already made, never a
   * second one (`SM-04`, `BI-28`, architecture §10.4); a concurrent repeat waits on the database's key and then gets the
   * same answer.
   */
  app.post('/stores/:storeId/sales', inStore('Sale.Create'), async (request, reply) => {
    const body = NewSale.parse(request.body);
    const till = await tillOf(pool, request);
    const existing = async () =>
      one<{ id: string }>(pool, 'SELECT id FROM sale WHERE pos_terminal_id = $1 AND client_operation_id = $2', [till.terminalId, body.clientOperationId]);
    const before = await existing();
    if (before !== undefined) return reply.status(200).send(await summary(pool, before.id));
    try {
      const sale = await completeCashSale(pool, request, till, body, options.quotes, options.quoteMaxAgeMinutes, options.lockTimeoutMs);
      return reply.status(201).send(await summary(pool, sale));
    } catch (error) {
      const raced = (error as { code?: string; constraint?: string }).constraint === 'uq_checkout_operation' ? await existing() : undefined;
      if (raced !== undefined) return reply.status(200).send(await summary(pool, raced.id));
      throw error;
    }
  });

  app.get('/stores/:storeId/sales/:saleId', inStore('Sale.View'), async (request) => {
    const { saleId } = SaleRef.parse(request.params);
    const found = await one<{ id: string }>(pool, 'SELECT id FROM sale WHERE id = $1 AND store_id = $2', [saleId, request.storeId]);
    if (found === undefined) throw new AppError(404, 'not_found', 'There is no such sale in this store.');
    return summary(pool, found.id);
  });

  /**
   * The store's sales, newest first, a page at a time (architecture §18.5), under `Sale.View`, "see sales, own store"
   * (`MS-02`). They can be filtered by business date, till and cashier, and by receipt status: `Failed` is the reprint
   * queue (`SP-58`, `RT-140`).
   */
  app.get('/stores/:storeId/sales', inStore('Sale.View'), async (request) => {
    const q = SaleListing.parse(request.query);
    const { rows } = await pool.query<{ documentNumber: number }>(
      `SELECT s.id AS "saleId", s.document_number AS "documentNumber", s.business_date::text AS "businessDate",
              s.completed_at AS "completedAt", s.pos_terminal_id AS "terminalId", t.label AS "terminalLabel",
              s.employee_id AS "employeeId", ${employeeName('e')} AS "cashierName", s.currency_code AS "currencyCode",
              s.total_due AS "totalDue", s.status, s.receipt_status AS "receiptStatus"
       FROM sale s JOIN pos_terminal t ON t.id = s.pos_terminal_id JOIN employee e ON e.id = s.employee_id
       WHERE s.store_id = $1
         AND ($2::date IS NULL OR s.business_date >= $2) AND ($3::date IS NULL OR s.business_date <= $3)
         AND ($4::uuid IS NULL OR s.pos_terminal_id = $4) AND ($5::uuid IS NULL OR s.employee_id = $5)
         AND ($6::text IS NULL OR s.receipt_status = $6 OR ($6 = 'None' AND s.receipt_status IS NULL))
         AND ($7::bigint IS NULL OR s.document_number < $7)
       ORDER BY s.document_number DESC LIMIT $8`,
      [request.storeId, q.from ?? null, q.to ?? null, q.terminalId ?? null, q.employeeId ?? null, q.receipt ?? null, q.before ?? null, q.limit],
    );
    return { items: rows, before: rows.length === q.limit ? rows.at(-1)!.documentNumber : null };
  });

  /** The receipt of a sale of this store (`SP-57`, `SP-59`, `SP-60`). */
  app.get('/stores/:storeId/sales/:saleId/receipt', inStore('Sale.View'), async (request) => {
    const { saleId } = SaleRef.parse(request.params);
    const found = await one<{ id: string }>(pool, 'SELECT id FROM sale WHERE id = $1 AND store_id = $2', [saleId, request.storeId]);
    if (found === undefined) throw new AppError(404, 'not_found', 'There is no such sale in this store.');
    return receiptOf(pool, found.id);
  });

  /**
   * The outcome of the receipt's first print, reported by the till after the commit (`SP-03`, `SP-58`, `UX-22`). It is
   * recorded once: reporting the same outcome again changes nothing, and a different one is refused, because a failed
   * receipt is recovered by a reprint, not by rewriting its outcome. Receipt issuance is the cashier's work, so this
   * needs `Sale.Create` (actors-and-roles §4; a choice listed for the owner's veto).
   */
  app.put('/stores/:storeId/sales/:saleId/receipt-status', inStore('Sale.Create'), async (request) => {
    const { saleId } = SaleRef.parse(request.params);
    const { status } = PrintOutcome.parse(request.body);
    return withTransaction(pool, auditContext(request), async (c) => {
      const found = await one<{ receipt_status: string | null }>(c, 'SELECT receipt_status FROM sale WHERE id = $1 AND store_id = $2 FOR UPDATE', [
        saleId,
        request.storeId,
      ]);
      if (found === undefined) throw new AppError(404, 'not_found', 'There is no such sale in this store.');
      if (found.receipt_status === status) return { saleId, receiptStatus: status, changed: false };
      if (found.receipt_status !== null) {
        throw new AppError(409, 'receipt_status_recorded', `This receipt is already recorded as ${found.receipt_status}. Reprint it to give the customer a copy.`);
      }
      await c.query('UPDATE sale SET receipt_status = $2 WHERE id = $1', [saleId, status]);
      return { saleId, receiptStatus: status, changed: true };
    });
  });

  /**
   * Reprints a receipt (`SP-57`): the original numbers exactly, under a reprint banner, so the copy and the original
   * are told apart. The reason is mandatory by the owner's instruction of 2026-10-01, and the reprint is recorded with
   * who and when. The reason must be the organization's, checked here so that another organization's archived reason
   * answers "not found" (architecture §24.3); its liveness is the database's (`SS024`). `Sale.Create`, as above.
   */
  app.post('/stores/:storeId/sales/:saleId/reprints', inStore('Sale.Create'), async (request, reply) => {
    const { saleId } = SaleRef.parse(request.params);
    const { reasonCodeId } = Reprint.parse(request.body);
    const principal = request.principal!;
    const reprinted = await withTransaction(pool, auditContext(request), async (c) => {
      const found = await one<{ id: string }>(c, 'SELECT id FROM sale WHERE id = $1 AND store_id = $2 FOR UPDATE', [saleId, request.storeId]);
      if (found === undefined) throw new AppError(404, 'not_found', 'There is no such sale in this store.');
      const reason = await one<{ name: string }>(c, 'SELECT name FROM reason_code WHERE id = $1 AND organization_id = $2', [
        reasonCodeId,
        principal.organizationId,
      ]);
      if (reason === undefined) throw new AppError(422, 'invalid_reference', 'Something this refers to does not exist.');
      const { rows } = await c.query<{ reprintedAt: string }>(
        `INSERT INTO receipt_reprint (sale_id, store_id, organization_id, reason_code_id, reprinted_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING reprinted_at AS "reprintedAt"`,
        [saleId, request.storeId, principal.organizationId, reasonCodeId, principal.employeeId],
      );
      await c.query("UPDATE sale SET receipt_status = 'Reprinted' WHERE id = $1", [saleId]);
      return { ...(await receiptOf(c, saleId)), reprint: { reprintedAt: rows[0]!.reprintedAt, reason: reason.name } };
    });
    return reply.status(201).send(reprinted);
  });
}
