# Constitution + Phase 2 Readiness — Final Audit

**The independent governance and readiness audit of the SmartStore documentation set, performed against
[SMARTSTORE-CONSTITUTION.md](../../SMARTSTORE-CONSTITUTION.md) and the approved Phase 0–2 documents.**

Status: **AUDIT COMPLETE.** Final Phase 3 readiness verdict at §12.

Scope boundary honoured: no Phase 3 work was performed. No schema, migration, application code, or framework
selection was created. The constitution was **not changed** to remove any finding below; contradictions are
documented, not edited away.

> ### Status of this document after the final closure pass (2026-09-29)
>
> **§1–§11 are the historical record of the Phase 2 boundary audit and are deliberately left as written.** Several
> of their claims have since been overtaken by the owner's decisions, and one has been refuted by measurement. They
> are not rewritten, because the record of what the audit found and believed is itself evidence. Where a claim is
> now wrong, the correction is carried in the documents that asserted it and summarised in §12.
>
> Specifically: the "13 undefined permission keys" claim was **refuted** (all 13 exist; D-01); the "ten gates open"
> and "D-01..D-05 options listed" positions are **superseded** (D-01..D-11 are decided); the "342-rule backlog"
> claim is **confirmed and quantified** (73 of the 342 point at OUT OF SCOPE rows, GAP-035); and the session
> revocation finding is **narrowed** (EC-45 already revokes on role removal; the real gap is termination,
> GAP-040). The current verdict is §12; the current decision record is `OWNER-DECISIONS.md`; the current gap
> position is `PRE-PHASE-3-GAP-REGISTER.md`.

---

## 1. Audit scope

Verified sources:

- `SMARTSTORE-CONSTITUTION.md` (the constitution, all 34 sections)
- `docs/architecture/`: `PRE-PHASE-3-GAP-REGISTER.md` (GAP-001..GAP-034), `OWNER-DECISIONS.md` (D-01..D-13),
  `PHASE-3-ENTRY-CRITERIA.md` (C-01..C-13), `PHASE-2-REVIEW.md`, `PHASE-2-ARCHITECTURE.md`
- `docs/domain/`: `business-invariants.md` (BI-01..BI-43)
- `docs/product/`: all 27 domain/spec documents, `state-machines.md` (§22 contract), `requirements-traceability.md`
  (§26), `PHASE-1-REVIEW.md`
- `docs/repository-analysis/`: Phase 0 documents (esp. `foundation-recommendation.md`, `license-matrix.md`,
  `security-verification.md`)
- The spec docs produced by the pre-Phase-3 closure pass: `tax-and-currency.md`, `configuration-model.md`,
  `backup-and-recovery.md`, `data-import.md`, `retention-and-deletion.md`, `TEST-STRATEGY.md`,
  `HARDWARE-REQUIREMENTS.md`

Every claim below is either re-measured against the primary source or carries an explicit `UNVERIFIED` marker.
No inference from conversation history was used where an authoritative document exists.

---

## 2. Constitution consistency

The constitution was checked clause by clause against the Phase 0/1/2 documents. **No contradiction was found.**
The specific checks requested:

| Check | Finding | Evidence |
|---|---|---|
| Source-of-truth hierarchy | **Consistent.** Matches the actual document architecture: constitution → owner decisions → phase specs → invariants → architecture (ADRs) → traceability → analysis → reconnaissance. AI suggestions are excluded from authority, matching the register's rule that no gap is `RESOLVED` without a source line | CONSTITUTION §2; register §1; PHASE-2-ARCHITECTURE §30 |
| Owner decisions | **Consistent.** Constitution §7 forbids silent owner decisions and points to `OWNER-DECISIONS.md`; the register and OWNER-DECISIONS keep all 13 decisions OPEN, exactly as the constitution requires | CONSTITUTION §7; OWNER-DECISIONS D-01..D-13; register §4 |
| Business invariants | **Consistent.** Constitution §9's example list (no over-return, no over-refund, no duplicate application, idempotent sync, deterministic totals) maps 1:1 to `BI-06/10`, `BI-07/28/29`, `BI-11`. Constitution does not invent invariants; it defers to "the actual approved invariant documents remain authoritative" — matching `business-invariants.md` §1 | CONSTITUTION §9; BI-06, BI-07, BI-10, BI-11, BI-28, BI-29 |
| State machines | **Consistent.** Constitution §13 requires source/destination/actor/permission/preconditions/side effects/audit/reversal, or `OPEN DECISION` — identical to `SM-02a`/`SM-02b`/`SM-02c` | CONSTITUTION §13; SM-02a..02d |
| Authorization | **Consistent.** §10 (default-deny, exact matching, server-side enforcement, RFID ≠ authorization, session lifecycle) matches `BI-21`, `BI-22`, `BI-14`, `BI-33`, `PC-04` | CONSTITUTION §10; BI-21, BI-22, BI-33 |
| Inventory | **Consistent.** §11 and §14 (movement-only stock change, projection-not-input, no silence deletion) match `BI-02`, `BI-03`, `BI-12`, `BI-15` | CONSTITUTION §11, §14; BI-02, BI-12, BI-15 |
| Financial correctness | **Consistent.** §14's "no unsafe float, no discarding financial history" match `BI-01`, `BI-08`, `BI-15a` (the three-immutability split is respected) | CONSTITUTION §14; BI-01, BI-08, BI-15a |
| Offline POS | **Consistent.** §17 (server-authoritative, idempotent, conflict ownership explicit or STOP) matches `BI-28..31`, `OF-29` | CONSTITUTION §17; BI-28..31 |
| Auditability | **Consistent.** §12 (audit ≠ logging, server-side enforcement, not frontend-dependent) matches `AU-02/03`, `BI-23`, `BI-24` | CONSTITUTION §12; AU-02, BI-23, BI-24 |
| Hardware abstraction | **Consistent.** §18 (no manufacturer/business-logic leakage) matches `BI-34`, `HD-02`, `RT-211` | CONSTITUTION §18; BI-34 |
| Testing | **Consistent.** §19 (`Specified → Implemented → Tested → Verified`, never fabricated results) matches `GR-02/03` and the release gates `IV-09`/`PY-12` | CONSTITUTION §19; IV-09, PY-12 |
| Phase discipline | **Consistent.** §6 and the "STOP on contradiction" rule match `PHASE-1-REVIEW` §8 and the blockage rule in `PHASE-3-ENTRY-CRITERIA.md` C-13 | CONSTITUTION §6; entry criteria §1 |
| Scope | **Consistent.** §23 (no unapproved ERP/payroll/manufacturing) matches the v1 out-of-scope list in `product-overview.md` §6 (`PY-49..53`, `AU-33..35`, `NT-32..36`) | CONSTITUTION §23; overview §6 |
| Build-clean / old repositories | **Consistent.** §24 ("built clean"; old repos are reference, not templates) matches Phase 0 Option C in `foundation-recommendation.md` and `repository-analysis/README.md:49` | CONSTITUTION §24; foundation-recommendation |
| Constitution examples (`PR-47`, `IV-46`, `SM-02d`, `D-04`, `GATE-OFFLINE-INVENTORY`) | All five identifiers exist in the documents they cite | PRODUCT: PR-47; inventory: IV-46; SM-02d; OWNER-DECISIONS D-04, GATE-OFFLINE-INVENTORY |

**One nuance, not a contradiction:** the constitution can be read by a first-time reader as implying "no phase
can start while the previous phase is perfect". The actual governing position — stated in `PHASE-2-REVIEW.md` §4
and echoed in the constitution §6 — is that a phase is *ready with documented, blocker-ranked open decisions*,
and only *structural blockers* hold the next phase. This is consistent, but a reader should carry the entry
criteria alongside the constitution. Recorded here so the nuance is explicit.

**Constitution change needed? No.** No finding in this audit required the constitution to change.

---

## 3. Phase 3 blockers

Classification of every item in `PRE-PHASE-3-GAP-REGISTER.md` (GAP-001..GAP-034), and of the newly discovered
gaps (§10). "Blocker" here means *Phase 3 may not produce the final schema without it*, per the blocker rule in
`PHASE-3-ENTRY-CRITERIA.md` §1.

### 3.1 True Phase 3 blockers (BLOCKER)

| Item | Classification | Reason |
|---|---|---|
| GAP-002 — the 13 permission keys (`GATE-PERMKEYS`) | **BLOCKER** | 29 transitions across 8 machines cannot be authorised; `SM-02d` forbids renaming. Schema itself is not blocked, but the actor resolution for those transitions is. Structural precondition (entry criteria C-01) |
| GAP-001 — payable timing (`GATE-PAYABLE`) | **BLOCKER** | The `SupplierInvoice`/AP-ledger schema differs under the two readings (`SM-29` vs `procurement-domain §5`); liability posting date is a schema shape, not a setting. C-02 |
| GAP-011 — the 342-rule traceability backlog | **BLOCKER** | Phase 2's first work item, carried into Phase 3. The requirement-rule mapping is proposed, not reviewed; a schema derived from an unreviewed mapping is built on an unverified map. C-06 |
| GAP-003/004 — warehouse attribution + offline shortfall attribution (`GATE-Q1`, `GATE-OFFLINE-INVENTORY`) | **BLOCKER** (schema) | These are the same Stock-location-shape question; `StoreId` cardinality must be fixed before the stock schema. C-03, C-04. Behaviour is already decided; only the schema attribution stands |
| GAP-005 — credit due date (Q4) | **BLOCKER only if answered "yes"** | If "no" (the docs' recorded standing), `EC-65` is rewritten and there is no AR schema. If "yes", the customer/notification/state/reporting schema all change. C-05 |

### 3.2 Non-blocking but schema-relevant (OPEN DECISION / OPEN SPECIFICATION)

| Item | Classification | Reason |
|---|---|---|
| GAP-010/021 — audit event types (`GATE-AUDITTYPES`) | **DECIDED (D-06): closed** | The five missing types were RESOLVED (`AU-12b`); D-06 then closed the per-transition Audit cells (20 types added, cells mapped, the one remaining `OPEN DECISION` — `DeadLetter` — is D-07's). The audit **store** schema is buildable from the closed vocabulary. C-07 |
| GAP-029/033 — dead-letter visibility (`GATE-DEADLETTER`) | **DECIDED (D-07)** | Client-only `DeadLetter`; server vocabulary stays `Applied`/`AppliedWithAdjustment`/`Rejected` (`OF-29`). C-08 |
| GAP-027/028 — Notification/StockCount state sets | **BOTH DECIDED (D-08, D-09)** | Vocabulary only; behaviour fully specified. C-09 |
| GAP-014 — backup/recovery, GAP-025 — configuration, GAP-023 — security checklist, GAP-024 — observability, GAP-017 — testing | **OPEN SPECIFICATION** (consolidation docs) | All five now exist (`backup-and-recovery.md`, `configuration-model.md`, `TEST-STRATEGY.md`; security checklist consolidated in PHASE-2-ARCHITECTURE §28). RPO/RTO values remain OPEN SPECIFICATION in one doc (D-13) |
| GAP-013 — tax jurisdiction + rounding mode | **OPEN SPECIFICATION** (mechanism RESOLVED) | Mechanism complete (`SP-33..38`, `PR-38..41`); the legal facts for Nepal/NPR are owner+legal input (D-12), not documentation |

### 3.3 RESOLVED in the closure pass (non-issues for the audit)

GAP-006 (credit limits — RESOLVED, one wording note), GAP-008 (statements), GAP-009 (loyalty — mechanism
RESOLVED, **basis decided D-11: net of discount, excluding tax** — a config value), GAP-015 (import), GAP-018 (concurrency), GAP-019 (payments), GAP-020
(offline sync), GAP-022 (licence — **decided D-10: sold/commercial**; blocks release, not engineering), GAP-026 (retention), GAP-030 (scope),
GAP-031 (`Sales.*` sweep — NON-BLOCKING), GAP-032 (27 domain files), GAP-034 (offline card).

---

## 4. Owner decisions still required

From `OWNER-DECISIONS.md` (D-01..D-13) — reproduced, **not decided**. No new option was added unless the
existing evidence required it (D-01's three-part question is already in the source; it is not new).

| ID | Question | Why it matters | What Phase 3 depends on it | Consequence of each option |
|---|---|---|---|---|
| D-01 | Who may hold the 13 undefined permission keys? (`GATE-PERMKEYS`) | 29 transitions across 8 machines cannot be authorised; `Product.Edit ≠ Product.View` (`SM-02d`) | The actor resolution for lifecycle/write edges: activate/hide/suspend/post/receive/close/register/retire; which role templates enter the catalogue | (a) nearest-template + separation — minimal but pairs Day-Job with Approve oddly for `Purchase.Order.Send`; (b) one new write-lifecycle template — cleaner division of duty; (c) per-machine templates — most expressive, most catalogue growth. Each changes who can run 29 transitions |
| D-02 | When does a supplier payable exist? (`GATE-PAYABLE`) | Two readings put the same invoice on the AP ledger on different dates (`SM-29` vs `procurement-domain §5`); a real balance difference under `SU-09` | The `SupplierInvoice`/AP-ledger schema and the outstanding-payable column | A — payable at `Matched` (liability on match; disputed-otherwise still a liability); B — payable at `ApprovedForPayment` (matches `SM-29`; matched invoice is a "pending payable", reported not on-ledger) |
| D-03 | One or several store attributions for a central-warehouse location? (`GATE-Q1`) | The Stock-location `StoreId` cardinality; the only schema-constraining question | The `StorageLocation / StockBalance` schema shape | A — several attributions per location; B — one location per attribution. Reporting (§9) shows per-location negative stock either way |
| D-04 | Server reservation or apply-and-reconcile for offline stock? (`GATE-OFFLINE-INVENTORY`) | How an offline shortfall is attributed | The reservation model and negative-stock attribution on sync | **DECIDED — 2026-09-29: (b) allow-and-reconcile.** Behaviour already decided by the requirements (`OF-38`, `IV-49`); shortfall written to ledger and reported per location (`IV-17`, `IV-20`); no server-side reservation for offline checkout |
| D-05 | Is store credit repayable by a due date? (Q4) | `EC-65` references a dunning policy no rule defines; every other document records "no due date in v1" | If no: `EC-65` rewrite only. If yes: due-date element, `CreditOverdue` event (AU-13 process), dunning states, AR aging — a real feature | **DECIDED — 2026-09-29: (a) no due date in v1.** No AR aging, no `CreditOverdue`, no dunning policy; `EC-65` corrected to drop the due-date/dunning dependency (CON-06, NT-37 preserved; CU-12..CU-23 unchanged) |
| D-06 | Which event types cover the `OPEN DECISION` audit cells? (`GATE-AUDITTYPES`) | The audit `EventType` set must be closed and versioned (`AU-11`) before the audit store | The audit schema (per-transition `EventType`) | **DECIDED — 2026-09-29: (a) small deliberate per-machine set.** Twenty types added; cells mapped to existing/new/`—`; the one cell left `OPEN DECISION` (`DeadLetter`) is D-07's |
| D-07 | Does the server ever observe a `DeadLetter` status? (`GATE-DEADLETTER`) | `OF-29` says exactly three server outcomes; a fourth contradicts it unless restated | The sync-status column on the queue/session schema | Client-only (`DeadLetter` = terminal retention) — matches `OF-29`; server-visible marker — requires a restated requirement |
| D-08 | `Notification` state set ownership | Behaviour complete (`NT-27..31`); the three states were `state-machines`' own | The `Notification` state column | **DECIDED — 2026-09-29: (a) the three states `Unread/Read/Acknowledged`, now owned by notification-domain §7; expiry stays retention, not a state (`NT-30`); read/ack independent (`NT-28`, `RT-324`); ack never performs the action (`NT-29`)** |
| D-09 | `StockCount` state set ownership | Behaviour complete (`IV-25..31`); four names were `state-machines`' own | The `StockCount` state column | **DECIDED — 2026-09-29: (a) the four states `Open/Posted/Cancelled/Reversed`, now owned by inventory-domain §8.3; `Posted` immutable, `Reversed` by compensating movement (IV-30, SM-82); no `Approval` state — IV-28's approval is a posting precondition** |
| D-10 | Licence for distribution (`GATE-Q2-LICENCE`) | `GR-04`; legal question | Nothing — blocks release, not engineering | **DECIDED — 2026-09-29: (d) sold/commercial.** No specific licence named and no legal conclusion asserted; licence compatibility + third-party dependency terms review remain a **pre-release requirement** |
| D-11 | Loyalty accrual basis (`CU-25`) | Mechanism complete; the basis is a config value | A config default value only — no schema change | **DECIDED — 2026-09-29: (a) net of discount, excluding tax.** All three bases remain configurable (`RP-08` vocabulary unchanged) |
| D-12 | Product config vs legal tax facts (Nepal, NPR) | Jurisdictional taxes, rates, receipt obligations are legal facts; the *configuration layer* is decidable | The tax-config schema (driven by the mechanics, `SP-33..38`) is buildable now; the legal facts populate it, not define it | Config-layer decision (Phase 2 deliverable) vs legal-facts decision (owner + legal input) |
| D-13 | Backup RPO/RTO and restore window | Rules name the requirement and permissions but no numbers | Whether configuration and archive schema require a specific restore path | The numeric target decides snapshot/granularity and restore-path design |

**Deliberately not decided here, and recorded as such.** The decision log in `OWNER-DECISIONS.md` remains
empty, per the constitution §7.

---

## 5. Domain readiness (specification completeness)

39 areas were enumerated in the task; all 39 were audited and are reported here (the list was 46 in the brief but
contains 39 distinct names — every provided name is covered; nothing was reworded to make a count fit). Full
per-area detail is in the exploration annex; the summary is:

| Classification | Count | Areas |
|---|---|---|
| **READY FOR DATABASE DESIGN** | 27 | organization, warehouses, products, variants, SKU, barcode, units, pricing, inventory, movements, batches, expiry, FEFO, sales, returns, refunds, payments, employees, roles, RFID, hardware, POS terminals, cash drawers, approvals, retention, import/export, customer credit |
| **PARTIALLY SPECIFIED** | 12 | stores, locations, tax, purchasing, suppliers, permissions, offline transactions, synchronization, audit, notifications, configuration, backup/recovery |
| **BLOCKED** | 0 | — |

### 5.1 The 12 PARTIALLY SPECIFIED, with the exact open item

| Area | Open item (exact) | Gate / decision |
|---|---|---|
| stores | **Store trading calendar / opening hours** — `organization-model.md` §11: "Should be added before production"; defines the business-date boundary that is snapshotted onto every sale | NEWLY DISCOVERED (G-4, §10) |
| locations | Central-warehouse `StoreId` cardinality | GATE-Q1 (D-03) |
| tax | No rate/taxable-class/registration data; jurisdiction undeclared by rule (`GR-05`) | D-12 |
| purchasing | Payable-creation point (`SM-29` vs `procurement-domain §5`); plus **payment-terms modelling** (`PR-Q37`, `SU-14`): "whether terms are modelled or the payment only recorded is an open decision" | GATE-PAYABLE (D-02); payment terms (G-5, §10) |
| suppliers | Due-date posting point depends on D-02; the same payment-terms open decision (`SU-14`) | GATE-PAYABLE; **payment terms** |
| permissions | The 13 missing keys (a *seed-set* gap, not a table-shape gap) | GATE-PERMKEYS (D-01) |
| offline transactions | Dead-letter server visibility | GATE-DEADLETTER (D-07) |
| synchronization | Dead-letter visibility; offline-shortfall attribution | GATE-DEADLETTER; GATE-OFFLINE-INVENTORY (D-04) |
| audit | Per-transition Audit cells — **RESOLVED by D-06** (20 types, cells mapped; the one remaining `OPEN DECISION`, `DeadLetter`, is D-07's) | GATE-AUDITTYPES (D-06) |
| notifications | State-set ownership | GATE-NOTIFICATION-STATES (D-08) |
| configuration | RPO/RTO participation in backup scope; inherited tax gap | D-13; D-12 |
| backup/recovery | Storage/schedule/tier; RPO/RTO values | D-13 |

### 5.2 What the "27 READY" proves

The audit shows the *shape* of the domain model — entities, relationships, closed enumerations, immutable-vs-
derived columns, concurrency mechanisms — is derivable for 27 of 39 areas without inventing business rules. The
12 partial areas are partial **only** because of the tracked gates plus the newly discovered items (G-4, G-5 in
§10); none is BLOCKED. This is a **documentation-completeness** verdict, not a license to start Phase 3: the
blockers in §3.1 stand.

---

## 6. Critical invariant gaps

The 18 enumerated behaviors (the brief's list of 20 contains 18 distinct names) were checked against
`business-invariants.md` and the product rules:

**COVERED (16):** duplicate sales (online: `ClientOperationId` + SM-04; *citation defect — see below*), duplicate
synchronization (BI-28/29, OF-22/23), duplicate returns (BI-07, RR-15/16), over-return (BI-06/16, RR-14),
over-refund (BI-10, RR-03/24, PY-22/23), stock creation (BI-12/03, IV-13/14/51), stock destruction (BI-12/13,
IV-41/52), negative stock (BI-05 consequence, BI-36, IV-16..20, organization-model §3.2), concurrent checkout
(BI-36, IV-21..24 — *but see contradiction below*), payment retry/duplicate-charge (PY-11/14/38..41/54; the
acquirer-side idempotency key exists only in PHASE-2-ARCHITECTURE §13.3, no Phase 1 product rule — recorded, not
a blocker), offline conflict (BI-30/31, OF-29..38), unauthorized store access (BI-14/43, MS-03..10), unauthorized
inventory adjustment (BI-25/26/27, IV-32..38), unauthorized price/below-cost change (BI-20, SP-22/23, PR-32..34),
unauthorized refunds (BI-10, RR-35, PY-26/27), RFID replay (BI-33, RF-01..03/16..19; a replayed read **cannot**
authorise anything — it may create a spurious `AttendanceEvent` outside the burst window, recorded), audit
tampering (BI-24, AU-20/29/30/32).

### 6.1 Found gaps and contradictions (verified in the primary source)

| # | Severity | Finding | Evidence | Register status |
|---|---|---|---|---|
| G-1 | **Contradiction** | **`EC-01`/`RT-067` contradict `BI-36` and CON-07 on the last-unit race.** `EC-01` (edge-cases.md:27): "One succeeds, one is refused. Never a negative balance", citing `BI-02` (which is a *projection* invariant, wrong citation). MUST `RT-067` (RT-064 acceptance): "exactly one completed sale and one refusal". But the v1 store default is `AllowNegative` (`organization-model.md` §3.2, CON-07), under which `BI-36` and `EC-24` (3 lines below EC-01, same file) require **both to succeed and the balance to go negative**. The MUST acceptance criterion is unsatisfiable at any v1-default store. `EC-01` is also the only `EC-*` case with no verdict in `PHASE-1-REVIEW.md` | edge-cases EC-01, EC-24; RT-067; BI-36; CON-07 | **NEWLY DISCOVERED** (§10) |
| G-2 | **Specification gap** | **`Terminated` has no live-session revocation rule** (suspension does — `SM-47`); and role-assignment removal is contradictory — `EC-45` says the session is revoked citing `AC-01` (which is about deny, not sessions), while `PC-03`/`PC-04` say mid-shift users are not logged out and stay usable up to 60 s. Suspension is also unaudited (`AU-12` has `Employee.Terminate`, no suspension type) | employee-domain EM-08..11; EC-45; PC-03/04; SM-47/50 | Already logged as `REPORTED` findings in PHASE-1-REVIEW §9/§11; covered by GAP-012 (NON-BLOCKING, unverified-as-primary-source) |
| G-3 | **Citation defect** | **`BI-28` is offline-scoped** (unique on `(TerminalId, ClientOperationId)`), yet is the cited authority for the *online* duplicate-sale case (EC-05, RT-121). The online case is actually held by `product-overview.md` §3.10 + `SM-04`. `sales-pos-domain.md:79` still says `ClientOperationId` is "Present when originated offline", contradicting `PY-39`'s "the commit step carries the same `ClientOperationId` discipline". Behaviour is defined and testable; the citation is wrong. A wrong citation reads as verified and is worse than none (PHASE-1-REVIEW:261) | BI-28; SM-04; sales-pos-domain:79; PY-39 | **NEWLY DISCOVERED** (§10) |
| G-4 | **Open decision, untracked in the register** | **Store trading calendar / opening hours** — `organization-model.md` §11: "Should be added before production; noted in the review as an open decision because it affects the business-date boundary." The business date is snapshotted onto every sale and drives shift close, return windows (`RR-10`), and reporting. `EC-64`/`EC-86` were already classified `MISSING DEPENDENCY` in PHASE-1-REVIEW, both descending from the business-date boundary `EC-64` cites | organization-model.md §11:368; edge-cases EC-64/EC-86; PHASE-1-REVIEW §8.1 | **NEWLY DISCOVERED** — a business-date/calendar decision, not in GAP-001..034. Does not shape the stock/ledger schema; shapes the business-date authority and operational calendar |
| G-5 | **Open decision, untracked in the register** | **Payment-terms modelling** — `PR-Q37`: "Whether SmartStore models the terms or merely records the payment is an open decision; what is not optional is that the **discount actually taken** is recorded, so the payable and the payment reconcile." `SU-14` (supplier side) says the same. The register has no row for it — payment terms are not in GAP-001..034 | procurement-domain PR-Q37:269-272; supplier-domain SU-14:118-120 | **NEWLY DISCOVERED** — schema-shape question (a `PaymentTerms` datum/table vs discount-recorded-only). Either answer is valid; not a blocker |

None of G-1..G-5 invalidates an invariant; G-1..G-3 are real defects in the specification text and G-4/G-5 are
decisions the register omits. Each must be resolved through the change-management rule (constitution §20) —
**not** silently patched.

---

## 7. State-machine readiness

The corrected `state-machines.md` §22 is **sufficient for derivation but not yet complete for implementation.**

Verified structure (primary source, PHASE-1-REVIEW defect 14 and §22.0):
- Each §22 table row carries `From → To, Event, Permission, Precondition, Side effect, Audit, Reversal` — seven
  of the eight attributes of `SM-02a`.
- The eighth, **Actor, is defined by rule**, not enumerated per row: *actor = the role template holding the
  Permission key* (`actors-and-roles.md` §4). This was a deliberate, documented review decision (defect 14:
  enumerating per-row roles would have been an invention), and the review no longer claims per-row actors.
- `SM-02b`: permission cell never empty and never "any". `SM-02c`: an `OPEN DECISION` cell blocks Phase 2 only
  in Permission, Side effect, or Audit. `SM-02d`: undefined keys are MISSING DEPENDENCY.

Derivation capability:
- **States and relationships — derivable.** Every transition names both states; the owning documents define the
  state sets (verified for Product, PurchaseOrder, SupplierInvoice, Sale, Batch, Device, Shift, Notification,
  StockCount).
- **Permissions — derivable for 88 of 119 rows, blocked for 29** (the 13 undefined keys, GAP-002).
- **Preconditions, side effects, reversal/cancellation — derivable for the 90 rows that carry them**, `OPEN`
  for the 29 `OPEN DECISION` rows.
- **Audit behavior — derivable.** The `AU-12` vocabulary is RESOLVED (`AU-12b` plus the D-06 additions); every §22
  Audit cell names an existing or added type, except the offline `DeadLetter` cell which is D-07's (GATE-AUDITTYPES,
  D-06).

Measured position (unchanged since the closure pass): of 119 §22 rows, **38** name only defined keys, **29**
name a missing key, **29** carry `OPEN DECISION` cells, **23** are system edges. The contract is
**complete and honest**; the unresolved cells are exactly the gates D-01 and D-06.

**Verdict:** the state-machine specification is *structured enough that a DB architect can derive the state
tables and transition-permission relationships*, and it explicitly refuses guessing (`SM-02d`). It is not
*implementation-complete* for the 29 blocked rows and the 29 open audit cells. Those cells must remain unresolved
per the constitution §13 — they are not filled in here.

---

## 8. Database-derivation test

> Could a competent database architect derive the domain model from the current documents **without inventing
> business rules**?

| Major domain | Verdict | Missing information (if NO/PARTIAL) |
|---|---|---|
| Organization / stores / warehouses / locations | **PARTIAL** | Trading calendar for stores (G-4); central-warehouse `StoreId` cardinality (D-03) |
| Product / variants / SKU / barcode / units | **YES** | — |
| Pricing / discounts | **YES** | — |
| Tax | **PARTIAL** | The mechanism is fully specified; the rate/taxable-class **facts** cannot be derived (legal input, D-12). The *schema shape* is derivable |
| Inventory / movements / batches / expiry / FEFO | **YES** | (batches: cached-status derivation fully specified, BE-16) |
| Purchasing / suppliers / payables | **PARTIAL** | Payable-creation state (D-02); payment-terms-as-data-or-recorded (G-5) |
| Sales / returns / refunds / payments | **YES** | (payments: acquirer-side idempotency key is Phase 2 §13.3, recorded) |
| Customer credit | **YES** | Due-date existence resolved (D-05: no due date in v1); CU-12..CU-23 complete |
| Employees / roles / permissions | **PARTIAL** | The 13 missing keys (D-01) — the *table shape* is derivable, the seed data is not |
| RFID / hardware / terminals / drawers | **YES** | — |
| Offline transactions / synchronization | **PARTIAL** | Dead-letter visibility (D-07); shortfall attribution (D-04) |
| Audit | **PARTIAL** | Per-transition event types (D-06); the five-missing-types question is RESOLVED |
| Notifications / approvals | **PARTIAL** | Notification state set **YES** (D-08); StockCount state set **YES** (D-09) |
| Retention / configuration / backup / import-export | **PARTIAL** | RPO/RTO (D-13) for backup scope; the rest specified |

**Aggregate verdict: PARTIAL — but "partial" only where an owner or newly-recorded decision is the exact missing
piece.** In no domain did the audit find that a business rule itself was missing or would need to be invented;
the missing information is in every case one of the recorded open decisions. This is the strongest statement the
documentation supports, and it is exactly the situation `PHASE-3-ENTRY-CRITERIA.md` and the constitution's
§7/§13 anticipate.

---

## 9. Claude Code handoff test

A fresh Claude Code session with **no conversation history** receives the five documents the task names. The
handoff test asks whether it could understand the eight facts.

| Fact | Understandable? | How |
|---|---|---|
| What SmartStore is | **Yes** | Constitution §1 (retail operating platform, built clean, Phase 0 Options C); `product-overview.md` §1 |
| What it must build | **Yes** | Constitution §6 + §26 (read spec → requirements → invariants → architecture before acting); the 39-area inventory (§5) |
| What it must not build | **Yes** | Constitution §23 (no ERP/payroll/manufacturing without approval), §18 (no hardware leaking in); v1 out-of-scope list (`overview.md` §6) |
| What remains undecided | **Yes** | `OWNER-DECISIONS.md` (13 OPEN), register (§3-residual cells), `PHASE-3-ENTRY-CRITERIA.md` (13 criteria, none met) |
| What evidence is authoritative | **Yes** | Constitution §2 hierarchy (1–9), §4 (source per claim) |
| What it must never assume | **Yes** | Constitution §3 (NEVER INVENT), §5 (no false certainty), §13 (do not invent transition behavior) |
| What phase it is currently in | **Yes** | Constitution §31 (Phase 2 complete/pre-Phase-3; Phase 3 not started) — status table is current and validated |

**Missing information found (3, all minor):**
1. **The 20-field register schema is referenced but not repeated** — a Claude session reading only the four
   files must open `PRE-PHASE-3-GAP-REGISTER.md` to interpret `GAP-xxx` rows. The register itself documents the
   fields (§2), so this is not a blocker — it is a pointer dependency.
2. **`CONSTITUTION-READINESS-AUDIT.md` (this file) will not exist in a fresh handoff** unless included in the
   package. It carries the new findings (G-1..G-5, §10) that the register does not record. **Recommendation:**
   fold the five new findings into the register under the change-management rule before Phase 3 begins — or hand
   this audit to the session explicitly. This is a documentation action, not a constitution change.
3. **The taxonomy of blockage — "Phase 2 blocker" vs "Phase 3 blocker" vs "release blocker"** — is precise in the
   register §5 but a fresh reader could under-read it; nothing in the four documents cross-links the three tiers
   to the full 13-decision table. Minor; the register's §4/§5 tables already carry it.

**Verdict: PASS with the documented caveat.** A fresh Claude Code session could determine all eight facts from
the named documents alone; the caveats are pointer-level, not fact-level, and are fixed by the §10 fold-in.

---

## 10. Newly discovered gaps

Five findings that the register does **not** yet carry in this form, all **verified against the primary source
during this audit** (G-1..G-3 are invariant/consistency defects; G-4, G-5 are decisions the register omits.
G-2 was previously logged only as `REPORTED` under GAP-012, without primary-source verification — this audit
promotes it to `CONFIRMED`):

| # | Finding | Evidence (file:line) | Classification | Impact |
|---|---|---|---|---|
| G-1 | `EC-01`/`RT-067` contradict `BI-36` + CON-07: MUST asserts "never a negative balance / exactly one succeeds" while the v1 store default `AllowNegative` requires both-to-succeed and a negative balance. `EC-01` cites `BI-02` (projection) instead of `BI-36` (concurrency); it is the only `EC-*` case without a PHASE-1-REVIEW verdict | edge-cases.md:27, EC-24; RT-067/RT-064; business-invariants.md BI-36; organization-model.md §3.2 (CON-07) | **CONTRADICTION** — specify, then decide through the change rule: either align `EC-01`/`RT-067` with `BI-36` (AllowNegative default ⇒ both succeed, negative flagged) or pin the MUST acceptance to `BlockNegative` stores. **Not a phase blocker for the schema** — the concurrency mechanism is settled; the acceptance *text* is wrong | Medium; MUST-level acceptance inconsistency; RT-067 is a mapped row whose acceptance is currently unsatisfiable |
| G-2 | `Terminated` has no session-revocation rule; role-assignment removal is contradictory (EC-45 revoke vs PC-03/04 keep alive); suspension unaudited | employee-domain EM-08..11; edge-cases EC-45; actors-and-roles PC-03/04; audit-domain AU-12 | **SPECIFICATION GAP.** Promote from `REPORTED` to `CONFIRMED` (it is no longer unverified) and resolve the session/access lifecycle before Phase 3 UI/access work | Medium; security-relevant (a terminated employee's live session behaviour is undefined) |
| G-3 | `BI-28` is offline-scoped but cited for the online duplicate-sale case; `sales-pos-domain.md:79` contradicts `PY-39` on when `ClientOperationId` is present | business-invariants BI-28; product-overview §3.10, SM-04; sales-pos-domain:79; PY-39 | **CITATION DEFECT.** Behavior is defined; the citation and one field note are wrong. Fix the citation/note (documentation change, no requirement change) | Low; wrong citation reads as verified |
| G-4 | **Decision not in the register:** the store trading calendar / opening hours is unmodelled, flagged "should be added before production", and defines the business-date boundary snapshotted onto every sale; `EC-64`/`EC-86` descend from it and are already `MISSING DEPENDENCY` | organization-model.md §11:368; edge-cases EC-64/EC-86; PHASE-1-REVIEW §8.1 | **OPEN DECISION** — business-date/calendar authority. Not a stock/ledger-schema shape; an operational-calendar decision | Medium; business-date is the store's day boundary; no schema block |
| G-5 | **Decision not in the register:** whether payment terms are modelled as data or the discount merely recorded (`PR-Q37`/`SU-14`); the discount-taken record is mandatory either way | procurement-domain PR-Q37:269-272; supplier-domain SU-14:118-120 | **OPEN DECISION** — schema-shape question (a `PaymentTerms` datum/table vs discount-recorded-only). Both answers are valid; not a blocker | Low; purchaser/supplier schema shape |

The register must be updated with G-1..G-5 (as `GAP-035..39` or absorbed into existing rows, at the owner's
direction) — **not** silently resolved here. The five citations in the §10 table above are the source lines
read during this audit.

## 11. Items explicitly NOT blockers

Recorded so the audit cannot be misread as inflating the blocker count:

- **Licence (D-10 / GATE-Q2-LICENCE):** **decided — sold/commercial**; no licence named, OSS-terms clearance stays
  pre-release. Blocks release, not development. Not a Phase 3 blocker.
- **Loyalty accrual basis (D-11):** **decided — net of discount, excluding tax.** Config value, no schema change.
  Not a blocker.
- **Notification / StockCount state sets (D-08/09): vocabulary only, behaviour complete.** Both are now
  **closed** — Notification by D-08 (notification-domain §7), StockCount by D-09 (inventory-domain §8.3). Not a
  blocker.
- **13 `REPORTED` cross-domain findings (GAP-012):** NON-BLOCKING until verified in the primary source. G-2
  elevated one of them to CONFIRMED in §10; the rest remain NOT BLOCKED.
- **`Sales.*` → `Sale.*` sweep (GAP-031):** mechanical consistency work; not a blocker.
- **Security-checklist, observability, consolidation docs:** now exist; were open-specification, not blockers.
- **Dead-letter visibility (D-07):** a status-column choice whose requirements-preferred answer (`OF-29`, client-
  only) is already recorded; not a blocker unless the owner chooses the contradicting option.
- **Payment-terms modelling (G-5):** either answer (terms as data, or recorded-only) produces a valid schema; the
  discount-taken rule (`PR-Q37`, `SU-14`) is mandatory regardless. Open decision, not a blocker.

---

## 12. Final Phase 3 readiness status

**Superseded in part, 2026-09-29 (final closure pass).** The verdict below is the audit's own; the current
position is recorded immediately after it. The audit text is retained as the historical record.

The status is chosen from the evidence, not from optimism.

- **Specification completeness:** 27 of 39 domains are ready (customer credit moved to ready with D-05); 12 are
  partial **only** in the recorded decisions; 0 are blocked.
- **Constitution:** fully consistent with Phase 0–2; no change required; §31 status table correct.
- **Blockers:** the five structural blockers of §3.1 stand — permission keys (D-01), payable timing (D-02),
  warehouse/offline attribution (D-03/04), credit due date (D-05, decided **no** per D-05), and the 342-rule
  traceability backlog (C-06). The five new findings (§10) are recorded but are not additional structural
  blockers.
- **Entry criteria:** C-04 (offline stock) and C-05 (credit due date) are *decided*; the remaining
  `C-01..C-03`, `C-06..C-13` stay *pending* (`PHASE-3-ENTRY-CRITERIA.md` §3).

### **FINAL STATUS: READY WITH BLOCKERS**

*Phase 3 is ready in the sense that the domain model is derivable without inventing business rules, and the
documentation is internally consistent and gated. It is blocked in the precise, recorded sense: the owner
decisions D-01..D-05 are decided (D-05 is closed, having been answered "no"), and the traceability backlog C-06
and the remaining decisions must be resolved before the final schema is produced, per `PHASE-3-ENTRY-CRITERIA.md`
§1 and the constitution §6/§7. Phase 3 must not start while any structural blocker stands.*

Not `READY` because the blockers are real and unresolved. Not `NOT READY` because the documentation — including
the blocker record itself — is complete, consistent, and sufficient for the next phase to begin the moment the
structural decisions are made. Closing C-06 and the remaining decisions — a documentation and decision task, not
an implementation task — is the only work between this audit and Phase 3.

---

## 13. Current position after the final closure pass (2026-09-29)

**The verdict is unchanged in kind and much narrower in degree: READY WITH BLOCKERS — one blocker.**

**What changed.** The five structural blockers §3.1 listed were four owner decisions plus the traceability
backlog. All four decisions are now taken (D-01..D-11), and the gap register, entry criteria, state machines,
Phase-2 review, and constitution §31 have been corrected accordingly. Two of §3.1's claims did not survive
verification: the "13 undefined permission keys" premise was **refuted** (all 13 exist in `actors-and-roles.md` §2;
D-01 kept them as written), and §3.1's treatment of the session-revocation finding was **too wide** — `EC-45`
already revokes the session when a role assignment is removed, and `Suspended` already revokes live sessions
(`SM-47`). The genuine, narrower gap is that `Terminated` does not (GAP-040).

**The one remaining Phase 3 blocker is C-06 / GAP-035.** The audit reported the 342-row backlog as a fact; the
closure pass quantified why it cannot simply be relabelled. 73 of the 342 `inferred` homes point at requirement
rows that are themselves marked OUT OF SCOPE (`RT-343`×30, `RT-288`×17, `RT-326`×11, `RT-316`×9, `RT-274`×6), and
132 more point at two generic catch-all rows (`RT-344`×67, `RT-350`×65). The exact action that closes it is a
human confirming or reassigning each of the 342 homes against its domain source. It is a traceability-coverage
defect, not a design gap.

**Open but not Phase 3 blockers**, all now registered for the first time: `GAP-036` (27 transitions with no
permission key; behaviour specified as "refuse", so the schema is unaffected), `GAP-037` (a `MUST`-level
contradiction in the concurrent-last-unit acceptance text, where `BI-36` still fixes the build), `GAP-040`..`GAP-043`
(session revocation on termination, trading calendar and reporting currency, payment-terms shape, the
`CreditBlocked` exit). `GAP-038`, `GAP-039`, `GAP-044` are owner-input items that change no table.

**Release blockers** are `GAP-044` (jurisdictional tax facts — a shop cannot lawfully issue a receipt without
them) and `GATE-Q2-LICENCE` (D-10 left licence naming and OSS-terms clearance to owner+legal).

**The three new §10 findings in this document are now registered, with two of them refined.** G-1 became GAP-037
and is confirmed as a real `MUST` contradiction; G-2 became GAP-040 and was narrowed on verification; G-3 was a
citation defect and is fixed by pointing `EC-05` at `SM-04`/`PY-39`, with the residual question of `BI-28`'s
offline-scoped title left for the owner. G-4 and G-5 became GAP-041 and GAP-042.

**No Phase 3 artifact was created by the closure pass, and none should be created until C-06 is closed.**
## 14. Addendum 2026-09-30 - C-06 closed on coverage; the review artifact rebuilt

**Append-only.** Sections 1 to 13 are unchanged. Where this addendum disagrees with them - and it does,
in two places - this addendum governs. Section 13 is the record as of 2026-09-29.

### 14.1 Two corrections to section 13

**Correction 1 - the "one remaining Phase 3 blocker" paragraph is superseded.** It states the exact action that
closes C-06 is "a human confirming or reassigning each of the 342 homes against its domain source." That
adjudication is done. All 342 homes were confirmed or reassigned in ten batches; `inferred` is 0; 1161 rules are
`mapped` and 1161 distinct rules are cited, a bijection verified in both directions. The 73 and 132 counts are
historical, true on 2026-09-29, and no longer describe the trace: 24 requirement rows now carry `Pri` =
`OUT OF SCOPE` and 50 coverage rows resolve to one by canonical home, 52 by any listed home. The 48 in
section 26.3 is stale (`GAP-047`).

**Correction 2 - C-06 was never a design gap, and the coverage defect is not what blocks Phase 3.** The gate is
this project's own acceptance rule, that all 342 read `mapped` with `inferred 0`. That rule is met. What is
unmet is that 175 drafted rows are still `PROPOSED - REQUIRES HUMAN CONFIRMATION`. `mapped` is not `approved`.

### 14.2 Status

**C-06: MET pending owner approval of 175 proposed rows and acceptance of the rebuilt audit.**

Three things close it: the owner accepts, amends or rejects the 175 rows in section 18 of
`C-06-TRACEABILITY-REVIEW.md`; the owner accepts the rebuilt audit; and the owner decides the 12 pre-existing rows
in `GAP-046`, which the 175-row list will not cover.

### 14.3 The review artifact was destroyed and rebuilt

`C-06-TRACEABILITY-REVIEW.md` was destroyed on 2026-09-30: a PowerShell array collapsed to a string and
`WriteAllText` overwrote the file, losing the per-rule disposition log for 8 of the 10 batches. The traceability
work was never at risk - every home is in `requirements-traceability.md` section 26.2. The file was rebuilt
mechanically: the pre-damage copy was recovered from git baseline `9283038`, the 175-row owner list and the
rebuild notice were preserved verbatim, and the rest was recovered from surviving fragments or derived from
section 26.2 and labelled as such. **49 of the 342 rule identities are not reconstructable and are marked so
rather than invented** (`GAP-045`). Appendix A was corrected from 282 to **279** rules: 3 of its rows were
section references.

### 14.4 Independent verification

42 of the 1161 mappings were re-read against their domain sources, spanning all 25 source documents: **29
CONFIRMED, 12 WEAK MATCH, 1 ADDS BEHAVIOUR NOT IN SOURCE, 0 WRONG HOME.** The 12 weak matches are
correctly-homed but under-stated pre-existing rows (`GAP-046`); the one "adds behaviour" finding is `IV-34` at
`RT-475`, which restates `SM-14`'s content from the wrong home.

`docs/architecture/measure-c06.ps1` re-derives every invariant from the two documents and exits 1 on any
failure: 38 checks, all passing. It is saved in the repository so the gate can be re-measured rather than
trusted.

### 14.5 Constitution position

The Constitution is **not** the constraint here and was not implicated at any point. C-06 is a documentation
and approval task. `GAP-036`..`GAP-044` are unchanged by this addendum and remain as section 13 describes them:
not Phase 3 blockers, except `GAP-044` and `GATE-Q2-LICENCE`, which are release blockers.

**No Phase 3 artifact has been created by this pass, and none should be until the 175 rows and the rebuild are
accepted.**
