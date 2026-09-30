# SmartStore — Audit Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `AuditEvent`, append-only history, the retention/archival policy, and the standing audit reports.
The immutability principle is BI-24 (audit entries) and BI-08 (documents), and the two are separate (BI-15a); the permission catalog lives in
[actors-and-roles.md](actors-and-roles.md) §3.

---

## 1. The rule

> **The audit log is append-only, complete for money and permission, redacted by policy, and never a thing you
> can edit — including the people who wrote it.**

**Rule AU-01.** An audit event is **created in the same transaction as the change it records.** An event written
after the fact is a report, and a report can be lost, delayed, or lost in a crash between the commit and the
write. A database that committed a void without its audit row has a money discrepancy nobody can investigate.

**Rule AU-02 — there is no update and no delete on an audit event, at any privilege.** Not by the Owner, not by
an administrator, not by retention cleanup. Retention **archives or expires** whole events; it never edits one
(overview §3.10, BI-24).

**Rule AU-03 — money and permission events are mandatory.** The completeness floor is: every stock movement, every
price change, every payment state change, every refund, every cash transaction, every void, every manual
adjustment, every permission or role change, every provider configuration change, every login, every logout and
session end, and every failed authorisation. A gap here is a gap in the product, not a missing feature.

**Rule AU-04 — the log records what happened, not what was intended.** `Stock.Adjustment` records the resulting
values, the previous values, the reason, and the actor. It does not record what the actor was hoping to achieve.

**Rule AU-05 — the actor is recorded from the authenticated identity, never from the request body.** A client
that sends `UserId` in a payload is offering to forge history. The authenticated principal is the only source
(BI-23).

**Rule AU-06 — impersonation is itself an event.** When a user acts as another, both the real principal and the
effective principal are recorded, with the reason and the approving identity. Impersonation is a legitimate
support tool and a fraud tool; without an event it is only the second.

---

## 2. What an event holds

| Field | Purpose |
|---|---|
| `Id`, `OccurredAt` | Identity and ordering. `OccurredAt` is server time |
| `EntityType`, `EntityId` | What changed |
| `EventType` | What happened (a closed vocabulary, §2.1) |
| `ActorId` | The authenticated principal (AU-05) |
| `EffectiveActorId` | Present only under impersonation (AU-06) |
| `StoreId` | Organization-global, filterable (MS-29) |
| `Before`, `After` | The changed fields. Redacted per CU-35 |
| `Reason` | Mandatory where the domain says so |
| `CorrelationId`, `ClientOperationId` | Ties the event to the request that caused it |
| `Source` | UI, API, job, device, offline sync, or terminal |

**Rule AU-07 — the store is on the event, always.** It is derived from the affected entity, not from the request,
so an event is filterable by store without a join (MS-29).

**Rule AU-08 — `Before`/`After` hold only the changed fields**, not whole entities. A whole-entity snapshot of a
customer record on every event is a second copy of the PII, subject to no redaction rule, and it grows without
bound.

**Rule AU-09 — redaction is applied at write time, not at read time.** A masked field is masked in the stored
event (CU-35, PY-44). Masking on read leaves the value in the database for anyone with a backup, a log
reader, or a direct query.

**Rule AU-10 — correlation and operation ids are the join key for investigation.** The error the cashier saw and
the event that recorded the failure are the same operation, found by `CorrelationId` (HD-18, BI-23).

---

## 3. The event vocabulary is closed

**Rule AU-11.** `EventType` is a closed, versioned set. Free-text event types turn a log into a grep exercise,
and a log that can only be grepped is a log nobody queries during an investigation.

**Rule AU-12.** Event types are namespaced by domain and are the same identifiers as the rule that requires them:

`Inventory.Movement`, `Inventory.Adjustment`, `Inventory.FEFOOverride`, `Payment.Capture`, `Payment.Refund`,
`Payment.Provider.Configure`, `Cash.PayOut`, `Sale.Void`, `Shift.Close`, `Price.Change`, `Security.Login`,
`Security.Logout`, `Security.SessionEnded`, `Security.LoginFailed`, `Security.PermissionDenied`,
`Security.Role.Assign`, `Security.Impersonate`, `Data.Export`, `Offline.SyncApplied`,
`Offline.SyncAppliedWithAdjustment`, `Offline.SyncRejected`, `Approval.Decided`, `Notification.Sent`,
`Product.Archive`, `Employee.Terminate`, `Audit.EventExpired`.

**D-06 additions** (owner decision D-06, 2026-09-29): `Product.StateChange`, `Inventory.BatchStateChange`,
`Purchase.OrderStateChange`, `Purchase.ReceiptStateChange`, `Purchase.InvoiceStateChange`,
`Purchase.PayableCreated`, `Purchase.PayableSettled`, `Sale.Completed`, `Return.StateChange`,
`Refund.StateChange`, `Customer.StateChange`, `Employee.StateChange`, `Payment.StateChange`,
`Shift.StateChange`, `Shift.Reopened`, `Device.ModeChange`, `Device.StateChange`,
`Inventory.CountStateChange`, `Inventory.TransferStateChange`, `Rfid.Credential.StateChange`.

**Rule AU-12b — the vocabulary is complete against AU-03, not merely illustrative.** Every event type required by a
rule elsewhere in Phase 1 is in the AU-12 set, and a rule that requires a new event type names it here. The five
types added to the original list close real gaps found in the Phase 1 audit, each named by a rule that already
demanded the event and found no type for it:

| Event type | Required by | Why the original list missed it |
|---|---|---|
| `Inventory.FEFOOverride` | `BE-` FEFO override (batch-expiry-fefo) | A non-FEFO batch choice is a stock decision, not a movement, and so matched no existing name |
| `Offline.SyncAppliedWithAdjustment` | `OF-36`, `SM-65` | `Offline.SyncApplied` existed but cannot represent "accepted **and** changed" |
| `Product.Archive` | `PR-47` | `Product.Archive` is a permission and a state; no event type carried it |
| `Employee.Terminate` | `EM-10` | Termination is the one irreversible employee operation and had no event type |
| `Audit.EventExpired` | `AU-` retention expiry (audit-domain) | Expiry of a retained event is itself a compliance event |

**The D-06 additions** close the transition-contract cells (`GATE-AUDITTYPES`): the lifecycle, cancel, and close
edges the five above did not cover. Each new type is a per-machine semantic action named by an existing rule, and
each names the transitions it records (state-machines §22). A `StateChange` type is justified only where a
machine's several edges genuinely share one semantic action; the money events (`Payment.Capture`,
`Payment.Refund`, `Shift.Close`, `Purchase.PayableCreated`/`Settled`) stay distinct from their lifecycle
types.

**Rule AU-12c — the vocabulary stays closed.** This list is not a starting set to grow opportunistically. A new
type is added by the change described in AU-13, and only when a rule already requires the event. **Adding a type
because an implementation would like to log something is exactly the failure AU-11 exists to prevent.**

**Rule AU-12a — logout and session end are both events.** An explicit logout records `Security.Logout`; an
expired, revoked, or signed-out-elsewhere session records `Security.SessionEnded` with the cause. The
distinction matters to an investigation: a user who left is not the same as a user whose session was taken
away, and only one of them suggests an account takeover.

**Rule AU-13 — a new event type is a schema change, reviewed like one.** Because the log is a compliance record,
its vocabulary changing silently is a compliance event.

---

## 4. What is never audited

**Rule AU-14 — reads are not audited, except exports, sensitive reads, and failed authorisations.** Auditing
every read produces a log that drowns the events that matter and costs storage proportional to traffic, not to
risk.

**Rule AU-15 — the following are explicitly audited because they are the exfiltration paths**: data export,
report generation beyond a store's data, bulk read, and any read of a full customer list. `Data.Export` and
`Security.PermissionDenied` are not optional events (AU-03).

**Rule AU-16 — a scheduled job records what it did and what it changed**, in the same event vocabulary. A nightly
reconciliation that silently changes a balance is exactly the event an investigation needs.

---

## 5. Retention, archival, and the right to be forgotten

> **A financial audit record has a legal retention floor. A customer marketing record has a consent ceiling. Both
> are real, and pretending the second does not exist is how a deletion request becomes a legal problem.**

**Rule AU-17.** Retention is a per-category policy, configured per organization, with a legal floor for the
financial categories and a consent ceiling for the personal ones. **Both are configuration; neither is hardcoded**,
because the floor differs by jurisdiction and the ceiling by the customer's consent.

**Rule AU-18 — financial event categories** (stock movements, payments, refunds, cash transactions, price
changes, voids, adjustments, approval decisions) are retained for the organization's configured financial period
and are **not deletable before it**, whatever else is requested. Deleting a payment record on request would leave
a sale that cannot be explained, and BI-12's traceability would break.

**Rule AU-19 — personal data in an event is redacted, then the event's personal fields are expirable** where the
category is not financial. A customer's name in a `Price.Change` event, two years after they asked to be
forgotten, is a GDPR failure, and the retention policy is where it is prevented (CU-37).

**Rule AU-20 — expiry is whole-event and append-only.** Expiring an event removes a row and writes a
`Audit.EventExpired` event recording the range and the policy that did it. **The system that forgets must record
that it forgot**, or the gap is indistinguishable from a tamper.

**Rule AU-21 — archival moves events to cold storage and preserves the query path.** An investigator asking about
a transaction from four years ago gets an answer, slower.

**Rule AU-22 — the retention policy itself is versioned and audited.** A policy change that shortens retention is
a compliance event and requires approval (AP-07).

---

## 6. Who can read it

**Rule AU-23.** Reading the audit log requires `Audit.View`, scoped to a store or organization-wide
(actors-and-roles §3). The log is not visible to ordinary supervisory roles. An employee who can see their own
actions is not being audited.

**Rule AU-24 — `Audit.View` does not grant `Audit.View.Sensitive`, and the log cannot be edited by anyone who can
read it.** `Audit.View` and `Audit.View.Sensitive` are separate, and no role holds both (SEP-09).

**Rule AU-25 — every access to the log is itself audited**, at `Info` level, including who looked at whom. An
audit log that records everything except who read the log is an incomplete audit log, and reading the log to
cover a track is the oldest trick in the book.

**Rule AU-26 — access to an employee's own actions is not a special case.** Supervisors see their store; they
see their own events like anyone else's, and a request to suppress one's own event is refused (BI-24, SP-14).

---

## 7. The standing reports

**Rule AU-27.** The audit domain ships the reports an investigation actually starts from, rather than leaving the
log as a query exercise:

| Report | Answers |
|---|---|
| Permission denials by employee/terminal/time | Is someone probing privileges |
| Void and refund concentration by actor | Is someone stealing in small amounts |
| Stock adjustments by actor and reason | Is the adjustment log being used |
| Price changes outside trading hours | Is someone repricing quietly |
| After-hours activity by actor | Is anyone working at 3am |
| Logins from unexpected terminals or geographies | Is a credential shared |
| Failed logins by account | Is a password being guessed |
| Exits and re-opens of closed shifts (CD-26) | Is the money record being revisited |
| Provider configuration changes (PY-06) | Is a payment route being redirected |
| Retention or purge activity (AU-20) | Has the record been tampered with |

**Rule AU-28 — every standing report is a projection, rebuildable from the events.** Same rule as every other
projection in the system (BI-02, CD-08, CU-11). A standing report that cannot be rebuilt is a report that
cannot be trusted after a bug.

---

## 8. Integrity

**Rule AU-29.** The audit store is **append-only at the storage layer**, not merely by application convention. A
truncated or deleted event is detectable: events are chained or signed per organization so a removal breaks the
chain and is reported.

**Rule AU-30 — the chain check is a job, and a broken chain is an incident, not a warning.** Silent corruption in
a compliance record is the failure mode this whole domain exists to prevent.

**Rule AU-31 — a database administrator with write access to the audit store is a known, documented risk**,
mitigated by the chain and by separating the store's credentials. It is documented rather than solved, because
solving it properly means an external log shipper, which is an infrastructure decision Phase 2 will make against
this requirement.

**Rule AU-32 — no `Audit` entity appears in the batch, deletion, or cascade vocabulary.** A cascade delete must
never reach an audit event (BI-24, BI-40, HD-14). An entity is deleted with compensating records, and the events about
it stay.

---

## 9. Deliberately out of scope

**Rule AU-33 — no tamper-evident blockchain, no external notary, no third-party timestamping in v1.** The chain is
sufficient for the stated threat, which is a careless or curious insider, not a state-level adversary.

**Rule AU-34 — no per-field, per-reason audit trails on every entity in v1.** The mandatory floor is AU-03, and a
change-history UI on all 60 entities is a Phase 3 feature. The events exist for all of them; the UI is selective.

**Rule AU-35 — no real-time alerting on audit events in v1.** A standing report and a notification on the
thresholds that matter (NT-14) is enough. Streaming every denial to a live wall is an operations feature.

---

## 10. Audit rules index

| ID | Rule |
|---|---|
| AU-01 | The event is written in the same transaction as the change |
| AU-02 | No update, no delete, at any privilege. Retention archives or expires whole events |
| AU-03 | Money and permission events are mandatory, with a stated completeness floor |
| AU-04 | The log records what happened, not what was intended |
| AU-05 | The actor comes from the authenticated principal, never the request body |
| AU-06 | Impersonation is itself an event, recording both principals and the reason |
| AU-07 | The store is on the event, derived from the affected entity |
| AU-08 | `Before`/`After` hold only changed fields |
| AU-09 | Redaction happens at write time, not at read time |
| AU-10 | `CorrelationId` and `ClientOperationId` are the investigation join key |
| AU-11 | `EventType` is a closed, versioned set |
| AU-12 | Event types are namespaced by domain and match the rule that requires them |
| AU-12a | `Security.Logout` and `Security.SessionEnded` are distinct events |
| AU-13 | A new event type is a reviewed schema change |
| AU-14 | Reads are not audited, except exports, sensitive reads, and denials |
| AU-15 | Export, bulk read, and full-customer-list reads are audited exfiltration paths |
| AU-16 | A scheduled job records what it did and what it changed |
| AU-17 | Retention is per-category, with a legal floor and a consent ceiling, both configured |
| AU-18 | Financial events are not deletable before the configured financial period |
| AU-19 | Personal fields in non-financial events are expirable after redaction at write |
| AU-20 | Expiry is whole-event and writes an `Audit.EventExpired` event |
| AU-21 | Archival preserves the query path |
| AU-22 | Retention policy changes are versioned, audited, and approvaled |
| AU-23 | Reading the log requires `Audit.View`, store- or organization-scoped |
| AU-24 | `Audit.View` does not grant export, and no role holds read and remediate together |
| AU-25 | Every access to the log is itself audited, including who looked at whom |
| AU-26 | An employee sees their own events like anyone else's |
| AU-27 | The domain ships the standing investigation reports |
| AU-28 | Standing reports are rebuildable projections of the events |
| AU-29 | The store is append-only at the storage layer, with a per-organization chain |
| AU-30 | A chain check is a job, and a broken chain is an incident |
| AU-31 | Administrator write access is a documented, chain-mitigated risk |
| AU-32 | No cascade or bulk delete ever reaches an audit event |
| AU-33 | No blockchain, notary, or external timestamping in v1 |
| AU-34 | No per-field history UI on every entity in v1 |
| AU-35 | No real-time audit streaming in v1 |
| — | The mandatory categories are the AU-03 floor in §3; AU-01 to AU-35 are indexed here |
