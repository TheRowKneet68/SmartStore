import { spawnSync } from 'node:child_process';
import { resolveBinary } from 'dbmate';
import pg from 'pg';
import { STAFF_ORGANIZATION, STAFF_SIZE, staffId, withTestContext } from './db.ts';
import { loadEnv, migrationsDir, requireEnv, TEMPLATE_DB, urlFor } from './env.ts';

/**
 * Builds the template database once per test run: drop it, create it, apply every migration with dbmate, then seed
 * the TEST-ONLY staff. Each test file then clones it with CREATE DATABASE ... TEMPLATE (see db.ts).
 */
export default async function setup(): Promise<void> {
  loadEnv();
  const owner = requireEnv('MIGRATION_DATABASE_URL');

  const admin = new pg.Client({ connectionString: urlFor(owner, 'postgres') });
  await admin.connect();
  try {
    // Never WITH (FORCE): autovacuum visits the freshly seeded template, and FORCE run by a non-superuser fails with
    // 42501 on an autovacuum worker. A plain DROP stops autovacuum itself and waits up to 5 s for other sessions.
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB}`);
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

  // TEST-ONLY staff (db.ts): the employees that fixtures name as who did what. Employee 0 is the default actor of the
  // test audit context and records the creation of them all, itself included.
  const seed = new pg.Client({ connectionString: withTestContext(urlFor(owner, TEMPLATE_DB)) });
  await seed.connect();
  try {
    await seed.query(`INSERT INTO currency (code, minor_unit_exponent) VALUES ('XTS', 2) ON CONFLICT (code) DO NOTHING`);
    await seed.query(
      `INSERT INTO organization (id, legal_name, currency_code, time_zone) VALUES ($1, 'TEST-ONLY staff', 'XTS', 'UTC')`,
      [STAFF_ORGANIZATION],
    );
    await seed.query(
      `INSERT INTO employee (id, organization_id, employee_number, first_name, last_name, status_changed_by)
       SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, $1, 'TEST-' || n, 'Test', 'Employee ' || n, $2
       FROM generate_series(0, $3::integer - 1) AS n`,
      [STAFF_ORGANIZATION, staffId(0), STAFF_SIZE],
    );
  } finally {
    await seed.end();
  }
}
