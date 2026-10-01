import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { errorHandler } from './http/errors.ts';
import { registerGate, type Authenticate } from './http/gate.ts';
import { transitionRoutes } from './http/transitions.ts';
import { productMachine, productRoutes } from './modules/catalog/products.ts';
import { catalogReferenceRoutes } from './modules/catalog/reference.ts';
import { scanRoutes } from './modules/catalog/scan.ts';
import { accessRoutes } from './modules/identity/access.ts';
import { employeeMachine, employeeRoutes } from './modules/identity/employees.ts';
import { identityRoutes } from './modules/identity/routes.ts';
import { sessionAuthenticator, type SessionPolicy } from './modules/identity/sessions.ts';
import { adjustmentMachine, adjustmentRoutes } from './modules/inventory/adjustments.ts';
import { reasonRoutes } from './modules/inventory/reasons.ts';
import { stockRoutes } from './modules/inventory/stock.ts';
import { organizationRoutes } from './modules/organization/routes.ts';
import { paymentMethodRoutes } from './modules/sales/payment-methods.ts';
import { quoteSigner } from './modules/sales/quotes.ts';
import { saleRoutes } from './modules/sales/sales.ts';
import { shiftCloseRoutes, shiftMachine } from './modules/sales/shift-close.ts';
import { deviceMachine, tillRoutes } from './modules/sales/till.ts';

export interface AppOptions {
  pool: pg.Pool;
  session: SessionPolicy;
  /** How long a scan's price quote stays valid for the sale (OQ-027). */
  quoteMaxAgeMinutes: number;
  /** How long a transaction that moves stock waits for a contended balance (IV-23, OQ-027). */
  lockTimeoutMs: number;
  /** How a request's principal is found: the session cookie. Tests may substitute their own. */
  authenticate?: Authenticate;
  logger?: boolean;
  /** End the pool when the server closes (tests); `main.ts` ends its own. */
  ownsPool?: boolean;
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
  if (options.ownsPool === true) app.addHook('onClose', async () => options.pool.end());

  registerGate(app, options.pool, options.authenticate ?? sessionAuthenticator(options.pool));

  // Versioned from the first release (architecture §18.4).
  const v1 = { prefix: '/api/v1', pool: options.pool };
  const quotes = quoteSigner();
  await app.register(identityRoutes, { ...v1, session: options.session });
  await app.register(employeeRoutes, { ...v1, session: options.session });
  await app.register(accessRoutes, v1);
  await app.register(organizationRoutes, v1);
  await app.register(catalogReferenceRoutes, v1);
  await app.register(productRoutes, v1);
  await app.register(scanRoutes, { ...v1, quotes });
  await app.register(tillRoutes, v1);
  await app.register(paymentMethodRoutes, v1);
  await app.register(saleRoutes, { ...v1, quotes, quoteMaxAgeMinutes: options.quoteMaxAgeMinutes, lockTimeoutMs: options.lockTimeoutMs });
  await app.register(shiftCloseRoutes, v1);
  await app.register(reasonRoutes, v1);
  await app.register(adjustmentRoutes, v1);
  await app.register(stockRoutes, v1);
  await app.register(transitionRoutes, {
    ...v1,
    machines: [employeeMachine, productMachine, deviceMachine, adjustmentMachine, shiftMachine],
    lockTimeoutMs: options.lockTimeoutMs,
  });

  await app.ready();
  return app;
}
