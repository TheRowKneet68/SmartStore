import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import type pg from 'pg';
import type { AuditContext } from '../db/pool.ts';
import { AppError } from './errors.ts';

/** The signed-in employee a request acts as, resolved from the server-held session only (`AC-03`, architecture §7.1). */
export interface Principal {
  employeeId: string;
  organizationId: string;
  sessionId: string | null;
  terminalId: string | null;
}

/**
 * What a route requires. Every route declares one, or the server refuses to start (`AC-01`, ADR-31 §4.2).
 * - `public`: no session (signing in).
 * - `session`: any signed-in employee, for their own workspace only (`MS-05`: no store access is an empty workspace,
 *   not an error).
 * - `permission`: a catalogue key held in the store named by the route's `:storeId`, or organization-wide
 *   (`AC-02`, `MS-11`; OQ-025 item 6).
 */
export type Access =
  | { kind: 'public' }
  | { kind: 'session' }
  | { kind: 'permission'; key: string; scope: 'store' | 'organization' };

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    principal: Principal | null;
    /** The store the gate authorized for this request: the only store a handler may touch (`MS-02`, `MS-03`). */
    storeId: string | null;
  }
}

/** Resolves the principal of a request, or null when it has none. Domain 7 resolves it from the session cookie. */
export type Authenticate = (request: FastifyRequest) => Promise<Principal | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one authorization gate (architecture §8.2, `AC-03`): every request passes it, and anything it cannot decide is
 * refused. The permission is checked by `employee_holds_permission()`, the database's one definition of what a grant
 * set allows (D7 §3). If the database cannot answer, the query fails and the request is refused.
 */
export function registerGate(app: FastifyInstance, pool: pg.Pool, authenticate: Authenticate): void {
  const declaredKeys = new Set<string>();

  app.decorateRequest('principal', null);
  app.decorateRequest('storeId', null);

  app.addHook('onRoute', (route: RouteOptions) => {
    const access = (route.config as { access?: Access } | undefined)?.access;
    if (!access) {
      throw new Error(`Route ${String(route.method)} ${route.url} declares no access. Every route must (AC-01).`);
    }
    if (access.kind === 'permission') {
      declaredKeys.add(access.key);
      if (access.scope === 'store' && !route.url.includes(':storeId')) {
        throw new Error(`Route ${String(route.method)} ${route.url} is store-scoped but names no :storeId (MS-03).`);
      }
    }
  });

  // A key missing from the catalogue would refuse every request for ever. Refuse to start instead (AC-02, D-01).
  app.addHook('onReady', async () => {
    const keys = [...declaredKeys];
    const { rows } = await pool.query<{ key: string }>('SELECT key FROM permission WHERE key = ANY($1)', [keys]);
    const missing = keys.filter((key) => !rows.some((row) => row.key === key));
    if (missing.length > 0) throw new Error(`Routes declare permissions missing from the catalogue: ${missing.join(', ')}`);
  });

  app.addHook('onRequest', async (request) => {
    const access = request.routeOptions.config.access;
    if (!access || access.kind === 'public') return; // No access only on the not-found handler.

    const principal = await authenticate(request);
    if (!principal) throw new AppError(401, 'unauthenticated', 'You are not signed in. Sign in to continue.');
    request.principal = principal;
    if (access.kind === 'session') return;

    let storeId: string | null = null;
    if (access.scope === 'store') {
      const raw = (request.params as Record<string, string | undefined>).storeId;
      if (raw === undefined || !UUID.test(raw)) throw new AppError(400, 'invalid_request', 'The store id is not valid.');
      storeId = raw;
    }
    const { rows } = await pool.query<{ allowed: boolean }>(
      'SELECT employee_holds_permission($1, $2, $3) AS allowed',
      [principal.employeeId, storeId, access.key],
    );
    if (rows[0]?.allowed !== true) {
      // The same answer whether the store exists or not (architecture §24.3, MS-03), and it names what is missing
      // (UX-58).
      const where = storeId === null ? 'for the whole organization' : 'in this store';
      throw new AppError(403, 'forbidden', `You do not have access to this: it needs the ${access.key} permission ${where}.`);
    }
    request.storeId = storeId;
  });
}

/** The audit context of a request, from the session only (`AU-05`, `AU-10`, `BI-33`). */
export function auditContext(
  request: FastifyRequest,
  extra: Pick<AuditContext, 'clientOperationId' | 'reasonCodeId'> = {},
): AuditContext {
  const principal = request.principal;
  if (!principal) throw new AppError(401, 'unauthenticated', 'You are not signed in. Sign in to continue.');
  return {
    actorId: principal.employeeId,
    source: principal.terminalId === null ? 'UI' : 'Terminal',
    correlationId: request.id,
    terminalId: principal.terminalId,
    ipAddress: request.ip,
    ...extra,
  };
}
