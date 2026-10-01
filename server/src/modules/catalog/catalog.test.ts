import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { draftAdjustment, employeeWithAccess, insertOrganization, insertReasonCode, insertStore, insertWarehouse } from '../../../test/fixtures.ts';

let db: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDb();
  app = await testApp(db);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

const MANAGER_KEYS = [
  'Product.View', 'Product.Create', 'Product.Edit', 'Product.Archive', 'Product.Cost.View',
  'Price.View', 'Price.Edit', 'Tax.View', 'Tax.Edit', 'Sale.Create',
];

type Headers = Record<string, string>;

async function catalogue(keys: string[] = MANAGER_KEYS) {
  const org = await insertOrganization(db.app);
  const store = await insertStore(db.app, org);
  const manager = await employeeWithAccess(db.app, org, keys, { assignedStore: null, accessStores: [store] });
  return { org, store, manager, as: signedInAs(manager, org) };
}
type Catalogue = Awaited<ReturnType<typeof catalogue>>;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, as: Headers, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });

async function created(method: 'POST', url: string, as: Headers, payload: object): Promise<string> {
  const response = await call(method, url, as, payload);
  expect(response.statusCode, `${url}: ${response.body}`).toBe(201);
  return response.json().id;
}

/** Reference data: a countable unit, a TEST-ONLY tax category at a TEST-ONLY 10% rate in force now, a category. */
async function reference(c: Catalogue) {
  const unit = await created('POST', '/units', c.as, { code: `EA-${randomUUID()}`, name: 'Each', quantityKind: 'Countable', scale: 0 });
  const tax = await created('POST', '/tax-categories', c.as, { code: `T-${randomUUID()}`, name: 'TEST-ONLY standard' });
  await created('POST', `/tax-categories/${tax}/rates`, c.as, { jurisdiction: 'TEST-ONLY', ratePercent: '10.0000' });
  const category = await created('POST', '/categories', c.as, { name: 'Groceries', parentId: null, sortOrder: 1 });
  return { unit, tax, category };
}

/** A product, Active, with one variant priced at `amount` carrying `barcode`. */
async function sellable(c: Catalogue, barcode: { value: string; kind: string }, amount = 1_250) {
  const r = await reference(c);
  const product = await created('POST', '/products', c.as, { categoryId: r.category, name: 'Oat milk' });
  const variant = await created('POST', `/products/${product}/variants`, c.as, {
    name: '1 L', baseUnitId: r.unit, taxCategoryId: r.tax, price: { amount }, barcodes: [barcode],
  });
  const activated = await call('POST', '/transitions', c.as, { machine: 'Product', event: 'activate', subject: product });
  expect(activated.json().state).toBe('Active');
  return { ...r, product, variant };
}

const scan = (c: Catalogue, code: string, as: Headers = c.as, store = c.store) => call('GET', `/stores/${store}/scan/${encodeURIComponent(code)}`, as);

describe('reference data (PR-04..PR-06, PR-14, PR-15, PR-37, PR-40, RT-026, RT-047, D-12)', () => {
  it('PR-14, PR-15: a unit has a kind and decimal places; a countable unit has none; a code is used once', async () => {
    const c = await catalogue();
    const decimals = await call('POST', '/units', c.as, { code: 'EA', name: 'Each', quantityKind: 'Countable', scale: 2 });
    expect(decimals.json().error).toEqual({ code: 'invalid_value', message: 'A countable unit has no decimal places.' });
    expect((await call('POST', '/units', c.as, { code: 'KG', name: 'Kilogram', quantityKind: 'Measurable', scale: 3 })).statusCode).toBe(201);
    expect((await call('POST', '/units', c.as, { code: 'KG', name: 'Kilo', quantityKind: 'Measurable', scale: 3 })).json().error.message).toBe('That unit code is already in use.');
    expect((await call('GET', '/units', c.as)).json().items).toEqual([{ id: expect.any(String), code: 'KG', name: 'Kilogram', pluralName: null, quantityKind: 'Measurable', scale: 3 }]);
  });

  it('RT-047, PR-40, D-12: a rate is a new version, now or later; zero is allowed; the past is refused; none is supplied', async () => {
    const c = await catalogue();
    const tax = await created('POST', '/tax-categories', c.as, { code: 'ZERO', name: 'TEST-ONLY zero' });
    expect((await call('GET', '/tax-categories', c.as)).json().items[0].ratesInForce, 'no rate is seeded').toEqual([]);
    await created('POST', `/tax-categories/${tax}/rates`, c.as, { jurisdiction: 'TEST-ONLY', ratePercent: '0' });
    await created('POST', `/tax-categories/${tax}/rates`, c.as, { jurisdiction: 'TEST-ONLY', ratePercent: '5.5', effectiveFrom: new Date(Date.now() + 86_400_000).toISOString() });
    const listed = (await call('GET', '/tax-categories', c.as)).json().items[0];
    expect(listed.ratesInForce).toEqual([{ jurisdiction: 'TEST-ONLY', ratePercent: '0.0000', effectiveFrom: expect.any(String) }]);
    const past = await call('POST', `/tax-categories/${tax}/rates`, c.as, { jurisdiction: 'TEST-ONLY', ratePercent: '7', effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
    expect(past.json().error.code).toBe('invalid_value');
    expect((await call('POST', `/tax-categories/${tax}/rates`, c.as, { jurisdiction: 'X', ratePercent: '-1' })).statusCode, 'never a negative rate').toBe(400);
  });

  /** Someone of `c`'s organization holding every manager key but `key`. */
  const allBut = async (c: Catalogue, key: string) =>
    signedInAs(await employeeWithAccess(db.app, c.org, MANAGER_KEYS.filter((k) => k !== key), { assignedStore: null, accessStores: [c.store] }), c.org);

  it("PR-14, PR-15, RT-491, D2 s4: a unit's code, names, kind and decimal places change, only as sent; a used unit's kind does not", async () => {
    const c = await catalogue();
    const r = await reference(c);
    const box = await created('POST', '/units', c.as, { code: 'BX', name: 'Box', quantityKind: 'Countable', scale: 0 });
    await created('POST', '/units', c.as, { code: 'KG', name: 'Kilogram', quantityKind: 'Measurable', scale: 3 });
    const change = (body: object, as: Headers = c.as) => call('PATCH', `/units/${box}`, as, body);
    expect((await change({})).json().error).toEqual({ code: 'invalid_request', message: 'The request changes nothing.' });
    expect((await change({ name: 'Crate', pluralName: 'Crates' })).json()).toEqual({ id: box });
    expect((await change({ scale: 2 })).json().error, 'PR-15').toEqual({ code: 'invalid_value', message: 'A countable unit has no decimal places.' });
    expect((await change({ quantityKind: 'Measurable', scale: 2 })).statusCode, 'unused, so its kind may change').toBe(200);
    expect((await change({ code: 'KG' })).json().error.message).toBe('That unit code is already in use.');
    const units = (await call('GET', '/units', c.as)).json().items;
    expect(units.find((u: { id: string }) => u.id === box)).toEqual({ id: box, code: 'BX', name: 'Crate', pluralName: 'Crates', quantityKind: 'Measurable', scale: 2 });

    // Used: a draft stock adjustment line names a variant on it.
    const product = await created('POST', '/products', c.as, { categoryId: r.category, name: 'Apples' });
    const variant = await created('POST', `/products/${product}/variants`, c.as, { baseUnitId: box, taxCategoryId: r.tax, price: { amount: 100 } });
    const { defaultLocationId } = await insertWarehouse(db.app, c.org, c.store);
    await draftAdjustment(db.app, { org: c.org, store: c.store, reason: await insertReasonCode(db.app, c.org) }, [{ variant, location: defaultLocationId, type: 'FOUND', quantity: '1.5' }]);
    expect((await change({ quantityKind: 'Countable', scale: 0 })).json().error, 'RT-491').toEqual({ code: 'SS021', message: 'This unit has already been used, so its kind cannot change.' });
    expect((await change({ name: 'Bushel' })).statusCode, 'its name still can').toBe(200);

    expect((await change({ name: 'Theirs' }, (await catalogue()).as)).statusCode, "another organization's unit").toBe(404);
    expect((await change({ name: 'Nope' }, await allBut(c, 'Product.Edit'))).statusCode, 'Product.Edit').toBe(403);
  });

  it("PR-37, RT-047, D2 s4: a tax category's code and name change; its rates are never edited; a code is used once", async () => {
    const c = await catalogue();
    const tax = await created('POST', '/tax-categories', c.as, { code: 'STD', name: 'TEST-ONLY standard' });
    await created('POST', `/tax-categories/${tax}/rates`, c.as, { jurisdiction: 'TEST-ONLY', ratePercent: '10' });
    await created('POST', '/tax-categories', c.as, { code: 'ZERO', name: 'TEST-ONLY zero' });
    const change = (body: object, as: Headers = c.as) => call('PATCH', `/tax-categories/${tax}`, as, body);
    expect((await change({ code: 'MAIN', name: 'TEST-ONLY main' })).json()).toEqual({ id: tax });
    expect((await change({ code: 'ZERO' })).json().error.message).toBe('That tax category code is already in use.');
    expect((await change({ ratePercent: '5' })).json().error, 'a rate is not a field of the category').toEqual({ code: 'invalid_request', message: 'The request changes nothing.' });
    const listed = (await call('GET', '/tax-categories', c.as)).json().items.find((t: { id: string }) => t.id === tax);
    expect(listed).toEqual({ id: tax, code: 'MAIN', name: 'TEST-ONLY main', ratesInForce: [{ jurisdiction: 'TEST-ONLY', ratePercent: '10.0000', effectiveFrom: expect.any(String) }] });
    expect((await change({ name: 'Theirs' }, (await catalogue()).as)).statusCode, "another organization's category").toBe(404);
    expect((await change({ name: 'Nope' }, await allBut(c, 'Tax.Edit'))).statusCode, 'Tax.Edit').toBe(403);
  });

  it('product-domain s3, D2 s4: a brand is renamed, and stays unique by name whatever the case', async () => {
    const c = await catalogue();
    const acme = await created('POST', '/brands', c.as, { name: 'Acme' });
    await created('POST', '/brands', c.as, { name: 'Zeta' });
    const change = (body: object, as: Headers = c.as) => call('PATCH', `/brands/${acme}`, as, body);
    expect((await change({ name: 'Acme Foods' })).json()).toEqual({ id: acme });
    expect((await change({ name: 'ZETA' })).json().error.message).toBe('That brand already exists.');
    expect((await call('GET', '/brands', c.as)).json().items.map((b: { name: string }) => b.name)).toEqual(['Acme Foods', 'Zeta']);
    expect((await change({ name: 'Theirs' }, (await catalogue()).as)).statusCode, "another organization's brand").toBe(404);
    expect((await change({ name: 'Nope' }, await allBut(c, 'Product.Edit'))).statusCode, 'Product.Edit').toBe(403);
  });

  it('PR-04, PR-05, RT-026, EC-42, SM-04: categories form a tree, a cycle is refused, archival is once and repeats change nothing', async () => {
    const c = await catalogue();
    const top = await created('POST', '/categories', c.as, { name: 'Food', parentId: null, sortOrder: 1 });
    const sub = await created('POST', '/categories', c.as, { name: 'Dairy', parentId: top, sortOrder: 1 });
    const cycle = await call('PATCH', `/categories/${top}`, c.as, { parentId: sub });
    expect(cycle.json().error.code).toBe('SS006');
    expect((await call('PATCH', `/categories/${sub}`, c.as, { parentId: null, sortOrder: 2 })).statusCode).toBe(200);
    expect((await call('POST', `/categories/${top}/archive`, c.as)).json()).toEqual({ id: top, archived: true, changed: true });
    expect((await call('POST', `/categories/${top}/archive`, c.as)).json().changed).toBe(false);
  });
});

describe('products and their lifecycle (PR-02, RT-042, SM-12, s22.1)', () => {
  it('PR-02, SM-12, RT-042: a product starts Draft; activation needs a live variant with a price in force', async () => {
    const c = await catalogue();
    const r = await reference(c);
    const product = await created('POST', '/products', c.as, { categoryId: r.category, name: 'Bread' });
    expect((await call('GET', `/products/${product}`, c.as)).json()).toMatchObject({ status: 'Draft', variants: [] });
    const activate = () => call('POST', '/transitions', c.as, { machine: 'Product', event: 'activate', subject: product });
    expect((await activate()).json().error.code).toBe('SS005');
    const variant = await created('POST', `/products/${product}/variants`, c.as, { baseUnitId: r.unit, taxCategoryId: r.tax });
    expect((await activate()).json().error.code, 'not priced').toBe('SS008');
    await created('POST', `/variants/${variant}/prices`, c.as, { amount: 300 });
    expect((await activate()).json()).toMatchObject({ state: 'Active', changed: true });
  });

  it('RT-042, PR-30: a variant of a released product brings its price in the same request, which also needs Price.Edit', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '4006381333931', kind: 'EAN13' });
    const unpriced = await call('POST', `/products/${s.product}/variants`, c.as, { baseUnitId: s.unit, taxCategoryId: s.tax });
    expect(unpriced.json().error.code).toBe('SS008');
    const noPriceKey = signedInAs(await employeeWithAccess(db.app, c.org, ['Product.Create'], { assignedStore: null, accessStores: [c.store] }), c.org);
    const refused = await call('POST', `/products/${s.product}/variants`, noPriceKey, { baseUnitId: s.unit, taxCategoryId: s.tax, price: { amount: 100 } });
    expect(refused.json().error.message).toBe('You do not have access to this: it needs the Price.Edit permission for the whole organization.');
    expect((await call('POST', `/products/${s.product}/variants`, c.as, { baseUnitId: s.unit, taxCategoryId: s.tax, price: { amount: 100 } })).statusCode).toBe(201);
  });

  it("s22.1, SM-02d, SS055: a product's edges take their own key and reason", async () => {
    const c = await catalogue(MANAGER_KEYS.filter((k) => k !== 'Product.Archive'));
    const s = await sellable(c, { value: '012345678905', kind: 'UPC_A' });
    const discontinue = await call('POST', '/transitions', c.as, { machine: 'Product', event: 'discontinue', subject: s.product });
    expect(discontinue.json().error.code).toBe('SS055');
    const reason = await insertReasonCode(db.app, c.org);
    expect((await call('POST', '/transitions', c.as, { machine: 'Product', event: 'discontinue', subject: s.product, reasonCodeId: reason })).json().state).toBe('Discontinued');
    const archive = await call('POST', '/transitions', c.as, { machine: 'Product', event: 'archive', subject: s.product, reasonCodeId: reason });
    expect(archive.json().error.message).toContain('Product.Archive');
  });

  it('UX-48, s18.5: products are found by part of their name, case-blind, a page at a time; a wildcard is just a character', async () => {
    const c = await catalogue();
    const r = await reference(c);
    for (const name of ['Oat milk', 'Almond MILK', 'Milkshake 100%', 'Bread']) {
      await created('POST', '/products', c.as, { categoryId: r.category, name });
    }
    const page1 = (await call('GET', '/products?search=milk&limit=2', c.as)).json();
    expect(page1.items.map((p: { name: string }) => p.name)).toEqual(['Almond MILK', 'Milkshake 100%']);
    const page2 = (await call('GET', `/products?search=milk&limit=2&after=${page1.next}`, c.as)).json();
    expect(page2.items.map((p: { name: string }) => p.name)).toEqual(['Oat milk']);
    expect((await call('GET', '/products?search=%25', c.as)).json().items.map((p: { name: string }) => p.name)).toEqual(['Milkshake 100%']);
  });
});

describe('barcodes (PR-08..PR-12, RT-023..RT-025, RT-490, EC-41)', () => {
  it('PR-12, RT-490: a code is canonical: check digits verified, surrounding spaces trimmed', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: ' 4006381333931 ', kind: 'EAN13' });
    const bad = await call('POST', `/variants/${s.variant}/barcodes`, c.as, { value: '4006381333932', kind: 'EAN13' });
    expect(bad.json().error).toEqual({ code: 'invalid_value', message: 'That is not a valid barcode of that kind. Check the digits, including the check digit.' });
    expect((await call('GET', `/products/${s.product}`, c.as)).json().variants[0].barcodes).toEqual([{ id: expect.any(String), value: '4006381333931', kind: 'EAN13', isPrimary: true }]);
  });

  it('PR-08, RT-024, EC-41: a code is used once in an organization, by any GTIN spelling; another organization may use it', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '012345678905', kind: 'UPC_A' });
    const product2 = await created('POST', '/products', c.as, { categoryId: s.category, name: 'Other' });
    const other = await created('POST', `/products/${product2}/variants`, c.as, { baseUnitId: s.unit, taxCategoryId: s.tax });
    const again = await call('POST', `/variants/${other}/barcodes`, c.as, { value: '0012345678905', kind: 'EAN13' });
    expect(again.json().error.message).toBe('That barcode is already in use in this organization.');
    const elsewhere = await catalogue();
    await sellable(elsewhere, { value: '012345678905', kind: 'UPC_A' });
  });

  it('PR-08, PR-09, PR-10: one live primary; a new primary takes over; archiving moves nothing and lets the value be issued again', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '96385074', kind: 'EAN8' });
    const second = await created('POST', `/variants/${s.variant}/barcodes`, c.as, { value: 'INT-0001', kind: 'Internal' });
    const barcodes = async () => (await call('GET', `/products/${s.product}`, c.as)).json().variants[0].barcodes as { id: string; isPrimary: boolean }[];
    expect((await barcodes()).find((b) => b.isPrimary)!.id, 'the first stays primary').not.toBe(second);
    const first = (await barcodes()).find((b) => b.isPrimary)!.id;
    const archivePrimary = await call('POST', `/barcodes/${first}/archive`, c.as);
    expect(archivePrimary.json().error.code, 'the other would be left with no primary').toBe('SS007');
    expect((await call('POST', `/barcodes/${second}/primary`, c.as)).statusCode).toBe(200);
    expect((await call('POST', `/barcodes/${first}/archive`, c.as)).statusCode).toBe(200);
    expect((await scan(c, '96385074')).json().error.code, 'an archived code scans to nothing').toBe('unknown_barcode');
    const product2 = await created('POST', '/products', c.as, { categoryId: s.category, name: 'Successor' });
    const successor = await created('POST', `/products/${product2}/variants`, c.as, { baseUnitId: s.unit, taxCategoryId: s.tax, barcodes: [{ value: '96385074', kind: 'EAN8' }] });
    expect(successor).toBeTruthy();
  });
});

describe('prices and costs (PR-30, PR-32, PR-33, PR-35, PR-36, RT-040, RT-041)', () => {
  it('PR-32, PR-33: a price is prospective, and one below the standard cost is refused for want of an approval', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '4006381333931', kind: 'EAN13' }, 1_000);
    expect((await call('POST', `/variants/${s.variant}/prices`, c.as, { amount: 0 })).json().error.code, 'never zero').toBe('invalid_value');
    await created('POST', `/variants/${s.variant}/costs`, c.as, { amount: 700 });
    const below = await call('POST', `/variants/${s.variant}/prices`, c.as, { amount: 650 });
    expect(below.json().error.code).toBe('below_cost');
    const storeBelow = await call('POST', `/stores/${c.store}/variants/${s.variant}/prices`, c.as, { amount: 699 });
    expect(storeBelow.json().error.code).toBe('below_cost');
    const past = await call('POST', `/variants/${s.variant}/prices`, c.as, { amount: 900, effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
    expect(past.json().error.code).toBe('invalid_value');
    expect((await call('POST', `/variants/${s.variant}/prices`, c.as, { amount: 700 })).statusCode, 'at cost is allowed').toBe(201);
    const listed = (await call('GET', `/variants/${s.variant}/prices`, c.as)).json().items;
    expect(listed[0]).toMatchObject({ amount: 700, currencyCode: 'XTS', started: true });
  });

  it('PR-36: setting a standard cost needs Product.Cost.View as well as Product.Edit', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '4006381333931', kind: 'EAN13' });
    const editor = signedInAs(await employeeWithAccess(db.app, c.org, ['Product.Edit'], { assignedStore: null, accessStores: [] }), c.org);
    expect((await call('POST', `/variants/${s.variant}/costs`, editor, { amount: 10 })).statusCode).toBe(403);
  });

  it('PR-30, RT-040, organization-model s8.2: a store price in force wins over the default; Price.Edit in that store is enough', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '012345678905', kind: 'UPC_A' }, 1_250);
    const storePricer = signedInAs(await employeeWithAccess(db.app, c.org, ['Price.Edit'], { assignedStore: c.store, accessStores: [c.store] }), c.org);
    expect((await call('POST', `/variants/${s.variant}/prices`, storePricer, { amount: 1_300 })).statusCode, 'not the default').toBe(403);
    expect((await call('POST', `/stores/${c.store}/variants/${s.variant}/prices`, storePricer, { amount: 1_100 })).statusCode).toBe(201);
    expect((await scan(c, '012345678905')).json().price).toEqual({ amount: 1_100, currencyCode: 'XTS', minorUnitExponent: 2 });
  });
});

describe('one organization never reaches another (organization-model s2, MS-04)', () => {
  it("MS-04: another organization's tax category, category, product and barcode are not found, and nothing is written", async () => {
    const mine = await catalogue();
    const theirs = await catalogue();
    const t = await sellable(theirs, { value: '4006381333931', kind: 'EAN13' });
    const theirBarcode = (await call('GET', `/products/${t.product}`, theirs.as)).json().variants[0].barcodes[0].id;
    expect((await call('POST', `/tax-categories/${t.tax}/rates`, mine.as, { jurisdiction: 'X', ratePercent: '1' })).statusCode).toBe(404);
    expect((await call('PATCH', `/categories/${t.category}`, mine.as, { name: 'Mine now' })).statusCode).toBe(404);
    expect((await call('GET', `/products/${t.product}`, mine.as)).statusCode).toBe(404);
    expect((await call('POST', `/products/${t.product}/variants`, mine.as, { baseUnitId: t.unit })).statusCode).toBe(404);
    expect((await call('POST', `/barcodes/${theirBarcode}/primary`, mine.as)).statusCode).toBe(404);
    expect((await call('POST', `/variants/${t.variant}/archive`, mine.as)).statusCode).toBe(404);
    const untouched = await db.app.query(
      `SELECT (SELECT count(*)::int FROM tax_rate WHERE tax_category_id = $1) AS rates,
              (SELECT name FROM category WHERE id = $2) AS category,
              (SELECT count(*)::int FROM product_variant WHERE product_id = $3) AS variants`,
      [t.tax, t.category, t.product],
    );
    expect(untouched.rows).toEqual([{ rates: 1, category: 'Groceries', variants: 1 }]);
  });
});

describe("the till's scan (UX-09, UX-11, UX-25, UX-48, SM-11, RT-124, RT-493, ADR-31 s8)", () => {
  it('PR-32, RT-041: a price, default or store, applies only from its effective time', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '012345678905', kind: 'UPC_A' }, 1_250);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await created('POST', `/variants/${s.variant}/prices`, c.as, { amount: 1_400, effectiveFrom: tomorrow });
    await created('POST', `/stores/${c.store}/variants/${s.variant}/prices`, c.as, { amount: 1_300, effectiveFrom: tomorrow });
    expect((await scan(c, '012345678905')).json().price).toEqual({ amount: 1_250, currencyCode: 'XTS', minorUnitExponent: 2 });
  });

  it('SM-11, PR-46, PR-48: a Discontinued product still sells; an archived variant does not, and archiving it again changes nothing', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '4006381333931', kind: 'EAN13' });
    const reason = await insertReasonCode(db.app, c.org);
    await call('POST', '/transitions', c.as, { machine: 'Product', event: 'discontinue', subject: s.product, reasonCodeId: reason });
    expect((await scan(c, '4006381333931')).statusCode, 'sold from held stock').toBe(200);
    expect((await call('POST', `/variants/${s.variant}/archive`, c.as)).json()).toEqual({ id: s.variant, archived: true, changed: true });
    expect((await call('POST', `/variants/${s.variant}/archive`, c.as)).json().changed).toBe(false);
    expect((await scan(c, '4006381333931')).json().error.code).toBe('unknown_barcode');
  });

  it("PR-08: a variant's first barcode is its primary; a barcode added as primary takes over from the old one", async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '96385074', kind: 'EAN8' });
    const added = await created('POST', `/variants/${s.variant}/barcodes`, c.as, { value: 'INT-7', kind: 'Internal', isPrimary: true });
    const barcodes = (await call('GET', `/products/${s.product}`, c.as)).json().variants[0].barcodes;
    expect(barcodes.filter((b: { isPrimary: boolean }) => b.isPrimary).map((b: { id: string }) => b.id)).toEqual([added]);

    const bare = await created('POST', `/products/${s.product}/variants`, c.as, { baseUnitId: s.unit, taxCategoryId: s.tax, price: { amount: 500 } });
    const first = await created('POST', `/variants/${bare}/barcodes`, c.as, { value: 'INT-8', kind: 'Internal' });
    const variants = (await call('GET', `/products/${s.product}`, c.as)).json().variants;
    expect(variants.find((v: { id: string }) => v.id === bare).barcodes).toEqual([{ id: first, value: 'INT-8', kind: 'Internal', isPrimary: true }]);
  });

  it('UX-09, UX-48, PR-12, RT-124: a scan finds the sellable item by any spelling of its GTIN, with the price in force and the quote time', async () => {
    const c = await catalogue();
    const s = await sellable(c, { value: '012345678905', kind: 'UPC_A' }, 1_250);
    for (const code of ['012345678905', '0012345678905', '012345678905 ']) {
      const response = await scan(c, code);
      expect(response.statusCode, JSON.stringify(code)).toBe(200);
      expect(response.json()).toEqual({
        variantId: s.variant,
        productId: s.product,
        description: 'Oat milk — 1 L',
        barcode: '012345678905',
        unit: { code: expect.any(String), quantityKind: 'Countable', scale: 0 },
        price: { amount: 1_250, currencyCode: 'XTS', minorUnitExponent: 2 },
        quotedAt: expect.any(String),
        quote: expect.any(String),
      });
    }
    expect((await scan(c, '12345678905')).statusCode, 'a dropped leading zero finds nothing, never something wrong').toBe(404);
  });

  it('UX-11, SM-11, RT-493: unknown, unreleased and unclassified items are each their own answer', async () => {
    const c = await catalogue();
    const unknown = await scan(c, '4006381333931');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toEqual({ code: 'unknown_barcode', message: 'Nothing has the barcode 4006381333931. Check it, or find the item by name.' });

    const r = await reference(c);
    const draft = await created('POST', '/products', c.as, { categoryId: r.category, name: 'Prototype' });
    await created('POST', `/products/${draft}/variants`, c.as, { baseUnitId: r.unit, taxCategoryId: r.tax, price: { amount: 100 }, barcodes: [{ value: '96385074', kind: 'EAN8' }] });
    expect((await scan(c, '96385074')).json().error).toEqual({ code: 'not_for_sale', message: 'Prototype is not for sale (it is Draft).' });

    const plain = await created('POST', '/products', c.as, { categoryId: r.category, name: 'Unclassified' });
    await created('POST', `/products/${plain}/variants`, c.as, { baseUnitId: r.unit, price: { amount: 100 }, barcodes: [{ value: 'INT-9', kind: 'Internal' }] });
    await call('POST', '/transitions', c.as, { machine: 'Product', event: 'activate', subject: plain });
    expect((await scan(c, 'INT-9')).json().error.code).toBe('unclassified');
  });

  it('PR-30, RT-040, RT-042: an item with no price in force at a store is not sold there', async () => {
    const c = await catalogue();
    await sellable(c, { value: '96385074', kind: 'EAN8' });
    // A store in another currency has no price for it: the organization's price is not in that currency (resolve_price).
    // XXX is ISO 4217's "no currency" code, a TEST-ONLY fixture here.
    await db.owner.query(`INSERT INTO currency (code, minor_unit_exponent) VALUES ('XXX', 0) ON CONFLICT (code) DO NOTHING`);
    const abroad = (await db.app.query<{ id: string }>(
      `INSERT INTO store (organization_id, code, name, time_zone, currency_code) VALUES ($1, $2, 'Abroad', 'UTC', 'XXX') RETURNING id`,
      [c.org, `S-${randomUUID()}`],
    )).rows[0]!.id;
    const there = signedInAs(await employeeWithAccess(db.app, c.org, ['Sale.Create'], { assignedStore: null, accessStores: [abroad] }), c.org);
    const response = await scan(c, '96385074', there, abroad);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({ code: 'no_price', message: 'Oat milk — 1 L has no price in force here, so it cannot be sold yet.' });
  });

  it('MS-03, AC-01: scanning needs Sale.Create in that store; another store or organization gets a 403', async () => {
    const c = await catalogue();
    await sellable(c, { value: '4006381333931', kind: 'EAN13' });
    const viewer = signedInAs(await employeeWithAccess(db.app, c.org, ['Product.View', 'Price.View'], { assignedStore: null, accessStores: [c.store] }), c.org);
    expect((await scan(c, '4006381333931', viewer)).statusCode).toBe(403);
    const otherStore = await insertStore(db.app, c.org);
    expect((await scan(c, '4006381333931', c.as, otherStore)).statusCode, 'no access to that store').toBe(403);
    const elsewhere = await catalogue();
    expect((await scan(elsewhere, '4006381333931')).statusCode, "another organization's barcode is unknown here").toBe(404);
  });
});
