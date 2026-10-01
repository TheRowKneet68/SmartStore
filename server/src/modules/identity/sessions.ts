import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTransaction, type AuditContext, type Queryable } from '../../db/pool.ts';
import type { Authenticate, Principal } from '../../http/gate.ts';
import { hashPassword, needsRehash, verifyPassword } from './password.ts';

/** The owner's security policy (OQ-027): required settings, never defaulted. */
export interface SessionPolicy {
  lifetimeMinutes: number;
  failureLimit: number;
  failureWindowMinutes: number;
}

export const SESSION_COOKIE = 'smartstore_session';
const TOKEN_BYTES = 32;

const sha256 = (bytes: Buffer): Buffer => createHash('sha256').update(bytes).digest();

/** An opaque token for the client; the database keeps only its SHA-256 (`ADR-12`, architecture §7.1). */
export function newSessionToken(): { token: string; hash: Buffer } {
  const raw = randomBytes(TOKEN_BYTES);
  return { token: raw.toString('base64url'), hash: sha256(raw) };
}

/** The hash of a well-formed token, or null: anything else is not a session. */
export function sessionTokenHash(token: string): Buffer | null {
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(Buffer.from(token, 'base64url')) : null;
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** httpOnly, Secure, SameSite=Strict, scoped to the API (architecture §4.2, §7.1). */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

type EndReason = 'Logout' | 'Expired' | 'Revoked' | 'Rotated';

/**
 * Ends the live sessions that `which` selects, once each (`AU-12a`; the database stamps the time and refuses a second
 * end), and records each: `Security.Logout` for a sign-out, `Security.SessionEnded` otherwise (`AU-03`, `SM-47`).
 * Returns how many ended.
 */
export async function endSessions(
  db: Queryable,
  which: { sessionId: string } | { tokenHash: Buffer } | { employeeId: string },
  reason: EndReason,
): Promise<number> {
  const [column, value] =
    'sessionId' in which ? ['id', which.sessionId] : 'tokenHash' in which ? ['token_hash', which.tokenHash] : ['employee_id', which.employeeId];
  const { rowCount } = await db.query(
    `WITH ended AS (
       UPDATE user_session SET end_reason = $2 WHERE ${column} = $1 AND ended_at IS NULL
       RETURNING id, organization_id, pos_terminal_id)
     SELECT record_audit_event(CASE WHEN $2 = 'Logout' THEN 'Security.Logout' ELSE 'Security.SessionEnded' END,
                               e.organization_id, t.store_id, 'user_session', e.id, jsonb_build_object('reason', $2::text))
     FROM ended e LEFT JOIN pos_terminal t ON t.id = e.pos_terminal_id`,
    [value, reason],
  );
  return rowCount ?? 0;
}

export type SignInResult =
  | { ok: true; token: string; principal: Principal; maxAgeSeconds: number }
  | { ok: false; status: 401 | 403 | 429; code: string; message: string };

export interface SignInRequest {
  username: string;
  password: string;
  /** The organization, when the client knows it (OQ-025 item 7). */
  organizationId: string | null;
  /** The till this browser is, when it is one. */
  terminalId: string | null;
  /** The token of a session this browser already holds: it is rotated out (architecture §7.1). */
  replacesToken: string | null;
  correlationId: string;
  ipAddress: string;
}

interface Account {
  id: string;
  organization_id: string;
  employee_id: string;
  password_hash: string;
  status: string;
}

const WRONG = { ok: false, status: 401, code: 'sign_in_failed', message: 'The username or password is not right.' } as const;

// Verified when no single login matches, so a wrong username takes as long as a wrong password (architecture §24.3).
let decoy: Promise<string> | null = null;

/**
 * Signs in (architecture §7, `ADR-12`, `EM-02`, `EM-04`, `SM-49`). The answer is the same whether the username or the
 * password was wrong. A credential with too many recent failures is throttled, never the employee. Only `Active`
 * and `OnLeave` employees may sign in (employee-domain §3). Every attempt is audited (`AU-03`).
 */
export async function signIn(pool: pg.Pool, policy: SessionPolicy, request: SignInRequest): Promise<SignInResult> {
  const { rows } = await pool.query<Account>(
    `SELECT a.id, a.organization_id, a.employee_id, a.password_hash, e.status
     FROM user_account a JOIN employee e ON e.id = a.employee_id
     WHERE lower(a.username) = lower($1) AND ($2::uuid IS NULL OR a.organization_id = $2)`,
    [request.username, request.organizationId],
  );
  if (rows.length !== 1) {
    // None, or one in each of several organizations (OQ-025 item 7). There is no organization to record against.
    decoy ??= hashPassword(randomBytes(16).toString('hex'));
    await verifyPassword(request.password, await decoy);
    return WRONG;
  }
  const account = rows[0]!;
  const context = (actorId: string | null, terminalId: string | null): AuditContext => ({
    actorId,
    source: terminalId === null ? 'UI' : 'Terminal',
    correlationId: request.correlationId,
    ipAddress: request.ipAddress,
    terminalId,
  });
  const failed = async (why: string) => {
    await withTransaction(pool, context(null, null), (c) =>
      c.query(`SELECT record_audit_event('Security.LoginFailed', $1, NULL, 'user_account', $2, $3)`, [
        account.organization_id,
        account.id,
        { reason: why },
      ]),
    );
  };

  const recent = await pool.query<{ failures: number }>(
    `SELECT count(*)::int AS failures FROM audit_event
     WHERE entity_id = $1 AND event_type = 'Security.LoginFailed' AND occurred_at > now() - make_interval(mins => $2)`,
    [account.id, policy.failureWindowMinutes],
  );
  if (recent.rows[0]!.failures >= policy.failureLimit) {
    await failed('Throttled');
    return {
      ok: false,
      status: 429,
      code: 'sign_in_throttled',
      message: `Too many failed sign-ins for this login. Wait ${policy.failureWindowMinutes} minutes, then try again.`,
    };
  }
  if (!(await verifyPassword(request.password, account.password_hash))) {
    await failed('Password');
    return WRONG;
  }
  if (account.status !== 'Active' && account.status !== 'OnLeave') {
    await failed('Status');
    return { ok: false, status: 403, code: 'sign_in_blocked', message: 'This login cannot sign in. Ask your manager.' };
  }

  let terminalStore: string | null = null;
  if (request.terminalId !== null) {
    // A till of this organization, in a store the employee may work in (MS-01: a store where they hold a permission).
    const till = await pool.query<{ store_id: string }>(
      `SELECT t.store_id FROM pos_terminal t
       WHERE t.id = $1 AND t.organization_id = $2
         AND EXISTS (SELECT 1 FROM permission p WHERE employee_holds_permission($3, t.store_id, p.key))`,
      [request.terminalId, account.organization_id, account.employee_id],
    );
    if (till.rows.length === 0) {
      await failed('Terminal');
      return { ok: false, status: 403, code: 'sign_in_blocked', message: 'You cannot sign in at this till. Ask your manager.' };
    }
    terminalStore = till.rows[0]!.store_id;
  }

  const { token, hash } = newSessionToken();
  const rehashed = needsRehash(account.password_hash) ? await hashPassword(request.password) : null;
  const replaced = request.replacesToken === null ? null : sessionTokenHash(request.replacesToken);
  const session = await withTransaction(pool, context(account.employee_id, request.terminalId), async (c) => {
    if (rehashed !== null) await c.query('UPDATE user_account SET password_hash = $2 WHERE id = $1', [account.id, rehashed]);
    if (replaced !== null) await endSessions(c, { tokenHash: replaced }, 'Rotated');
    const inserted = await c.query<{ id: string }>(
      `INSERT INTO user_session (organization_id, user_account_id, employee_id, token_hash, pos_terminal_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6 * 60.0)) RETURNING id`,
      [account.organization_id, account.id, account.employee_id, hash, request.terminalId, policy.lifetimeMinutes],
    );
    const id = inserted.rows[0]!.id;
    await c.query(`SELECT record_audit_event('Security.Login', $1, $2, 'user_session', $3, NULL)`, [
      account.organization_id,
      terminalStore,
      id,
    ]);
    return id;
  });
  return {
    ok: true,
    token,
    maxAgeSeconds: Math.ceil(policy.lifetimeMinutes * 60),
    principal: {
      employeeId: account.employee_id,
      organizationId: account.organization_id,
      sessionId: session,
      terminalId: request.terminalId,
      readOnly: account.status === 'OnLeave',
    },
  };
}

interface SessionRow {
  id: string;
  organization_id: string;
  employee_id: string;
  pos_terminal_id: string | null;
  ended: boolean;
  expired: boolean;
  status: string;
}

/**
 * The gate's principal lookup: the session cookie, re-checked on every request (architecture §7.5, `AC-03`). An expired
 * session, or one whose employee may no longer sign in (`Suspended`, `Terminated`, `Archived`), is ended and refused.
 */
export function sessionAuthenticator(pool: pg.Pool): Authenticate {
  return async (request: FastifyRequest) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const hash = token === null ? null : sessionTokenHash(token);
    if (hash === null) return null;
    const { rows } = await pool.query<SessionRow>(
      `SELECT s.id, s.organization_id, s.employee_id, s.pos_terminal_id, s.ended_at IS NOT NULL AS ended,
              s.expires_at <= now() AS expired, e.status
       FROM user_session s JOIN employee e ON e.id = s.employee_id WHERE s.token_hash = $1`,
      [hash],
    );
    const session = rows[0];
    if (session === undefined || session.ended) return null;
    const blocked = session.status !== 'Active' && session.status !== 'OnLeave';
    if (session.expired || blocked) {
      await withTransaction(
        pool,
        {
          actorId: session.employee_id,
          source: session.pos_terminal_id === null ? 'UI' : 'Terminal',
          correlationId: request.id,
          terminalId: session.pos_terminal_id,
          ipAddress: request.ip,
        },
        (c) => endSessions(c, { sessionId: session.id }, session.expired ? 'Expired' : 'Revoked'),
      );
      return null;
    }
    return {
      employeeId: session.employee_id,
      organizationId: session.organization_id,
      sessionId: session.id,
      terminalId: session.pos_terminal_id,
      readOnly: session.status === 'OnLeave',
    };
  };
}

export interface Workspace {
  employee: { id: string; name: string; readOnly: boolean };
  organization: { id: string; name: string; permissions: string[] };
  stores: {
    id: string;
    code: string;
    name: string;
    deactivatedAt: Date | null;
    currencyCode: string;
    minorUnitExponent: number;
    permissions: string[];
  }[];
  terminal: { id: string; code: string; label: string; storeId: string } | null;
}

/**
 * What the signed-in employee may see and do (`UX-05`, `UX-08`): the stores where they hold a permission, which is the
 * permitted set (`MS-01`, `EM-13`), with the permissions they hold in each, by the gate's own definition. No store is
 * an empty workspace, not an error (`MS-05`, `UX-07`).
 */
export async function workspace(db: Queryable, principal: Principal): Promise<Workspace> {
  const person = await db.query<{ name: string; organization_name: string; organization_permissions: string[] }>(
    `SELECT coalesce(e.preferred_name, e.first_name) || ' ' || e.last_name AS name,
            coalesce(o.trading_name, o.legal_name) AS organization_name,
            array(SELECT p.key::text FROM permission p WHERE employee_holds_permission(e.id, NULL, p.key) ORDER BY p.key)
              AS organization_permissions
     FROM employee e JOIN organization o ON o.id = e.organization_id WHERE e.id = $1`,
    [principal.employeeId],
  );
  const stores = await db.query<Workspace['stores'][number]>(
    `SELECT id, code, name, deactivated_at AS "deactivatedAt", currency_code AS "currencyCode",
            minor_unit_exponent AS "minorUnitExponent", permissions FROM (
       SELECT s.id, s.code, s.name, s.deactivated_at, s.currency_code, c.minor_unit_exponent,
              array(SELECT p.key::text FROM permission p WHERE employee_holds_permission($1, s.id, p.key) ORDER BY p.key)
                AS permissions
       FROM store s JOIN currency c ON c.code = s.currency_code WHERE s.organization_id = $2) AS scoped
     WHERE cardinality(permissions) > 0 ORDER BY code`,
    [principal.employeeId, principal.organizationId],
  );
  const terminal =
    principal.terminalId === null
      ? null
      : ((
          await db.query<NonNullable<Workspace['terminal']>>(
            `SELECT id, code, label, store_id AS "storeId" FROM pos_terminal WHERE id = $1`,
            [principal.terminalId],
          )
        ).rows[0] ?? null);
  const row = person.rows[0]!;
  return {
    employee: { id: principal.employeeId, name: row.name, readOnly: principal.readOnly },
    organization: { id: principal.organizationId, name: row.organization_name, permissions: row.organization_permissions },
    stores: stores.rows,
    terminal,
  };
}
