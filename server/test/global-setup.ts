import { spawnSync } from 'node:child_process';
import { resolveBinary } from 'dbmate';
import pg from 'pg';
import { loadEnv, migrationsDir, requireEnv, TEMPLATE_DB, urlFor } from './env.ts';

/**
 * Builds the template database once per test run: drop it, create it, apply every migration with dbmate.
 * Each test file then clones it with CREATE DATABASE ... TEMPLATE (see db.ts).
 */
export default async function setup(): Promise<void> {
  loadEnv();
  const owner = requireEnv('MIGRATION_DATABASE_URL');

  const admin = new pg.Client({ connectionString: urlFor(owner, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB} OWNER smartstore_owner`);
  } finally {
    await admin.end();
  }

  // The URL goes to dbmate in its environment, not on its command line, so a failure never prints a password.
  // --no-dump-schema keeps a test run from rewriting db/schema.sql.
  const result = spawnSync(
    resolveBinary(),
    ['--migrations-dir', migrationsDir, '--no-dump-schema', 'migrate', '--strict'],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: urlFor(owner, TEMPLATE_DB) } },
  );
  if (result.status !== 0) {
    throw new Error(`dbmate failed to migrate ${TEMPLATE_DB} (exit ${String(result.status)}). Its output is above.`);
  }
}
