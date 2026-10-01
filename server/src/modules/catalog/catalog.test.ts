import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signedInAs, testApp } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { employeeWithAccess, insertOrganization, insertReasonCode, insertStore } from '../../../test/fixtures.ts';

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
    expect((await scan(c, '012345678905')).json().price).toEqual({ amount: 1_100, currencyCode: 'XTS', minorUnitExponent: 2, source: 'store' });
  });
});

describe("the till's scan (UX-09, UX-11, UX-25, UX-48, SM-11, RT-124, RT-493, ADR-31 s8)", () => {
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
        price: { amount: 1_250, currencyCode: 'XTS', minorUnitExponent: 2, source: 'organization' },
        quotedAt: expect.any(String),
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
