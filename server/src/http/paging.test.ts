import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboard } from '../onboarding.ts';
import { signedInAs, testApp } from '../../test/app.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import {
  actor,
  adjust,
  insertCategory,
  insertPrice,
  insertReasonCode,
  insertSellableVariant,
  insertStore,
  insertTaxCategory,
  insertUnit,
  insertWarehouse,
  onboardingAnswers,
  openShift,
} from '../../test/fixtures.ts';

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

type Headers = Record<string, string>;
type Page = { items: unknown[]; next: string | null; before?: number | null };

/**
 * At least three of everything a list holds, in one onboarded organization (TEST-ONLY). Built through fixtures where
 * it can be, because only the reading is under test here.
 */
async function world() {
  const o = await onboard(db.app, onboardingAnswers());
  const org = o.organizationId;
  const as = signedInAs(o.ownerEmployeeId, org);
  for (let i = 0; i < 3; i++) {
    await insertUnit(db.app, org);
    await insertTaxCategory(db.app, org);
    await insertCategory(db.app, org);
    await db.app.query('INSERT INTO brand (organization_id, name) VALUES ($1, $2)', [org, `Brand ${i}`]);
    await insertReasonCode(db.app, org);
    await db.app.query(`INSERT INTO payment_method (organization_id, code, name, method_type) VALUES ($1, $2, $2, 'Cash')`, [org, `M${i}`]);
  }
  // Two roles beside the Owner's, both the Owner's too; two stores beside the first, both open to the Owner.
  for (let i = 0; i < 2; i++) {
    const role = (await db.app.query<{ id: string }>('INSERT INTO role (organization_id, name) VALUES ($1, $2) RETURNING id', [org, `Role ${i}`])).rows[0]!.id;
    await db.app.query('INSERT INTO employee_role_assignment (employee_id, role_id, organization_id, store_id, assigned_by) VALUES ($1, $2, $3, NULL, $4)', [
      o.ownerEmployeeId,
      role,
      org,
      actor(),
    ]);
    const store = await insertStore(db.app, org);
    await db.app.query('INSERT INTO employee_store_access (employee_id, store_id, organization_id, granted_by) VALUES ($1, $2, $3, $4)', [
      o.ownerEmployeeId,
      store,
      org,
      actor(),
    ]);
  }
  // Three tills, each in service with a shift open, before more sellable locations make a till's own a choice.
  for (let i = 1; i <= 3; i++) {
    const made = await app.inject({ method: 'POST', url: `/api/v1/stores/${o.storeId}/terminals`, headers: as, payload: { code: `T${i}`, label: `Till ${i}` } });
    expect(made.statusCode, made.body).toBe(201);
    const { id, drawerId } = made.json() as { id: string; drawerId: string };
    await db.app.query(`UPDATE pos_terminal SET status = 'Active', status_changed_by = $2 WHERE id = $1`, [id, actor()]);
    await openShift(db.app, { store: o.storeId, terminal: id, drawer: drawerId });
  }
  for (let i = 0; i < 2; i++) await insertWarehouse(db.app, org, o.storeId);
  // Three versions of one price, and three balances, each with its movement.
  const priced = await insertSellableVariant(db.app, org);
  for (const days of [1, 2]) await insertPrice(db.app, org, priced.variantId, 100 + days, new Date(Date.now() + days * 86_400_000).toISOString());
  const reason = await insertReasonCode(db.app, org);
  for (let i = 0; i < 3; i++) {
    const { variantId } = await insertSellableVariant(db.app, org);
    await adjust(db.app, { org, store: o.storeId, reason }, [{ variant: variantId, location: o.defaultLocationId, type: 'OPENING_BALANCE', quantity: 5 }], 'OpeningBalance');
  }
  return { ...o, as, variant: priced.variantId };
}

const read = async (as: Headers, path: string, query: string): Promise<Page> => {
  const response = await app.inject({ method: 'GET', url: `/api/v1${path}${query === '' ? '' : `?${query}`}`, headers: as });
  expect(response.statusCode, `${path}?${query}: ${response.body}`).toBe(200);
  return response.json();
};

/** Every page of a list, two at a time, following `cursor` (`next`, or a route's older name for it). */
async function walk(as: Headers, path: string, cursor: (page: Page) => string | null, param = 'after') {
  const items: unknown[] = [];
  let at: string | null = null;
  let pages = 0;
  do {
    const page = await read(as, path, `limit=2${at === null ? '' : `&${param}=${encodeURIComponent(at)}`}`);
    if (pages === 0) {
      expect(page.items, `${path}: the first page is full`).toHaveLength(2);
      expect(cursor(page), `${path}: and says where to go on`).not.toBeNull();
    }
    items.push(...page.items);
    at = cursor(page);
    pages++;
  } while (at !== null && pages < 10);
  return items;
}

describe('paging every list (architecture s18.5)', () => {
  it('s18.5: every list is bounded and pages with limit and after; the pages, joined, are the whole list in its order', async () => {
    const w = await world();
    const lists: Record<string, string> = {
      units: '/units',
      'tax categories': '/tax-categories',
      categories: '/categories',
      brands: '/brands',
      roles: '/roles',
      "an employee's roles": `/employees/${w.ownerEmployeeId}/roles`,
      "an employee's stores": `/employees/${w.ownerEmployeeId}/stores`,
      'reason codes': '/reason-codes',
      'payment methods': '/payment-methods',
      tills: `/stores/${w.storeId}/terminals`,
      locations: `/stores/${w.storeId}/locations`,
      'price versions': `/variants/${w.variant}/prices`,
      shifts: `/stores/${w.storeId}/shifts`,
      stock: `/stores/${w.storeId}/stock`,
      movements: `/stores/${w.storeId}/movements`,
    };
    for (const [name, path] of Object.entries(lists)) {
      const whole = await read(w.as, path, '');
      expect(whole.items.length, `${name}: at least three to page`).toBeGreaterThanOrEqual(3);
      expect(whole.next, `${name}: one page holds them all`).toBeNull();
      expect(await walk(w.as, path, (page) => page.next), `${name}: the pages, joined`).toEqual(whole.items);
    }
    // The ledger's first name for its cursor still pages it the same way, for the screens written against it.
    expect(await walk(w.as, `/stores/${w.storeId}/movements`, (page) => (page.before ?? null) === null ? null : String(page.before), 'before')).toEqual(
      (await read(w.as, `/stores/${w.storeId}/movements`, '')).items,
    );
  });

  it('s18.5: a page is at most 200, a short list asked for no limit comes whole up to that, and a cursor that is not one is refused', async () => {
    const o = await onboard(db.app, onboardingAnswers());
    const as = signedInAs(o.ownerEmployeeId, o.organizationId);
    for (let i = 0; i < 60; i++) await insertUnit(db.app, o.organizationId);
    const whole = await read(as, '/units', '');
    expect(whole.items, 'a screen that reads a short list whole still gets all of it').toHaveLength(60);
    expect(whole.next).toBeNull();
    const status = async (query: string) => (await app.inject({ method: 'GET', url: `/api/v1/units?${query}`, headers: as })).statusCode;
    expect(await status('limit=200')).toBe(200);
    expect(await status('limit=201')).toBe(400);
    expect(await status('limit=0')).toBe(400);
    expect(await status('after=nonsense')).toBe(400);
  });
});
