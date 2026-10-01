import { randomUUID } from 'node:crypto';
import { stdout } from 'node:process';
import { z } from 'zod';
import { loadDotEnv } from '../config.ts';
import { createPool, withTransaction } from '../db/pool.ts';

/**
 * `npm run demo`: TEST-ONLY sample data, so the till can be tried after `npm run onboard`. Into the one onboarded
 * organization it puts five items with valid EAN-13 barcodes, a TEST-ONLY 10% tax rate (rates are the owner's facts:
 * D-12, GAP-044), cash enabled at the store, and an active till. Everything it makes is named TEST-ONLY. It is recorded
 * as the Owner's doing, from a job, like onboarding.
 */
loadDotEnv();
const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
if (!url.success) throw new Error('DATABASE_URL is not set. Run scripts/db-setup.ps1, or see .env.example.');

const ITEMS = [
  { name: 'TEST-ONLY Oat milk 1 L', barcode: '2000000000015', price: 1_250 },
  { name: 'TEST-ONLY Sourdough loaf', barcode: '2000000000022', price: 500 },
  { name: 'TEST-ONLY Eggs, 6', barcode: '2000000000039', price: 325 },
  { name: 'TEST-ONLY Coffee beans 250 g', barcode: '2000000000046', price: 899 },
  { name: 'TEST-ONLY Apples, each', barcode: '2000000000053', price: 45 },
];

const pool = createPool(url.data, 1);
try {
  const orgs = await pool.query<{ id: string; owner: string; store: string; currency: string; location: string }>(
    `SELECT o.id, (SELECT a.employee_id FROM employee_role_assignment a JOIN role r ON r.id = a.role_id
                   WHERE a.organization_id = o.id AND r.name = 'Owner' AND a.revoked_at IS NULL ORDER BY a.assigned_at LIMIT 1) AS owner,
            s.id AS store, s.currency_code AS currency,
            (SELECT l.id FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id WHERE w.store_id = s.id AND l.is_sellable LIMIT 1) AS location
     FROM organization o JOIN store s ON s.organization_id = o.id`,
  );
  if (orgs.rows.length !== 1) throw new Error(`Expected one onboarded organization with one store; found ${orgs.rows.length}. Run npm run onboard first.`);
  const o = orgs.rows[0]!;
  await withTransaction(pool, { actorId: o.owner, source: 'Job', correlationId: randomUUID() }, async (c) => {
    const unit = (await c.query<{ id: string }>(`INSERT INTO unit (organization_id, code, name, quantity_kind, scale) VALUES ($1, 'TEST-EA', 'TEST-ONLY each', 'Countable', 0) RETURNING id`, [o.id])).rows[0]!.id;
    const tax = (await c.query<{ id: string }>(`INSERT INTO tax_category (organization_id, code, name) VALUES ($1, 'TEST-STD', 'TEST-ONLY standard') RETURNING id`, [o.id])).rows[0]!.id;
    await c.query(`INSERT INTO tax_rate (organization_id, tax_category_id, jurisdiction, rate_percent, created_by) VALUES ($1, $2, 'TEST-ONLY', 10, $3)`, [o.id, tax, o.owner]);
    const category = (await c.query<{ id: string }>(`INSERT INTO category (organization_id, name, sort_order) VALUES ($1, 'TEST-ONLY groceries', 1) RETURNING id`, [o.id])).rows[0]!.id;
    for (const item of ITEMS) {
      const product = (await c.query<{ id: string }>(`INSERT INTO product (organization_id, category_id, name, status_changed_by) VALUES ($1, $2, $3, $4) RETURNING id`, [o.id, category, item.name, o.owner])).rows[0]!.id;
      const variant = (await c.query<{ id: string }>(`INSERT INTO product_variant (organization_id, product_id, base_unit_id, tax_category_id) VALUES ($1, $2, $3, $4) RETURNING id`, [o.id, product, unit, tax])).rows[0]!.id;
      await c.query(`INSERT INTO variant_price (organization_id, variant_id, currency_code, amount, created_by) VALUES ($1, $2, $3, $4, $5)`, [o.id, variant, o.currency, item.price, o.owner]);
      await c.query(`INSERT INTO product_barcode (organization_id, variant_id, value, kind, is_primary) VALUES ($1, $2, $3, 'EAN13', true)`, [o.id, variant, item.barcode]);
      await c.query(`UPDATE product SET status = 'Active', status_changed_by = $2 WHERE id = $1`, [product, o.owner]);
    }
    const cash = (await c.query<{ id: string }>(`INSERT INTO payment_method (organization_id, code, name, method_type) VALUES ($1, 'TEST-CASH', 'Cash', 'Cash') RETURNING id`, [o.id])).rows[0]!.id;
    await c.query('INSERT INTO store_payment_method (store_id, payment_method_id, is_enabled, changed_by) VALUES ($1, $2, true, $3)', [o.store, cash, o.owner]);
    const till = (await c.query<{ id: string }>(
      `INSERT INTO pos_terminal (store_id, organization_id, code, label, sell_from_location_id, status_changed_by)
       VALUES ($1, $2, 'TEST-T1', 'TEST-ONLY till 1', $3, $4) RETURNING id`,
      [o.store, o.id, o.location, o.owner],
    )).rows[0]!.id;
    await c.query(`UPDATE pos_terminal SET status = 'Active', status_changed_by = $2 WHERE id = $1`, [till, o.owner]);
    await c.query(`INSERT INTO cash_drawer (store_id, pos_terminal_id, label, currency_code) VALUES ($1, $2, 'TEST-ONLY drawer 1', $3)`, [o.store, till, o.currency]);
  });
  stdout.write(`TEST-ONLY demo data added. Barcodes to type at the till:\n${ITEMS.map((i) => `  ${i.barcode}  ${i.name}`).join('\n')}\n`);
} finally {
  await pool.end();
}
