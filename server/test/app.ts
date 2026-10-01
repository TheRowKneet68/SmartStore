import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/db/pool.ts';
import type { SessionPolicy } from '../src/modules/identity/sessions.ts';
import type { TestDb } from './db.ts';

/** TEST-ONLY security policy. The real values are the owner's to set (OQ-027). */
export const TEST_SESSION_POLICY: SessionPolicy = { lifetimeMinutes: 60, failureLimit: 3, failureWindowMinutes: 15 };
export const TEST_QUOTE_MAX_AGE_MINUTES = 30;
export const TEST_LOCK_TIMEOUT_MS = 2_000;

/**
 * A pool built as the server builds its own (createPool: exact int8), on the test database's runtime role, so a
 * response carries the types production sends. Without the test audit context, too: every audited change the server
 * makes must set its own, as in production. The server ends the pool on close.
 */
function serverPool(db: TestDb) {
  const url = new URL(db.appUrl);
  url.searchParams.delete('options');
  return createPool(url.toString(), 8);
}

/** The server as it runs: principals come from session cookies only. */
export async function sessionApp(db: TestDb, policy: SessionPolicy = TEST_SESSION_POLICY): Promise<FastifyInstance> {
  return buildApp({ pool: serverPool(db), session: policy, quoteMaxAgeMinutes: TEST_QUOTE_MAX_AGE_MINUTES, lockTimeoutMs: TEST_LOCK_TIMEOUT_MS, ownsPool: true });
}

/**
 * The server over a test database, where a request names who is signed in with the TEST-ONLY headers below, so a test
 * of a route need not sign in first. Everything after the session lookup (the permission check, the handlers) runs
 * for real; `sessionApp` tests the session lookup itself.
 */
export async function testApp(db: TestDb, options: { quoteMaxAgeMinutes?: number } = {}): Promise<FastifyInstance> {
  return buildApp({
    pool: serverPool(db),
    session: TEST_SESSION_POLICY,
    quoteMaxAgeMinutes: options.quoteMaxAgeMinutes ?? TEST_QUOTE_MAX_AGE_MINUTES,
    lockTimeoutMs: TEST_LOCK_TIMEOUT_MS,
    ownsPool: true,
    authenticate: async (request) => {
      const employeeId = request.headers['x-test-employee'];
      const organizationId = request.headers['x-test-organization'];
      const terminal = request.headers['x-test-terminal'];
      if (typeof employeeId !== 'string' || typeof organizationId !== 'string') return null;
      return { employeeId, organizationId, sessionId: null, terminalId: typeof terminal === 'string' ? terminal : null, readOnly: false };
    },
  });
}

/** The TEST-ONLY headers that sign a request in as `employeeId` of `organizationId`, at `terminalId` if given. */
export const signedInAs = (employeeId: string, organizationId: string, terminalId?: string): Record<string, string> => ({
  'x-test-employee': employeeId,
  'x-test-organization': organizationId,
  ...(terminalId === undefined ? {} : { 'x-test-terminal': terminalId }),
});
