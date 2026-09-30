# Domain 6 — Audit

**Phase 3 — database design.** Migration: `db/migrations/20261001100000_d6_audit.sql`. Conventions:
[CONVENTIONS.md](CONVENTIONS.md) §17. Previous: [D5](D5-RETURNS-REFUNDS.md).

| State (Constitution §5) | What |
|---|---|
| **DESIGNED** | Everything in this document |
| **IMPLEMENTED** | The migration: the vocabulary, the event table, the writers for every built machine and ledger, the application's recorder, the per-organization chain and its check |
| **TESTED** | `server/test/d6-audit.test.ts` (22 tests) plus every earlier suite, now running with audit on; 252 passing |
| **Not built** | §10, and all application code: the sign-in events' producers, the audit read path and its permissions, the chain check's schedule |

Sources: [audit-domain.md](../product/audit-domain.md) (`AU-*`), architecture §14, owner decisions `D-06` and `D-07`,
`state-machines.md` §22 (the Audit column), [multi-store-domain.md](../product/multi-store-domain.md) (`MS-29`),
requirements `RT-290`..`RT-302`, `RT-464`..`RT-467`, Constitution §12.

---

## 1. How an event is written

`AU-01` requires the event in the same transaction as the change, and Constitution §12 forbids making audit depend on the
caller. So **the database writes the event itself**, from triggers on the tables whose changes are audited. A change
and its event commit or roll back together, so there is never a change without its event and never an event for a
change that did not happen (`RT-290`). The application cannot insert into `audit_event` at all. The one way it
writes events is `record_audit_event()`, and only for the event types that are its own (§6).

Each event takes three kinds of information:

- **From the row:** the entity, its store and organization (`AU-07`), and its reason where the document has one.
- **From the change:** the whole created row, or before and after of only the fields that changed (`AU-04`, `AU-08`).
- **From the authenticated context** (§4): the actor, the effective actor under impersonation, the role used, the
  source, the terminal, the correlation and client operation ids, and the IP address (`AU-05`, `AU-06`, `AU-10`,
  architecture §14.2). None of these comes from the request body.

## 2. Tables

| Table | Scope | Purpose |
|---|---|---|
| `audit_event_type` | reference | The closed vocabulary (`AU-11`, `AU-12c`): the 26 types of `AU-12`, the 20 of `D-06`, and `Cash.In`, which §22.11 records for opening a shift (OQ-024). Each type's **origin** says who writes it: `Database` (the triggers, with the change) or `Application` (through `record_audit_event()`). A new type is a migration (`AU-13`) |
| `audit_event` | exception: organization, with a nullable store | The §2 fields of audit-domain: time (server), type, entity, actor, effective actor, role used, source, terminal, correlation id, client operation id, IP, reason, before, after. Organization-global and filterable by store without a join (`MS-29`, `AU-07`): the store is null exactly when the entity has none. **No update, delete or truncate at any privilege** (`AU-02`, `SS010`) |
| `audit_chain_link` | organization | Each event's place in its organization's hash chain (`AU-29`); append-only at every privilege |
| `audit_chain_head` | organization | The chain's tip per organization, so a removal at the end is detectable too |

`state_machine_state` gains `creation_audit_event_type`, and `state_machine_edge` gains `audit_event_type` and
`requires_reason`. **The §22 Audit column becomes data**, next to the edges it describes.

## 3. The contract as data (§22, `D-06`)

| Machine | Creation | Edges |
|---|---|---|
| Product (§22.1) | none | activate, discontinue, reactivate, hide, unhide → `Product.StateChange`; archive → `Product.Archive` |
| StockAdjustment (§22.17) | none | approve → `Approval.Decided`; post, cancel, reverse → `Inventory.Adjustment`; submit → none ("on exit": the approval records it) |
| Sale (§22.6) | `Sale.Completed` | void → `Sale.Void`; return part, return rest → none (the return's `Inventory.Movement` events record them) |
| Payment (§22.10) | `Payment.StateChange` (submit) | authorize, void ×2, decline, fail → `Payment.StateChange`; capture → `Payment.Capture` |
| Shift (§22.11) | none (the opening float's own `Cash.In`) | begin count → `Shift.StateChange`; close, recount → `Shift.Close` |
| Device (§22.12) | `Device.StateChange` | activate, disable, reactivate, retire → `Device.StateChange`; a mode change → `Device.ModeChange` |
| CustomerReturn (§22.7) | none | cancel → `Return.StateChange`; post → none (its movements) |
| Refund (§22.7) | none | approve → `Approval.Decided`; complete, fail → `Payment.Refund` ("on exit" from `Processing`); cancel → `Refund.StateChange`; submit, submit to provider, retry → none |

Two readings are stated here and listed in OQ-024:

- **"On exit".** "`Approval.Decided` on exit" (submit) and "`Payment.Refund` on exit" (submit to provider) record the
  event when the state is left, not when it is entered, so the entering edges record nothing.
- **An event another row already writes is not written twice.** A shift's opening is recorded by its opening float's
  `Cash.In`. A return's posting and a sale's return edges are recorded by the `Inventory.Movement` of each movement.

A test holds the whole table against the contract, edge by edge, so a missing or extra edge fails the build.

**Ledger rows** write the `AU-03` floor directly:

- every stock movement → `Inventory.Movement`, with its resulting balance (`AU-04`);
- every cash transaction → `Cash.In` or `Cash.PayOut` by its direction, with the cash type in `after`;
- every organization or store price → `Price.Change`.

## 4. The authenticated context (`AU-05`, `AU-06`, `AU-10`)

The application sets the request context **per transaction** with `set_config('smartstore.<name>', value, true)`,
taken from the signed-in session. The database reads it with `audit_setting()`.

| Setting | Required | Recorded as |
|---|---|---|
| `actor_id` | yes (only a failed sign-in has none) | `actor_id` |
| `source` | yes: `UI`, `API`, `Job`, `Device`, `OfflineSync`, `Terminal` | `source` |
| `correlation_id` | yes | `correlation_id` |
| `effective_actor_id` | under impersonation | `effective_actor_id`, which must differ from the actor |
| `role`, `terminal_id`, `client_operation_id`, `ip_address` | when known | the same names |
| `reason_code_id` | for a transition that needs a reason its document cannot carry | `reason_code_id` |

**An audited change without an actor, a source or a correlation id is refused (`SS054`).** Refusing the change
leaves nothing, so no change can escape its event. The event names the authenticated actor even if the row names
someone else. Making the rows' own `*_by` columns equal the authenticated principal needs the employee table, so it
is a pending guard for domain 7 (CONVENTIONS §12). Test connections carry a TEST-ONLY default context from connection
start; the production application sets it per transaction and has no default.

## 5. Reasons (`BI-25`, the §22 preconditions)

An edge whose contract precondition says "Reason" has `requires_reason`. Its event takes the reason from the
document (`cancel_reason_code_id`, `late_reason_code_id` or `reason_code_id`) or, where the document has no reason
column, from the context. Without either, the change is refused (`SS055`). A context reason must be live (`SS024`) and
of the entity's organization (`23503`). This closes a gap in domains 2 and 4:

- Product: discontinue, reactivate, hide, unhide and archive.
- Device: disable, reactivation and retirement; setting `Maintenance` or restoring `Standard`.

All of these needed a reason by contract but had nowhere to record one. The earlier tests now supply it.

## 6. Events the application records

`record_audit_event(type, organization, store, entity type, entity, after)` is the application's only writer. It
takes the actor and the request context from the session, never from its arguments. It refuses any `Database` type
(`SS056`): an `Inventory.Movement` or a `Payment.Capture` event exists only because the change happened. An unknown
type is refused by the vocabulary's key (`23503`, `AU-11`). A failed sign-in may have no actor; every other event must
have one (`SS054`, `ck_audit_event_actor`). Sign-in, sign-out, session end, denial, export and impersonation events
are recorded this way once domain 7 and the application exist.

## 7. The chain (`AU-29`, `AU-30`, `AU-31`)

Every event is linked into its organization's chain **when its transaction commits**, by a deferred trigger:

`hash = sha256(previous hash ‖ canonical form of the event)`

The canonical form is a JSON array of every field, in a fixed order, with the time in UTC. It is therefore
unambiguous and independent of the session's time zone. `audit_chain_breaks(org)` walks the chain and returns every
break without repairing it:

- a missing link;
- a link that does not continue from its predecessor;
- an altered event;
- an event outside the chain;
- a chain shorter than its recorded head.

An empty result is the proof (`RT-302`). Tests alter, remove and unlink events as the owner and see each break
reported.

**Why at commit.** Linking takes the organization's chain head lock. Taken at the first audited statement, the lock
would be held while the transaction goes on to lock stock balances and document rows, and two tills could deadlock
on the pair. Linking last means a transaction waits for the head only after holding every business lock it needs,
and the holder is committing and needs nothing else. So it cannot deadlock. Thirty concurrent transactions link with
no gap or fork. The ceiling is that one organization's commits serialise at the moment of linking. It is marked
`ponytail` in the migration: shard the chain per store if one organization ever needs more.

`AU-31` stands as documented. Someone who can disable triggers can rewrite events **and** recompute the chain after
them. The chain detects everything short of that, and separate credentials plus an external shipper are the stated
mitigation, outside v1 (`AU-33`).

## 8. Error codes

| Code | Meaning |
|---|---|
| `SS054` | An audited change, or an application event, without the authenticated actor, source or correlation id |
| `SS055` | A transition whose contract needs a reason, with none from its document or the context |
| `SS056` | The application tried to record a type the database writes itself |

Reused: `SS010` (the event and chain tables are append-only at every privilege) and `SS024` (an archived reason).

## 9. Tests — what proves what

| Rule | Proven by (`d6-audit.test.ts`) |
|---|---|
| `AU-12`, `AU-12b`, `D-06` | The vocabulary is exactly the documented set |
| `RT-292`, §22 | Every creation and edge of the eight built machines carries its contract row's type and reason flag |
| `AU-11`, `RT-465` | A free-text type is refused |
| `AU-01`, `AU-03`, `SP-02`, `RT-290` | A cash sale writes its payment, sale, movement and change events, each on its entity, with the store, actor, source and correlation id; a failed sale writes none |
| `AU-04`, `AU-07`, `AU-08`, `RT-464` | A movement's event carries its resulting balance; an organization price has no store and a store price has its store; a status change records only the changed fields |
| `AU-05`, `AU-10`, `RT-293` | No actor, source or correlation id: refused and nothing written; an unknown source refused; the event names the authenticated actor, not the row's |
| `AU-06`, `RT-294` | Impersonation records both principals, and they must differ |
| `BI-25`, §22 | A reason is required where the contract says so, must be live and of the organization, and is recorded; tills need one to be disabled or put in maintenance, not for training |
| `RT-292` floor | Shifts, cash transactions, adjustments, payments (a decline included), returns and refunds each record exactly their events |
| `AU-02`, `RT-291` | No role updates, deletes or truncates events or links; even the owner cannot insert an event with no actor or another organization's store |
| `AU-05`, `AU-12a`, `AU-15` | The application cannot insert or call the internal writer; it records its own types with the session's actor, never the database's; a failed sign-in may lack an actor, a sign-out may not |
| `AU-29`, `AU-30`, `RT-302` | Every event is linked in order and the check finds no break, in any session time zone; 30 concurrent transactions link cleanly; an altered, removed, tail-removed or unlinked event is each reported |

The earlier domains' tests run with audit on: 252 tests pass, and every sale, adjustment, return and refund they
perform writes and chains its events.

**Mutation check (2026-10-01).** 51 mutations, each removing or weakening one guard, were applied one at a time, and
the migration still applied every time. 49 turned tests red:

- the context and reason requirements;
- redaction of unchanged fields;
- store and organization derivation;
- the revoked writer;
- four contract mappings;
- the mode reason;
- the cash direction;
- each of the twelve audit triggers;
- the application recorder's two refusals;
- every `CHECK` and key on the event;
- both immutability triggers;
- every step of the chain's linking and checking;
- the canonical form's payload and its time zone.

The two truncate guards survived **one at a time**, and that is by design:

- the chain's foreign key stops the events being truncated alone;
- a joint truncate of events and chain is refused by whichever table's guard fires first.

Removing **both** turns the test red, which was confirmed separately.

## 10. Decisions, open questions, and what is not built

- **OQ-024** (new) records the vocabulary and rule gaps:
  - `Cash.In` is missing from `AU-12`.
  - No type exists for reading the log (`AU-25`, `RT-300`).
  - `AU-02` and `AU-20` disagree on expiry.
  - Master data and configuration have no event type.
  - The reading of §22.6's tender audit.
  - Product activation's reason.
  - `RT-292`'s "twenty categories".
- **Pending guards for domain 7** (CONVENTIONS §12):
  - Documents' `*_by` columns equal the authenticated principal (`AU-05`, `BI-33`).
  - Personal fields are redacted in `before` and `after` at write time (`AU-09`, `RT-295`); no v1 table before the
    employee has personal data.
- **Not built:**
  - Retention, expiry and archival (`AU-17`..`AU-22`, `RT-297`, `RT-298`, `RT-466`). They wait for the configured
    financial periods, a legal floor like `GAP-044`, and `AU-02`/`AU-20` must be reconciled first.
  - The audit read path and its permissions (`AU-23`..`AU-26`, domain 7 and the application).
  - The standing reports (`AU-27`, `AU-28`, P5).
  - The chain check's schedule (`AU-30`, P5).
  - The external log shipper (`AU-31`).
