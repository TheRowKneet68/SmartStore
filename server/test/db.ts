import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadEnv, requireEnv, TEMPLATE_DB, urlFor } from './env.ts';

export interface TestDb {
  /** Connected as smartstore_owner: owns the schema. Use it to arrange data and to change the schema under test. */
  owner: pg.Pool;
  /** Connected as smartstore_app: the runtime role. Use it to prove what the application can and cannot do. */
  app: pg.Pool;
  name: string;
  drop(): Promise<void>;
}

// CREATE DATABASE ... TEMPLATE needs a quiet template, so clones are made one at a time across processes.
const CLONE_LOCK = 7_310_001;

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

  const owner = new pg.Pool({ connectionString: urlFor(ownerUrl, name), max: 8 });
  const app = new pg.Pool({ connectionString: urlFor(appUrl, name), max: 8 });

  return {
    owner,
    app,
    name,
    async drop() {
      await owner.end();
      await app.end();
      const dropper = new pg.Client({ connectionString: urlFor(ownerUrl, 'postgres') });
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
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
