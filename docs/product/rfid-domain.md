# SmartStore — RFID Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `RfidReader`, `RfidTag`, `RfidCredential`, `RfidEvent`, `AuthenticationEvent`, anti-duplication, and the
offline behaviour of the RFID subsystem.

---

## 1. The rule this entire document exists to enforce

> **An RFID read identifies a credential. It grants nothing.**

**Rule RF-01.** The authentication flow is exactly:

```
RFID read → credential lookup → employee resolution → session established → PERMISSION CHECK → action
                                                    (BI-33)
```

**Rule RF-02.** The RFID subsystem has **no code path to a business operation.** A valid tag read produces an
**identity assertion**, never an access grant. There is no operation anywhere in the product whose only
authorisation is a tag read.

**Why this is stated first, before any feature.** Phase 0 finding **S-06**: a surveyed system stored a
`PermissionsJson` column on roles, seeded it, displayed it in a UI, and **never once read it for an access
decision**, while 16 of 18 controllers had no authorization at all. The RFID layer was fully built and completely
inert. The lesson is not that RFID is dangerous. It is that **an identity signal and an authorisation decision are
different things**, and a system that treats the first as the second has no access control at all — it has a
convenient-looking substitute for it.

**Rule RF-03 — the test is absolute and is a release gate:** an employee with **zero** permissions whose valid
RFID card is read at an authorised reader still cannot perform any action, and the read is recorded as a successful
read with no authorisation consequence. If this test ever fails, the product has a security defect, not a feature.

---

## 2. Tag and credential — two different things

| Entity | What it is |
|---|---|
| `RfidTag` | A physical tag. An identifier, plus its type and state |
| `RfidCredential` | A **binding** of a tag to an employee, with a lifecycle |

**Why two entities.** A tag exists before it is assigned, and after it is unassigned. A credential is the
assignment. Conflating them means a lost tag must be deleted — and deleting the tag record destroys the evidence
that tag 0x44A1 was issued to an employee on 4 March and read at reader 3 last Tuesday, which is exactly the
evidence an investigation needs.

**Rule RF-04.** A `RfidTag` is **never deleted**. It is archived with its full history.

**Rule RF-05.** A `RfidCredential` has its own state machine (see §7) and may be issued, suspended, re-assigned to
a different employee (with a reason and audit), or revoked. Revocation is not deletion.

**Rule RF-06 — one tag binds to at most one employee at a time**, and the binding is unique across the
organization. A tag bound to two employees would make the identity assertion ambiguous, and an ambiguous identity
assertion is a non-deterministic access decision — the exact class of bug the uniqueness rules elsewhere prevent
(PR-08 has the same shape for barcodes).

---

## 3. Tag types

`RfidTag.Type` is **closed and enumerated**, because the read means different things for each:

| Type | Carries | Use |
|---|---|---|
| `Employee` | A credential bound to an employee | Clock-in/out, session identification at a reader-attended till |
| `CustomerLoyalty` | A customer identifier | Loyalty lookup. **Not** an identity proof (CU-30) |
| `Stock` | A batch or serialized unit reference | Batch identification, not permission |
| `Fixture` | A fixed reader, door, or tag | Physical presence of a device, not a person |
| `Unassigned` | Nothing yet | A tag in stock awaiting issue |

**Rule RF-07 — a tag's type is immutable once issued.** Changing `Employee` to `Stock` on a tag that was read at
a till is a history rewrite. A new tag is issued instead.

**Rule RF-08 — a `CustomerLoyalty` tag grants nothing** (CU-30). It resolves a customer for a points balance and
is a service convenience. It is never authentication, never a payment credential, and never a discount
authorisation. **"Tap to pay" with a loyalty tag is explicitly out of scope for v1** and must not be improvised: it
is a payment authorisation and needs a whole different security model.

---

## 4. Readers and what a read is allowed to do

`RfidReader` is a `Device` with the `RfidReader` capability (hardware-domain §3). It holds its reader type, the
store or warehouse it serves, the ports it covers, the antenna count, its configured mode, its health, and its
last heartbeat.

**Rule RF-09 — a reader's mode is configured, and it determines what a read means:**

| Mode | A read produces | A read does **not** produce |
|---|---|---|
| `Identify` | A session identification, requiring the employee to confirm with a credential factor | Any business operation without a permission check |
| `Clock` | An `AttendanceEvent` (EM-23) | A session, a permission, a till login |
| `Door` | A door-open request, logged with the tag | A business session |
| `Inventory` | A stock identification for a batch or unit | Any change to stock. A read is an observation, not a movement |
| `IdentifyAndClock` | Both of the above, in one read | Anything else |

**Rule RF-10 — `Inventory` mode is the easiest thing to get dangerously wrong.** A read in `Inventory` mode
populates a list. Posting a count variance from that list is a separate, permissioned, reason-bearing operation
(IV-28, IV-33). A reader that posts a count on a read would make every employee with a tag a stock-adjustment
actor, and it would be invisible.

**Rule RF-11 — a door open is a request, not an authentication.** The door controller decides. SmartStore records
that tag X was read at door Y at 08:03 and reports it; whether the door opened is the controller's business. A
system that both decides and records the decision can only report what it already decided.

**Rule RF-12 — a reader must be registered and authenticated before its events are accepted** (BI-35). An
unregistered reader's events are rejected and recorded as rejected. **An unauthenticated reader feeding a till is
a direct attack path**, because a rogue reader at a till would let an unauthenticated person assert an identity
and then be checked against permissions they chose.

**Rule RF-13.** Reader events are recorded with both the device's observation timestamp and the server's receipt
timestamp (overview §3.3), and the reader's own is authoritative for what the operator saw.

---

## 5. Events and anti-duplication

**Rule RF-14.** `RfidEvent` records: reader, tag, observation timestamp, server receipt timestamp, antenna or
port, RSSI, read count within a burst, mode, the store, and the resolution outcome. It is **append-only** and
**never carries an authorisation consequence** (RF-01).

**Rule RF-15 — one physical read, one event.** A reader firing eight reads as it captures a tag produces
**one** `RfidEvent` with `ReadCount = 8`, not eight events. Eight events per tag makes a busy hour
unreadable, and a report of "tag reads today" that counts antenna cycles rather than people is worse than no
report.

**Rule RF-16 — a duplicate event is discarded and recorded as a duplicate in the device log** (overview §3.10).
The device-generated event UUID is the idempotency key (BI-28 shape).

**Rule RF-17 — an anti-duplication window is per tag, per reader, and time-bounded** — default 2 seconds. A second
read of the same tag at the same reader inside the window is folded into the first event's read count.

**Rule RF-18 — the anti-duplication window never suppresses a *different* operation.** A tag read at the clock
reader and the same tag at the door 30 seconds later are two events, because they are two facts. A window keyed
only on tag and time would silently drop the second, and the second is the interesting one.

**Rule RF-19 — the window is a device concern, applied at the edge**, not a server-side post-filter. The edge
agent owns hardware (principle 6), and a server-side filter cannot undo 40 duplicate events already queued.

---

## 6. Authentication and sessions

**Rule RF-20 — a tag read establishes an *identity assertion*, and the session is established only after a
credential factor.** The options, in the order a real store would use them:

| Store setup | Flow | Security posture |
|---|---|---|
| Reader-attended till | Read → confirm with PIN | **Recommended default.** A stolen card is not a sale |
| Trusted staff area | Read → session | Acceptable only where the reader is physically in a controlled space |
| High-value approval | Read → session, then approval still requires a PIN and a different approver | `*.Large.Approve` is never satisfied by a tag alone (BI-26) |

**Rule RF-21 — a tag never satisfies an approval.** Every two-person rule in the specification (BI-26) requires a
*different employee*, and reading a second employee's tag is how that second employee is identified — but the
approval is a deliberate act in a session, not an automatic consequence of a read. A tag read cannot approve a
discount, a refund, a price change, a stock adjustment, or a cash withdrawal.

**Rule RF-22 — a session from a tag read has a short inactivity timeout** and is bound to the terminal. A
session that survives a cashier walking away is a session another person uses.

**Rule RF-23 — a tag read at a terminal where the employee has no store access establishes no session** (BI-14,
EM-13). The identity is resolved and the refusal is recorded; it is a useful signal, and it is a refusal.

**Rule RF-24 — a revoked or suspended credential produces a refusal event, not a silent failure.** `RfidEvent`
outcome `CredentialRevoked` with the tag, reader, and timestamp. A card that stopped working with no explanation
generates support calls; a card that reports "revoked" does not.

---

## 7. Credential lifecycle

```
Unassigned ──issue──▶ Issued ──suspend──▶ Suspended ──restore──▶ Issued
                         │                                     │
                         ├──────────revoke────▶ Revoked ◀──────┘
                         │
                         └──────────supersede──▶ Superseded ──(new credential issued)
```

| State | Reads resolve? | Meaning |
|---|---|---|
| `Unassigned` | No | A tag in stock, no owner |
| `Issued` | Yes | Active credential |
| `Suspended` | No, with `CredentialSuspended` | Temporarily disabled — a reported lost card, a disciplinary hold |
| `Revoked` | **No** | Permanently invalid. The card is in someone's pocket |
| `Superseded` | No | Replaced by a new credential; retained for history |

**Rule RF-25.** `Revoked` is **terminal**. A revoked tag never resolves again, and re-issuing requires a new
credential bound to it, which is a new credential with its own history.

**Rule RF-26 — every transition is reasoned and audited** (BI-25): `Lost`, `Damaged`, `Replaced`,
`EmployeeTerminated`, `SecurityConcern`, `RoutineRenewal`. A card revoked with no reason cannot be distinguished
from a card revoked in an investigation.

**Rule RF-27 — an employee's termination revokes their credentials as a consequence, not as a manual step.** A
terminated employee's tag is `Revoked` with reason `EmployeeTerminated` in the same transaction as the
termination (EM-10). A terminated employee whose tag still works is a security incident, and the check must be
structural, not a process.

**Rule RF-28 — re-assignment requires a reason and writes both sides of the history.** The old employee retains the
record that they held the tag until date X; the new employee holds it from date Y. Neither has a hole.

---

## 8. RFID and inventory — the honest boundary

RFID readers are sold for stocktaking, and the temptation is to make them post counts.

**Rule RF-29 — a read identifies; it never changes stock.** A read in `Inventory` mode produces a candidate
list. Posting a variance is `Inventory.Count.Post`, with the count as the document, a reason per variance line,
and approval beyond tolerance (IV-28, IV-35). **This separation is the single most important rule in this
section.**

**Rule RF-30 — why, concretely.** A reader that posts on a read turns "an employee walked past a reader" into "an
employee adjusted stock". A count is a *document* whose expected quantity was frozen at creation (IV-26) and whose
postings are evidence behind every shrinkage figure (IV-30). A read is an observation with no expected value, no
reason, and no actor beyond whoever was holding the tag. **[P0: D-09 — the failure this whole separation prevents
is stock that changed with nothing explaining it.]**

**Rule RF-31.** Where a store wants a "scan to count" workflow, the model already supports it: the reader
populates the count line, the counter confirms and enters a reason for any variance, and the count posts as a
count. The efficiency comes from the counting, not from skipping the document.

**Rule RF-32.** For a batch-tracked variant, a read identifies the batch (BE-09) and a count variance charges the
soonest-expiring batch (BE-26). The read never allocates stock; the count posting does.

---

## 9. RFID offline

**Rule RF-33 — a reader works offline.** A read is recorded on the edge agent and queued like any other device
event. The reader is not a network dependency, because a reader that stops working when the WAN drops is a
reader that stops working.

**Rule RF-34 — an offline read resolves nothing, and that is honest.** No credential lookup, no employee
resolution, no session. A read offline produces an event with the tag identity and queues it; the identity
resolution happens on sync.

**Rule RF-35 — therefore a read-only mode is the offline behaviour of a clock reader.** Attendance punches are
recorded locally with the tag and resolved on sync. The alternative — accepting an offline read as an
authentication because the tag is "known" — is a cached-credential authentication system, and cached credentials
are a revocation problem. A tag that was revoked an hour ago still authenticates against the cache until the
cache expires.

**Rule RF-36 — resolution on sync is a compensating, reasoned update, not a live action.** An offline punch's
employee is resolved on sync and the event is linked. An offline read never becomes an approved operation, and a
queued read cannot retroactively authorise anything (BI-33).

**Rule RF-37 — an offline event for a tag with no credential is retained and reported as unresolved**, never
dropped (BI-31). An unknown tag read is a provisioning gap and the report is how it gets found.

**Rule RF-38 — event ordering across devices is by server receipt time, and every event keeps its observation
timestamp** (overview §3.3). An offline punch observed at 09:00 and synced at 14:00 sorts at 09:00 for reporting
and at 14:00 for arrival. Both facts matter and both are stored.

---

## 10. What RFID is not

The list of things an RFID system is regularly credited with that it must not do. Each has a Phase 0 precedent
behind it.

| Not allowed | Why | Rule |
|---|---|---|
| Authorising a business action from a read | Identity ≠ authorisation | RF-01, BI-33 |
| Storing permissions on tags or roles-as-JSON and not enforcing them | The surveyed system's `PermissionsJson` | RF-01 |
| Letting a tag read satisfy an approval | A two-person rule needs two deliberate people | RF-21, BI-26 |
| Posting stock from a read | A read has no expected value and no reason | RF-29, IV-28 |
| A loyalty tag as payment | A payment authorisation needs a different model | RF-08 |
| A customer tag as identity | A shared phone number is not a person | CU-30 |
| Cached offline credential authentication | Revocation stops working | RF-35 |
| Deleting a tag or its event history | The evidence is the point | RF-04, RF-14 |
| One event per antenna cycle | The report counts cycles, not people | RF-15 |
| Unauthenticated reader events | A rogue reader is an attack | RF-12, BI-35 |

---

## 11. RFID rules index

| ID | Rule |
|---|---|
| RF-01 | The flow is read → credential → employee → session → **permission check** → action |
| RF-02 | The RFID subsystem has no code path to a business operation |
| RF-03 | Zero-permission employee + valid tag still cannot act. A release gate |
| RF-04 | A tag is never deleted; it is archived with its history |
| RF-05 | A credential has its own lifecycle; revocation is not deletion |
| RF-06 | One tag binds to at most one employee, organization-unique |
| RF-07 | A tag's type is immutable once issued |
| RF-08 | A loyalty tag grants nothing; tap-to-pay is out of scope |
| RF-09 | A reader's mode determines what a read means |
| RF-10 | `Inventory` mode populates a list; posting is a separate permissioned operation |
| RF-11 | A door open is a request; the controller decides and SmartStore records the read |
| RF-12 | A reader must be registered and authenticated before its events are accepted |
| RF-13 | Device and server timestamps are both stored |
| RF-14 | `RfidEvent` is append-only and carries no authorisation consequence |
| RF-15 | One physical read is one event with a read count |
| RF-16 | A duplicate event is discarded and recorded as a duplicate |
| RF-17 | Anti-duplication is per tag, per reader, time-bounded (default 2 s) |
| RF-18 | The window never suppresses a different operation |
| RF-19 | De-duplication happens at the edge, not as a server post-filter |
| RF-20 | A read is an identity assertion; a session needs a credential factor per store setup |
| RF-21 | A tag never satisfies an approval |
| RF-22 | A tag session is short-lived and terminal-bound |
| RF-23 | No store access means no session, and the refusal is recorded |
| RF-24 | A revoked or suspended credential produces a named refusal event |
| RF-25 | `Revoked` is terminal |
| RF-26 | Every credential transition is reasoned and audited |
| RF-27 | Termination revokes credentials in the same transaction |
| RF-28 | Re-assignment writes both sides of the history with a reason |
| RF-29 | A read identifies; it never changes stock |
| RF-30 | A read has no expected value, no reason, and no accountable actor |
| RF-31 | "Scan to count" populates a count document; it does not bypass it |
| RF-32 | A count variance charges the soonest-expiring batch |
| RF-33 | A reader works offline; reads are queued |
| RF-34 | An offline read resolves nothing |
| RF-35 | Offline behaviour is read-only, not cached-credential authentication |
| RF-36 | Sync-time resolution is a compensating update, never a live authorisation |
| RF-37 | An event for an unknown tag is retained and reported |
| RF-38 | Events sort by server receipt; observation timestamps are preserved |
