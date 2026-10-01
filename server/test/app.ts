import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { TestDb } from './db.ts';

/**
 * The server over a test database, where a request names who is signed in with the TEST-ONLY headers below. This
 * stands in for the session lookup, which domain 7 builds. The gate's permission check, and everything after it, run
 * for real.
 */
export async function testApp(db: TestDb): Promise<FastifyInstance> {
  return buildApp({
    pool: db.app,
    authenticate: async (request) => {
      const employeeId = request.headers['x-test-employee'];
      const organizationId = request.headers['x-test-organization'];
      if (typeof employeeId !== 'string' || typeof organizationId !== 'string') return null;
      return { employeeId, organizationId, sessionId: null, terminalId: null };
    },
  });
}

/** The TEST-ONLY headers that sign a request in as `employeeId` of `organizationId`. */
export const signedInAs = (employeeId: string, organizationId: string): Record<string, string> => ({
  'x-test-employee': employeeId,
  'x-test-organization': organizationId,
});
