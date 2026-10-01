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
  // Domain 2. organization-model s8.1: the catalog, units and tax categories are organization-global.
  state_machine_state: 'reference',
  state_machine_edge: 'reference',
  unit: 'organization',
  tax_category: 'organization',
  tax_rate: 'organization',
  category: 'organization',
  brand: 'organization',
  product: 'organization',
  product_variant: 'organization',
  product_barcode: 'organization',
  variant_price: 'organization',
  variant_standard_cost: 'organization',
  store_variant_price: 'store', // organization-model s8.2: a store-level price is store-scoped
  // Domain 3.
  reason_code: 'organization',
  inventory_movement_type: 'reference',
  stock_adjustment: 'store',
  stock_adjustment_line: 'store',
  inventory_transaction: 'store',
  inventory_movement: 'store', // MS-16: every movement is attributed to the store that is its reason
  // MS-17, D-03: a stock item is a variant at a location and never a store's; its store is its location's.
  stock_balance: 'organization',
  // Domain 4. organization-model s8.1: customers and payment methods are organization-global; s8.2: terminals,
  // drawers, shifts, cash transactions, sales and payments are store-scoped.
  customer: 'organization',
  pos_terminal: 'store',
  cash_drawer: 'store',
  cash_shift: 'store',
  cash_transaction: 'store',
  payment_method: 'organization',
  store_payment_method: 'store',
  checkout: 'store',
  payment: 'store',
  sale: 'store',
  sale_line: 'store',
  shift_count: 'store',
  // Domain 5. organization-model s8.2: returns and refunds are store documents.
  customer_return: 'store',
  customer_return_line: 'store',
  refund: 'store',
  refund_line: 'store',
  // Domain 6. MS-29: the audit log is organization-global; AU-07: an event carries the store of its entity when the
  // entity has one, so store_id is nullable here by rule. fk_audit_event_store proves it when present.
  audit_event_type: 'reference',
  audit_event: 'exception',
  audit_chain_head: 'organization',
  audit_chain_link: 'organization',
  // Domain 7. organization-model s8.1: employees, logins, roles and grants are organization-global; store access is a
  // fact about one store. MS-11: a role assignment is organization-wide or scoped to one store, so its store_id is
  // nullable by rule; fk_employee_role_assignment_store proves it when present.
  employee: 'organization',
  user_account: 'organization',
  user_session: 'organization',
  permission: 'reference',
  role: 'organization',
  role_permission: 'organization',
  employee_role_assignment: 'exception',
  employee_store_access: 'store',
  audit_redacted_field: 'reference',
};

/** Tables the runtime role may DELETE from, each with its authority. Nothing else may be deleted. */
const DELETE_ALLOWED: Record<string, string> = {
  stock_adjustment_line: 'overview s3.6: draft document lines never submitted; the trigger allows Draft only',
  customer_return_line: 'overview s3.6: draft document lines never posted; the trigger allows Draft only',
  refund_line: 'overview s3.6: draft document lines never submitted; the trigger allows Draft only',
};

/** Tables whose rows are history: the application role may read and insert, never update or delete. */
const APPEND_ONLY = [
  'store_setting_version',
  'storage_location_attribution',
  'tax_rate',
  'variant_price',
  'store_variant_price',
  'variant_standard_cost',
  'inventory_transaction',
  'inventory_movement',
  'cash_transaction',
  'sale_line',
  'audit_event',
  'audit_chain_link',
];

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

/**
 * Tables with a foreign key whose columns include `column`, referencing `target` (any table when omitted).
 * A composite key such as (variant_id, organization_id) -> product_variant proves the organization as surely as a
 * direct key to organization, because the parent's own organization_id is proven the same way.
 */
async function tablesWithForeignKey(column: string, target?: string): Promise<Set<string>> {
  const { rows } = await db.owner.query<{ name: string }>(
    `SELECT DISTINCT cl.relname AS name
     FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.contype = 'f' AND a.attname = $1 AND ($2::text IS NULL OR con.confrelid = $2::regclass)`,
    [column, target ?? null],
  );
  return new Set(rows.map((r) => r.name));
}

describe('RT-001, MS-01: every table declares its scope, and store scope is a non-null StoreId', () => {
  it('every table in the schema is classified, and every classified table exists', async () => {
    const tables = await publicTables();
    expect(tables.filter((t) => !(t in SCOPE)), 'add each new table to SCOPE in schema-rules.test.ts').toEqual([]);
    expect(Object.keys(SCOPE).filter((t) => !tables.includes(t))).toEqual([]);
  });

  it('store-scoped tables carry store_id NOT NULL, proven by a foreign key into store or a store-scoped parent', async () => {
    const cols = await columns();
    // A line's (document_id, store_id) -> document(id, store_id) proves the store as surely as a key to store itself,
    // because the parent's store_id is proven the same way; the chain must end at store.
    const { rows: keys } = await db.owner.query<{ child: string; parent: string }>(`
      SELECT DISTINCT cl.relname AS child, pa.relname AS parent
      FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_class pa ON pa.oid = con.confrelid
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
      WHERE con.contype = 'f' AND a.attname = 'store_id'`);
    const provenBy = (table: string) =>
      keys.filter((k) => k.child === table).some((k) => k.parent === 'store' || SCOPE[k.parent] === 'store');
    const problems = Object.entries(SCOPE)
      .filter(([, scope]) => scope === 'store')
      .flatMap(([table]) => {
        const c = cols.find((x) => x.table_name === table && x.column_name === 'store_id');
        if (!c) return [`${table}: no store_id`];
        if (c.is_nullable === 'YES') return [`${table}: store_id is nullable`];
        if (!provenBy(table)) return [`${table}: store_id is not proven by a foreign key`];
        return [];
      });
    expect(problems).toEqual([]);
  });

  it('organization-scoped tables carry organization_id NOT NULL with a foreign key, and no store_id', async () => {
    const cols = await columns();
    const fk = await tablesWithForeignKey('organization_id');
    const problems = Object.entries(SCOPE)
      .filter(([, scope]) => scope === 'organization')
      .flatMap(([table]) => {
        const c = cols.find((x) => x.table_name === table && x.column_name === 'organization_id');
        if (!c) return [`${table}: no organization_id`];
        if (c.is_nullable === 'YES') return [`${table}: organization_id is nullable`];
        if (!fk.has(table)) return [`${table}: organization_id is in no foreign key`];
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

  it('MS-29, AU-07, MS-11: the audit and role-assignment exceptions are organization-scoped, with their store proven by key when they have one', async () => {
    const cols = await columns();
    for (const table of ['audit_event', 'employee_role_assignment']) {
      const org = cols.find((x) => x.table_name === table && x.column_name === 'organization_id');
      expect(org?.is_nullable, table).toBe('NO');
      expect((await tablesWithForeignKey('organization_id', 'organization')).has(table) ||
        (await tablesWithForeignKey('organization_id')).has(table), table).toBe(true);
      expect((await tablesWithForeignKey('store_id', 'store')).has(table), table).toBe(true);
    }
  });

  it('BI-23, CONVENTIONS s11: every column recording who did something references an employee', async () => {
    const { rows } = await db.owner.query<{ col: string }>(`
      SELECT c.table_name || '.' || c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND (c.column_name LIKE '%\\_by' OR (c.table_name, c.column_name) = ('sale', 'employee_id'))
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
          WHERE con.contype = 'f' AND con.conrelid = format('%I', c.table_name)::regclass
            AND con.confrelid = 'employee'::regclass AND a.attname = c.column_name)
      ORDER BY 1`);
    expect(rows.map((r) => r.col)).toEqual([]);
    const { rows: count } = await db.owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'public' AND column_name LIKE '%\\_by'`,
    );
    expect(Number(count[0]!.n), 'the register of actor columns is not empty').toBeGreaterThan(40);
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
  it('BI-40, RT-346: the runtime role may TRUNCATE nothing, and DELETE only where an authority allows it', async () => {
    const { rows } = await db.owner.query<{ t: string; p: string }>(`
      SELECT c.relname AS t, p AS p
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['DELETE', 'TRUNCATE']) AS p
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege('smartstore_app', c.oid, p)`);
    const unjustified = rows.filter((r) => !(r.p === 'DELETE' && r.t in DELETE_ALLOWED));
    expect(unjustified).toEqual([]);
  });

  it('BI-24, REQ-AU-06: append-only tables grant the runtime role no UPDATE on any column', async () => {
    const { rows } = await db.owner.query<{ t: string }>(
      `SELECT t FROM unnest($1::text[]) AS t WHERE has_any_column_privilege('smartstore_app', t, 'UPDATE')`,
      [APPEND_ONLY],
    );
    expect(rows).toEqual([]);
  });

  it('RT-353: created_at is never insertable by the runtime role, so it is always server time', async () => {
    // Pass the row's own column_name, not the literal 'created_at': SQL does not fix the order WHERE conditions are
    // evaluated in, and the literal made this query fail intermittently on tables without that column.
    const { rows } = await db.owner.query<{ t: string }>(`
      SELECT table_name AS t FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'created_at'
        AND (has_column_privilege('smartstore_app', format('%I', table_name), column_name, 'INSERT')
          OR has_column_privilege('smartstore_app', format('%I', table_name), column_name, 'UPDATE'))`);
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
