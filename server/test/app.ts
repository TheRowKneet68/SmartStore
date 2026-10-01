import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { SessionPolicy } from '../src/modules/identity/sessions.ts';
import type { TestDb } from './db.ts';

/** TEST-ONLY security policy. The real values are the owner's to set (OQ-027). */
export const TEST_SESSION_POLICY: SessionPolicy = { lifetimeMinutes: 60, failureLimit: 3, failureWindowMinutes: 15 };

/** The server as it runs: principals come from session cookies only. */
export async function sessionApp(db: TestDb, policy: SessionPolicy = TEST_SESSION_POLICY): Promise<FastifyInstance> {
  return buildApp({ pool: db.app, session: policy });
}

/**
 * The server over a test database, where a request names who is signed in with the TEST-ONLY headers below, so a test
 * of a route need not sign in first. Everything after the session lookup (the permission check, the handlers) runs
 * for real; `sessionApp` tests the session lookup itself.
 */
export async function testApp(db: TestDb): Promise<FastifyInstance> {
  return buildApp({
    pool: db.app,
    session: TEST_SESSION_POLICY,
    authenticate: async (request) => {
      const employeeId = request.headers['x-test-employee'];
      const organizationId = request.headers['x-test-organization'];
      if (typeof employeeId !== 'string' || typeof organizationId !== 'string') return null;
      return { employeeId, organizationId, sessionId: null, terminalId: null, readOnly: false };
    },
  });
}

/** The TEST-ONLY headers that sign a request in as `employeeId` of `organizationId`. */
export const signedInAs = (employeeId: string, organizationId: string): Record<string, string> => ({
  'x-test-employee': employeeId,
  'x-test-organization': organizationId,
});
