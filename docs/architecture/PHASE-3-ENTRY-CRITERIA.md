# Phase 3 Entry Criteria

**The conditions that must hold before SmartStore Phase 3 (implementation) begins.**

This is a branch-gate document: each criterion is checkable from the documentation or the decisions that exist
at the gate. It is not a wishlist. A criterion is either **met** (with evidence) or **not met** (naming the
blocker). `BLOCKER` here means exactly that: Phase 3 does not start until it is closed.

Source: [PRE-PHASE-3-GAP-REGISTER.md](PRE-PHASE-3-GAP-REGISTER.md), [OWNER-DECISIONS.md](OWNER-DECISIONS.md),
[PHASE-2-ARCHITECTURE.md](PHASE-2-ARCHITECTURE.md), `PHASE-1-REVIEW.md`, `requirements-traceability.md`.

---

## 1. The blocker rule

> **A single `BLOCKER` entry in the gap register that is not resolved blocks Phase 3.** Open decisions and open
> specifications do not block by themselves unless the register names them as blockers — but the two largest
> gates (`GATE-PERMKEYS`, `GATE-PAYABLE`) are blockers, and their resolution is a precondition of the schema.

Every criterion below is a **necessary** condition. The list is not sufficient: the owner may add constraints.
Nothing here is invented; each criterion cites the requirement that creates it.

---

## 2. Criteria

### C-01 — The 13 permission keys are decided and entered in the access-model catalogue

- Gate: `GATE-PERMKEYS`. Blocker.
- Why: `SM-02d` — a transition whose permission key is undefined is a MISSING DEPENDENCY and blocks that
  transition. 29 transitions across 8 machines are affected. Renaming to a near neighbour is forbidden.
- Accept: `actors-and-roles.md` lists each of the 13 keys with the role templates that hold it, and no
  transition in `state-machines.md` §22 names a key absent from the catalogue.

### C-02 — Payable timing is decided

- Gate: `GATE-PAYABLE`. Blocker.
- Why: the `SupplierInvoice` schema and AP ledger cannot be built until it is known when a liability exists
  (`SM-29` vs `procurement-domain §5`; the two readings produce different ledgers under `SU-09`).
- Accept: the owner picks the state at which a payable exists and the `OPEN DECISION` cells on the `Matched →
  ApprovedForPayment` edge (side effect and permission) are closed in state-machines §22.5.

### C-03 — The central-warehouse attribution decision is made

- Gate: `GATE-Q1`. Blocker (schema).
- Why: one physical location carrying several store attributions is a schema shape; every other document is
  written to hold either answer, and the stock schema is not final until it is chosen.
- Accept: owner picks option A or B (PHASE-2-ARCHITECTURE §23.4) and the chosen shape is reflected in the
  multi-store schema.

### C-04 — The offline-stock model is decided

- Gate: `GATE-OFFLINE-INVENTORY`. Blocker (schema), shared with C-03.
- Why: server reservation vs apply-and-reconcile changes the reservation model, the negatives reporting, and
  the sync schema. The behaviour is already settled in the requirements (allow-and-reconcile, OF-38; no implicit
  reservations, IV-49); what the gate adds is the schema attribution (same question as C-03).
- Accept: the attribution of an offline shortfall is defined (per store / per location / per the store bearing
  the sale).

### C-05 — Q4 answered: does store credit have a due date?

- Gate: `GATE-Q4-DUNNING`. **DECIDED (D-05): no due date in v1.** Was a blocker **only if** the requirements
  were to keep referencing a dunning policy.
- Why: `EC-65` referenced a dunning policy no rule defines. The owner's answer is "no": `EC-65` is rewritten to
  drop the dependency and no AR aging exists, per D-05. If the answer had been "yes", customer-domain,
  notification-domain (a `CreditOverdue` event added under AU-13), state-machines, and reporting would all change.
- Accept: the owner answer is in the decision log (`OWNER-DECISIONS.md` D-05, 2026-09-29), and the documents are
  consistent with it (`EC-65` corrected; CON-06, NT-37, and CU-12..CU-23 preserved).

### C-06 — The traceability backlog is closed

- Blocker (Phase 2's first work item, carried into Phase 3).
- Why: 342 rules (335 ids + 7 `PR-Q` ids) are home-assigned by a script and unverified; 232 of the audit-time
  320 are `CONFIRMED` with no requirement row. `GR-06`: "the assignment is a proposal and has not been reviewed
  by a person."
- Accept: every id in `requirements-traceability.md` §26.2 row for the 342 reads `mapped`, and §26.3 shows
  `inferred 0`.

### C-07 — The audit-vocabulary question is settled

- Gate: `GATE-AUDITTYPES`. **DECIDED (D-06, 2026-09-29).**
- Why: `AU-11` closed, versioned vocabulary; a type added post-schema-migration requires a reviewed migration
  (`AU-13`).
- Accept: every §22 Audit cell names an existing `AU-12` type or a D-06 addition; the only cell left
  `OPEN DECISION` is the offline `DeadLetter` edge, which belongs to C-08 (D-07). No placeholder type is used.

### C-08 — Dead-letter visibility is decided

- Gate: `GATE-DEADLETTER`. **DECIDED (D-07, 2026-09-29).**
- Why: `OF-29`'s three-outcome contract is load-bearing; a fourth server status would contradict it without a
  restated requirement.
- Accept: the owner decided client-only, and the sync status model matches `OF-29` — the server result vocabulary
  remains exactly `Applied`/`AppliedWithAdjustment`/`Rejected`, and the §22 `any → DeadLetter` edge audits `—`
  (client-side retention, not a server business event). This closes the last `OPEN DECISION` audit cell.

### C-09 — Notification and StockCount state sets are owned

- Gates: `GATE-NOTIFICATION-STATES`, `GATE-STOCKCOUNT-STATES`.
- Why: both machines' states were this document's own, not the owner's (§22.16, §22.17). Behaviour is fully
  specified; the state vocabulary is not.
- Accept: each owning domain enumerates its states or confirms the names in use.
- **Notification (D-08, 2026-09-29): decided** — `Unread`/`Read`/`Acknowledged`, now owned by notification-domain
  §7; expiry outside the machine (NT-30).
- **StockCount (D-09, 2026-09-29): decided** — `Open`/`Posted`/`Cancelled`/`Reversed`, now owned by inventory-domain
  §8.3; `Posted` immutable, `Reversed` by compensating movement (IV-30, SM-82); no `Approval` state.

### C-10 — Licence decided

- Gate: `GATE-Q2-LICENCE`. **Blocks release, not engineering.** **DECIDED (D-10, 2026-09-29): sold/commercial.**
- Why: `GR-04`. With a sold/commercial answer, OSS dependency terms must be checked before distribution.
- Accept: decision logged. Optional for starting implementation; mandatory before any delivery. No specific licence
  is named; licence compatibility and third-party dependency review remain a **pre-release requirement** (owner +
  counsel).

### C-11 — A test strategy is stated

- Why: `IV-09` (rebuild from ledger is a release gate), `PY-12` (payment graph assertion), the concurrency
  suite (`IV` §7), `SP-66` (sale status rebuild).
- Accept: `testing/TEST-STRATEGY.md` names these as gates and the implementation is required to run them.
  Framework selection is Phase 3.

### C-12 — The consistency sweep is done

- Why: `sales-pos-domain.md` §1 records several role templates still writing `Sales.*`, which is not a real
  permission.
- Accept: no `Sales.*` remains; `Sale.*` is used throughout; every cross-document reference resolves.

### C-13 — The gap register is current

- Accept: `PRE-PHASE-3-GAP-REGISTER.md` is the live record; every row reflects the state as of the gate; no
  `BLOCKER` row is unresolved.

---

## 3. Sign-off

*Status column refreshed 2026-09-29 during the final closure pass. `*pending*` meant "no decision taken yet";
three of these were pending only because the decisions existed but had not been copied into this table, which is
what the refresh corrects.*

| Criterion | Status | Evidence / decision reference |
|---|---|---|
| C-01 permission keys | *decided* | OWNER-DECISIONS **D-01** — premise refuted: all 13 keys are defined in `actors-and-roles.md` §2; kept as written and assigned via the existing wildcard grants, with `Purchase.Order.*` separation of duties enforced explicitly. `‡` markers removed from the 29 §22 rows (`state-machines.md` §22.0/§22.0.1). **Residual, separate population: 27 transitions with no key at all → `GAP-036`, non-blocking for schema** |
| C-02 payable timing | *decided* | OWNER-DECISIONS **D-02** — the payable is created at `ApprovedForPayment`; `SM-29`/`SU-09`/`BI-38`/`RT-109`/`RT-110` agree. **Residual:** the `→ ApprovedForPayment` permission is not named → `GAP-036` |
| C-03 warehouse attribution | *decided* | OWNER-DECISIONS **D-03** — explicit `(StorageLocation, Store)` attribution model |
| C-04 offline stock | *decided* | OWNER-DECISIONS D-04 (allow-and-reconcile) |
| C-05 credit due date | *decided* | OWNER-DECISIONS D-05 (no due date in v1; EC-65 corrected) |
| C-06 traceability backlog | **NOT MET — BLOCKER** | `requirements-traceability.md` §26.3: `inferred 342` of 1161. Measured 2026-09-29: **73 of the 342 point at requirement rows that are themselves OUT OF SCOPE**, and 132 point at two generic catch-all rows. The generated homes are not acceptable as recorded; this closes only by human confirmation or reassignment of all 342. → `GAP-035` |
| C-07 audit vocabulary | *decided* | OWNER-DECISIONS D-06 (20 types added; audit cells mapped; the `DeadLetter` cell resolved by D-07) |
| C-08 dead-letter | *decided* | OWNER-DECISIONS D-07 (client-only; server vocabulary stays `Applied`/`AppliedWithAdjustment`/`Rejected`) |
| C-09 Notification/StockCount states | *decided* | Notification **D-08** (`Unread`/`Read`/`Acknowledged`, owned by notification-domain §7); StockCount **D-09** (`Open`/`Posted`/`Cancelled`/`Reversed`, owned by inventory-domain §8.3) |
| C-10 licence | *decided* | OWNER-DECISIONS D-10 (sold/commercial; no licence named; OSS-terms review pre-release) |
| C-11 test strategy | *met* | `testing/TEST-STRATEGY.md` now exists (consolidated 2026-09-29, `GAP-017` corrected). No framework chosen and **no test executed** — this pass is documentation only |
| C-12 consistency sweep | *met* | Sweep executed and verified 2026-09-29. Every SmartStore permission is `Sale.*`; the one remaining `Sales.*` occurrence (`business-invariants.md` line 473) quotes the **surveyed** system's hazard and is deliberately unchanged. `PR-Q22` is used for stock-only, payable timing cites `SM-29`. `GAP-031` corrected |
| C-13 gap register current | *met* | `PRE-PHASE-3-GAP-REGISTER.md` refreshed 2026-09-29: `GAP-001` (stale, D-02), `GAP-002` (closed on the corrected premise), `GAP-013` (split), `GAP-014`/`016`/`017`/`025` (docs exist), `GAP-031` closed; nine new rows `GAP-035`..`GAP-044` added, six of them genuinely open |

**Gate decision: NOT REACHED — one blocker stands.**

Owner decisions D-01..D-11 are all decided, and the consolidation and sweep work is done. What remains is
**C-06**, the 342-row traceability backlog, which this project's own acceptance rule makes a Phase 3 gate: every
one of the 342 must read `mapped` with `inferred 0` in §26.3. Measured evidence that the current assignments do not
satisfy it is in `GAP-035` (73 point at OUT OF SCOPE rows). It is a traceability-coverage defect rather than a
design gap — the design decisions Phase 2 was waiting on have all been made — but it cannot be closed by
re-labelling, only by a human confirming or reassigning each home.

Everything else now open is **registered and non-blocking for schema derivation**: `GAP-036` (27 un-keyed
transitions, behaviour specified as "refuse"), `GAP-037` (a `MUST`-level contradiction in the acceptance text for
concurrent last-unit sales, where `BI-36` still fixes the build), `GAP-040`..`GAP-043` (session revocation on
termination, trading calendar and reporting currency, payment-terms shape, the `CreditBlocked` exit).
`GAP-038`, `GAP-039` and `GAP-044` are owner-input items that do not change any table: RPO/RTO, fleet and budget,
and the jurisdictional tax facts — the last of which is a hard **release** blocker, since a shop cannot lawfully
issue a receipt without them.

**No Phase 3 artifact has been created, and none should be until C-06 is closed.**
## 4. Addendum 2026-09-30 - C-06 re-measured (supersedes the C-06 row in section 3)

**Append-only.** The table in section 3 is unchanged. This addendum supersedes its C-06 row and the
"Gate decision" line that follows it.

| Criterion | Status | Evidence / decision reference |
|---|---|---|
| C-06 traceability backlog | **MET pending owner approval of 175 proposed rows and acceptance of the rebuilt audit** | `requirements-traceability.md` section 26.3: `inferred 0`, 1161 rules `mapped`, 1161 distinct rules cited, bijection verified in both directions. All 342 formerly `inferred` homes were adjudicated in ten batches (`GAP-035`). Independently re-measured 2026-09-30 by `measure-c06.ps1`, 38 checks, all passing. The review artifact was destroyed on 2026-09-30 and mechanically rebuilt (`GAP-045`); 49 of the 342 rule identities are marked not reconstructable rather than guessed |

**Gate decision: NOT REACHED - the blocker is now an approval, not a coverage defect.**

The original gate text was that all 342 homes must read `mapped` with `inferred 0` in section 26.3. That
condition is met and independently measured. What remains is that 175 requirement rows drafted by the
review carry `PROPOSED - REQUIRES HUMAN CONFIRMATION`, and a drafted row is a proposal. `mapped` is not
`approved`.

The exact actions that reach the gate:

1. The owner accepts, amends or rejects each of the 175 rows in section 18 of
   `C-06-TRACEABILITY-REVIEW.md`.
2. The owner accepts the rebuilt audit (or names a section to reject).
3. The owner decides the 12 pre-existing rows recorded in `GAP-046`, which approving the 175-row list will
   **not** cover.

Item 3 is new and was not visible before the 2026-09-30 sampling. It is not a schema blocker.

**No Phase 3 artifact has been created, and none should be created until the above are done.** That
sentence is unchanged in force; what changed is that C-06 no longer fails on coverage.
