import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { errorHandler } from './http/errors.ts';
import { registerGate, type Authenticate } from './http/gate.ts';
import { organizationRoutes } from './modules/organization/routes.ts';

export interface AppOptions {
  pool: pg.Pool;
  /** How a request's principal is found. Until domain 7 adds sessions, nobody is signed in. */
  authenticate?: Authenticate;
  logger?: boolean;
}

const nobodySignedIn: Authenticate = async () => null;

/** Builds the server (ADR-31 §5). Tests drive it with `app.inject()`; `main.ts` listens. */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  // Each request's id is its correlation id (architecture §25.3, AU-10): a UUID, because audit_event stores one.
  const app = Fastify({ logger: options.logger ?? false, genReqId: () => randomUUID() });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(async (_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'There is nothing at this address.' } }),
  );
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-correlation-id', request.id);
  });

  registerGate(app, options.pool, options.authenticate ?? nobodySignedIn);

  // Versioned from the first release (architecture §18.4).
  await app.register(organizationRoutes, { prefix: '/api/v1', pool: options.pool });

  await app.ready();
  return app;
}
