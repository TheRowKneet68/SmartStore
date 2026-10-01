import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../db/pool.ts';
import { AppError } from './errors.ts';
import { auditContext, missingPermission, refuse, rolesGranting, type Principal } from './gate.ts';

/**
 * How one state machine's subjects are found and changed. The edges, their permissions, events and reasons are data
 * (`state_machine_edge`); this says only where the subject lives.
 */
export interface MachineBinding {
  /** The machine's name in `state_machine_edge`. */
  machine: string;
  /** What a person calls one subject, for messages ("employee"). */
  noun: string;
  table: string;
  stateColumn: string;
  actorColumn: string;
  /** Store-scoped subjects are authorized in their store; organization-scoped ones organization-wide (OQ-025 item 6). */
  storeColumn: string | null;
  /** How the subject's organization is found, when its table has no `organization_id` (for example through its store). */
  organizationColumn?: string;
  /** Columns also set to the acting employee when the subject enters a state (for example `submitted_by`). */
  actorColumnsFor?: (to: string) => string[];
  /** Further columns read with the subject, for `keyFor`. */
  extraColumns?: string[];
  /**
   * The key the specification names for this subject, where it differs from the edge's by the subject's kind (for
   * example inventory-domain §5's opening balance). It returns the edge's own key otherwise.
   */
  keyFor?: (subject: Record<string, unknown>, event: string, key: string) => string;
  /** Work the transition's use case does with it, in its transaction (for example SM-47's session revocation). */
  after?: (client: pg.PoolClient, subjectId: string, from: string, to: string, principal: Principal, correlationId: string) => Promise<void>;
}

const Transition = z.object({
  machine: z.string().min(1),
  event: z.string().min(1),
  subject: z.uuid(),
  reasonCodeId: z.uuid().optional(),
  clientOperationId: z.uuid().optional(),
});

/** A refusal decided inside the transaction, recorded after it rolls back. */
class Denied extends Error {
  readonly key: string | null;
  readonly storeId: string | null;
  readonly code: string;
  readonly rule: string;

  constructor(key: string | null, storeId: string | null, code: string, rule: string, message: string) {
    super(message);
    this.key = key;
    this.storeId = storeId;
    this.code = code;
    this.rule = rule;
  }
}

interface Subject {
  state: string;
  organization_id: string;
  store_id: string | null;
}

/**
 * The transition API (architecture §18.1): `POST /transitions { machine, event, subject }`. The permission checked is
 * the one the attempted edge names in the §22 table, never one derived from the URL or the body (§8.4). An edge whose
 * permission is `OpenDecision` or `System` refuses every person (`SM-02d`). The subject is locked first, so the edge
 * is decided on its state at the moment of change (`ADR-25`).
 */
export async function transitionRoutes(
  app: FastifyInstance,
  options: { pool: pg.Pool; machines: MachineBinding[]; lockTimeoutMs: number },
): Promise<void> {
  const { pool } = options;
  const machines = new Map(options.machines.map((binding) => [binding.machine, binding]));

  app.post('/transitions', { config: { access: { kind: 'transition' } } }, async (request) => {
    const body = Transition.parse(request.body);
    const binding = machines.get(body.machine);
    if (binding === undefined) throw new AppError(400, 'invalid_request', `There is no ${body.machine} machine.`);
    const principal = request.principal!;
    try {
      return await withTransaction(
        pool,
        auditContext(request, { clientOperationId: body.clientOperationId ?? null, reasonCodeId: body.reasonCodeId ?? null }),
        (c) => transition(c, principal, binding, body.event, body.subject, request.id),
        // A transition may move stock (posting an adjustment), so it waits for a balance only so long (IV-23).
        { lockTimeoutMs: options.lockTimeoutMs },
      );
    } catch (error) {
      if (!(error instanceof Denied)) throw error;
      return refuse(pool, request, error.key, error.storeId, error.code, error.message, {
        machine: body.machine,
        event: body.event,
        subject: body.subject,
        rule: error.rule,
      });
    }
  });
}

async function transition(
  c: pg.PoolClient,
  principal: Principal,
  binding: MachineBinding,
  event: string,
  subjectId: string,
  correlationId: string,
): Promise<{ subject: string; state: string; changed: boolean }> {
  const store = binding.storeColumn === null ? 'NULL::uuid' : binding.storeColumn;
  const extra = (binding.extraColumns ?? []).map((column) => `, ${column}`).join('');
  const organization = binding.organizationColumn ?? 'organization_id';
  const found = await c.query<Subject & Record<string, unknown>>(
    `SELECT ${binding.stateColumn} AS state, ${organization} AS organization_id, ${store} AS store_id${extra}
     FROM ${binding.table} WHERE id = $1 FOR UPDATE`,
    [subjectId],
  );
  const subject = found.rows[0];
  // Another tenant's subject does not exist, as far as this caller can tell (MS-04, architecture §24.3).
  if (subject === undefined || subject.organization_id !== principal.organizationId) {
    throw new AppError(404, 'not_found', `There is no such ${binding.noun}.`);
  }

  const edge = await c.query<{ to_state: string; permission_rule: string; permission_key: string | null }>(
    `SELECT to_state, permission_rule, permission_key FROM state_machine_edge
     WHERE machine = $1 AND from_state = $2 AND event = $3`,
    [binding.machine, subject.state, event],
  );
  const step = edge.rows[0];
  if (step === undefined) {
    // SM-04: repeating a transition already made changes nothing and is not an error.
    const done = await c.query('SELECT 1 FROM state_machine_edge WHERE machine = $1 AND event = $2 AND to_state = $3', [
      binding.machine,
      event,
      subject.state,
    ]);
    if (done.rows.length > 0) return { subject: subjectId, state: subject.state, changed: false };
    // SM-06: an illegal transition is refused with a named message.
    throw new AppError(409, 'illegal_transition', `This ${binding.noun} is ${subject.state}, so it cannot ${event}.`);
  }

  if (step.permission_rule !== 'Key') {
    const message =
      step.permission_rule === 'OpenDecision'
        ? 'Nobody can do this yet: the owner has not decided which permission allows it.'
        : 'Only the system can do this.';
    throw new Denied(null, subject.store_id, 'not_permitted', step.permission_rule, message);
  }
  const key = binding.keyFor?.(subject, event, step.permission_key!) ?? step.permission_key!;
  const roles = await rolesGranting(c, principal, key, subject.store_id);
  if (roles === null) {
    throw new Denied(key, subject.store_id, 'forbidden', 'Key', missingPermission(key, subject.store_id));
  }
  // The role-as-used is known only now, from the edge's key (architecture §14.2).
  await c.query(`SELECT set_config('smartstore.role', $1, true)`, [roles]);

  // The database enforces the edge again, records its event and requires its reason (SS004, SS055; D6).
  const actors = [binding.actorColumn, ...(binding.actorColumnsFor?.(step.to_state) ?? [])].map((column) => `${column} = $3`).join(', ');
  await c.query(`UPDATE ${binding.table} SET ${binding.stateColumn} = $2, ${actors} WHERE id = $1`, [
    subjectId,
    step.to_state,
    principal.employeeId,
  ]);
  await binding.after?.(c, subjectId, subject.state, step.to_state, principal, correlationId);
  return { subject: subjectId, state: step.to_state, changed: true };
}
