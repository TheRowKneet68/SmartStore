import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { actor, insertOrganization } from '../../test/fixtures.ts';
import { createPool, TRANSACTION_ATTEMPTS, withTransaction, type AuditContext } from './pool.ts';

let db: TestDb;
let pool: pg.Pool; // No test audit context on its connections: whatever context a test sees, withTransaction set.

beforeAll(async () => {
  db = await createTestDb();
  const url = new URL(db.appUrl);
  url.searchParams.delete('options');
  pool = createPool(url.toString(), 1);
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

const context = (): AuditContext => ({ actorId: actor(), source: 'UI', correlationId: randomUUID() });
const fail = (code: string) => Object.assign(new Error(`simulated ${code}`), { code });

describe('the pool and the transaction helper (ADR-04, ADR-26, architecture s20.2, s21.1)', () => {
  it('ADR-04: an int8 arrives as an exact number, and one beyond the exact range is refused rather than rounded', async () => {
    const { rows } = await pool.query<{ n: number }>('SELECT 9007199254740991::int8 AS n');
    expect(rows[0]!.n).toBe(Number.MAX_SAFE_INTEGER);
    await expect(pool.query('SELECT 9007199254740992::int8 AS n')).rejects.toThrow(/exact integer range/);
    const quantity = await pool.query<{ q: string }>('SELECT 1.2500::numeric(18,4) AS q');
    expect(quantity.rows[0]!.q, 'a quantity stays a decimal string').toBe('1.2500');
  });

  it('AU-05, AU-10, RT-293: an audited change records the actor, source and correlation id the helper set', async () => {
    const ctx = context();
    const org = await insertOrganization(db.app);
    const id = await withTransaction(pool, ctx, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO employee (organization_id, employee_number, first_name, last_name, status_changed_by)
         VALUES ($1, $2, 'Test', 'Employee', $3) RETURNING id`,
        [org, `E-${randomUUID()}`, ctx.actorId],
      );
      return rows[0]!.id;
    });
    const { rows } = await db.app.query<{ actor_id: string; source: string; correlation_id: string }>(
      'SELECT actor_id, source, correlation_id FROM audit_event WHERE entity_id = $1',
      [id],
    );
    expect(rows).toEqual([{ actor_id: ctx.actorId, source: 'UI', correlation_id: ctx.correlationId }]);
  });

  it("AU-05: one transaction's context never reaches the next on the same connection", async () => {
    await withTransaction(pool, context(), async () => undefined);
    const { rows } = await pool.query<{ actor: string | null }>(`SELECT audit_setting('actor_id') AS actor`);
    expect(rows[0]!.actor).toBeNull();
  });

  it('s20.2: a deadlock or serialization failure is retried a bounded number of times; anything else is not', async () => {
    let calls = 0;
    expect(
      await withTransaction(pool, context(), async () => {
        calls += 1;
        if (calls === 1) throw fail('40P01');
        if (calls === 2) throw fail('40001');
        return 'done';
      }),
    ).toBe('done');
    expect(calls).toBe(3);

    calls = 0;
    await expect(
      withTransaction(pool, context(), async () => {
        calls += 1;
        throw fail('40P01');
      }),
    ).rejects.toThrow('simulated 40P01');
    expect(calls, 'gives up after the bounded number of attempts').toBe(TRANSACTION_ATTEMPTS);

    calls = 0;
    await expect(
      withTransaction(pool, context(), async () => {
        calls += 1;
        throw fail('23505');
      }),
    ).rejects.toThrow('simulated 23505');
    expect(calls, 'a business error is not retried').toBe(1);
  });

  it('s21.1: a failed transaction leaves nothing behind', async () => {
    const name = `Rolled back ${randomUUID()}`;
    await expect(
      withTransaction(pool, context(), async (c) => {
        await c.query(`INSERT INTO organization (legal_name, currency_code, time_zone) VALUES ($1, 'XTS', 'UTC')`, [name]);
        throw fail('23514');
      }),
    ).rejects.toThrow();
    // The pool has one connection, so the next transaction would commit anything the failed one left open.
    await withTransaction(pool, context(), async () => undefined);
    const { rows } = await db.app.query('SELECT 1 FROM organization WHERE legal_name = $1', [name]);
    expect(rows).toHaveLength(0);
  });
});
