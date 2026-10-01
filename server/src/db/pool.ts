import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

/** Anything that runs a query: a pool, or the client of an open transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

/**
 * `int8` arrives as a JS number only when it is exact, and is refused otherwise. Money is integer minor units end to
 * end and is never rounded (`ADR-04`, ADR-31 §2). `numeric` quantities stay strings (pg's default).
 */
export function parseInt8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${value} is outside the exact integer range of a number`);
  return n;
}

const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === pg.types.builtins.INT8 ? parseInt8 : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
};

/** The runtime role's pool (`ADR-11`). The int8 rule is per pool, so nothing else in the process changes behaviour. */
export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, types });
}

/** `audit_event.source` (audit-domain §2, D6). */
export type Source = 'UI' | 'API' | 'Job' | 'Device' | 'OfflineSync' | 'Terminal';

/**
 * The authenticated request context that the database's audit triggers read (`AU-05`, `AU-10`; D6, CONVENTIONS §17).
 * It always comes from the signed-in session, never from a request body (`AU-05`, `BI-33`).
 */
export interface AuditContext {
  actorId: string;
  source: Source;
  correlationId: string;
  effectiveActorId?: string | null;
  role?: string | null;
  terminalId?: string | null;
  clientOperationId?: string | null;
  ipAddress?: string | null;
  reasonCodeId?: string | null;
}

// set_config(..., true) lasts until the transaction ends, so a pooled connection never carries one request's context
// into the next. An empty string reads as unset (audit_setting()).
const SET_CONTEXT = `SELECT set_config('smartstore.actor_id', $1, true), set_config('smartstore.source', $2, true),
  set_config('smartstore.correlation_id', $3, true), set_config('smartstore.effective_actor_id', $4, true),
  set_config('smartstore.role', $5, true), set_config('smartstore.terminal_id', $6, true),
  set_config('smartstore.client_operation_id', $7, true), set_config('smartstore.ip_address', $8, true),
  set_config('smartstore.reason_code_id', $9, true)`;

// Serialization failure and deadlock: the transaction rolled back whole, so running it again is safe (architecture
// §20.2: bounded retry with jitter).
const RETRYABLE = new Set(['40001', '40P01']);
export const TRANSACTION_ATTEMPTS = 3;

/**
 * One use case, one transaction (architecture §21.1), at READ COMMITTED (`ADR-26`), with the audit context set first.
 * `work` must not call anything outside the database (§21.3), because a retry runs it again.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  context: AuditContext,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query(SET_CONTEXT, [
        context.actorId,
        context.source,
        context.correlationId,
        context.effectiveActorId ?? '',
        context.role ?? '',
        context.terminalId ?? '',
        context.clientOperationId ?? '',
        context.ipAddress ?? '',
        context.reasonCodeId ?? '',
      ]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      if (attempt < TRANSACTION_ATTEMPTS && RETRYABLE.has((error as { code?: string }).code ?? '')) {
        await sleep(attempt * 20 + Math.floor(Math.random() * 30));
        continue;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }
}
