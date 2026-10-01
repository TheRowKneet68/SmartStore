import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import type pg from 'pg';
import { withTransaction, type AuditContext } from '../db/pool.ts';
import { AppError } from './errors.ts';

/** The signed-in employee a request acts as, resolved from the server-held session only (`AC-03`, architecture §7.1). */
export interface Principal {
  employeeId: string;
  organizationId: string;
  sessionId: string | null;
  terminalId: string | null;
  /** `OnLeave`: may sign in and look, may not change anything (employee-domain §3). */
  readOnly: boolean;
}

/**
 * What a route requires. Every route declares one, or the server refuses to start (`AC-01`, ADR-31 §4.2).
 * - `public`: no session (signing in).
 * - `session`: any signed-in employee, for their own workspace only (`MS-05`: no store access is an empty workspace,
 *   not an error).
 * - `permission`: a catalogue key held in the store named by the route's `:storeId`, or organization-wide
 *   (`AC-02`, `MS-11`; OQ-025 item 6).
 * - `transition`: the transition endpoint. The key is the one the attempted edge names (architecture §8.4), so the
 *   gate checks it with `holdsPermission()` once the subject is locked (http/transitions.ts).
 */
export type Access =
  | { kind: 'public' }
  | { kind: 'session' }
  | { kind: 'permission'; key: string; scope: 'store' | 'organization' }
  | { kind: 'transition' };

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    principal: Principal | null;
    /** The store the gate authorized for this request: the only store a handler may touch (`MS-02`, `MS-03`). */
    storeId: string | null;
    /** The roles that granted the permission the gate checked: the audit's role-as-used (architecture §14.2). */
    rolesUsed: string | null;
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
  app.decorateRequest('rolesUsed', null);

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

    const writes = request.method !== 'GET' && request.method !== 'HEAD';
    if (access.kind === 'transition') {
      if (principal.readOnly) await refuse(pool, request, null, null, 'read_only', READ_ONLY);
      return;
    }

    let storeId: string | null = null;
    if (access.scope === 'store') {
      const raw = (request.params as Record<string, string | undefined>).storeId;
      if (raw === undefined || !UUID.test(raw)) throw new AppError(400, 'invalid_request', 'The store id is not valid.');
      storeId = raw;
    }
    if (principal.readOnly && writes) await refuse(pool, request, access.key, storeId, 'read_only', READ_ONLY);
    const roles = await rolesGranting(pool, principal, access.key, storeId);
    if (roles === null) {
      await refuse(pool, request, access.key, storeId, 'forbidden', missingPermission(access.key, storeId));
    }
    request.storeId = storeId;
    request.rolesUsed = roles;
  });
}

const READ_ONLY = 'You are on leave: you can look, but not change anything.';

/** What a refusal says: the permission that was missing, and where (`UX-58`). */
export function missingPermission(key: string, storeId: string | null): string {
  const where = storeId === null ? 'for the whole organization' : 'in this store';
  return `You do not have access to this: it needs the ${key} permission ${where}.`;
}

/**
 * The one permission check (`AC-01`, `AC-02`, `EM-13`, `MS-11`). The decision is the database's
 * `employee_holds_permission()`; the answer is the same whether the store exists or not (architecture §24.3, `MS-03`).
 * When it allows, the result is the ids of the live, unarchived roles whose live grants carry the key in that scope:
 * the role-as-used that every audit entry carries (architecture §8.5, §14.2). Null means refused.
 */
export async function rolesGranting(
  db: Pick<pg.Pool, 'query'>,
  principal: Principal,
  key: string,
  storeId: string | null,
): Promise<string | null> {
  const { rows } = await db.query<{ allowed: boolean; roles: string | null }>(
    `SELECT employee_holds_permission($1, $2, $3) AS allowed,
            (SELECT string_agg(DISTINCT a.role_id::text, ',' ORDER BY a.role_id::text)
             FROM employee_role_assignment a
             JOIN role r ON r.id = a.role_id AND r.archived_at IS NULL
             JOIN role_permission g ON g.role_id = r.id AND g.permission_key = $3 AND g.revoked_at IS NULL
             WHERE a.employee_id = $1 AND a.revoked_at IS NULL AND (a.store_id IS NULL OR a.store_id = $2)) AS roles`,
    [principal.employeeId, storeId, key],
  );
  return rows[0]?.allowed === true ? rows[0].roles : null;
}

/**
 * A second permission a handler needs only in some cases (for example `Price.Edit` when a new variant carries its first
 * price). The same check and the same refusal as the gate's, so there is still one definition (`AC-03`).
 */
export async function requirePermission(pool: pg.Pool, request: FastifyRequest, key: string, storeId: string | null): Promise<void> {
  if ((await rolesGranting(pool, request.principal!, key, storeId)) === null) {
    await refuse(pool, request, key, storeId, 'forbidden', missingPermission(key, storeId));
  }
}

/**
 * Records a refusal (`AU-03`: every failed authorisation; `Security.PermissionDenied`) in its own transaction, then
 * refuses. The event is filed under the store only when that store is in the principal's organization: a probe of
 * another tenant's store leaves no trace in that tenant's log.
 */
export async function refuse(
  pool: pg.Pool,
  request: FastifyRequest,
  key: string | null,
  storeId: string | null,
  code: string,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<never> {
  const principal = request.principal!;
  await withTransaction(pool, auditContext(request), (c) =>
    c.query(
      `SELECT record_audit_event('Security.PermissionDenied', $1,
                                 (SELECT id FROM store WHERE id = $2 AND organization_id = $1), 'permission', NULL, $3)`,
      [principal.organizationId, storeId, { permission: key, method: request.method, route: request.routeOptions.url, storeId, ...detail }],
    ),
  );
  throw new AppError(403, code, message);
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
    role: request.rolesUsed,
    source: principal.terminalId === null ? 'UI' : 'Terminal',
    correlationId: request.id,
    terminalId: principal.terminalId,
    ipAddress: request.ip,
    ...extra,
  };
}
