import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Access } from './gate.ts';

const PUBLIC: { config: { access: Access } } = { config: { access: { kind: 'public' } } };

/** How long readiness waits for the database before it answers "not ready". */
const READY_TIMEOUT_MS = 1_000;

/**
 * Liveness and readiness, for whatever runs the server (the owner's brief, Phase D). They are not the signals of
 * architecture §25, which are the ledger, auth, invariant and job checks. Both are public and unversioned, outside the
 * API. Neither says anything about internals (§24.3, §25.4).
 * - `GET /health`: the process answers. It touches nothing else, so a slow database cannot fail it.
 * - `GET /ready`: the database answers too, within a second. Otherwise 503, and the server should be sent no work.
 */
export async function healthRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  app.get('/health', PUBLIC, async () => ({ status: 'ok' }));

  app.get('/ready', PUBLIC, async (_request, reply) => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS);
    });
    try {
      await Promise.race([options.pool.query('SELECT 1'), late]);
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    } finally {
      clearTimeout(timer);
    }
  });
}
