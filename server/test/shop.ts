import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { onboard } from '../src/onboarding.ts';
import { signedInAs } from './app.ts';
import type { TestDb } from './db.ts';
import { employeeWithAccess, insertLocation, onboardingAnswers } from './fixtures.ts';

export type Headers = Record<string, string>;
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A store that has sold something, built through the routes in TEST-ONLY terms: an inclusive 10% tax, cash and a card
 * (taken by the simulated gateway) enabled, an active till with an open shift, a clerk at it who can sell, take a card,
 * return, and draft and pay refunds, two managers who approve, and a location of each kind a return can be sent to. The
 * first sale, two Oat milk and one Bread, was paid in cash.
 */
export function shopKit(db: TestDb, app: FastifyInstance) {
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, as: Headers, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: as, ...(payload ? { payload } : {}) });

  async function ok(method: 'POST' | 'PUT', url: string, as: Headers, payload: object): Promise<Json> {
    const response = await call(method, url, as, payload);
    expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
    return response.json();
  }

  async function shop() {
    const o = await onboard(db.app, onboardingAnswers());
    const owner = signedInAs(o.ownerEmployeeId, o.organizationId);
    const unit = (await ok('POST', '/units', owner, { code: 'EA', name: 'Each', quantityKind: 'Countable', scale: 0 })).id as string;
    const tax = (await ok('POST', '/tax-categories', owner, { code: 'STD', name: 'TEST-ONLY standard' })).id as string;
    await ok('POST', `/tax-categories/${tax}/rates`, owner, { jurisdiction: 'TEST-ONLY', ratePercent: '10' });
    const category = (await ok('POST', '/categories', owner, { name: 'Groceries', parentId: null, sortOrder: 1 })).id as string;
    const item = async (name: string, amount: number, barcode: { value: string; kind: string }) => {
      const product = (await ok('POST', '/products', owner, { categoryId: category, name })).id as string;
      await ok('POST', `/products/${product}/variants`, owner, { baseUnitId: unit, taxCategoryId: tax, price: { amount }, barcodes: [barcode] });
      await ok('POST', '/transitions', owner, { machine: 'Product', event: 'activate', subject: product });
    };
    await item('Oat milk', 1_250, { value: '012345678905', kind: 'UPC_A' });
    await item('Bread', 500, { value: '4006381333931', kind: 'EAN13' });
    const cash = (await ok('POST', '/payment-methods', owner, { code: 'CASH', name: 'Cash', methodType: 'Cash' })).id as string;
    await ok('PUT', `/stores/${o.storeId}/payment-methods/${cash}`, owner, { enabled: true });
    const card = (await ok('POST', '/payment-methods', owner, { code: 'CARD', name: 'Card (TEST / simulated)', methodType: 'Card' })).id as string;
    await ok('PUT', `/stores/${o.storeId}/payment-methods/${card}`, owner, { enabled: true });
    const till = (await ok('POST', `/stores/${o.storeId}/terminals`, owner, { code: 'T1', label: 'Till 1' })).id as string;
    await ok('POST', '/transitions', owner, { machine: 'Device', event: 'activate', subject: till });
    const staff = (keys: string[], at?: string) =>
      employeeWithAccess(db.app, o.organizationId, keys, { assignedStore: o.storeId, accessStores: [o.storeId] }).then((id) => signedInAs(id, o.organizationId, at));
    const clerk = await staff(['Sale.Create', 'Sale.View', 'Shift.Open', 'Payment.Capture', 'Return.Create', 'Sale.Refund', 'Refund.Pay'], till);
    const manager = await staff(['Return.Approve', 'Sale.Refund.Large.Approve', 'Return.Create', 'Sale.Refund']);
    const manager2 = await staff(['Return.Approve', 'Sale.Refund.Large.Approve']);
    const reason = (await ok('POST', '/reason-codes', owner, { code: 'WHY', name: 'Because' })).id as string;

    const where = await db.app.query<{ warehouse_id: string; id: string }>(
      `SELECT l.id, l.warehouse_id FROM storage_location l JOIN warehouse w ON w.id = l.warehouse_id WHERE w.store_id = $1 AND l.is_sellable`,
      [o.storeId],
    );
    const sellable = where.rows[0]!.id;
    const quarantine = await insertLocation(db.app, o.organizationId, where.rows[0]!.warehouse_id, 'StoreAttached', 'Quarantine', false);

    await ok('POST', `/stores/${o.storeId}/shift`, clerk, { openingFloat: 10_000 });
    const store = `/stores/${o.storeId}`;
    const quote = async (code: string) => (await call('GET', `${store}/scan/${code}`, clerk)).json().quote as string;
    const sell = async (body: Json, as: Headers = clerk) =>
      call('POST', `${store}/sales`, as, {
        clientOperationId: randomUUID(),
        lines: [
          { quote: await quote('012345678905'), quantity: 2 },
          { quote: await quote('4006381333931'), quantity: 1 },
        ],
        ...body,
      });
    const sale = (await sell({ cash: { tendered: 5_000 } }).then((r) => {
      expect(r.statusCode, r.body).toBe(201);
      return r.json();
    })) as Json;
    const milk = sale.lines.find((l: Json) => l.description === 'Oat milk') as Json;
    const bread = sale.lines.find((l: Json) => l.description === 'Bread') as Json;
    const go = (as: Headers, machine: string, event: string, subject: string, extra: object = {}) =>
      call('POST', '/transitions', as, { machine, event, subject, ...extra });
    return { ...o, owner, clerk, manager, manager2, reason, sellable, quarantine, sale, milk, bread, store, go, till, quote, sell, staff };
  }
  return { call, ok, shop };
}
export type Shop = Awaited<ReturnType<ReturnType<typeof shopKit>['shop']>>;
