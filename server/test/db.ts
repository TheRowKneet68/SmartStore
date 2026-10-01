import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadEnv, requireEnv, TEMPLATE_DB, urlFor } from './env.ts';

export interface TestDb {
  /** Connected as smartstore_owner: owns the schema. Use it to arrange data and to change the schema under test. */
  owner: pg.Pool;
  /** Connected as smartstore_app: the runtime role. Use it to prove what the application can and cannot do. */
  app: pg.Pool;
  /** Connection string for the runtime role, for tests that need their own pool (for example, wider concurrency). */
  appUrl: string;
  name: string;
  drop(): Promise<void>;
}

// CREATE DATABASE ... TEMPLATE needs a quiet template, so clones are made one at a time across processes.
const CLONE_LOCK = 7_310_001;

/**
 * TEST-ONLY staff: an organization whose employees, seeded once in the template (global-setup.ts), stand in as the
 * people who did things in test documents, since every `*_by` column is an employee of record (D7).
 */
export const STAFF_ORGANIZATION = '00000000-0000-4000-8000-00005ea1f000';
export const STAFF_SIZE = 5000;
export const staffId = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/**
 * The authenticated request context every audited change needs (AU-05, AU-10; docs/database/D6-AUDIT.md). The
 * application sets it per transaction from the signed-in session; test connections carry this TEST-ONLY default from
 * connection start, and tests that need another actor or a reason set their own with set_config(..., true).
 */
export const TEST_CONTEXT = {
  actor: staffId(0),
  correlation: '00000000-0000-4000-8000-00000000c0e1',
  source: 'API',
} as const;

/** `url` with the test audit context applied to every connection opened from it. */
export function withTestContext(url: string): string {
  const u = new URL(url);
  u.searchParams.set(
    'options',
    `-c smartstore.actor_id=${TEST_CONTEXT.actor} -c smartstore.source=${TEST_CONTEXT.source} ` +
      `-c smartstore.correlation_id=${TEST_CONTEXT.correlation}`,
  );
  return u.toString();
}

/** A private database cloned from the migrated template. Drop it in afterAll. */
export async function createTestDb(): Promise<TestDb> {
  loadEnv();
  const ownerUrl = requireEnv('MIGRATION_DATABASE_URL');
  const appUrl = requireEnv('DATABASE_URL');
  const name = `smartstore_t_${randomBytes(5).toString('hex')}`;

  const admin = new pg.Client({ connectionString: urlFor(ownerUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query('SELECT pg_advisory_lock($1)', [CLONE_LOCK]);
    try {
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB} OWNER smartstore_owner`);
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1)', [CLONE_LOCK]);
    }
  } finally {
    await admin.end();
  }

  const owner = new pg.Pool({ connectionString: withTestContext(urlFor(ownerUrl, name)), max: 8 });
  const app = new pg.Pool({ connectionString: withTestContext(urlFor(appUrl, name)), max: 8 });

  return {
    owner,
    app,
    appUrl: withTestContext(urlFor(appUrl, name)),
    name,
    async drop() {
      await owner.end();
      await app.end();
      const dropper = new pg.Client({ connectionString: urlFor(ownerUrl, 'postgres') });
      await dropper.connect();
      try {
        // Not WITH (FORCE), for the reason in global-setup.ts; every pool on the clone has ended by now.
        await dropper.query(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/** Runs `fn` in one transaction on one connection and commits; rolls back and rethrows on any error. */
export async function inTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** SQLSTATE of a failed query, or undefined if it succeeded. Tests assert on codes, never on message text. */
export async function sqlState(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
