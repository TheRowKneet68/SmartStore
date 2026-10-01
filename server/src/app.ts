import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { errorHandler } from './http/errors.ts';
import { registerGate, type Authenticate } from './http/gate.ts';
import { transitionRoutes } from './http/transitions.ts';
import { employeeMachine, employeeRoutes } from './modules/identity/employees.ts';
import { identityRoutes } from './modules/identity/routes.ts';
import { sessionAuthenticator, type SessionPolicy } from './modules/identity/sessions.ts';
import { organizationRoutes } from './modules/organization/routes.ts';

export interface AppOptions {
  pool: pg.Pool;
  session: SessionPolicy;
  /** How a request's principal is found: the session cookie. Tests may substitute their own. */
  authenticate?: Authenticate;
  logger?: boolean;
}

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

  registerGate(app, options.pool, options.authenticate ?? sessionAuthenticator(options.pool));

  // Versioned from the first release (architecture §18.4).
  const v1 = { prefix: '/api/v1', pool: options.pool };
  await app.register(identityRoutes, { ...v1, session: options.session });
  await app.register(employeeRoutes, { ...v1, session: options.session });
  await app.register(organizationRoutes, v1);
  await app.register(transitionRoutes, { ...v1, machines: [employeeMachine] });

  await app.ready();
  return app;
}
