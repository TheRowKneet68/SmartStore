# Owner Decisions

**Every question in this document is a decision for the SmartStore owner — a human — and nothing here decides it.
This document states the question, the options, the evidence, and the consequence each option carries. The
decision column is intentionally empty until the owner answers. Do not treat a "recommended option" as a
decision; it is a recommendation with reasons, recorded so the owner can decide from a complete picture.**

Related: [PRE-PHASE-3-GAP-REGISTER.md](PRE-PHASE-3-GAP-REGISTER.md) (each row has the full evidence trace),
[PHASE-2-ARCHITECTURE.md](PHASE-2-ARCHITECTURE.md) §28.3 (the ten gates).

Status legend: `OPEN` = awaiting owner; `DECIDED` = owner answered (record date + answer).

---

## D-01 — Who may hold the 13 undefined permission keys? (`GATE-PERMKEYS`)

**Status:** DECIDED — 2026-09-29

**Why a decision exists.** The product defines 298 transition rows' permissions, but 13 keys the transitions
require do not exist in the access-model catalogue (`actors-and-roles.md` §2). `SM-02d` forbids renaming them to
a near neighbour (`Product.Edit` is not `Product.View`). 29 transitions across 8 machines cannot be authorized
until someone says who may do the things they name.

**The 13 keys.** `Product.Edit`, `Purchase.Order.Submit`, `Purchase.Order.Approve`, `Purchase.Order.Send`,
`Customer.Edit`, `Employee.Create`, `Employee.Edit`, `Device.Register`, `Device.Edit`, `Device.Disable`,
`Shift.Close`, `Inventory.Count.Post`, `Inventory.Transfer.Receive`.

**What the owner decides, not the implementer.**
- Whether each key maps to an existing role template, a new template, or an existing template widened;
- Whether keys that gate irreversibility or money (`Employee.Terminate` requires `Employee.Edit` as its
  transition key; `Sale.Void.Posted.Approve` is a different-key-two-approver substance) stay division-of-duty
  split;
- Whether `Purchase.Order.Send` (the one key with **no** basis anywhere in the access model, and the strongest
  external consequence: the moment a commitment becomes real for a supplier) needs a brand-new template.

**Options.** (a) assign each key to the nearest existing template with a division-of-duty pairing;
(b) create one new template specifically for the write-side lifecycle edges;
(c) a new template per machine group. Each changes the actor resolution for 29 transitions.

**Consequence if not decided.** Those transitions refuse (the architecture's chosen fallback, §29.1). Features
that are lifecycle-dependent — activate, hide, suspend, post, receive, close, register, retire — are unusable.

**Answer (owner, 2026-09-29).** **Option (a): assign each key as-is via the existing wildcard template
grants.** No new role templates, no renamed permission keys, no change to the effective access model.
Appended owner requirements, which are binding:

1. The 13 keys resolve through the existing wildcard template grants exactly as they currently are
   (`Product.*`, `Purchase.*` except `.Pay`, `Customer.*`, `Employee.*` except `Terminate`, `Device.*`,
   `Shift.*`, `Inventory.*`). No new template is created for the write-side lifecycle edges.
2. `Purchase.Order.*` separation of duties is **explicitly enforced**, not assumed:
   - the requester must not approve their own Purchase Order (`SEP-07`);
   - `Purchase.Order.Send` must not bypass the approval workflow — a PO may only be sent from `Approved`;
   - `Purchase.Order.Approve` requires the documented approval-limit authority (the Accountant or Store
     Manager above the requester's limit per `PR-Q02`), not the Procurement Officer who created the PO;
   - all recorded approval-limit rules (`PR-Q02`, Store-Manager exclusion at `actors-and-roles.md` §4) are
     preserved.
3. `Purchase.Order.Send` is the recorded contentious case. The division-of-duty requirement is documented
   here explicitly rather than silently assuming the Procurement Officer may both create and send an approved
   PO: sending is the moment a commitment becomes real for a supplier and is bound by the same
   requester/decider discipline as approval.

**Premise correction (recorded per §27 as a CORRECTION, not as confirmation of the original claim).** The
original D-01 premise — "13 keys do not exist in the access-model catalogue" — **was refuted during the
Constitution Enforcement Test (2026-09-29)**. All 13 keys are present in `actors-and-roles.md` §2 as part of
the **117 atomic permissions** (the statement "88 keys" is a row count, not the key count; the 13 keys live in
slash-combined cells at lines 39, 59, 61, 72, 105, 126, 146, 152). What was actually open is that none of the
13 is assigned as a **standalone** permission in the §4 role-template section; each is reachable only through a
wildcard. This decision therefore confirms the wildcard-based effective access model, not the filling of a
catalogue gap.

---

## D-02 — When does a supplier payable exist? (`GATE-PAYABLE`)

**Status:** DECIDED — 2026-09-29

**Why a decision exists.** `SM-29` (state-machines.md §22.5) says the payable is created at
`ApprovedForPayment`. `procurement-domain.md §5` says an invoice creates a payable without naming a state. The
two readings produce different ledgers: an invoice matched on Monday and approved on Friday is a liability from
Monday (outstanding payable exists at `Matched`) or from Friday (only at `ApprovedForPayment`). Because supplier
balances are a projection of entries (`SU-09`), the difference is a real balance difference, not presentation.

**Also open:** the permission for the `→ ApprovedForPayment` edge is unnamed. The nearest existing key is
`Purchase.Invoice.Record`, which records the invoice — using it would let the person who typed the invoice also
approve it. **Not assumed.**

**Options.**
- A — payable at `Matched` (`Three-way match creates the liability`). Risk: a matched-but-disputed-otherwise
  invoice is already a liability; recovery is via write-off.
- B — payable at `ApprovedForPayment` (`liability at approval`). Consistent with `SM-29`; the effective
  existence of the payable is the approval gate. The matched invoice is a "pending payable", reported but not
  yet on the liability ledger.
- Either way `Scheduled → Paid` etc. are unchanged.

**Consequence if not decided.** The AP ledger, the outstanding-payable figure, and the `SupplierInvoice` schema
carry an `OPEN DECISION` cell that blocks Phase 2. This is the review's business-decision blocker #1.

**Answer (owner, 2026-09-29).** **Option B — the supplier payable is created when the Purchase Invoice reaches
`ApprovedForPayment`** (consistent with the verified rule `SM-29`). It is **not** created at `Matched`. A
`Matched` invoice before approval is a **pending payable / reporting state**, not a `SupplierLedgerEntry`
liability. Preserved, as binding:

- `Matched` does not create the payable.
- `ApprovedForPayment` creates the payable.
- `Paid` does not create the payable; it settles the existing payable.
- A disputed invoice before `ApprovedForPayment` does not create a payable (RT-110).
- Supplier balances remain projections of `SupplierLedgerEntry` entries (SU-09).
- Partial-payment behavior is unchanged (SM-31).

**Citation correction (recorded per §27 as a CORRECTION).** `PR-Q22` does **not** establish payable timing. Its
actual rule is that an invoice does not create stock (`procurement-domain.md:180`). Where documentation uses
`PR-Q22` as evidence for payable timing, the citation is corrected to the actual source supporting the
payable-creation statement / state-machine behavior (the `procurement-domain.md §5` payable statement and
`SM-29`), without changing the underlying requirement.

---

## D-03 — One store attribution or several for a central warehouse? (`GATE-Q1`)

**Status:** DECIDED — 2026-09-29

**Why a decision exists.** A central warehouse serving several stores can be modelled as (A) one physical
location with several store attributions, or (B) one location per store attribution. Every other part of the
architecture is written to hold either answer; this is the only schema-constraining question.

**Options.** A and B are described fully in PHASE-2-ARCHITECTURE.md §23.4. Reporting (§9) shows negative stock
and valuation per location; the answer determines whether a shared warehouse's stock appears once or per store.

**Consequence if not decided.** The stock schema (which location entity owns `StoreId`) is not final, and
GATE-Q1 blocks Phase 2 schema work with GATE-OFFLINE-INVENTORY.

**Answer (owner, 2026-09-29).** **Option A — explicit store attribution table.** Central-warehouse stock uses
an explicit attribution model. Preserved, as binding:

- Physical stock identity remains **Variant + `StorageLocation`** (MS-17).
- `StorageLocation` does **not** carry a single `StoreId` as the ownership model.
- Store attribution is an explicit **(`StorageLocation`, `Store`)** relationship, capable of representing
  **several** stores drawing from the same central-warehouse location.
- MS-16 is preserved: central-warehouse stock remains attributed to the store whose procurement/movement
  caused the stock to exist.
- MS-19 is preserved: `StockBatch` attribution remains tied to the receiving store, and reporting may
  reconcile stock by originating store.
- MS-15/MS-18 are preserved: the central warehouse itself is not a sellable store.

**Scope note.** EC-91 still means multi-store operation is **not active in v1**. This decision establishes the
domain/schema direction for future multi-store support; it does **not** enable multi-store operations now.

---

## D-04 — Server reservation or apply-and-reconcile for offline stock? (`GATE-OFFLINE-INVENTORY`)

**Status:** DECIDED — 2026-09-29

**Why a decision exists.** When two offline terminals sell the same last unit, either the server reserved it
ahead (impossible in principle offline — OF-02: the server was asked later), or both sales apply and the balance
goes negative and is reconciled (OF-38). The documentation is emphatic that offline means "the server was asked
later, never the terminal decided", and that offline operation requires `AllowNegative` (OF-03/SP-63). The
requirements already settle the *behaviour*: allow-and-reconcile, reservations only for explicit dated holds
(IV-46-49). What remains open is the *schema attribution* of the shortfall — which store/location bears a
negative balance — which is the same question as D-03.

**Options.** A and B per PHASE-2-ARCHITECTURE.md §11.4. Under A the server would need a reservation the terminal
cannot check; under B the negative balance is recorded and attributed by report (IV-17/IV-20).

**Consequence if not decided.** The offline sync schema and negative-stock attribution are not final. Note: the
*business behaviour* is already decided by the requirements; this gate is narrower than it appears.

**Answer (owner, 2026-09-29).** **Option B — Allow-and-reconcile.** Preserved, as binding:

- Offline terminals do **not** reserve stock implicitly (IV-49).
- Multiple offline sales may consume the same apparent last available stock (OF-38).
- Synchronization applies the recorded sales without a server-side reservation mechanism for offline checkout.
- Inventory may become negative where `AllowNegative` permits (OF-03, SP-63).
- The resulting shortfall/variance is recorded and reported (IV-17: written to ledger, never clamped; IV-20:
  reported per location).
- **No server-side reservation is introduced for offline checkout.** OF-38, IV-17, and IV-46..IV-49 are **not**
  rewritten to make the architecture easier.

**Also preserved:** D-03's Option A — central-warehouse attribution uses the explicit `(StorageLocation, Store)`
attribution model, so a synced offline movement's store attribution resolves through that model.

---

## D-05 — Is a store-credit balance repayable by a due date? (`GATE-Q4-DUNNING`)

**Status:** DECIDED — 2026-09-29

**Why a decision exists.** `EC-65` says "when a credit sale's due date passes" a customer's standing moves per
the dunning policy — but (a) no rule gives a customer balance a due date, and (b) no rule defines the dunning
policy. `CON-06` explicitly records "no due date in v1"; `NT-37`'s example names `CreditOverdue` as deliberately
absent because no rule gives a balance a due date.

**Options.**
- No — the current recorded standing. Consequence: `EC-65` must be rewritten to drop the dunning dependency
  (it is a MISSING DEPENDENCY otherwise), and no AR aging exists in v1. Additive-only, smallest change.
- Yes — a customer credit balance becomes repayable by a date. Consequence: customer-domain (due date on the
  ledger or the account), notification-domain (a `CreditOverdue` event, added to the closed `NT-03` vocabulary by
  the AU-13 process), state-machines (dunning states), reporting (AR aging), and a dunning policy must all be
  specified. This is a real feature, not a setting.

**Consequence if not decided.** `EC-65` stays a MISSING DEPENDENCY and AR aging remains absent. This is a Phase 2
item only if answered "yes" (per PHASE-1-REVIEW line 149); the default standing in the docs is "no".

**Answer (owner, 2026-09-29).** **No — a store-credit balance is NOT repayable by a due date in v1.**
Not an invented behavior; the recorded Phase-1 evidence is preserved as binding:

- `CON-06`: customer credit balances have **no due date in v1**.
- `NT-37`: `CreditOverdue` is **deliberately absent** because no rule gives a customer balance a due date.
- `EC-65` is the **inconsistent** rule — it refers to a credit-sale due date and an undefined dunning policy.

**Preserved, unchanged:** no credit due dates added; no AR aging for customer credit in v1; no
`CreditOverdue` notification/event; no invented dunning policy. `EC-65` is corrected below so it no longer
depends on the undefined due-date/dunning mechanism. The credit-limit requirements `CU-12..CU-23` are untouched;
no unrelated customer-credit requirement is silently changed.

---

## D-06 — What event types cover the `OPEN DECISION` audit cells? (`GATE-AUDITTYPES`)

**Status:** DECIDED

**Why a decision exists.** The transition contract (§22) carries `OPEN DECISION` in the Audit column for many
lifecycle, cancel, and close edges. Five audit vocabulary gaps were already found and closed (`AU-12b`). The
remaining question is which event types cover the still-open cells. The closed-vocabulary rule (`AU-11`) means
each new type is a reviewed schema change.

**Options.** A small, deliberate set per machine (e.g. a lifecycle edge logs `Approval.Decided` where a decision
happened, and a per-machine event otherwise) vs. one generic per-machine event vs. a single `Document.Lifecycle`
event. The vocabulary must stay closed and versioned.

**Consequence if not decided.** Audit schema migration cannot be finalized; the standing audit reports (AU-27)
may not answer "what changed and when" for lifecycle edges.

**Answer (owner, 2026-09-29). Option (a) — a small, deliberate set per machine, applied per cell.** Each
previously `OPEN DECISION` Audit cell resolves to exactly one of: an existing type, a new justified type, `—`
(no audit event; the rule text says why), or stays explicitly `OPEN DECISION`. **Twenty new types**, each named
by an existing rule for a genuine semantic action (never one type per transition, never a `Document.Lifecycle`
catch-all):

| Event type | The edges it records | Required by |
|---|---|---|
| `Product.StateChange` | activate, discontinue, reactivate, hide, unhide | PR-46, PR-47 (reasons); SM-12 |
| `Inventory.BatchStateChange` | quarantine, withhold | BE-37/38, BI-25 |
| `Purchase.OrderStateChange` | send to supplier, cancel ×3, close-short ×2, close | PR-Q06a, PR-Q08/09, SM-22 |
| `Purchase.ReceiptStateChange` | GRN cancel | SM-25/26, PR-Q06a |
| `Purchase.InvoiceStateChange` | match, dispute, resolve, schedule, fail, reject, cancel | PR-Q25, SM-30 |
| `Purchase.PayableCreated` | approve (`Matched` → `ApprovedForPayment`) | SM-29 (payable effective here, D-02) |
| `Purchase.PayableSettled` | pay | SM-31, PR-Q34 |
| `Sale.Completed` | sale-document completion | SP-02, AU-03 |
| `Return.StateChange` | cancel, settle, close | RR-14/17, SM-42 |
| `Refund.StateChange` | cancel (hold released) | SM-40, RR-24 |
| `Customer.StateChange` | hold, block credit, close | SM-45, CU-09/10 |
| `Employee.StateChange` | create, leave, archive | SM-48a, EM-08/09, BI-40 |
| `Payment.StateChange` | submit, authorize, void, decline, fail | AU-03, PY-13/54 |
| `Shift.StateChange` | begin count | SM-55, CD-21 |
| `Shift.Reopened` | reopen a closed shift | CD-26, SM-56, AU-27 |
| `Device.ModeChange` | set training / maintenance / standard | PT-03; changing mode is audited (SM-59) |
| `Device.StateChange` | register, activate, disable, retire | SM-60b (disable is audited), HD-08; degrade/offline stay `—` (SM-61 telemetry) |
| `Inventory.CountStateChange` | count cancel | IV-25/26/28 |
| `Inventory.TransferStateChange` | close, cancel | SM-78, IV-39/41 |
| `Rfid.Credential.StateChange` | register, issue, suspend, revoke, supersede | RF-26 |

**Exceptions, equally explicit.** StockAdjustment `Draft` → `Cancelled` **reuses** `Inventory.Adjustment` — a
cancelled manual adjustment is still a manual-adjustment action under the AU-03 floor (IV-33 reason). **No event
(`—`):** Device `Degraded`/`Offline` (health telemetry, SM-61), ReadEvent session close (AU-14 — reads and
operational events are not audited), Notification read/acknowledge (AU-14; NT-28/29 — no money, no permission).
**Stays `OPEN DECISION`:** OfflineQueue `DeadLetter` only — whether the server ever observes that status is D-07,
and its audit type (if any) follows that decision.

**Applied.** `audit-domain.md` AU-12/AU-12b; `state-machines.md` §22 cells; `GATE-AUDITTYPES` closed. The §22.1
"only archive is audited" product note and the device telemetry statement are updated in the same pass so the
document says what it now means.

---

## D-07 — Does the server ever observe a dead-letter status? (`GATE-DEADLETTER`)

**Status:** DECIDED

**Why a decision exists.** `OF-29` says every synced transaction ends in exactly one of three server outcomes —
`Applied`, `AppliedWithAdjustment`, `Rejected` — and there is no fourth. `SM-64a` reconciles the earlier
four-outcome queue as: the three are server outcomes, `DeadLetter` is a **client-side** retention state. Whether
the server ever *sees* a `DeadLetter` status is not stated in any v1 requirement.

**Options.** (a) `DeadLetter` stays client-only — the server always sees one of the three; (b) the server may
carry a `DeadLetter` marker for terminated queue items. Option (b) contradicts `OF-29`'s "no fourth" unless
restated.

**Consequence if not decided.** The sync status model and the `OfflineQueue` schema are not final.

**Answer (owner, 2026-09-29). Option (a) — `DeadLetter` remains client-only.**

- The server **MUST NOT** treat `DeadLetter` as a fourth server outcome in v1.
- The server-side synchronization result vocabulary remains exactly `Applied`, `AppliedWithAdjustment`, `Rejected`.
- `DeadLetter` remains a client-side `OfflineQueue` retention state.
- No server-side `DeadLetter` status is added for operational convenience.
- `OF-29` is not modified to manufacture support for a fourth outcome.
- The transition to client-side `DeadLetter` does not require a server-side business audit event.

**Audit consequence (resolves the D-06 leftover).** The `any → DeadLetter` §22 edge records **no audit event**
(`—`): it is client-side retention, not a server business event. The last `OPEN DECISION` audit cell is now
closed; the audit vocabulary is complete against `OF-29`/`SM-64a`.

**Unchanged.** All other offline-sync requirements (`OF-31`, `OF-35`, `OF-36`, `SM-64`, `SM-65`, `SM-66`, `SM-67`)
are untouched by this decision.

---

## D-08 — `Notification` state set ownership (`GATE-NOTIFICATION-STATES`)

**Status:** DECIDED

**Why a decision exists.** `notification-domain.md` defines the inbox, the read-vs-acknowledged distinction, and
expiry, but enumerates no states. `state-machines.md` §22.16 names `Unread`/`Read`/`Acknowledged` as its own,
consistent with `NT-28`. `NT-30` says expiry is retention, not a state.

**Options.** (a) Confirm `Unread`/`Read`/`Acknowledged` as the owner set, expiry outside the machine; (b) name a
different set in notification-domain. Low impact, small schema.

**Answer (owner, 2026-09-29). Option (a) — the owner set is exactly `Unread`, `Read`, `Acknowledged`.** Supported
by the existing Phase-1 requirements and the state-machine specification; no notification behavior is invented
or altered.

- `notification-domain.md` now explicitly enumerates the three states as its own (§7).
- Creation enters `Unread`.
- `Unread` → `Read` is the recipient reading it; **reading is not acknowledging** (`NT-28`).
- `Unread` → `Acknowledged` and `Read` → `Acknowledged` are acknowledgement; they were never a sequence
  (`NT-28`, `SM-72`, `RT-324`).
- **Acknowledgement does not execute the notification's underlying action** (`NT-29`, `SM-73`).
- **Expiry stays outside the state machine** as retention, not a state (`NT-30`, `SM-74`); **no `Expired` state is
  added**.
- `Read` is neither collapsed into `Acknowledged` nor reduced to a mere flag.

---

## D-09 — `StockCount` state set ownership (`GATE-STOCKCOUNT-STATES`)

**Status:** DECIDED

**Why a decision exists.** `inventory-domain.md` defines a count sheet's behaviour completely (IV-25..31) — frozen
snapshot at creation, counts not negative, immutability after posting — but names no state set.
`state-machines.md` §22.17 uses `Open`/`Posted`/`Cancelled`/`Reversed` as its own vocabulary.

**Options.** (a) Confirm those names in inventory-domain; (b) rename. The behaviour is fully specified; only the
vocabulary is unowned. Low impact.

**Answer (owner, 2026-09-29). Option (a) — the owner set is exactly `Open`, `Posted`, `Cancelled`, `Reversed`.**
Based only on the verified existing requirements (IV-25..31; `SM-81..83`; RT-071/72/73); no redesign.

- `inventory-domain.md` §8.3 now enumerates the four states as its own.
- `Open` is the working/in-progress state; `Open` → `Posted` is posting.
- `Open` → `Cancelled` is cancellation before posting.
- **`Posted` → `Reversed`** is the compensating-document reversal; **`Posted` is immutable as a document** — the
  reversal creates the compensating movement, never an edit (IV-30, SM-82).
- **No separate `Approval` state.** IV-28's "permission + approval" is an **authorization/precondition of
  posting**, not a persisted state.
- `Cancelled` is not folded into another status; no state is added beyond the four.

---

## D-10 — Under what licence is SmartStore distributed? (`GATE-Q2-LICENCE`)

**Status:** DECIDED

**Why a decision exists.** `GR-04` records that licence compatibility is not traceable because the SmartStore
licence is unresolved. The phase-0 repository licence matrix is evidence, not a decision.

**Options.** (a) internal/proprietary; (b) open-sourced, permissive; (c) open-sourced, copyleft (AGPL); (d) sold /
commercial. This blocks **release**, not engineering. If the answer is "sold / commercial", any OSS dependency terms
must be checked against it before anything is distributed. This is a legal question — the owner should take advice.
No legal assertion is made here.

**Answer (owner, 2026-09-29). Option (d) — SmartStore is a product sold commercially.** The **use** is decided;
the licence itself is not named in this record.

- **No specific legal licence and no legal conclusion is asserted here.** Naming the licence, and clearing it, is
  the owner's and counsel's to do.
- **Licence compatibility and third-party dependency review remain a pre-release requirement.** Before any
  distribution, every selected dependency's terms must be checked against the SmartStore licence and recorded.
- This does **not** change the Phase 0 clean-build position: nothing was copied, so the reference projects'
  licences still do not infect SmartStore (`PHASE-2-ARCHITECTURE` §26.4).
- **Blocks release, not engineering** — engineering and Phase 3 preparation are unaffected.

---

## D-11 — Loyalty accrual basis (`CU-25`)

**Status:** DECIDED

**Why a decision exists.** `CU-25` (`RR-41`) makes the accrual basis a configured value with three options — gross
line total, net of discount, or net of tax — and records the value as an open business decision. The **mechanism** is
fully specified; only the value was undecided, and changing the value needs no schema change. Config value, low
impact.

**Options.** (a) net item subtotal after discount, excluding tax; (b) gross line total; (c) net of tax.

**Answer (owner, 2026-09-29). Option (a) — the accrual basis is net of discount, excluding tax.** This is the
documented v1 recommended default in `CU-25` and `RR-41`; the owner adopts it.

- **The value is a store/org configuration item** (`configuration-model.md` §2), snapshotted per the governing rule in
  that document; it does not change when a store changes its own setting.
- **Mechanism unchanged.** `CU-25`/`RR-41` still support all three bases as configured values; only the v1 default
  value is now fixed. No new loyalty behavior is introduced, and `RP-08`'s closed basis vocabulary
  (`Gross`/`NetOfDiscount`/`NetOfTax`/`NetOfAll`) is unchanged — reports still state the basis (`RT-170`).
- The rationale recorded in `CU-25` stands: accruing on tax would mean earning points for tax the retailer does not
  keep.
- Blocks nothing. Not a Phase 3 blocker; not a schema change.

---

## D-12 — Product configuration vs legal/tax compliance (Nepal, NPR)

**Status:** OPEN

**Decision:** which taxes, rates, rounding mode, and receipt content are (a) product configuration (decidable
from the docs — the mechanism is specified in SP-33..38, PR-38..41) and (b) legal-compliance facts a
jurisdiction imposes (require owner + legal input). Deciding the *configuration layer* is a Phase 2 deliverable;
deciding the *legal facts* is not something documentation can resolve. Whether Nepal/NPR taxes apply to a sale,
at what rate, and a shop's printed receipt obligations are legal facts, not specification choices. No legal
assertion is made here.

---

## D-13 — Backup RPO/RTO and restore window

**Status:** OPEN

**Decision:** how much data loss is acceptable (RPO) and how long restore may take (RTO). The rules name the
requirement (backup and recovery) and the permissions (`Config.Backup`/`Backup.Restore`, the latter the most
dangerous permission in the product). The *numbers* are a business choice, not a documentation conclusion. The
offline queue is included in backup and local integrity (OF-45).

---

## D-14 â€” `Payment` `Failed` is terminal; a retry is a new `Payment` (CON-03)

**Status:** DECIDED (2026-09-30)

**Decision:** `CON-03` is resolved **in favour of `PY-54`**. A customer `Payment` in `Failed` is **terminal for
that record**; a retry is a **new `Payment` against the same sale**. `Declined` remains retryable by a new attempt
(PY-14). `SM-30` (supplier invoice `Failed`) and `SM-41` (refund `Failed`) are **unchanged** â€” this decision is
scoped to the customer `Payment` machine only.

Applied: `SM-53` and `RT-420` reworded to "retryable by writing a new `Payment`; the `Failed` record itself is
terminal", keeping every existing citation (`SM-53, PY-14, PY-54`). This makes the state graph single-reading:
no edge out of `Failed`, and every retry is a new row. `PY-54`, the payment state table, the edge table, the
machine table and `BI-25` already stated this and were **not** changed â€” `SM-53` was the sole contradiction.

---

## Decision log

| ID | Question | Answer | Date |
|---|---|---|---|
| D-01 | 13 permission keys | (a) as-is via wildcard templates + explicit PO separation of duties (SEP-07, PR-Q02). Premise corrected: keys were present in §2 (117 atomic permissions), not assigned as standalone | 2026-09-29 |
| D-02 | Payable timing | (b) payable at `ApprovedForPayment` (SM-29); Matched is a pending-payable/reporting state, not a liability. Citation corrected: PR-Q22 is stock-not-payable, not payable timing | 2026-09-29 |
| D-03 | Warehouse attribution | (a) explicit `(StorageLocation, Store)` attribution table; physical stock stays Variant+Location (MS-17); no single `StoreId` on the location. Direction for future multi-store, not active in v1 (EC-91) | 2026-09-29 |
| D-04 | Offline stock | (b) allow-and-reconcile (OF-38); no implicit reservation at the till (IV-49); shortfall written to ledger and reported per location (IV-17, IV-20); no server-side reservation for offline checkout; behaviour requirements unrewritten | 2026-09-29 |
| D-05 | Credit due date | (a) no due date in v1: no `CreditOverdue` event, no AR aging, no dunning policy; `EC-65` corrected to drop the due-date/dunning dependency (CON-06, NT-37 preserved) | 2026-09-29 |
| D-06 | Audit types | (a) small deliberate per-machine set — 20 new types, mapped per cell; `Inventory.Adjustment` reused for adjustment-cancel; `Degraded`/`Offline`/reads/session-close are `—` (telemetry/AU-14); `DeadLetter` stays `OPEN DECISION` pinned to D-07 | 2026-09-29 |
| D-07 | Dead-letter visibility | (a) `DeadLetter` stays client-only: server outcome vocabulary remains exactly `Applied`/`AppliedWithAdjustment`/`Rejected` (`OF-29`, `SM-64a`); no server-side `DeadLetter` status; `OF-29` unchanged; the §22 `any → DeadLetter` edge records `—` (client-side retention, not a server business event) — closes the last `OPEN DECISION` audit cell | 2026-09-29 |
| D-08 | Notification states | (a) the owner set is exactly `Unread`/`Read`/`Acknowledged`; creation enters `Unread`; `Read` and `Acknowledged` independent (`NT-28`, `SM-72`, `RT-324`); ack never executes the action (`NT-29`, `SM-73`); expiry is retention, no `Expired` state (`NT-30`, `SM-74`); reads/acks unaudited (AU-14). `notification-domain.md` §7 now enumerates the states (owner) | 2026-09-29 |
| D-09 | StockCount states | (a) the owner set is exactly `Open`/`Posted`/`Cancelled`/`Reversed`; creation works `Open`; `Open`→`Posted` posts; `Open`→`Cancelled` abandons before posting; `Posted`→`Reversed` is the compensating-document reversal, `Posted` immutable (IV-30, SM-82); **no `Approval` state** — IV-28's approval is an authorization/precondition of posting; `Cancelled` not folded; no extra states. `inventory-domain.md` §8.3 now enumerates them (owner) | 2026-09-29 |
| D-10 | Licence | (d) **sold / commercial** — a product sold commercially. No specific licence is named and no legal conclusion is asserted; naming and clearing the licence is owner+counsel's. **Licence compatibility and third-party dependency review remain a pre-release requirement** (every selected dependency's terms checked against the SmartStore licence and recorded before distribution). Phase 0 clean-build position unchanged. Blocks **release, not engineering** | 2026-09-29 |
| D-11 | Loyalty accrual | (a) **net of discount, excluding tax** (net item subtotal after discount) — the documented v1 default in `CU-25`/`RR-41`, adopted by the owner. Value only: a store/org configuration item (configuration-model.md §2); `CU-25`/`RR-41` still support all three bases as configured values, `RP-08` basis vocabulary and `RT-170` (basis stated on every report) unchanged; no new loyalty behavior; no schema change | 2026-09-29 |
| D-12 | Tax config vs legal | | |
| D-13 | RPO/RTO | | |
| D-14 | `Payment` `Failed` terminal (CON-03) | (PY-54) A customer `Payment` in `Failed` is terminal for that record; a retry is a new `Payment` against the same sale. `Declined` still retryable (PY-14). `SM-30` and `SM-41` unchanged. `SM-53` and `RT-420` reworded, all citations kept. Closes the last Phase 3 blocker | 2026-09-30 |
