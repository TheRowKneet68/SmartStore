import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db.ts';

/**
 * Rules that hold across the whole schema. Each test inspects the catalog, so a new table that breaks a rule fails
 * here without anyone writing a test for it.
 */

/**
 * RT-001, MS-01, overview s3.9, organization-model s8: every table's scope, declared. A new table must be added
 * here, which forces its author to decide whether it is store-scoped.
 *   tenant        the organization itself
 *   organization  organization_id NOT NULL, no store_id
 *   store         store_id NOT NULL with a foreign key to store
 *   reference     neither (closed vocabularies and reference data)
 *   exception     documented below
 */
const SCOPE: Record<string, 'tenant' | 'organization' | 'store' | 'reference' | 'exception'> = {
  organization: 'tenant',
  currency: 'reference',
  document_type: 'reference',
  store: 'organization',
  store_setting_version: 'store',
  // RT-003: scope is chosen per row. A store-attached warehouse carries store_id; a central one belongs to the
  // organization (organization-model s8.1). ck_warehouse_store_iff_attached ties the two together.
  warehouse: 'exception',
  // D-03 (owner decision): a location carries no single StoreId. Its store is its warehouse's, or an explicit
  // attribution when the warehouse is central.
  storage_location: 'organization',
  storage_location_attribution: 'store',
  document_number_sequence: 'store',
};

/** Tables whose rows are history: the application role may read and insert, never update or delete. */
const APPEND_ONLY = ['store_setting_version', 'storage_location_attribution'];

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

async function publicTables(): Promise<string[]> {
  const { rows } = await db.owner.query<{ name: string }>(`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'schema_migrations'
    ORDER BY 1`);
  return rows.map((r) => r.name);
}

interface Column {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
}

async function columns(): Promise<Column[]> {
  const { rows } = await db.owner.query<Column>(`
    SELECT table_name, column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> 'schema_migrations'`);
  return rows;
}

/** Tables with a foreign key whose columns include `column` and that references `target`. */
async function tablesWithForeignKey(column: string, target: string): Promise<Set<string>> {
  const { rows } = await db.owner.query<{ name: string }>(
    `SELECT DISTINCT cl.relname AS name
     FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.contype = 'f' AND a.attname = $1 AND con.confrelid = $2::regclass`,
    [column, target],
  );
  return new Set(rows.map((r) => r.name));
}

describe('RT-001, MS-01: every table declares its scope, and store scope is a non-null StoreId', () => {
  it('every table in the schema is classified, and every classified table exists', async () => {
    const tables = await publicTables();
    expect(tables.filter((t) => !(t in SCOPE)), 'add each new table to SCOPE in schema-rules.test.ts').toEqual([]);
    expect(Object.keys(SCOPE).filter((t) => !tables.includes(t))).toEqual([]);
  });

  it('store-scoped tables carry store_id NOT NULL with a foreign key to store', async () => {
    const cols = await columns();
    const fk = await tablesWithForeignKey('store_id', 'store');
    const problems = Object.entries(SCOPE)
      .filter(([, scope]) => scope === 'store')
      .flatMap(([table]) => {
        const c = cols.find((x) => x.table_name === table && x.column_name === 'store_id');
        if (!c) return [`${table}: no store_id`];
        if (c.is_nullable === 'YES') return [`${table}: store_id is nullable`];
        if (!fk.has(table)) return [`${table}: store_id has no foreign key to store`];
        return [];
      });
    expect(problems).toEqual([]);
  });

  it('organization-scoped tables carry organization_id NOT NULL with a foreign key, and no store_id', async () => {
    const cols = await columns();
    const fk = await tablesWithForeignKey('organization_id', 'organization');
    const viaWarehouse = await tablesWithForeignKey('organization_id', 'warehouse');
    const problems = Object.entries(SCOPE)
      .filter(([, scope]) => scope === 'organization')
      .flatMap(([table]) => {
        const c = cols.find((x) => x.table_name === table && x.column_name === 'organization_id');
        if (!c) return [`${table}: no organization_id`];
        if (c.is_nullable === 'YES') return [`${table}: organization_id is nullable`];
        if (!fk.has(table) && !viaWarehouse.has(table)) return [`${table}: organization_id has no foreign key`];
        if (cols.some((x) => x.table_name === table && x.column_name === 'store_id')) return [`${table}: has store_id`];
        return [];
      });
    expect(problems).toEqual([]);
  });

  it('tenant and reference tables carry neither scope column', async () => {
    const cols = await columns();
    const problems = Object.entries(SCOPE)
      .filter(([, scope]) => scope === 'tenant' || scope === 'reference')
      .flatMap(([table]) =>
        cols
          .filter((x) => x.table_name === table && (x.column_name === 'store_id' || x.column_name === 'organization_id'))
          .map((x) => `${table}: has ${x.column_name}`),
      );
    expect(problems).toEqual([]);
  });

  it('RT-003: the warehouse exception is tied to its kind by a check constraint', async () => {
    const { rows } = await db.owner.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'ck_warehouse_store_iff_attached' AND conrelid = 'warehouse'::regclass`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('BI-01: no money, or anything else, is stored as a binary float', () => {
  it('no column in the schema is real or double precision', async () => {
    const { rows } = await db.owner.query<{ col: string }>(`
      SELECT table_name || '.' || column_name AS col FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('real', 'double precision')`);
    expect(rows.map((r) => r.col)).toEqual([]);
  });
});

describe('ADR-11, BI-40, CONVENTIONS s10: what the runtime role may do', () => {
  it('BI-40, RT-346: the runtime role may DELETE or TRUNCATE nothing', async () => {
    const { rows } = await db.owner.query<{ t: string; p: string }>(`
      SELECT c.relname AS t, p AS p
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['DELETE', 'TRUNCATE']) AS p
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege('smartstore_app', c.oid, p)`);
    expect(rows).toEqual([]);
  });

  it('BI-24, REQ-AU-06: append-only tables grant the runtime role no UPDATE on any column', async () => {
    const { rows } = await db.owner.query<{ t: string }>(
      `SELECT t FROM unnest($1::text[]) AS t WHERE has_any_column_privilege('smartstore_app', t, 'UPDATE')`,
      [APPEND_ONLY],
    );
    expect(rows).toEqual([]);
  });

  it('RT-353: created_at is never insertable by the runtime role, so it is always server time', async () => {
    const { rows } = await db.owner.query<{ t: string }>(`
      SELECT table_name AS t FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'created_at'
        AND (has_column_privilege('smartstore_app', table_name, 'created_at', 'INSERT')
          OR has_column_privilege('smartstore_app', table_name, 'created_at', 'UPDATE'))`);
    expect(rows).toEqual([]);
  });

  it('the runtime role owns nothing and cannot create objects', async () => {
    const owned = await db.owner.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'smartstore_app'`);
    expect(owned.rows).toEqual([]);
    const create = await db.owner.query<{ ok: boolean }>(
      `SELECT has_schema_privilege('smartstore_app', 'public', 'CREATE') AS ok`,
    );
    expect(create.rows[0]!.ok).toBe(false);
    const role = await db.owner.query<{ rolsuper: boolean; rolcreatedb: boolean }>(
      `SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = 'smartstore_app'`,
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false });
  });

  it('AU-32, BI-40: no foreign key cascades or nulls on delete or update', async () => {
    const { rows } = await db.owner.query<{ name: string }>(`
      SELECT con.conname AS name FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
      WHERE n.nspname = 'public' AND con.contype = 'f'
        AND (con.confdeltype NOT IN ('a', 'r') OR con.confupdtype NOT IN ('a', 'r'))`);
    expect(rows).toEqual([]);
  });
});
