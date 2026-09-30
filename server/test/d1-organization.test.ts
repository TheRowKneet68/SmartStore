import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, inTransaction, sqlState, type TestDb } from './db.ts';
import {
  actor,
  ensureTestCurrency,
  insertLocation,
  insertOrganization,
  insertStore,
  insertWarehouse,
  TEST_CURRENCY,
} from './fixtures.ts';

/** Domain 1 — Organization / Store / Warehouse. Design: docs/database/D1-ORGANIZATION-STORE-WAREHOUSE.md */

let db: TestDb;
let orgId: string;
let storeId: string;

beforeAll(async () => {
  db = await createTestDb();
  await ensureTestCurrency(db.owner);
  orgId = await insertOrganization(db.app);
  storeId = await insertStore(db.app, orgId);
});
afterAll(async () => {
  await db.drop();
});


describe('currency (BI-01, ADR-04)', () => {
  it('BI-01: a currency code is three upper-case letters', async () => {
    const insert = (code: string) =>
      db.app.query('INSERT INTO currency (code, minor_unit_exponent) VALUES ($1, 2)', [code]);
    expect(await sqlState(insert('xta'))).toBe('23514');
    expect(await sqlState(insert('XTAB'))).toBe('23514');
    expect(await sqlState(insert('XT'))).toBe('23514');
    expect(await sqlState(insert('XTA'))).toBeUndefined();
  });

  it('ADR-04: the exponent is recorded, may be 0 or 3, and must keep 10^exponent inside a bigint', async () => {
    const insert = (code: string, exponent: number) =>
      db.app.query('INSERT INTO currency (code, minor_unit_exponent) VALUES ($1, $2)', [code, exponent]);
    expect(await sqlState(insert('XTC', 0))).toBeUndefined();
    expect(await sqlState(insert('XTD', 3))).toBeUndefined();
    expect(await sqlState(insert('XTE', 19))).toBe('23514');
    expect(await sqlState(insert('XTF', -1))).toBe('23514');
  });

  it('BI-01, ADR-04: the runtime role cannot change an exponent, which would reinterpret every stored amount', async () => {
    expect(
      await sqlState(db.app.query('UPDATE currency SET minor_unit_exponent = 3 WHERE code = $1', [TEST_CURRENCY])),
    ).toBe('42501');
  });
});

describe('organization (ORG-01, ORG-02, ORG-03, RT-504, RT-505, RT-506)', () => {
  it('RT-506, ORG-03: the application cannot delete an organization', async () => {
    const id = await insertOrganization(db.app);
    expect(await sqlState(db.app.query('DELETE FROM organization WHERE id = $1', [id]))).toBe('42501');
  });

  it('RT-506, BI-40, RT-353: deactivation records who and server time, once', async () => {
    const id = await insertOrganization(db.app);
    const who = actor();
    const { rows } = await db.app.query<{ deactivated_by: string; stamped: boolean }>(
      `UPDATE organization SET deactivated_by = $2 WHERE id = $1
       RETURNING deactivated_by, deactivated_at = now() AS stamped`,
      [id, who],
    );
    expect(rows[0]).toEqual({ deactivated_by: who, stamped: true });

    const again = db.app.query('UPDATE organization SET deactivated_by = $2 WHERE id = $1', [id, actor()]);
    expect(await sqlState(again)).toBe('SS001');
    const cleared = db.app.query('UPDATE organization SET deactivated_by = NULL WHERE id = $1', [id]);
    expect(await sqlState(cleared)).toBe('SS001');
    const clock = db.app.query(`UPDATE organization SET deactivated_at = now() - interval '1 day' WHERE id = $1`, [id]);
    expect(await sqlState(clock)).toBe('42501');
  });

  it('ORG-01, ORG-02, RT-505: currency and time zone are settable while no financial document exists', async () => {
    const id = await insertOrganization(db.app);
    expect(
      await sqlState(db.app.query(`UPDATE organization SET time_zone = 'Asia/Kathmandu' WHERE id = $1`, [id])),
    ).toBeUndefined();
    expect(
      await sqlState(db.app.query('UPDATE organization SET currency_code = $2 WHERE id = $1', [id, TEST_CURRENCY])),
    ).toBeUndefined();
  });

  it('RT-505, ORG-02: a time zone must be a real IANA zone; abbreviations and POSIX offsets are refused', async () => {
    const insert = (zone: string) =>
      db.app.query('INSERT INTO organization (legal_name, currency_code, time_zone) VALUES ($1, $2, $3)', [
        `Org ${zone}`,
        TEST_CURRENCY,
        zone,
      ]);
    for (const bad of ['Mars/Olympus', 'UTC+5', 'PST', 'EST5EDT', '', ' UTC']) {
      expect(await sqlState(insert(bad)), bad).toBe('23514');
    }
    for (const good of ['UTC', 'Asia/Kathmandu', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) {
      expect(await sqlState(insert(good)), good).toBeUndefined();
    }
  });

  it('CONVENTIONS s6: names are never blank and never padded', async () => {
    const insert = (name: string) =>
      db.app.query('INSERT INTO organization (legal_name, currency_code, time_zone) VALUES ($1, $2, $3)', [
        name,
        TEST_CURRENCY,
        'UTC',
      ]);
    expect(await sqlState(insert(''))).toBe('23514');
    expect(await sqlState(insert(' Padded'))).toBe('23514');
  });
});

describe('store (RT-001, RT-269, ORG-05, RT-508)', () => {
  it('RT-269: an organization holds a second store without a migration', async () => {
    const org = await insertOrganization(db.app);
    await insertStore(db.app, org);
    await insertStore(db.app, org);
    const { rows } = await db.app.query('SELECT 1 FROM store WHERE organization_id = $1', [org]);
    expect(rows).toHaveLength(2);
  });

  it('RT-508, ORG-05: the application cannot delete a store', async () => {
    expect(await sqlState(db.app.query('DELETE FROM store WHERE id = $1', [storeId]))).toBe('42501');
  });

  it('RT-508, RT-353: store deactivation records who and server time, once', async () => {
    const id = await insertStore(db.app, orgId);
    const { rows } = await db.app.query<{ stamped: boolean }>(
      'UPDATE store SET deactivated_by = $2 WHERE id = $1 RETURNING deactivated_at = now() AS stamped',
      [id, actor()],
    );
    expect(rows[0]!.stamped).toBe(true);
    expect(await sqlState(db.app.query('UPDATE store SET deactivated_by = $2 WHERE id = $1', [id, actor()]))).toBe(
      'SS001',
    );
  });

  it('organization-model s3.1: the store currency cannot be changed', async () => {
    const change = db.app.query('UPDATE store SET currency_code = $2 WHERE id = $1', [storeId, TEST_CURRENCY]);
    expect(await sqlState(change)).toBe('42501');
  });

  it('OQ-007: the application cannot change a store time zone', async () => {
    const change = db.app.query(`UPDATE store SET time_zone = 'Asia/Kathmandu' WHERE id = $1`, [storeId]);
    expect(await sqlState(change)).toBe('42501');
  });

  it('RT-001: a store cannot move to another organization', async () => {
    const other = await insertOrganization(db.app);
    const move = db.app.query('UPDATE store SET organization_id = $2 WHERE id = $1', [storeId, other]);
    expect(await sqlState(move)).toBe('42501');
  });

  it('OQ-008: a store code is unique within its organization, not across organizations', async () => {
    const code = `DUP-${randomUUID()}`;
    await insertStore(db.app, orgId, code);
    expect(await sqlState(insertStore(db.app, orgId, code))).toBe('23505');
    const other = await insertOrganization(db.app);
    expect(await sqlState(insertStore(db.app, other, code))).toBeUndefined();
  });

  it('RT-001: a store must name an organization', async () => {
    const insert = db.app.query(
      `INSERT INTO store (organization_id, code, name, time_zone, currency_code) VALUES (NULL, 'X', 'X', 'UTC', $1)`,
      [TEST_CURRENCY],
    );
    expect(await sqlState(insert)).toBe('23502');
  });
});

describe('store settings (REQ-AU-06, SP-33, PR-38, IV-16)', () => {
  const insertVersion = (store: string, values: { effectiveFrom?: string; taxMode?: string; policy?: string }) =>
    values.effectiveFrom
      ? db.app.query(
          `INSERT INTO store_setting_version (store_id, effective_from, tax_mode, negative_stock_policy, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [store, values.effectiveFrom, values.taxMode ?? 'Inclusive', values.policy ?? 'AllowNegative', actor()],
        )
      : db.app.query(
          `INSERT INTO store_setting_version (store_id, tax_mode, negative_stock_policy, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [store, values.taxMode ?? 'Inclusive', values.policy ?? 'AllowNegative', actor()],
        );

  it('REQ-AU-06: a change takes effect now or later, never in the past', async () => {
    const store = await insertStore(db.app, orgId);
    expect(await sqlState(insertVersion(store, {}))).toBeUndefined();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(await sqlState(insertVersion(store, { effectiveFrom: past }))).toBe('23514');
  });

  it('REQ-AU-06: the version in force is the latest one whose effective time has passed', async () => {
    const store = await insertStore(db.app, orgId);
    await insertVersion(store, { taxMode: 'Inclusive', policy: 'AllowNegative' });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await insertVersion(store, { effectiveFrom: tomorrow, taxMode: 'Inclusive', policy: 'BlockNegative' });

    // "Now" is the database's clock, never the test process's (RT-353). Using the client clock here made this test
    // fail intermittently whenever it read a fraction of a millisecond behind the server.
    const inForce = (offset: string) =>
      db.app.query<{ negative_stock_policy: string }>(
        `SELECT negative_stock_policy FROM store_setting_version
         WHERE store_id = $1 AND effective_from <= now() + $2::interval
         ORDER BY effective_from DESC LIMIT 1`,
        [store, offset],
      );
    expect((await inForce('0 seconds')).rows[0]!.negative_stock_policy).toBe('AllowNegative');
    expect((await inForce('2 days')).rows[0]!.negative_stock_policy).toBe('BlockNegative');
  });

  it('REQ-AU-06: two versions cannot take effect at the same instant', async () => {
    const store = await insertStore(db.app, orgId);
    const when = new Date(Date.now() + 86_400_000).toISOString();
    await insertVersion(store, { effectiveFrom: when });
    expect(await sqlState(insertVersion(store, { effectiveFrom: when }))).toBe('23505');
  });

  it('BI-24, REQ-AU-06: versions are append-only for the runtime role', async () => {
    const store = await insertStore(db.app, orgId);
    const { rows } = await insertVersion(store, {});
    const id = (rows[0] as { id: string }).id;
    const update = db.app.query(`UPDATE store_setting_version SET tax_mode = 'Exclusive' WHERE id = $1`, [id]);
    expect(await sqlState(update)).toBe('42501');
    expect(await sqlState(db.app.query('DELETE FROM store_setting_version WHERE id = $1', [id]))).toBe('42501');
  });

  it('RT-353: the runtime role cannot supply created_at', async () => {
    const store = await insertStore(db.app, orgId);
    const insert = db.app.query(
      `INSERT INTO store_setting_version (store_id, tax_mode, negative_stock_policy, created_by, created_at)
       VALUES ($1, 'Inclusive', 'AllowNegative', $2, now() - interval '1 day')`,
      [store, actor()],
    );
    expect(await sqlState(insert)).toBe('42501');
  });

  it('SP-33, IV-16, CON-07: only the specified tax modes and negative-stock policies exist', async () => {
    const store = await insertStore(db.app, orgId);
    expect(await sqlState(insertVersion(store, { taxMode: 'Mixed' }))).toBe('23514');
    expect(await sqlState(insertVersion(store, { policy: 'Allow' }))).toBe('23514');
    const later = new Date(Date.now() + 60_000).toISOString();
    expect(await sqlState(insertVersion(store, { effectiveFrom: later, taxMode: 'Exclusive', policy: 'BlockNegative' })))
      .toBeUndefined();
  });
});

describe('warehouse (RT-003, MS-15)', () => {
  const insertBare = (client: pg.PoolClient | pg.Pool, organization: string, store: string | null, kind: string) =>
    client.query(
      `INSERT INTO warehouse (organization_id, store_id, kind, code, name) VALUES ($1, $2, $3, $4, 'W') RETURNING id`,
      [organization, store, kind, `W-${randomUUID()}`],
    );

  it('RT-003: a store-attached warehouse and a central warehouse can both be created', async () => {
    expect((await insertWarehouse(db.app, orgId, storeId)).warehouseId).toBeTruthy();
    expect((await insertWarehouse(db.app, orgId, null)).warehouseId).toBeTruthy();
  });

  it('RT-003: a store-attached warehouse must name its store, and a central one must not', async () => {
    expect(await sqlState(insertBare(db.app, orgId, null, 'StoreAttached'))).toBe('23514');
    expect(await sqlState(insertBare(db.app, orgId, storeId, 'Central'))).toBe('23514');
    expect(await sqlState(insertBare(db.app, orgId, storeId, 'Floating'))).toBe('23514');
  });

  it("RT-003, BI-14: a store-attached warehouse cannot belong to another organization's store", async () => {
    const other = await insertOrganization(db.app);
    expect(await sqlState(insertBare(db.app, other, storeId, 'StoreAttached'))).toBe('23503');
  });

  it('organization-model s1: a warehouse cannot be committed without its Default location', async () => {
    const attempt = inTransaction(db.app, (c) => insertBare(c, orgId, storeId, 'StoreAttached'));
    expect(await sqlState(attempt)).toBe('SS002');
  });

  it('organization-model s5: a warehouse has at most one Default location', async () => {
    const { warehouseId } = await insertWarehouse(db.app, orgId, storeId);
    const second = insertLocation(db.app, orgId, warehouseId, 'StoreAttached', 'Default', true);
    expect(await sqlState(second)).toBe('23505');
  });

  it("RT-003: the application cannot change a warehouse's kind or store", async () => {
    const { warehouseId } = await insertWarehouse(db.app, orgId, storeId);
    expect(await sqlState(db.app.query(`UPDATE warehouse SET kind = 'Central' WHERE id = $1`, [warehouseId]))).toBe(
      '42501',
    );
    expect(await sqlState(db.app.query('UPDATE warehouse SET store_id = NULL WHERE id = $1', [warehouseId]))).toBe(
      '42501',
    );
    expect(await sqlState(db.app.query('DELETE FROM warehouse WHERE id = $1', [warehouseId]))).toBe('42501');
  });
});

describe('storage location (WH-01, WH-02, WH-03, WH-04, RT-004, RT-509, RT-510)', () => {
  it('RT-004, MS-18, WH-02: no location in a central warehouse can be sellable', async () => {
    const central = await insertWarehouse(db.app, orgId, null);
    const makeSellable = db.app.query('UPDATE storage_location SET is_sellable = true WHERE id = $1', [
      central.defaultLocationId,
    ]);
    expect(await sqlState(makeSellable)).toBe('23514');
  });

  it('WH-01, WH-04, RT-510: only a Default location can be sellable', async () => {
    const { warehouseId } = await insertWarehouse(db.app, orgId, storeId);
    for (const type of ['Receiving', 'Quarantine', 'Damaged', 'ReturnsPending', 'Transit']) {
      expect(await sqlState(insertLocation(db.app, orgId, warehouseId, 'StoreAttached', type, true)), type).toBe(
        '23514',
      );
      expect(await sqlState(insertLocation(db.app, orgId, warehouseId, 'StoreAttached', type, false)), type)
        .toBeUndefined();
    }
  });

  it('organization-model s5: a location type outside the standard set is refused', async () => {
    const { warehouseId } = await insertWarehouse(db.app, orgId, storeId);
    expect(await sqlState(insertLocation(db.app, orgId, warehouseId, 'StoreAttached', 'Shelf', false))).toBe('23514');
  });

  it('WH-03, RT-509: sellability can be turned off at any time, and back on', async () => {
    const { defaultLocationId } = await insertWarehouse(db.app, orgId, storeId);
    const set = (value: boolean) =>
      db.app.query('UPDATE storage_location SET is_sellable = $2 WHERE id = $1', [defaultLocationId, value]);
    expect(await sqlState(set(false))).toBeUndefined();
    expect(await sqlState(set(true))).toBeUndefined();
  });

  it('WH-03, RT-509: the application cannot delete a location', async () => {
    const { defaultLocationId } = await insertWarehouse(db.app, orgId, storeId);
    expect(await sqlState(db.app.query('DELETE FROM storage_location WHERE id = $1', [defaultLocationId]))).toBe(
      '42501',
    );
  });

  it('organization-model s5: a location type cannot be changed, so the Default stays the Default', async () => {
    const { defaultLocationId } = await insertWarehouse(db.app, orgId, storeId);
    const change = db.app.query(`UPDATE storage_location SET location_type = 'Receiving' WHERE id = $1`, [
      defaultLocationId,
    ]);
    expect(await sqlState(change)).toBe('42501');
  });

  it("D-03, MS-17: a location must carry its warehouse's real kind and organization", async () => {
    const { warehouseId } = await insertWarehouse(db.app, orgId, storeId);
    expect(await sqlState(insertLocation(db.app, orgId, warehouseId, 'Central', 'Receiving', false))).toBe('23503');
    const other = await insertOrganization(db.app);
    expect(await sqlState(insertLocation(db.app, other, warehouseId, 'StoreAttached', 'Receiving', false))).toBe(
      '23503',
    );
  });
});

describe('store attribution of central locations (D-03, MS-16, MS-19)', () => {
  const attribute = (location: string, kind: string, organization: string, store: string) =>
    db.app.query(
      `INSERT INTO storage_location_attribution
         (storage_location_id, location_warehouse_kind, organization_id, store_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [location, kind, organization, store, actor()],
    );

  it('D-03: one central location can be attributed to several stores, each once', async () => {
    const storeB = await insertStore(db.app, orgId);
    const { defaultLocationId } = await insertWarehouse(db.app, orgId, null);
    expect(await sqlState(attribute(defaultLocationId, 'Central', orgId, storeId))).toBeUndefined();
    expect(await sqlState(attribute(defaultLocationId, 'Central', orgId, storeB))).toBeUndefined();
    expect(await sqlState(attribute(defaultLocationId, 'Central', orgId, storeB))).toBe('23505');
    const { rows } = await db.app.query('SELECT 1 FROM storage_location_attribution WHERE storage_location_id = $1', [
      defaultLocationId,
    ]);
    expect(rows).toHaveLength(2);
  });

  it('D-03: a store-attached location is never attributed explicitly', async () => {
    const { defaultLocationId } = await insertWarehouse(db.app, orgId, storeId);
    expect(await sqlState(attribute(defaultLocationId, 'StoreAttached', orgId, storeId))).toBe('23514');
    expect(await sqlState(attribute(defaultLocationId, 'Central', orgId, storeId))).toBe('23503');
  });

  it('D-03, BI-14: an attribution never crosses organizations', async () => {
    const other = await insertOrganization(db.app);
    const otherStore = await insertStore(db.app, other);
    const { defaultLocationId } = await insertWarehouse(db.app, orgId, null);
    expect(await sqlState(attribute(defaultLocationId, 'Central', orgId, otherStore))).toBe('23503');
    expect(await sqlState(attribute(defaultLocationId, 'Central', other, otherStore))).toBe('23503');
  });

  it('BI-24: an attribution is append-only for the runtime role', async () => {
    const { defaultLocationId } = await insertWarehouse(db.app, orgId, null);
    await attribute(defaultLocationId, 'Central', orgId, storeId);
    const del = db.app.query('DELETE FROM storage_location_attribution WHERE storage_location_id = $1', [
      defaultLocationId,
    ]);
    expect(await sqlState(del)).toBe('42501');
    const upd = db.app.query('UPDATE storage_location_attribution SET store_id = store_id WHERE storage_location_id = $1', [
      defaultLocationId,
    ]);
    expect(await sqlState(upd)).toBe('42501');
  });
});

describe('document numbers (BI-42, RT-479)', () => {
  const TYPE_A = 'TestDocA'; // TEST-ONLY document types; real ones are added by the domains that own them
  const TYPE_B = 'TestDocB';

  beforeAll(async () => {
    await db.owner.query('INSERT INTO document_type (code) VALUES ($1), ($2)', [TYPE_A, TYPE_B]);
  });

  const allocate = (pool: pg.Pool | pg.PoolClient, store: string, type: string) =>
    pool
      .query<{ n: string }>('SELECT allocate_document_number($1, $2) AS n', [store, type])
      .then((r) => Number(r.rows[0]!.n));

  it('BI-42: numbering starts at 1 and runs per store and per document type', async () => {
    const storeA = await insertStore(db.app, orgId);
    const storeB = await insertStore(db.app, orgId);
    expect([await allocate(db.app, storeA, TYPE_A), await allocate(db.app, storeA, TYPE_A)]).toEqual([1, 2]);
    expect(await allocate(db.app, storeB, TYPE_A)).toBe(1);
    expect(await allocate(db.app, storeA, TYPE_B)).toBe(1);
    expect(await allocate(db.app, storeA, TYPE_A)).toBe(3);
  });

  it('RT-479: 1,000 concurrent allocations yield 1,000 unique, contiguous numbers', async () => {
    const store = await insertStore(db.app, orgId);
    const wide = new pg.Pool({ connectionString: db.appUrl, max: 20 });
    try {
      const numbers = await Promise.all(Array.from({ length: 1000 }, () => allocate(wide, store, TYPE_A)));
      expect(new Set(numbers).size).toBe(1000);
      expect(Math.min(...numbers)).toBe(1);
      expect(Math.max(...numbers)).toBe(1000);
    } finally {
      await wide.end();
    }
  });

  it('RT-479: a rolled-back allocation is issued again, so no committed number is ever held twice', async () => {
    const store = await insertStore(db.app, orgId);
    const committedFirst = await allocate(db.app, store, TYPE_A);
    const client = await db.app.connect();
    let rolledBack: number;
    try {
      await client.query('BEGIN');
      rolledBack = await allocate(client, store, TYPE_A);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const committedNext = await allocate(db.app, store, TYPE_A);
    expect(rolledBack).toBe(committedFirst + 1);
    expect(committedNext).toBe(rolledBack);
    expect(committedNext).not.toBe(committedFirst);
  });

  it('BI-42: a counter cannot move backwards or be re-keyed', async () => {
    const store = await insertStore(db.app, orgId);
    await allocate(db.app, store, TYPE_A);
    await allocate(db.app, store, TYPE_A);
    const back = db.app.query(
      'UPDATE document_number_sequence SET last_value = last_value - 1 WHERE store_id = $1 AND document_type = $2',
      [store, TYPE_A],
    );
    expect(await sqlState(back)).toBe('SS003');
    const rekey = db.app.query(
      'UPDATE document_number_sequence SET document_type = $3 WHERE store_id = $1 AND document_type = $2',
      [store, TYPE_A, TYPE_B],
    );
    expect(await sqlState(rekey)).toBe('42501');
  });

  it('ADR-21, BI-42: document types are a closed set the application cannot extend', async () => {
    expect(await sqlState(db.app.query(`INSERT INTO document_type (code) VALUES ('Invented')`))).toBe('42501');
    expect(await sqlState(allocate(db.app, storeId, 'Invented'))).toBe('23503');
  });
});
