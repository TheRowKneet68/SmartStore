import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, inTransaction, sqlState, type TestDb } from './db.ts';
import {
  actor,
  ensureTestCurrency,
  insertBarcode,
  insertCategory,
  insertOrganization,
  insertPrice,
  insertProduct,
  insertReasonCode,
  insertSellableVariant,
  insertStore,
  insertTaxCategory,
  insertUnit,
  insertVariant,
  TEST_CURRENCY,
  withReason,
} from './fixtures.ts';

/** Domain 2 — Product / Barcode / Unit. Design: docs/database/D2-PRODUCT-BARCODE-UNIT.md */

let db: TestDb;
let org: string;
let otherOrg: string;
let reason: string;

beforeAll(async () => {
  db = await createTestDb();
  await ensureTestCurrency(db.owner);
  org = await insertOrganization(db.app);
  otherOrg = await insertOrganization(db.app);
  reason = await insertReasonCode(db.app, org);
});
afterAll(async () => {
  await db.drop();
});

/** s22.1: every product edge but activation needs a reason; the application supplies it in the audit context (D6). */
const setStatus = (product: string, status: string) =>
  withReason(db.app, reason, 'UPDATE product SET status = $2, status_changed_by = $3 WHERE id = $1', [product, status, actor()]);

/** A draft product with one variant; the variant is priced unless `priced` is false. */
async function draftWithVariant(priced = true) {
  const unit = await insertUnit(db.app, org);
  const product = await insertProduct(db.app, org, await insertCategory(db.app, org));
  const variant = await insertVariant(db.app, org, product, unit);
  if (priced) await insertPrice(db.app, org, variant);
  return { product, variant, unit };
}

describe('state machines as data (SM-02, SM-05, SM-07, ADR-19)', () => {
  it('SM-05, PR-47, SM-13: Archived is terminal and every Product state is reachable from Draft', async () => {
    const { rows } = await db.app.query<{ from_state: string; to_state: string }>(
      `SELECT from_state, to_state FROM state_machine_edge WHERE machine = 'Product'`,
    );
    expect(rows.filter((e) => e.from_state === 'Archived')).toEqual([]);
    const reached = new Set(['Draft']);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of rows) if (reached.has(e.from_state) && !reached.has(e.to_state)) reached.add(e.to_state), (grew = true);
    }
    expect([...reached].sort()).toEqual(['Active', 'Archived', 'Discontinued', 'Draft', 'Hidden']);
  });

  it('SM-13a: the stored Product states exclude OutOfStock, which is a derived condition', async () => {
    const { rows } = await db.app.query<{ state: string }>(
      `SELECT state FROM state_machine_state WHERE machine = 'Product' ORDER BY state`,
    );
    expect(rows.map((r) => r.state)).toEqual(['Active', 'Archived', 'Discontinued', 'Draft', 'Hidden']);
  });

  it('ADR-21, SM-07: the application cannot add a state or an edge', async () => {
    const edge = db.app.query(
      `INSERT INTO state_machine_edge (machine, from_state, to_state, event) VALUES ('Product', 'Archived', 'Active', 'revive')`,
    );
    expect(await sqlState(edge)).toBe('42501');
    const state = db.app.query(`INSERT INTO state_machine_state (machine, state, is_initial) VALUES ('Product', 'X', false)`);
    expect(await sqlState(state)).toBe('42501');
  });
});

describe('units (PR-14, PR-15, RT-033, RT-491)', () => {
  const insert = (kind: string, scale: number) =>
    db.app.query(`INSERT INTO unit (organization_id, code, name, quantity_kind, scale) VALUES ($1, $2, 'U', $3, $4)`, [
      org,
      `U-${randomUUID()}`,
      kind,
      scale,
    ]);

  it('RT-033: a countable unit is whole, a measurable one has a scale of at most 4', async () => {
    expect(await sqlState(insert('Countable', 0))).toBeUndefined();
    expect(await sqlState(insert('Countable', 3))).toBe('23514');
    expect(await sqlState(insert('Measurable', 3))).toBeUndefined();
    expect(await sqlState(insert('Measurable', 5))).toBe('23514');
    expect(await sqlState(insert('Service', 2))).toBeUndefined();
    expect(await sqlState(insert('Weight', 0))).toBe('23514');
  });

  it('PR-15: a unit code is unique within its organization', async () => {
    const code = `KG-${randomUUID()}`;
    const add = (o: string) =>
      db.app.query(`INSERT INTO unit (organization_id, code, name, quantity_kind, scale) VALUES ($1, $2, 'kg', 'Measurable', 3)`, [
        o,
        code,
      ]);
    expect(await sqlState(add(org))).toBeUndefined();
    expect(await sqlState(add(org))).toBe('23505');
    expect(await sqlState(add(otherOrg))).toBeUndefined();
  });
});

describe('category (PR-04, PR-05, PR-06, RT-026, RT-027, RT-488, EC-42)', () => {
  const move = (id: string, parent: string | null) =>
    db.app.query('UPDATE category SET parent_id = $2 WHERE id = $1', [id, parent]);

  it('RT-026: a category has one parent, and can be moved', async () => {
    const root = await insertCategory(db.app, org);
    const other = await insertCategory(db.app, org);
    const child = await insertCategory(db.app, org, root);
    expect(await sqlState(move(child, other))).toBeUndefined();
    expect(await sqlState(move(child, null))).toBeUndefined();
  });

  it('RT-026, EC-42: a category cannot be moved under itself, nor created as its own parent', async () => {
    const c = await insertCategory(db.app, org);
    expect(await sqlState(move(c, c)), 'the cycle trigger names it').toBe('SS006');
    const id = randomUUID();
    const selfParent = db.app.query(
      `INSERT INTO category (id, organization_id, parent_id, name, sort_order) VALUES ($1, $2, $1, 'Self', 0)`,
      [id, org],
    );
    expect(await sqlState(selfParent), 'the check constraint, where no trigger runs').toBe('23514');
  });

  it('RT-026: a category cannot be moved under its own descendant', async () => {
    const a = await insertCategory(db.app, org);
    const b = await insertCategory(db.app, org, a);
    const c = await insertCategory(db.app, org, b);
    expect(await sqlState(move(a, c))).toBe('SS006');
  });

  it('RT-026: two concurrent moves that would together form a cycle cannot both succeed', async () => {
    const root = await insertCategory(db.app, org);
    const x = await insertCategory(db.app, org, root);
    const y = await insertCategory(db.app, org, root);
    const first = await db.app.connect();
    const second = await db.app.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query('UPDATE category SET parent_id = $2 WHERE id = $1', [x, y]);
      const secondMove = sqlState(second.query('UPDATE category SET parent_id = $2 WHERE id = $1', [y, x]));
      await first.query('COMMIT'); // releases the tree lock the second move is waiting on
      expect(await secondMove).toBe('SS006');
    } finally {
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });

  it('PR-04, BI-14: a parent from another organization is refused', async () => {
    const foreign = await insertCategory(db.app, otherOrg);
    const c = await insertCategory(db.app, org);
    expect(await sqlState(move(c, foreign))).toBe('23503');
  });

  it('RT-488: order is an explicit sort order, and it is required', async () => {
    const c = await insertCategory(db.app, org);
    expect(await sqlState(db.app.query('UPDATE category SET sort_order = 7 WHERE id = $1', [c]))).toBeUndefined();
    const noOrder = db.app.query(`INSERT INTO category (organization_id, name) VALUES ($1, 'No order')`, [org]);
    expect(await sqlState(noOrder)).toBe('23502');
  });

  it('PR-05, RT-027: a category is archived once, with server time, and never deleted', async () => {
    const c = await insertCategory(db.app, org);
    const { rows } = await db.app.query<{ stamped: boolean }>(
      'UPDATE category SET archived_by = $2 WHERE id = $1 RETURNING archived_at = now() AS stamped',
      [c, actor()],
    );
    expect(rows[0]!.stamped).toBe(true);
    expect(await sqlState(db.app.query('UPDATE category SET archived_by = $2 WHERE id = $1', [c, actor()]))).toBe('SS001');
    expect(await sqlState(db.app.query('DELETE FROM category WHERE id = $1', [c]))).toBe('42501');
  });
});

describe('brand (product-domain s3)', () => {
  it('RT-021: a brand name is unique within an organization, ignoring case', async () => {
    const name = `Acme ${randomUUID()}`;
    const add = (o: string, n: string) => db.app.query('INSERT INTO brand (organization_id, name) VALUES ($1, $2)', [o, n]);
    expect(await sqlState(add(org, name))).toBeUndefined();
    expect(await sqlState(add(org, name.toUpperCase()))).toBe('23505');
    expect(await sqlState(add(otherOrg, name))).toBeUndefined();
  });
});

describe('product lifecycle (PR-02, PR-46, PR-47, SM-11..SM-13, RT-028, RT-031, RT-042, RT-444)', () => {
  it('PR-02: a product is always created Draft', async () => {
    const category = await insertCategory(db.app, org);
    const asActive = db.app.query(
      `INSERT INTO product (organization_id, category_id, name, status, status_changed_by) VALUES ($1, $2, 'P', 'Active', $3)`,
      [org, category, actor()],
    );
    expect(await sqlState(asActive)).toBe('42501');
    const { rows } = await db.app.query<{ status: string }>('SELECT status FROM product WHERE id = $1', [
      await insertProduct(db.app, org, category),
    ]);
    expect(rows[0]!.status).toBe('Draft');
  });

  it('PR-02, SM-12: a product without an active variant cannot be activated', async () => {
    const product = await insertProduct(db.app, org, await insertCategory(db.app, org));
    expect(await sqlState(setStatus(product, 'Active'))).toBe('SS005');
  });

  it('PR-02: an archived variant does not count as an active one', async () => {
    const { product, variant } = await draftWithVariant();
    await db.app.query('UPDATE product_variant SET archived_by = $2 WHERE id = $1', [variant, actor()]);
    expect(await sqlState(setStatus(product, 'Active'))).toBe('SS005');
  });

  it('RT-042: a product whose active variant has no price in force cannot be activated', async () => {
    const { product, variant } = await draftWithVariant(false);
    expect(await sqlState(setStatus(product, 'Active'))).toBe('SS008');
    await insertPrice(db.app, org, variant, 100, new Date(Date.now() + 86_400_000).toISOString());
    expect(await sqlState(setStatus(product, 'Active')), 'a price effective tomorrow is not in force').toBe('SS008');
    await insertPrice(db.app, org, variant, 100);
    expect(await sqlState(setStatus(product, 'Active'))).toBeUndefined();
  });

  it('overview s3.7: each status change records when it happened', async () => {
    const { product } = await draftWithVariant();
    const { rows } = await db.app.query<{ stamped: boolean }>(
      `UPDATE product SET status = 'Active', status_changed_by = $2 WHERE id = $1 RETURNING status_changed_at = now() AS stamped`,
      [product, actor()],
    );
    expect(rows[0]!.stamped).toBe(true);
  });

  it('SM-11, PR-47: the lifecycle edges of s22.1 are allowed', async () => {
    const { product } = await draftWithVariant();
    for (const status of ['Active', 'Discontinued', 'Active', 'Hidden', 'Active', 'Archived']) {
      expect(await sqlState(setStatus(product, status)), `-> ${status}`).toBeUndefined();
    }
  });

  it('SM-13, PR-47: Archived is terminal, from any state', async () => {
    for (const path of [[], ['Active'], ['Active', 'Discontinued'], ['Active', 'Hidden']]) {
      const { product } = await draftWithVariant();
      for (const s of path) await setStatus(product, s);
      expect(await sqlState(setStatus(product, 'Archived'))).toBeUndefined();
      for (const s of ['Active', 'Draft', 'Discontinued', 'Hidden']) {
        expect(await sqlState(setStatus(product, s)), `Archived -> ${s}`).toBe('SS004');
      }
    }
  });

  it('SM-02: edges outside the contract are refused: Active->Draft (OPEN DECISION), Draft->Hidden (OQ-009)', async () => {
    const draft = (await draftWithVariant()).product;
    expect(await sqlState(setStatus(draft, 'Hidden'))).toBe('SS004');
    expect(await sqlState(setStatus(draft, 'Discontinued'))).toBe('SS004');
    await setStatus(draft, 'Active');
    expect(await sqlState(setStatus(draft, 'Draft'))).toBe('SS004');
  });

  it('SM-13a: OutOfStock is never stored, by the state machine and by the check constraint behind it', async () => {
    const { product } = await draftWithVariant();
    await setStatus(product, 'Active');
    expect(await sqlState(setStatus(product, 'OutOfStock'))).toBe('SS004');
    // Defence in depth: with the machine's trigger off (possible only for the owner, in this private database),
    // the check constraint still refuses the value.
    await db.owner.query('ALTER TABLE product DISABLE TRIGGER tg_product_state_machine');
    try {
      const bypass = db.owner.query(`UPDATE product SET status = 'OutOfStock' WHERE id = $1`, [product]);
      expect(await sqlState(bypass)).toBe('23514');
    } finally {
      await db.owner.query('ALTER TABLE product ENABLE TRIGGER tg_product_state_machine');
    }
  });

  it('SM-04: setting the state a product is already in is a no-op', async () => {
    const { product } = await draftWithVariant();
    expect(await sqlState(setStatus(product, 'Draft'))).toBeUndefined();
  });

  it('RT-444: the application cannot delete a product', async () => {
    const { product } = await draftWithVariant();
    expect(await sqlState(db.app.query('DELETE FROM product WHERE id = $1', [product]))).toBe('42501');
  });
});

describe('variants (RT-021, RT-022, RT-042, RT-443, RT-495, PR-15, PR-48)', () => {
  it('RT-022: a product may have many variants', async () => {
    const unit = await insertUnit(db.app, org);
    const product = await insertProduct(db.app, org, await insertCategory(db.app, org));
    for (let i = 0; i < 3; i++) await insertVariant(db.app, org, product, unit);
    const { rows } = await db.app.query('SELECT 1 FROM product_variant WHERE product_id = $1', [product]);
    expect(rows).toHaveLength(3);
  });

  it('PR-15, BI-14: a base unit or tax category from another organization is refused', async () => {
    const product = await insertProduct(db.app, org, await insertCategory(db.app, org));
    const foreignUnit = await insertUnit(db.app, otherOrg);
    expect(await sqlState(insertVariant(db.app, org, product, foreignUnit))).toBe('23503');
    const unit = await insertUnit(db.app, org);
    const foreignTax = await insertTaxCategory(db.app, otherOrg);
    expect(await sqlState(insertVariant(db.app, org, product, unit, foreignTax))).toBe('23503');
  });

  it('PR-15: a variant never changes product or base unit', async () => {
    const { variant, unit } = await draftWithVariant();
    const other = await insertProduct(db.app, org, await insertCategory(db.app, org));
    expect(await sqlState(db.app.query('UPDATE product_variant SET product_id = $2 WHERE id = $1', [variant, other]))).toBe(
      '42501',
    );
    expect(await sqlState(db.app.query('UPDATE product_variant SET base_unit_id = $2 WHERE id = $1', [variant, unit])))
      .toBe('42501');
  });

  it('RT-042: a variant added to a released product needs a price in force by commit', async () => {
    const { product, unit } = await draftWithVariant();
    await setStatus(product, 'Active');
    const unpriced = inTransaction(db.app, (c) => insertVariant(c, org, product, unit));
    expect(await sqlState(unpriced)).toBe('SS008');
    const priced = inTransaction(db.app, async (c) => {
      const v = await insertVariant(c, org, product, unit);
      await insertPrice(c, org, v);
    });
    expect(await sqlState(priced)).toBeUndefined();
  });

  it('SM-13, PR-47: nothing new may reference an archived product', async () => {
    const { product, unit } = await draftWithVariant();
    await setStatus(product, 'Archived');
    const late = inTransaction(db.app, async (c) => {
      const v = await insertVariant(c, org, product, unit);
      await insertPrice(c, org, v);
    });
    expect(await sqlState(late)).toBe('SS009');
  });

  it('RT-495, PR-48: archiving one variant leaves the product and its other variants untouched', async () => {
    const { product, variant, unit } = await draftWithVariant();
    const sibling = await insertVariant(db.app, org, product, unit);
    await insertPrice(db.app, org, sibling);
    await setStatus(product, 'Active');
    await db.app.query('UPDATE product_variant SET archived_by = $2 WHERE id = $1', [variant, actor()]);
    const { rows } = await db.app.query<{ status: string; live: string }>(
      `SELECT p.status, (SELECT count(*) FROM product_variant v WHERE v.product_id = p.id AND v.archived_at IS NULL) AS live
       FROM product p WHERE p.id = $1`,
      [product],
    );
    expect(rows[0]).toEqual({ status: 'Active', live: '1' });
  });

  it('RT-443, EC-33: a variant is archived once, with server time, and never deleted', async () => {
    const { variant } = await draftWithVariant();
    await db.app.query('UPDATE product_variant SET archived_by = $2 WHERE id = $1', [variant, actor()]);
    expect(await sqlState(db.app.query('UPDATE product_variant SET archived_by = NULL WHERE id = $1', [variant]))).toBe(
      'SS001',
    );
    expect(await sqlState(db.app.query('DELETE FROM product_variant WHERE id = $1', [variant]))).toBe('42501');
  });
});

describe('barcodes (PR-08..PR-12, RT-023, RT-024, RT-025, RT-490, EC-41, UX-48)', () => {
  // GS1 check digits verified by hand: 4006381333931 (EAN-13), 96385074 (EAN-8), 036000291452 (UPC-A),
  // 04252614 (UPC-E, expands to UPC-A 042100005264), 00012345600012 (ITF-14), 0012345678905 (EAN-13).
  const VALID: Array<[string, string]> = [
    ['EAN13', '4006381333931'],
    ['EAN8', '96385074'],
    ['UPC_A', '036000291452'],
    ['UPC_E', '04252614'],
    ['ITF14', '00012345600012'],
  ];
  const BAD_CHECK: Array<[string, string]> = [
    ['EAN13', '4006381333932'],
    ['EAN8', '96385075'],
    ['UPC_A', '036000291453'],
    ['UPC_E', '04252615'],
    ['ITF14', '00012345600013'],
  ];

  const scan = (organization: string, scanned: string) =>
    db.app.query<{ variant_id: string }>(
      `SELECT variant_id FROM product_barcode
       WHERE organization_id = $1 AND lookup_key = barcode_lookup_key($2) AND archived_at IS NULL`,
      [organization, scanned],
    );

  it('RT-490, PR-12: each GTIN symbology is stored with a valid check digit', async () => {
    for (const [kind, value] of VALID) {
      const { variant } = await draftWithVariant();
      expect(await sqlState(insertBarcode(db.app, org, variant, value, kind)), `${kind} ${value}`).toBeUndefined();
    }
    for (const [kind, value] of BAD_CHECK) {
      const { variant } = await draftWithVariant();
      expect(await sqlState(insertBarcode(db.app, org, variant, value, kind)), `${kind} ${value}`).toBe('23514');
    }
  });

  it('RT-490: a 13-digit code beginning with 0 keeps its leading zero', async () => {
    const o = await insertOrganization(db.app);
    const unit = await insertUnit(db.app, o);
    const variant = await insertVariant(db.app, o, await insertProduct(db.app, o, await insertCategory(db.app, o)), unit);
    const id = await insertBarcode(db.app, o, variant, '0012345678905', 'EAN13');
    const { rows } = await db.app.query<{ value: string }>('SELECT value FROM product_barcode WHERE id = $1', [id]);
    expect(rows[0]!.value).toBe('0012345678905');
  });

  it('RT-490, PR-12: whitespace is never part of a stored barcode', async () => {
    const { variant } = await draftWithVariant();
    expect(await sqlState(insertBarcode(db.app, org, variant, ' 4006381333931', 'EAN13'))).toBe('23514');
    expect(await sqlState(insertBarcode(db.app, org, variant, 'AB 12', 'Code128'))).toBe('23514');
  });

  it('RT-024, EC-41, PR-08: a barcode held by another variant is refused, organization-wide', async () => {
    const o = await insertOrganization(db.app);
    const unit = await insertUnit(db.app, o);
    const product = await insertProduct(db.app, o, await insertCategory(db.app, o));
    const a = await insertVariant(db.app, o, product, unit);
    const b = await insertVariant(db.app, o, product, unit);
    await insertBarcode(db.app, o, a, '4006381333931', 'EAN13');
    expect(await sqlState(insertBarcode(db.app, o, b, '4006381333931', 'EAN13'))).toBe('23505');
    const o2 = await insertOrganization(db.app);
    const u2 = await insertUnit(db.app, o2);
    const v2 = await insertVariant(db.app, o2, await insertProduct(db.app, o2, await insertCategory(db.app, o2)), u2);
    expect(await sqlState(insertBarcode(db.app, o2, v2, '4006381333931', 'EAN13')), 'another organization').toBeUndefined();
  });

  it('PR-08, PR-12: a UPC-A and the same code read as EAN-13 are one barcode, and a scan of either finds it', async () => {
    const o = await insertOrganization(db.app);
    const unit = await insertUnit(db.app, o);
    const product = await insertProduct(db.app, o, await insertCategory(db.app, o));
    const a = await insertVariant(db.app, o, product, unit);
    const b = await insertVariant(db.app, o, product, unit);
    await insertBarcode(db.app, o, a, '0012345678905', 'EAN13');
    expect(await sqlState(insertBarcode(db.app, o, b, '012345678905', 'UPC_A'))).toBe('23505');
    for (const scanned of ['0012345678905', '012345678905', '00012345678905']) {
      expect((await scan(o, scanned)).rows, scanned).toEqual([{ variant_id: a }]);
    }
    expect((await scan(o, '12345678905')).rows, 'a trimmed leading zero is a different code').toEqual([]);
  });

  it('RT-023, PR-08: a variant carries several barcodes and exactly one live primary', async () => {
    const { variant } = await draftWithVariant();
    await insertBarcode(db.app, org, variant, `INT-${randomUUID()}`, 'Internal', true);
    expect(await sqlState(insertBarcode(db.app, org, variant, `INT-${randomUUID()}`, 'Internal', true))).toBe('23505');
    expect(await sqlState(insertBarcode(db.app, org, variant, `INT-${randomUUID()}`, 'Internal', false))).toBeUndefined();
    const other = (await draftWithVariant()).variant;
    const noPrimary = inTransaction(db.app, (c) => insertBarcode(c, org, other, `INT-${randomUUID()}`, 'Internal', false));
    expect(await sqlState(noPrimary)).toBe('SS007');
  });

  it('PR-09, RT-025: a barcode is never re-pointed; it is archived and the value reissued', async () => {
    const o = await insertOrganization(db.app);
    const unit = await insertUnit(db.app, o);
    const product = await insertProduct(db.app, o, await insertCategory(db.app, o));
    const a = await insertVariant(db.app, o, product, unit);
    const b = await insertVariant(db.app, o, product, unit);
    const id = await insertBarcode(db.app, o, a, '96385074', 'EAN8');
    expect(await sqlState(db.app.query('UPDATE product_barcode SET variant_id = $2 WHERE id = $1', [id, b]))).toBe('42501');
    expect(await sqlState(db.app.query(`UPDATE product_barcode SET value = '12345670' WHERE id = $1`, [id]))).toBe('42501');
    expect(
      await sqlState(db.app.query('UPDATE product_barcode SET archived_by = $2 WHERE id = $1', [id, actor()])),
      'an archived barcode cannot stay primary',
    ).toBe('23514');
    await db.app.query('UPDATE product_barcode SET archived_by = $2, is_primary = false WHERE id = $1', [id, actor()]);
    expect(await sqlState(insertBarcode(db.app, o, b, '96385074', 'EAN8'))).toBeUndefined();
    expect((await scan(o, '96385074')).rows).toEqual([{ variant_id: b }]);
  });

  it('PR-12: an Internal code can never look like a retail GTIN; free-text kinds keep their rules', async () => {
    const { variant } = await draftWithVariant();
    expect(await sqlState(insertBarcode(db.app, org, variant, '4006381333931', 'Internal'))).toBe('23514');
    expect(await sqlState(insertBarcode(db.app, org, variant, 'café', 'Code128'))).toBe('23514');
    expect(await sqlState(insertBarcode(db.app, org, variant, `SS-${randomUUID()}`, 'Internal'))).toBeUndefined();
    expect(await sqlState(insertBarcode(db.app, org, variant, `QR-€-${randomUUID()}`, 'QR', false))).toBeUndefined();
  });
});

describe('prices and cost (PR-30..PR-36, RT-040..RT-045)', () => {
  it('RT-042, PR-34: a price is positive; zero and negative are refused', async () => {
    const { variant } = await draftWithVariant(false);
    expect(await sqlState(insertPrice(db.app, org, variant, 0))).toBe('23514');
    expect(await sqlState(insertPrice(db.app, org, variant, -5))).toBe('23514');
    expect(await sqlState(insertPrice(db.app, org, variant, 1))).toBeUndefined();
  });

  it('PR-32, RT-041: a price change is prospective, never backdated', async () => {
    const { variant } = await draftWithVariant(false);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(await sqlState(insertPrice(db.app, org, variant, 100, yesterday))).toBe('23514');
  });

  it('PR-30, RT-040, RT-041: the store price in force wins, else the organization default in force', async () => {
    const store = await insertStore(db.app, org);
    const { variantId } = await insertSellableVariant(db.app, org, 500);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await db.app.query(
      `INSERT INTO store_variant_price (store_id, organization_id, variant_id, currency_code, amount, effective_from, created_by)
       VALUES ($1, $2, $3, $4, 450, $5, $6)`,
      [store, org, variantId, TEST_CURRENCY, tomorrow, actor()],
    );
    // "Now" is the database's clock, never the test process's (RT-353); see the matching note in d1.
    const priceAt = async (offset: string) => {
      const { rows } = await db.app.query<{ amount: string }>(
        `SELECT COALESCE(
           (SELECT amount FROM store_variant_price
            WHERE store_id = $1 AND variant_id = $2 AND effective_from <= now() + $3::interval
            ORDER BY effective_from DESC LIMIT 1),
           (SELECT amount FROM variant_price WHERE variant_id = $2 AND effective_from <= now() + $3::interval
            ORDER BY effective_from DESC LIMIT 1)) AS amount`,
        [store, variantId, offset],
      );
      return Number(rows[0]!.amount);
    };
    expect(await priceAt('0 seconds'), 'today: the default, the store price is not yet in force').toBe(500);
    expect(await priceAt('2 days'), 'after it takes effect').toBe(450);
  });

  it("BI-01, RT-001: a store price is in the store's own currency and organization", async () => {
    await db.owner.query(`INSERT INTO currency (code, minor_unit_exponent) VALUES ('XBB', 2) ON CONFLICT DO NOTHING`);
    const store = await insertStore(db.app, org);
    const { variantId } = await insertSellableVariant(db.app, org);
    const add = (s: string, o: string, currency: string) =>
      db.app.query(
        `INSERT INTO store_variant_price (store_id, organization_id, variant_id, currency_code, amount, created_by)
         VALUES ($1, $2, $3, $4, 100, $5)`,
        [s, o, variantId, currency, actor()],
      );
    expect(await sqlState(add(store, org, 'XBB')), "a currency that is not the store's").toBe('23503');
    const foreignStore = await insertStore(db.app, otherOrg);
    expect(await sqlState(add(foreignStore, otherOrg, TEST_CURRENCY)), 'another organization').toBe('23503');
    expect(await sqlState(add(store, org, TEST_CURRENCY))).toBeUndefined();
  });

  it('PR-32: prices are history the application can add to but never rewrite', async () => {
    const { variantId } = await insertSellableVariant(db.app, org);
    expect(await sqlState(db.app.query('UPDATE variant_price SET amount = 1 WHERE variant_id = $1', [variantId]))).toBe('42501');
    expect(await sqlState(db.app.query('DELETE FROM variant_price WHERE variant_id = $1', [variantId]))).toBe('42501');
  });

  it('PR-35: a standard cost is never negative, may be zero, and is prospective', async () => {
    const { variantId } = await insertSellableVariant(db.app, org);
    const add = (amount: number, from?: string) =>
      db.app.query(
        `INSERT INTO variant_standard_cost (organization_id, variant_id, currency_code, amount, effective_from, created_by)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6)`,
        [org, variantId, TEST_CURRENCY, amount, from ?? null, actor()],
      );
    expect(await sqlState(add(-1))).toBe('23514');
    expect(await sqlState(add(0))).toBeUndefined();
    expect(await sqlState(add(10, new Date(Date.now() - 86_400_000).toISOString()))).toBe('23514');
  });
});

describe('tax (PR-37, PR-40, BI-18, RT-047, RT-493)', () => {
  const addRate = (category: string, o: string, percent: string, from?: string) =>
    db.app.query(
      `INSERT INTO tax_rate (organization_id, tax_category_id, jurisdiction, rate_percent, effective_from, created_by)
       VALUES ($1, $2, 'TEST-ONLY', $3, COALESCE($4::timestamptz, now()), $5)`,
      [o, category, percent, from ?? null, actor()],
    );

  it('PR-40, RT-493: a rate is a non-negative percentage, and zero is how exemption is expressed', async () => {
    const category = await insertTaxCategory(db.app, org);
    expect(await sqlState(addRate(category, org, '-1'))).toBe('23514');
    expect(await sqlState(addRate(category, org, '0'))).toBeUndefined();
  });

  it('RT-047, PR-37: a rate is never edited; a change is a new effective-dated version', async () => {
    const category = await insertTaxCategory(db.app, org);
    await addRate(category, org, '13.0000');
    expect(await sqlState(db.app.query(`UPDATE tax_rate SET rate_percent = 10 WHERE tax_category_id = $1`, [category]))).toBe(
      '42501',
    );
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(await sqlState(addRate(category, org, '15.0000', tomorrow))).toBeUndefined();
    const { rows } = await db.app.query<{ rate_percent: string }>(
      `SELECT rate_percent FROM tax_rate WHERE tax_category_id = $1 AND effective_from <= now()
       ORDER BY effective_from DESC LIMIT 1`,
      [category],
    );
    expect(rows[0]!.rate_percent).toBe('13.0000');
  });

  it('PR-37, BI-14: a rate belongs to a category of its own organization', async () => {
    const foreign = await insertTaxCategory(db.app, otherOrg);
    expect(await sqlState(addRate(foreign, org, '5'))).toBe('23503');
  });
});
