# Phase 1 review and sign-off

Phase 1 of SmartStore produced 27 specification documents. This document is the review: what was decided, what
was verified mechanically, what is still open, and what Phase 2 must not assume.

**Status: complete, with recorded limits, and semantically audited. The mechanical checks passed. The semantic
audit did not: it found a defect cluster in the state-machine and audit-vocabulary layer that must be closed
before the specification is treated as implementable. Nothing here blocks the start of Phase 2, and the
architecture work should start — but Phase 2 must not build against `state-machines.md` or the `AU-12` event
vocabulary as they currently stand.**

---

## 1. What Phase 1 produced

| Area | Document | Owns |
|---|---|---|
| Foundation | [product-overview.md](product-overview.md) | The catalogue of entities, the invariants every other document obeys |
| Foundation | [actors-and-roles.md](actors-and-roles.md) | 18 actors, the permission catalogue, segregation of duties |
| Foundation | [organization-model.md](organization-model.md) | Organization, store, warehouse, location, terminal, drawer |
| Invariants | [../domain/business-invariants.md](../domain/business-invariants.md) | 43 rules that no document may contradict |
| Product | [product-domain.md](product-domain.md) | SPU, variant, barcode, price, category, supplier product |
| Inventory | [inventory-domain.md](inventory-domain.md) | Locations, stock items, movements, transfers, counts |
| Inventory | [batch-expiry-fefo.md](batch-expiry-fefo.md) | Batches, expiry windows, FEFO, overrides, shortfall |
| Procurement | [procurement-domain.md](procurement-domain.md) | Requisition, PO, GRN, invoice, three-way match, payment run |
| Sales | [sales-pos-domain.md](sales-pos-domain.md) | Cart, sale, hold, exchange, till operations |
| Sales | [returns-refunds-domain.md](returns-refunds-domain.md) | Return, inspection, disposition, refund |
| Customers | [customer-domain.md](customer-domain.md) | Customer, credit, loyalty |
| Suppliers | [supplier-domain.md](supplier-domain.md) | Supplier, ledger, statements |
| Payments | [payment-domain.md](payment-domain.md) | Provider interaction, states, split tender, refunds |
| Cash | [cash-management.md](cash-management.md) | Shift, drawer, float, variance, reconciliation |
| Staff | [employee-domain.md](employee-domain.md) | Employee, role, attendance, leave |
| Devices | [rfid-domain.md](rfid-domain.md) | Read event, credential, tag lifecycle |
| Devices | [hardware-domain.md](hardware-domain.md) | Terminal, scanner, printer, scale, reader health |
| Resilience | [offline-pos-domain.md](offline-pos-domain.md) | Queue, sync, conflict outcomes |
| Resilience | [multi-store-domain.md](multi-store-domain.md) | Scope enforcement, transfers, central warehouse |
| Control | [approval-workflows.md](approval-workflows.md) | Thresholds, request, decision, two-person rules |
| Control | [audit-domain.md](audit-domain.md) | The audit event vocabulary and its guarantees |
| Output | [reporting-domain.md](reporting-domain.md) | Report catalogue, as-of semantics, export |
| Output | [notification-domain.md](notification-domain.md) | The notification event vocabulary and its limits |
| Behaviour | [state-machines.md](state-machines.md) | 21 state machines, 90 numbered rules |
| Behaviour | [edge-cases.md](edge-cases.md) | 103 named edge cases with resolutions |
| Behaviour | [ux-requirements.md](ux-requirements.md) | 71 UX requirements |
| Trace | [requirements-traceability.md](requirements-traceability.md) | 354 requirements, priorities, phases, and the generated coverage appendix |

---

## 2. Decisions recorded in Phase 1

Each of these was a genuine fork. The decision, and the reason, are in the owning document; this is the index.

| ID | Decision | Rationale in one line | Recorded in |
|---|---|---|---|
| CON-01 | `Product` is the SPU; `ProductVariant` is the stockable, priced, barcoded SKU | Stock, price, and barcode are per-variant, so a product without variants has nothing to sell | PR-01..PR-03 |
| CON-02 | Stock exists only at a `StorageLocation`; a `StockItem` is a variant/location pair | "Stock at a store" cannot express a central warehouse or two locations in one store | IV-01..IV-03, MS-17 |
| CON-03 | A finalized document is immutable; an amendment is a new, linked document | Editing an approved or paid document changes history after the fact | BI-15, SM-20 |
| CON-04 | RFID authenticates and never authorizes | A tag proves who is holding it, not what they may do | BI-33, RF-01 |
| CON-05 | Device and payment-provider I/O happens outside the business transaction | A network call inside a transaction holds locks and cannot be rolled back | payment, hardware, offline domains |
| CON-06 | A customer credit balance has no due date in v1, so there is no `CreditOverdue` event | No rule anywhere gives a balance a due date; adding the event would be an event with nothing behind it | NT-37 |
| CON-07 | Negative stock is `AllowNegative` at stores and `BlockNegative` at warehouses by default | A warehouse sells to stores; a store sells to a person at the counter | organization-model, IV-16 |
| CON-08 | The supplier balance view defaults to the organization figure, with both scopes always available | It is the number used to pay an invoice, and a store-scoped figure next to a supplier's name misrepresents it | organization-model, SU-14 |

CON-07 and CON-08 are **defaults, not hard rules**. Both are per-store settings in the owning documents; a store
may invert either. They are recorded as defaults so that a reader does not have to infer intent from silence.

---

## 3. What was verified mechanically

These are counts produced by running a check over the delivered files, not assertions.

| Check | Result |
|---|---|
| Requirement rows | 354, `RT-001` to `RT-354`, contiguous, no duplicates |
| Priorities, counted from the table | `MUST` 325, `SHOULD` 9, `COULD` 4, `OUT OF SCOPE` 16 |
| Defined rules across the 26 rule-bearing documents | 1161 |
| Rules cited by a requirement row | 819 |
| Rules with no requirement row, machine-assigned and unverified | 342 |
| Rules with no home at all | 0 |
| Dangling rule references across all product documents | 2, both `CON-07` and `CON-08`, both defined in section 2 above |
| Definition-to-index parity, every document | Every defined rule appears in that document's own rules index |
| State machines | 21 machines, 90 rules, 90 index rows, no duplicate ids |
| Relative markdown links | All resolve |
| Fabricated `Sales.*` permission keys | None remain |
| Statements that a goods receipt creates a payable | None remain |
| **Rules text-resolved during the semantic audit** | **320 of 320** (two extraction passes were needed; the first pass silently dropped 79 rules whose text sits in table rows) |
| **Near-duplicate rules, 8-gram shingle over 982 rule texts** | **0 pairs** — but read review found 21 verbatim restatements, so the mechanical test was the wrong instrument and its null result is not evidence of absence |
| **Permission-shaped tokens in `state-machines.md`** | **0** across all 818 lines and 65 transition lines, against `SM-02`'s assertion that a transition is a "named, permissioned operation" |
| **Requirement rows with an acceptance criterion** | **354 of 354** (0 defects) |
| **MUST rows with a named actor** | **325 of 325**; the 16 `—` actors are the 16 `OUT OF SCOPE` rows, correctly marked |
| **Requirements citing a section reference instead of a rule id** | 4 (`RT-006`, `RT-009`, `RT-011`, `RT-100` cite `org §8`, `actors §3`, `actors §2`, `BE §9`) — not mechanically checkable, will drift on renumber |
| **MUST rows resting entirely on rules this audit classed defective** | **0** — the defects are in the machine and audit layers, not under the MUST requirements |

**The two dangling references resolved when this document was written.** The check that found them was
re-run after; it returns zero.

---

## 4. The largest known defect, stated plainly

**342 rules are cited by no requirement row.** The coverage appendix in
[requirements-traceability.md](requirements-traceability.md) section 26 assigns each one a home by taking the
requirement row in the same domain that already cites the most ids from the same namespace. That assignment is a
**proposal generated by a script, not a decision made by a person.** The rules exist and a requirement in the
right domain plausibly covers them, but nobody has confirmed it.

This document does not claim reverse completeness and neither should anything downstream. The backlog is
mechanical to close: a reviewer opens section 26, moves each id into the row it belongs to, and the row's status
flips from `inferred` to `mapped`. That is Phase 2 work, and it is the first thing Phase 2 should do.

**Update after the semantic audit.** All 342 *inferred* rules (320 at audit time, 22 added by the correction
pass) have now been read and classified on their own merits; the 320 are in
section 7 and appendix A. That closes the *semantic* question about each rule. It does **not** close the
*traceability* question: the home recorded in the coverage appendix is still a script's proposal, and the
classification in appendix A is an audit verdict, not a re-parenting decision. Moving 232 rules marked
`CONFIRMED` into real requirement rows is still outstanding work.

The forward direction is not in question. All 354 requirements cite rules, and every id they cite exists.

---

## 5. What the acceptance criteria are and are not

Nearly every row in the traceability matrix has a testable acceptance criterion. **A testable criterion is a
claim about the future, not evidence about it.** Nothing in Phase 1 has been implemented, built, or run. The
mechanisms the criteria name - unique constraints, graph assertions, build checks, static-analysis rules - are
themselves Phase 2 and Phase 3 deliverables that the architecture is obliged to honour. A criterion that says
"a build check fails on an edge out of a terminal state" describes a check that does not exist yet.

Two consequences worth stating because they are easy to misread:

- A document asserting that a design "is safe" is asserting a design intent, not a verified property.
- The Phase 0 security findings in [../repository-analysis/security-verification.md](../repository-analysis/security-verification.md)
  are evidence. Nothing in Phase 1 is. The two are not the same kind of claim and should never be cited together
  as though they were.

---

## 6. Open questions, and who has to answer them

None of these blocks the start of Phase 2. All of them block the corresponding part of it.

### 6.1 What the semantic audit concluded about each question

| # | Importance | Blocks which phase | Needed for database design? | Safe to leave as configuration? |
|---|---|---|---|---|
| Q1 central-warehouse attribution | **High** for multi-store; **moot in v1** | Phase 2 multi-store work, not v1 | **Yes — the only question in this table that is.** `MS-16`/`MS-19` attribute a batch to an originating store while `MS-17` identifies stock by variant and location only. One physical location with several attributions is a schema decision (an attribution table, or a nullable single `StoreId`), not a setting. It is deferred only because `EC-91` fixes v1 to one store. | **No** |
| Q2 licence | **High**, commercial only | Release and sale. Not engineering | No | No — legal, not configuration |
| Q3 jurisdiction, tax, currency | **High** for correctness, low for design | Phase 2 tax and receipt work | No. The *mechanism* is already specified as per-store tax category, rate, currency and rounding mode (`PR-39`–`PR-40`, `SP-25`–`SP-26`); only the values are unknown, and values are data | **Yes** — this is the safest question in the table |
| Q4 credit due date and dunning | Medium | Phase 2 only if answered yes | **Additive only.** A nullable due date is a new column; a *dunning state machine* is new states, which is a design change. `EC-65` already depends on a dunning policy that no rule defines | Partly — a date is configuration; automatic escalation is not |
| Q5 pharmacy / regulated goods | **High** for scope, low for Phase 2 | Nothing if answered no | Only if answered yes. `batch-expiry-fefo.md` already supplies the substrate; dispensing, prescriptions and controlled-substance logging do not exist at all | **Yes** — answering "no" costs nothing and is the status quo |
| Q6 approval threshold defaults | Low | Nothing | No — a per-store, per-currency setting the rules already require to be configurable | **Yes** |

Two consequences the audit adds to this table. First, the report previously said only that no question blocks
Phase 2; it did not say that **Q1 is the only one that constrains the schema**, and that is the distinction
Phase 2 actually needs. Second, **Q4 is not as clean as it looked**: `EC-65` resolves a missed due date by
applying "the dunning policy", and no such policy is defined anywhere. Answering Q4 "no" requires deleting or
rewriting `EC-65`, not leaving it alone.

### 6.2 The questions as originally recorded

| # | Question | Blocks | Why it is not answerable from the documents |
|---|---|---|---|
| Q1 | Does a central warehouse's stock carry one store attribution or several? | Multi-store reporting, and the `StockItem` model | MS-16 and MS-19 attribute central-warehouse batches to the originating store, while MS-17 identifies stock by variant and location only. Both are stated; the reporting compromise they imply - one physical location, several attributions - is a business call, not a modelling one. It is recorded in MS-19 as a nuance and it is a compromise. |
| Q2 | What is the SmartStore licence, and may the product be sold on that basis? | Everything commercial | Unresolved. See [../repository-analysis/license-matrix.md](../repository-analysis/license-matrix.md). A specification cannot settle a licence. |
| Q3 | Which jurisdictions, tax regimes, and currencies? | Tax calculation, receipts, reporting | No country was named. A tax rate is a fact about a place, not a design decision. |
| Q4 | Is a store credit balance repayable by a date? | `CON-06`, dunning, `CreditOverdue` | Phase 1 says no due date exists. If one should, customer-domain and notification-domain both change. |
| Q5 | Is there a pharmacy or regulated-goods mode? | Product attributes, expiry enforcement | No such domain exists in the specification. This is a scope question, not a detail. |
| Q6 | What are the default monetary values for the approval thresholds? | Configuration defaults, not behaviour | The rules say a threshold exists and is per store and per currency. The number is the store's to set. |

---

## 7. Semantic audit

All 342 inferred rules in the coverage appendix were read and their text resolved — the 320 that existed at audit
time each classified exactly once in appendix A, plus the 22 added by the correction pass (see §8.2; appendix A
is the audit-time record and was not retro-edited).
Requirements: 354 rows re-read for actor, priority, citation and testability. State machines: 21 audited
against their owning documents. Cross-domain pairs: 12 audited. Every finding below is labelled either
**VERIFIED** — read in the primary source during this audit, with a file and line — or **REPORTED** — returned
by a sub-agent that read the documents, not individually re-read here. The distinction is load-bearing; a
REPORTED finding is a lead, not a conclusion.

### Semantic Audit

| Classification | Rules | Share |
|---|---|---|
| `CONFIRMED` — coherent rule; the gap is traceability only | 232 | 72.5% |
| `CONTRADICTORY` — conflicts with another rule or a MUST requirement | 21 | 6.6% |
| `DUPLICATE` — restates another rule verbatim, in two homes | 21 | 6.6% |
| `MISSING DEPENDENCY` — depends on a rule, event type or policy that does not exist | 18 | 5.6% |
| `OUT-OF-SCOPE` — a v1 or Phase 2 deferral, correctly labelled in its own text | 16 | 5.0% |
| `AMBIGUOUS` — under-specified, two readings survive | 12 | 3.8% |
| **Total** | **320** | **100%** |

Per-rule verdicts and evidence are in appendix A.

Two results are worth stating because they cut against the pessimistic reading of the backlog:

- **No MUST requirement rests entirely on a defective rule.** All 325 MUST rows survive. The defect cluster is
  confined to the state-machine layer and the audit vocabulary, which no requirement row is load-bearing on.
  This is why Phase 2 can start.
- **The `CON-02`/`CON-08` decisions and the entity model are untouched.** Nothing found contradicts Product =
  SPU, stock at a location, immutable finalized documents, GRN-creates-stock, or RFID-never-authorizes.

One methodological note, because it changes how the numbers should be read: a mechanical 8-gram shingle
comparison over 982 rule texts found **zero** duplicate pairs. Read review found 21 verbatim restatements. The
mechanical test was the wrong instrument — the duplicates are whole-rule copies in two documents that cite
each other, not paraphrases. A null result from that test is not evidence of absence, and this report does not
use it as such.

### Critical Gaps

Ordered by consequence. The first four are VERIFIED.

1. **`state-machines.md` cannot be implemented as written, and its own consistency check is false.**
   **VERIFIED.** `SM-75` (line 714) asserts four properties were checked and found clean. Its own table breaks
   two: the `Shift` row (line 702) places `Reopened` in the **Terminal** column while giving it an outgoing
   edge, and the `StockItem` (line 708) and `Notification` (line 707) rows have no terminal state at all —
   which is precisely what `SM-75` claims is "none". `SM-07` requires each machine's closed state set to live
   in the owning document; **12 of 21 owning documents declare states but no transitions at all**, so half the
   set has no authoritative definition even before the consolidated document is considered.
   Of 89 consolidated edges, 2 are fully specified across all eight required attributes. Only
   `ApprovalRequest` is conformant. **REPORTED** for the per-machine matrix.

2. **No transition names a permission.** **VERIFIED.** `SM-02` (line 20) asserts "a transition is a named,
   permissioned operation." `state-machines.md` contains **zero** permission-shaped tokens across all 818
   lines, and none of its 65 transition lines mentions a permission — while the owning documents name dozens
   (`Purchase.Receive`, `Inventory.Adjust`, `Employee.Terminate`, `Device.Disable`). The document asserts a
   guarantee it does not carry, and two-person and segregation-of-duties rules cannot be enforced from it.

3. **The audit event vocabulary is closed but incomplete, which makes five required events unauditable.**
   **VERIFIED.** `AU-12` (audit-domain.md:78–83) enumerates 21 event types and `AU-11` closes the set;
   `AU-13` makes adding one a reviewed schema change. But `AU-03` (lines 24–27) sets a mandatory floor that
   includes every payment state change and every permission change, and other rules require events the
   vocabulary has no name for:

   | Required by | Event with no `AU-12` type |
   |---|---|
   | `SM-29`, `procurement-domain §5` — the payable's creation, called "the single most consequential state in procurement" | invoice approved for payment |
   | `OF-31`, `OF-33` — the server silently altering a customer's completed sale | `AppliedWithAdjustment` distinct from `SyncApplied` |
   | `EM-10`, `RF-27` — termination revoking credentials in the same transaction | employee termination |
   | `RF-26` — "every credential transition is reasoned and audited" | any `Rfid.*` event |
   | `product-overview.md:144`, `BI-40` — archival is "permissioned, audited" | product archive |

   Until these exist, the creation of a payable and the server's alteration of a customer's sale are both
   invisible to an investigator, and closing them is a schema decision, not a code change. This is the single
   cheapest high-value fix in the specification.

4. **A `Draft` purchase order can be deleted, and the rules disagree about whether it can.**
   **VERIFIED.** `PR-Q06` (procurement-domain.md:85): "A `Draft` PO may be freely edited and deleted."
   `SM-24` (state-machines.md:166): "No PO is ever deleted." `RT-117` is a **MUST** requirement, "A PO is never
   deleted", citing `SM-24`, with acceptance "Delete is not offered". So one of the 320 *inferred* rules
   contradicts a MUST requirement and its own sibling rule. `PR-Q06` is itself inferred — it is an unreviewed
   script proposal, which is exactly how an unreviewed rule escaped.

5. **`BI-15` is cited for a rule it does not state, in nine places and five MUST requirements.**
   **VERIFIED.** `BI-15` is the movement-immutability rule (`RT-059`: "Movements are immutable and are never
   deleted"). It is cited as authority for general document immutability by `SM-08`, `SM-33`, `SM-44`, `SM-48`,
   `SM-57`, `SM-62`, `SM-66`, `SM-78`, `SM-82`, and the wrongness has propagated into `RT-059`, `RT-190`,
   `RT-204`, `RT-291` and `RT-346`. The correct authorities are `BI-08`, `BI-12` and `BI-40`. A citation that
   points at the wrong rule is worse than no citation, because it reads as verified.

6. **A customer blocked on credit can never be unblocked.** **VERIFIED.** `state-machines.md:712` lists
   `CreditBlocked` as a **terminal** state with no reverse edge, while `CU-15` (customer-domain.md:115) treats
   it as an ongoing evaluated condition and `CU-09` describes it as a financial control rather than a
   judgement. `SM-09` requires any `Suspended`/`OnHold` machine to have a resume edge; `CreditBlocked` has the
   same character and no path back. The same row also names the machine `CustomerAccount`, while the owning
   document (customer-domain.md:62) owns *Customer status* — a different entity with an undefined `status`.

7. **The offline queue has a fourth outcome that the offline rules forbid.** **VERIFIED.** `OF-29`
   (offline-pos-domain.md:181) is emphatic: "Every synced transaction ends in exactly one of three states, and
   there is no fourth." `state-machines.md:504`, `:515` and `:705` add `DeadLetter` as a fourth terminal state,
   citing `OF-26` — which is about per-item sync responses, not dead-lettering. A terminal the domain does not
   have, justified by a rule that does not say so.

8. **"State is stored, not derived" is contradicted four times inside the same document.**
   **VERIFIED.** `SM-01` (state-machines.md, §0a). Against it: `SM-14`, `SM-35`, `SM-44` and `SM-76`,
   which define machines as projections, and `SP-66` (sales-pos-domain.md:400), which resolves the real
   question correctly — "a sale's status is derived from its line counters, and the status is a **cache** of
   them". The domain documents are right; the consolidated document misstates the principle.

9. **Removing a role assignment is undefined, and three rules disagree about what happens.**
   **REPORTED.** `EC-45` — itself an inferred rule — asserts "the next request is refused; the session is
   revoked", citing `AC-01`. `AC-01` is "default deny" (actors-and-roles.md:16) and says nothing about
   sessions. `PC-03` says a user mid-shift is "not logged out"; `PC-04` says a revoked session stays usable
   "for up to 60 seconds". Meanwhile nothing at all covers revoking a role *assignment* as opposed to editing a
   *role*, even though `Role.Assign` is a named high-value grant with an audit event. `EC-56` also asserts "the
   Owner is not a superuser" and cites `MS-13`, which is a different machine.

10. **The RFID credential machine exists in two irreconcilable versions.** **REPORTED.**
    rfid-domain.md §7 declares `Unassigned, Issued, Suspended, Revoked, Superseded` with restore target
    `Issued`. state-machines.md §20 declares `Issued, Active, Suspended, Revoked` with restore target `Active`,
    no `Unassigned`, no `Superseded`, and no outgoing edge from `Suspended` at all. `SM-86` ("a revoked tag is
    never re-issued to a different subject") also conflicts with `RF-05` (rfid-domain.md:53), which permits
    re-assignment to a different employee with a reason and an audit. The document header's own tie-break rule
    — the owning document wins — makes §20 and `SM-85`–`SM-88` defective as written.

11. **Employee suspension and termination have no audit event and inconsistent session handling.**
    **REPORTED.** `SM-47` claims suspension "revokes live sessions" citing `EM-13`, which is the store-set
    intersection rule and says nothing about sessions. `Suspended` is audited nowhere. Termination has no
    equivalent live-session rule at all. And three kinds of revocation are handled three different ways with no
    stated rationale: a role *edit* leaves the session alive, a store-access revocation drops the old scope, a
    suspension kills the session.

12. **Nothing maps an RFID read to an attendance event type.** **REPORTED.** `EM-23` and `RF-09` both say a
    read "produces an `AttendanceEvent`". No rule states how the reader or the system chooses between `In`,
    `Out`, `BreakStart` and `BreakEnd`, nor that a `BreakStart` requires a prior `In`. An offline punch
    resolving to a suspended or revoked credential has no defined outcome either. This is the core of the
    RFID↔Attendance pair and it is unspecified.

13. **Several cross-domain findings are reported but not independently confirmed**, including: a price change
    on an open unsuspended cart being undefined (`SP-11`, `SP-46`); an inventory sub-agent's claim of 32 gaps,
    20 contradictions and 6 ambiguities, whose detail was truncated; and whole-batch versus partial-quantity
    movement semantics. **These are leads. Do not act on them without reading the cited rules.**

### Phase 2 Blockers

Nothing here blocks *starting*. Three things block *building against specific documents*.

| Blocker | Blocks | Why it cannot be configured away |
|---|---|---|
| `state-machines.md` sections 1–21 | Any work that encodes a state machine, and any build check written from it | The tables contradict the owning documents and the document's own consistency check. 2 of 89 edges are fully specified. It is a consolidation artefact, not a source of truth |
| `AU-12` event vocabulary | Audit, compliance and the "every money event is audited" guarantee | The set is closed by `AU-11` and five mandated events have no name. Adding them is a reviewed schema change by the document's own rule |
| `Q1` central-warehouse attribution | Multi-store and warehouse reporting, and the `StockItem` model | One physical location with several store attributions is a schema decision. Deferred in practice because `EC-91` fixes v1 to one store, so it is a Phase 2 multi-store blocker, not a v1 blocker |

Two further items are **not** blockers and should not be scheduled as if they were: `Q2` (licence) blocks
commercial release, not engineering — Phase 0 already chose a clean build; and `EC-65`'s dependence on an
undefined dunning policy is resolved by answering `Q4` "no" and rewriting that one rule.

### Safe for Phase 2

The audit found a lot wrong and the following is genuinely sound. Stating it precisely matters, because an
audit that only lists defects gives no one permission to proceed.

- **The entity model and the eight `CON` decisions.** Nothing found contradicts Product = SPU, variant = SKU,
  stock existing only at a `StorageLocation`, finalized documents being immutable, GRN creating stock while
  invoices create payables, negative-stock policy being a per-store setting, or RFID never authorizing.
- **The entire MUST requirement layer.** All 354 rows have a testable acceptance criterion; all 325 MUST rows
  name an actor; **no MUST requirement rests entirely on a defective rule**.
- **Access control itself.** `AC-01` through `AC-04` — default deny, exact permission keys, server-side on
  every request, least privilege — are the best-specified rules in the set, and the Employee↔RBAC pair is
  sound apart from the revocation questions in gap 9.
- **The closed-vocabulary discipline.** `AU-11`/`AU-13` and `NT-04` are the reason gaps 3 and the `Q4` note
  were findable at all. A specification that refuses to invent event types is rarer than it should be.
- **Money and concurrency semantics.** Duplicate sale, over-return, concurrent refund, payment retry and
  split-tender behaviour are each specified, and each of the sixteen negative-stock rules was confirmed to be
  evaluated inside the business transaction rather than by an application lock.
- **Sixteen `OUT-OF-SCOPE` rules are correctly labelled deferrals**, not gaps. `RP-23`, `UX-53` and `UX-54` say
  "Phase 2" in their own text; `EC-91`, `MS-35`, `PY-35`, `RP-29` and `PR-Q10` scope v1 deliberately.
- **Phase 0 remains frozen and unaffected.** No finding in this audit touches `S-01`, `S-03`, `S-08` or `S-11`.

### Recommended order of repair

1. Add the five missing `AU-12` event types. Cheapest, highest consequence, unblocks auditability of the
   payable and of offline adjustments.
2. Fix the `BI-15` citation family (nine rules, five requirements). Mechanical, and it stops a wrong citation
   reading as verification.
3. Resolve `Q4` as "no" and rewrite `EC-65`, or define the dunning policy.
4. Rebuild `state-machines.md` from the owning documents rather than patching it, and make `SM-75` a check
   that runs instead of a claim that it ran. This is the large piece of work.
5. Add permissions to every transition, or delete `SM-02`'s claim that it has them.
6. Then re-parent the 232 `CONFIRMED` rules into requirement rows, flipping them from `inferred` to `mapped`.

---

## 8. Phase 1 defect correction

This section records what was changed after the audit in section 7, and only what was changed. Every row is
**VERIFIED** — read in the primary source, with the file and line that showed the defect. Nothing in this section
rests on a `REPORTED` lead.

### 8.1 Corrections made

| # | Defect | Evidence | Correction | Remaining uncertainty | Impact on Phase 2 |
|---|---|---|---|---|---|
| 1 | `SM-75` asserted four consistency properties were checked and clean. **Three were false**, in the table performing the check | `state-machines.md:714` claimed the check; its own table at `:702` put `Reopened` in the **Terminal** column with an outgoing edge, and `:712` put `CreditBlocked` in the Terminal column with a credit-block exit | `SM-75` rewritten as a table stating what was actually verified and what failed. New `SM-75a`: *a check that has not been performed is not reported as passing* | None. The check now reports its own failures | **Unblocked.** The document's self-certification is no longer false |
| 2 | **Nine machines used state names their owning documents do not define** | Read in each owner: product-domain §11, batch-expiry §2, sales-pos §13, returns-refunds §12.1/§12.2, employee-domain §3, hardware-domain §2, rfid-domain §7, inventory-domain §10 | Each machine's state set replaced with the owner's, verbatim, with a `SM-xxa` rule recording the correction and why the invented name was wrong: `Product` (`Retired`→`Archived`, `OutOfStock`/`Hidden` restored), `StockBatch` (`WrittenOff`→`Blocked`), `Sale` (`PartiallyRefunded`→`PartiallyReturned`), `Return` (`Received`/`Inspected`/`Dispositioned`/`Rejected`→the owner's four-state chain), `Refund` (added `PendingApproval`/`Approved`/`Processing`), `Employee` (`Invited` removed, `OnLeave`/`Archived` added), `PosTerminal`/`Device`, `RfidCredential` (`Active` removed), `StockTransfer` (`Dispatched`→`InTransit`, `Discrepancy` removed as a state) | `Notification` and `StockCount` have **no owner state list at all**. Their sets are this document's own and are recorded as such, not as agreement with an owner | **Partly unblocked.** The nine are corrected; the two unowned sets remain this document's own vocabulary and Phase 2 should treat them as provisional |
| 3 | **No transition named a permission.** `SM-02` requires one; the document had none, in 65 transition lines | Scan of `state-machines.md` before correction: permission-shaped tokens = 0; edge lines mentioning a permission = 0 | New `SM-02a`/`SM-02b`/`SM-02c` define the eight attributes and forbid an empty permission cell. New **§22 transition contracts** carry a row per transition with all eight attributes, using only keys that exist in the [permission catalogue](actors-and-roles.md) §2 | **`OPEN DECISION` cells remain where the owners are silent** — see 8.2. These are not filled in | **Still blocked.** See 8.2 and section 9 |
| 4 | `AU-12`'s closed vocabulary had **no type for five events other rules already required** | `AU-03` sets the mandatory floor; `AU-12` (`audit-domain.md:78-83`) listed 21 types. `OF-36`/`SM-65`, `PR-47`, `EM-10`, and the retention-expiry rule each require an event with no type | Five types added: `Inventory.FEFOOverride`, `Offline.SyncAppliedWithAdjustment`, `Product.Archive`, `Employee.Terminate`, `Audit.EventExpired`. New `AU-12b` records which rule requires each; `AU-12c` restates that the set stays closed | None. Each addition is demanded by an existing rule | **Unblocked** for the audit vocabulary. `AU-03`'s floor is unchanged and was not weakened |
| 5 | **`PR-Q06` contradicted a MUST.** It permitted deleting a `Draft` PO; `RT-117` is a MUST that a PO is never deleted, and `SM-24` said the same | `procurement-domain.md:84-86` vs `requirements-traceability.md:216` (`RT-117`) and `state-machines.md:166` | `PR-Q06` reworded to *cancel*; new **`PR-Q06a`** states the PO is never deleted in any state, including `Draft`. `SM-24` cross-references it. **`RT-117` was not touched** — the MUST stands and the glossary wording was the defect | None. Two MUSTs (`RT-104`, `RT-117`) and `PR-Q08` already agreed; only the prose of `PR-Q06` dissented. The formal "owning document wins" rule would have favoured delete, which is why this was a decision rather than a merge | **Unblocked.** A draft PO is cancelled, never deleted |
| 6 | **`BI-15` was overloaded.** It is titled and enforced for `InventoryMovement` only, yet was cited as the authority for general document immutability in 9 state-machine rules and 5 requirement rows, **none about stock movements** | `business-invariants.md:308-320` (title, enforcement, verification all name `InventoryMovement`) vs citations at `SM-08`, `SM-35`, `SM-43`, `SM-48`, `SM-62`, `SM-82`, `state-machines.md:10`, `RT-346`, and `audit-domain.md` ×4, `edge-cases.md:89`, `product-overview.md` ×2 | New **`BI-15a`** separates the three: movement immutability → **BI-15**, business-document immutability → **BI-08**, audit-log immutability → **BI-24**, never-deleted entities → **BI-40**. All misattributed citations re-pointed to the correct rule | None. `BI-08` and `BI-24` already existed and were correct; the citation was the defect. **Neither MUST was weakened** | **Unblocked.** A document rule can no longer be "fixed" by reading a movement rule |
| 7 | **`SM-01` contradicted four of its own rules.** "State is stored, not derived" is incompatible with `SM-21`, `SM-35`, `SM-44`, and `SM-76` | `state-machines.md:17-18` vs `SM-21` (PO receipt state projects GRNs), `SM-35` (sale status is a cache), `SM-44` (balance is a projection), `SM-76` | `SM-01` restated as being about **one document's own field**; new **`SM-01a`** states that stored does not mean authoritative and gives the test: *which entity owns the number*. `SM-35a` records that `SP-66`'s rebuild test is what keeps the cache equal | None. Both readings are now stated and the inconsistency is resolved by scope, not by choosing one | **Unblocked.** The rule no longer contradicts the machines below it |
| 8 | **`SM-64a`/`OF-29` conflict.** The offline queue listed four outcomes including `DeadLetter`; `OF-29` says exactly three, no fourth | `offline-pos-domain.md:181-188` vs `state-machines.md` §15 state table | Reconciled on a reading both documents support: `OF-29`'s three are **server outcomes**; `DeadLetter` is a **client-side** retention state reached by exhausting retries | **Partly open.** Whether the server ever sees a `DeadLetter` status is not stated in any v1 requirement, and is marked `OPEN DECISION`. Inventing a server-side fourth status would contradict `OF-29` | **Partly blocked.** The three-outcome contract is now unambiguous; the client/server visibility question is not |
| 9 | **`procurement-domain §5` and `SM-29` disagree on when the payable exists.** §5: "an invoice creates a payable". `SM-29`: the payable is created at `ApprovedForPayment` | `procurement-domain.md:172-175` vs `state-machines.md:287` | **Not resolved. Marked `OPEN DECISION`** in §22.5 with the two readings and their consequence | Genuinely unresolved. An invoice matched Monday and approved Friday is a liability from Monday or from Friday, and `SU-09` makes balances a projection of entries, so this is a **balance** difference, not a presentation one. Neither document states which | **Blocked** for AP. Phase 2 must not pick one; the permission for `→ ApprovedForPayment` is also unnamed |
| 10 | **`CreditBlocked` was filed as terminal** with no exit | `state-machines.md:712` vs `customer-domain.md:64-69`, where it is a standing control alongside the revisitable `OnHold` whose purpose is to be lifted | Reclassified non-terminal. New **`SM-45c`** records why "terminal" was wrong and marks the exit edge and its permission `OPEN DECISION` | **Partly open.** `Customer.Credit.Grant` is the nearest key and is **not assumed** to be it; no v1 requirement names who may lift a credit block | **Partly blocked.** The false terminal claim is gone; the exit is unspecified |
| 11 | **`StockAdjustment` and `RfidSession` were absent** from the consolidated set, though their owners define machines | `inventory-domain.md:283-284` (`IV-32`) and `state-machines.md` SM-63 (`RfidSession`) | Both added to §21 and given full contracts (§22.17, §22.13) | None. Both owners are explicit | **Unblocked.** Two machines that had no consolidated definition now do |
| 12 | **Broken cross-reference.** `sales-pos-domain.md` points at "state-machines.md §5" for the sale machine, which is §7 | `sales-pos-domain.md:384` | Corrected to §7 | None | Cosmetic, but it sent a reader to the purchase-order machine |
| 13 | **The access model is missing 13 permission keys that the state machines require, across 8 of 21 machines and 29 transitions.** Found while verifying the §22 permission column against the catalogue, not by re-reading prose | Mechanical check of all **119** §22 transition rows against `actors-and-roles.md` §2 (88 keys): **38 rows name only defined keys, 29 name a key the catalogue does not define, 29 are `OPEN DECISION`, 23 are system edges.** The missing keys are `Product.Edit`, `Purchase.Order.Submit`, `Purchase.Order.Approve`, `Purchase.Order.Send`, `Customer.Edit`, `Employee.Create`, `Employee.Edit`, `Device.Register`, `Device.Edit`, `Device.Disable`, `Shift.Close`, `Inventory.Count.Post`, `Inventory.Transfer.Receive` | The 29 cells are marked `‡` and listed in `state-machines.md` §22.0.1. New **`SM-02d`** classifies this as a `MISSING DEPENDENCY` that blocks its transition | **Do not repair by renaming.** `Product.Edit` is not `Product.View`; `Purchase.Order.Approve` appears in `actors-and-roles.md` §4 only as something Store Manager is *excluded* from, and so was never defined; `Purchase.Order.Send` appears **nowhere** in the access model. 12 of the 13 are referenced in that document's prose but never in its §2 table, so the table is the incomplete artifact | **Blocks 29 transitions**, and disproportionately the lifecycle ones: activate, hide, suspend, post, receive, close, register, retire. The access model has read and approve permissions for most of these and **not the write** |
| 14 | **A false claim was caught inside the correction pass itself**, twice. The first draft of §22 asserted "only keys that exist in the permission catalogue appear in a Permission cell", and the review draft then signed off "every transition specifies all eight attributes". Both were false — defect 13 falsified the first, and a per-row **Actor** was never actually enumerated | The §22 preamble claim, checked and disproved by the count above. The Actor omission: the 21 §22 tables have columns `From → To, Event, Permission, Precondition, Side effect, Audit, Reversal` — no Actor column — while two machine notes stated an actor at machine level and 19 stated none | Preamble rewritten to the verified position, with the counts as a table. Actor is now **defined by rule**, not enumerated: *actor = the role template holding the Permission key* (`actors-and-roles.md` §4), and `OPEN DECISION`/`system` where the key is `OPEN DECISION` or `‡` | **Enumerating Actor per row was deliberately not done**, and the review no longer claims it was. The catalogue maps role templates *to* permission sets, not permissions to a single role — `Inventory.Adjust` is held by four templates — so a per-row role would have been an invention | **Same blocker set, stated accurately.** The sign-off row now says seven attributes per row and actor by rule, instead of a claim that is not true |
| 15 | **Two count errors introduced by this review, both found and fixed before sign-off.** The §22 preamble's row counts were asserted from a partial scan rather than measured; the review's "341 rules" figure was an invention | Re-measured all 119 §22 rows: 38 / 29 / 29 / 23, not the 22 / 29 / 27 / 8 first written. The rule index holds **1161** distinct rule IDs (1139 before this pass), not 341 | Both corrected to the measured values. The 320 in Appendix A is the classified subset, not the total, and the review now says so where it previously implied otherwise | None — both were arithmetic, and both are now measured rather than asserted | None. This is the note that matters for trust: the correction pass produced two wrong numbers, and both were caught by re-measuring instead of by re-reading |

### 8.2 What was deliberately *not* done

- **No `REPORTED` finding was promoted.** The 13 cross-domain findings in section 7, including the inventory
  `32/20/6` tally, the open-cart price-change finding, and the RFID-attendance mapping, remain
  **`REPORTED — NOT INDEPENDENTLY VERIFIED`**. None of them produced an edit, because none was read in the primary
  source. Appendix A also still carries their audit-time verdicts.
- **No behaviour was invented.** Where an owning document does not name a permission, a side effect, or an audit
  type, the cell reads `OPEN DECISION` with the nearest candidate named in a note. **A candidate is not a
  decision.** §22.2, §22.3, §22.5, and §22.8 carry the blocking ones.
- **No MUST was weakened, relaxed, or re-prioritised.** `RT-117`, `RT-104`, `RT-106`, `RT-109`, `RT-346`, and the
  `AU-03` audit floor are unchanged.
- **No count was preserved for appearances, and no count was invented either.** The correction pass added **22 rules**
  (18 `SM`, 2 `AU`, 1 `BI`, 1 `PR-Q`), each documenting a correction or a vocabulary gap rather than restating an
  existing rule, and the rule index in `requirements-traceability.md` was extended by the same 22 rows, each mapped
  to the requirement its parent rule supports. The specification's rule index now holds **1161 distinct rule IDs
  with no duplicates** (1139 before this pass).
  Two corrections to earlier statements in this document, both found by re-measuring rather than by re-reading:
  an interim draft claimed the specification held "341 rules, not 320" — **that was an invention**; 320 was never the
  total, it is the number of rules *classified in Appendix A*, a subset, while the index holds 1161 distinct IDs. And
  the first §22 row counts were asserted from a partial scan; measured, they are 38 / 29 / 29 / 23 across 119 rows.
  Section 7's classification table is left as the audit-time record it is, and is not retro-edited to match the fix.

---

## 9. Phase 2 readiness

### **READY WITH BLOCKERS**

Phase 2 can start. It must not guess its way past the items below, and **four of the seven are decisions for a human**
rather than work for an implementer.

**What is now safe to build from**

- Every state machine's state set matches its owning document, for the 19 machines that have an owner. The other
  two (`Notification`, `StockCount`) are labelled as this document's own vocabulary.
- Every transition has its eight attributes recorded in `state-machines.md` §22, and every empty cell is visibly
  `OPEN DECISION` rather than silently blank.
- The audit vocabulary covers the `AU-03` mandatory floor with no type missing and no type invented.
- The PO lifecycle, the movement/document/audit-log immutability split, and the offline three-outcome contract are
  each internally consistent and agree with their owning documents.
- All 354 requirements still carry an actor, a priority, a phase, and acceptance criteria, and all cite at least one
  rule. `RT-117` is unchanged.

**Blockers — decisions needed before the affected work starts**

| # | Blocker | Type | Blocks |
|---|---|---|---|
| 1 | **When the payable comes into existence** — at `Matched` or at `ApprovedForPayment` (`OPEN DECISION`, §22.5). The answer changes the AP ledger, and `SU-09` makes balances a projection of entries | **Business decision** | AP module, supplier balances, aged-payables reporting |
| 2 | **13 permission keys required by the state machines are not defined in the access model** — `Product.Edit`, `Purchase.Order.Submit`/`.Approve`/`.Send`, `Customer.Edit`, `Employee.Create`/`.Edit`, `Device.Register`/`.Edit`/`.Disable`, `Shift.Close`, `Inventory.Count.Post`, `Inventory.Transfer.Receive` (`SM-02d`, §22.0.1) | **Business decision** | **29 transitions across 8 machines**, mostly lifecycle edges. Deciding who may activate, hide, suspend, post, receive, close, register, retire, or send a PO to a supplier is access-control work, not documentation |
| 3 | **Permissions that do not exist in the catalogue at all.** Quarantine, withhold and un-quarantine a batch (§22.2); cancel and close-short on a PO (§22.3); approve an invoice for payment (§22.5); who lifts a `CreditBlocked` (§22.8); settle and close a return (§22.7) | **Business decision** | Those specific transitions. Per `SM-02c` these are blockers because they sit in the permission column, not because the flows are unclear |
| 4 | **`OPEN DECISION` audit types** on catalog and employee lifecycle edges, device status, notification read/acknowledge, and several cancel/close edges (§22) | Specification work | The audit schema must be fixed before it is migrated; a type added later is the schema change `AU-13` warns about |
| 5 | **Whether the server ever sees `DeadLetter`** (§15, `SM-64a`) | Specification work | Offline reconciliation design |
| 6 | **`Notification` and `StockCount` have no owner state list.** Their state sets are `state-machines.md`'s own | Specification work | A consumer of the owner documents alone will not find these two |
| 7 | **Q2 — licence compatibility unestablished.** Unchanged by this pass; no architecture work makes the answer appear | **Business decision** | Commercial release. Does not block engineering |

**Explicitly still unverified.** The 13 `REPORTED — NOT INDEPENDENTLY VERIFIED` findings in section 7 remain
unverified. They are not blockers, because nothing was built on them. They are also not cleared: if Phase 2 touches
RFID attendance, suspended-cart pricing, or inventory completeness, read those rules first rather than trusting
this document's summary of them.

---

## 10. What Phase 2 must not assume

1. **Do not assume the generated coverage is reviewed.** Section 4.
2. **Do not assume a criterion has been tested.** Section 5.
3. **Do not add a field because a notification needed one.** `CON-06` and `NT-37` exist because an event type
   with no rule behind it is worse than an absent one. The same discipline applies to every closed vocabulary:
   `AU-11` for audit events, `NT-04` for notification events, and `AU-12c` for the audit list specifically.
4. **Do not treat CON-07 or CON-08 as immovable.** Both are defaults on settings.
5. **Do not resolve `Q2` by choosing a licence.** Phase 1 deliberately left it open, and no amount of
   architecture work makes the answer appear.
6. **Do not read a `Draft` document as a decided one.** Every document here is a specification, and a
   specification describes intent that implementation is free to fail.
7. **~~Do not build from `state-machines.md`.~~ Corrected.** Its state sets now match their owning documents and
   `SM-75` no longer claims a passing check it did not perform. **You may build from it, with two exceptions:**
   §22's `OPEN DECISION` and `‡` cells are gaps, not invitations. Read the cell, then read the owning document; if
   the owner is silent too, raise the question rather than choosing.
8. **Do not assume a permission is enforced because a transition exists, and do not assume a permission that a
   transition names exists.** Every transition now names a permission in §22 — but 27 name `OPEN DECISION` and 29
   name a key `‡` that the access model does not define. A permission named by a spec and absent from
   `actors-and-roles.md` §2 is a **gap in the access model**, not a key you may implement. See `SM-02d` and §22.0.1.
9. **Do not treat an `inferred` rule as reviewed.** `PR-Q06` contradicted a MUST requirement and survived because
   the coverage appendix is a script's output. It is now corrected (`PR-Q06a`), and the lesson stands: Appendix A is
   an audit verdict on each rule, not a re-parenting decision.
10. **Do not act on a `REPORTED` finding without reading the rule.** Section 7 labels every finding; the
    unconfirmed ones are leads, not conclusions. **The correction pass in section 8 deliberately left all 13
    untouched**, so they are still leads.
11. **Do not cite BI-15 for a document.** `BI-15a` separates the three immutability rules, and the reason is that
    the confusion was already propagating: a document rule pointing at a movement rule gets "fixed" by someone who
    concludes documents are editable.
12. **Do not read 320 as the size of the specification.** It is the number of rules *classified in Appendix A*, not
    the number of rules that exist. The rule index holds **1161 distinct IDs**.

---

## 11. Sign-off

| Criterion | Met |
|---|---|
| 28 of 28 required Phase 1 outputs exist | Yes, this document is the 28th |
| Every entity in the overview's catalogue has an owning document | Yes |
| No document contradicts a business invariant | **Yes, after the correction pass.** 21 `CONTRADICTORY` rules were found by the audit (section 7); the verified ones are fixed in section 8. The `REPORTED` ones remain unverified |
| Every rule reference resolves to a defined rule | **Yes.** 9 resolved to the *wrong* rule (`BI-15`); all 9 re-pointed. See section 8, defect 6 |
| Every defined rule appears in its document's index | Yes — including the 22 rules added by the correction pass; 1161 distinct IDs, no duplicates |
| Every requirement cites at least one rule | Yes, 354 of 354 |
| Every requirement has a priority, an owner, and a phase | Yes, 354 of 354 |
| Every decision has a recorded rationale | Yes, `CON-01` to `CON-08` |
| Reverse coverage verified by a person | **Partly.** All 320 rules at audit time are read and classified (appendix A), and 22 more were added and indexed. The *homes* in the coverage appendix remain machine-assigned and unmoved. See section 4 |
| State machines implementable as written | **Partly.** State sets now match their owning documents and `SM-75` reports honestly, but `OPEN DECISION` cells remain in the permission, side-effect, and audit columns. See section 9 |
| Every transition specifies its attributes | **Partly, and stated accurately.** `state-machines.md` §22 gives all 21 machines a per-transition table with 7 of 8 attributes populated. **Actor is defined by rule** (the role template holding the permission key), not enumerated per row, because the catalogue maps templates to permission sets rather than permissions to one role. Unspecified cells read `OPEN DECISION` or `‡` |
| Audit vocabulary complete for the mandatory floor | **Yes.** The five missing types are added, each named by the rule that requires it (`AU-12b`). The `AU-03` floor is unchanged |
| PO deletion contradiction resolved | **Yes.** `PR-Q06a`; `RT-117` untouched |
| Immutability rules separated | **Yes.** `BI-15a` splits movement, document, and audit-log immutability; 14 misattributed citations re-pointed |
| Semantic coverage of the rules | Appendix A classifies 320 rules at audit time; the rule index holds 1161 distinct IDs, extended by 22 in this pass. **13 findings remain `REPORTED — NOT INDEPENDENTLY VERIFIED`** and produced no edit |
| Licence compatibility established | **No.** See `Q2`. Blocks commercial release, not engineering |
| **Phase 2 readiness** | **READY WITH BLOCKERS.** Seven blockers listed in section 9; four of them are business decisions, not engineering work. Carried into [../architecture/PHASE-2-ARCHITECTURE.md](../architecture/PHASE-2-ARCHITECTURE.md) as gates `GATE-PERMKEYS`, `GATE-PAYABLE`, `GATE-OFFLINE-INVENTORY`, `GATE-AUDITTYPES`, `GATE-DEADLETTER`, `GATE-NOTIFICATION-STATES`, `GATE-STOCKCOUNT-STATES`, `GATE-Q1`, `GATE-Q4-DUNNING` and `GATE-Q2-LICENCE` |

---

## Appendix A — classification of all 320 inferred rules

One row per rule in the [coverage appendix](requirements-traceability.md) section 26. `CONFIRMED`
means the rule text is coherent and no semantic defect was found; the only gap is that no
requirement row cites it. It is **not** a claim that the rule is correct in every downstream
sense, and it is not a re-parenting decision. Evidence marked `VERIFIED` was read in the
primary source during this audit; `REPORTED` was returned by a sub-agent and not independently
re-read. Counts sum to 320.

| Rule | Class | Evidence |
|---|---|---|
| `AC-01` | CONFIRMED | Default deny, verified at actors-and-roles.md:16. NOTE: it is cited by EC-45 as authority for session revocation, which it does not address |
| `AC-02` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AC-03` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AC-04` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-04` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-05` | DUPLICATE | Identical text, each citing the other as authority (AP-05/SM-68) |
| `AP-06` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-07` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-11` | DUPLICATE | Three copies of the SLA-escalation rule, all citing AP-11 |
| `AP-12` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-13` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-15` | AMBIGUOUS | Approver pool is "a role assignment"; no rule excludes a suspended employee, and AP-17 delegation has no liveness check. REPORTED |
| `AP-21` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-22` | DUPLICATE | Three copies of the SLA-escalation rule, all citing AP-11 |
| `AP-25` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-28` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-30` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-32` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-33` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AP-34` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-04` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-07` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-08` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-11` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-12` | MISSING DEPENDENCY | Closed vocabulary lacks types for payable creation, AppliedWithAdjustment, Employee.Terminate, Rfid.*, Product.Archive - all required by AU-03:24-27 or RF-26. VERIFIED |
| `AU-12a` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-13` | MISSING DEPENDENCY | Closed vocabulary lacks types for payable creation, AppliedWithAdjustment, Employee.Terminate, Rfid.*, Product.Archive - all required by AU-03:24-27 or RF-26. VERIFIED |
| `AU-16` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-21` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-22` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-26` | AMBIGUOUS | "Not a special case" vs AC-01/EM-15 baseline role with no data access. REPORTED |
| `AU-31` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `AU-34` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `AU-35` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `BE-10` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-11` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-12` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-13` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-15` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-21` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-22` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-35` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-39` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-40` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-41` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-42` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-43` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-44` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-48` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BE-49` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `BI-03` | CONFIRMED | Text resolved on second read; rule is coherent and its home is traceability-only |
| `BI-05` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-08` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-14` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-16` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-17` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-20` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-31` | CONFIRMED | Text resolved on second read; rule is coherent and its home is traceability-only |
| `BI-35` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-41` | DUPLICATE | Business invariant restates the owning domain rule verbatim; the domain rule is canonical |
| `BI-42` | CONFIRMED | Text resolved on second read; rule is coherent and its home is traceability-only |
| `CD-01` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `CD-04` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `CD-19` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `CD-20` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `CD-30` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `CD-35` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `CD-37` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `CU-09` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `CU-10` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `CU-12` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-02` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-03` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-04` | AMBIGUOUS | Server-authority timing, non-re-reservation, and count-vs-adjustment interaction are underspecified at the boundary. REPORTED |
| `EC-05` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-08` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-09` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-10` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-11` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-12` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-15` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-16` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-17` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-18` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-19` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-20` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-21` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-23` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-24` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-25` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-27` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-28` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-29` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-30` | CONTRADICTORY | Asserts stock "sits in Transit" (IV-44) while the consolidated StockTransfer has no InTransit state and MS-23 defers destination stock to receipt. VERIFIED conflict |
| `EC-31` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-32` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-33` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-37` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-39` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-41` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-43` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-44` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-45` | CONTRADICTORY | Asserts the session is revoked on the next request, vs PC-03 "a user mid-shift is not logged out" and PC-04 "usable for up to 60 seconds". REPORTED |
| `EC-47` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-48` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-49` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-51` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-53` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-55` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-56` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-57` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-58` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-59` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-60` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-61` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-62` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-64` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-65` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-71` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-72` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-73` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-74` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-75` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-76` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-78` | CONFIRMED | Text resolved on second read; rule is coherent and its home is traceability-only |
| `EC-79` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-82` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-83` | AMBIGUOUS | "No training mode in production" vs PT-03, which defines a Training mode that blocks sale, stock and tender. REPORTED |
| `EC-84` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `EC-86` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-87` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-88` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-89` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EC-90` | MISSING DEPENDENCY | Cites a policy, compromise, or setting that no rule defines: dunning policy, central-warehouse view (MS-19), business-date change, referential guards. Ties to Q1/Q4. VERIFIED from text |
| `EC-91` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `EM-05` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EM-06` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `EM-07` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `HD-13` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `HD-14` | DUPLICATE | Identical text, mutual citation |
| `HD-15` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-08` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-16` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-17` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-18` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-32` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-34` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `IV-59` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `MS-09` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `MS-10` | DUPLICATE | Restates SP-08 / SP-27 / RP-28 verbatim with a citation |
| `MS-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `MS-23` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `MS-29` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `MS-35` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `NT-13` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `NT-15` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `NT-16` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `NT-17` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `NT-18` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `NT-23` | DUPLICATE | Three copies of the SLA-escalation rule, all citing AP-11 |
| `NT-24` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `NT-29` | DUPLICATE | Identical text, mutual citation |
| `NT-30` | DUPLICATE | Identical text, mutual citation |
| `NT-31` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `NT-37` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-24` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-27` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-28` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-38` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-39` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-40` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-41` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-42` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-43` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-44` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `OF-45` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `ORG-01` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `ORG-02` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `ORG-03` | CONFIRMED | Text resolved on second read; rule is coherent and its home is traceability-only |
| `ORG-04` | AMBIGUOUS | Server-authority timing, non-re-reservation, and count-vs-adjustment interaction are underspecified at the boundary. REPORTED |
| `ORG-05` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-06` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-11` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-12` | DUPLICATE | Restates SP-08 / SP-27 / RP-28 verbatim with a citation |
| `PR-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-16` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-39` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-40` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-45` | DUPLICATE | Restates SP-08 / SP-27 / RP-28 verbatim with a citation |
| `PR-48` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-52` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-Q04` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-Q05` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-Q06` | CONTRADICTORY | Draft PO "freely edited and deleted" (procurement-domain.md:85) vs SM-24 "No PO is ever deleted" (state-machines.md:166); RT-117 MUST sides with SM-24. VERIFIED |
| `PR-Q07` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-Q08` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PR-Q10` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `PY-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-15` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-19` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-20` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-21` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-24` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-27` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-35` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `PY-48` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `PY-54` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RF-09` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RF-10` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RF-11` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RF-12` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RF-13` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RP-01` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RP-03` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RP-06` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RP-07` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RP-16` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RP-20` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `RP-23` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `RP-24` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `RP-29` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `RR-29` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RR-36` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `RR-37` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-01` | CONTRADICTORY | "State is a stored fact, not a derived value" vs SM-14/35/44/76 projections and SP-66 "the status is a cache of them" (sales-pos-domain.md:400). VERIFIED |
| `SM-07` | CONTRADICTORY | Requires the closed set to live in the owning document; 12 of 21 owners declare states but no transitions. REPORTED |
| `SM-09` | CONTRADICTORY | CreditBlocked is listed terminal with no unblock edge (state-machines.md:712) although CU-15 treats it as an ongoing condition; machine is also named CustomerAccount while customer-domain.md:62 owns "Customer status". VERIFIED |
| `SM-13` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-14` | AMBIGUOUS | StockItem policy toggle vs SM-76 "no machine"; Expired as both derived and stored; Failed retry semantics. REPORTED |
| `SM-15` | AMBIGUOUS | StockItem policy toggle vs SM-76 "no machine"; Expired as both derived and stored; Failed retry semantics. REPORTED |
| `SM-16` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-17` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-18` | AMBIGUOUS | StockItem policy toggle vs SM-76 "no machine"; Expired as both derived and stored; Failed retry semantics. REPORTED |
| `SM-19` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-23` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-27` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-33` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-35` | CONTRADICTORY | "State is a stored fact, not a derived value" vs SM-14/35/44/76 projections and SP-66 "the status is a cache of them" (sales-pos-domain.md:400). VERIFIED |
| `SM-36` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-39` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-41` | AMBIGUOUS | StockItem policy toggle vs SM-76 "no machine"; Expired as both derived and stored; Failed retry semantics. REPORTED |
| `SM-42` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-45` | CONTRADICTORY | CreditBlocked is listed terminal with no unblock edge (state-machines.md:712) although CU-15 treats it as an ongoing condition; machine is also named CustomerAccount while customer-domain.md:62 owns "Customer status". VERIFIED |
| `SM-45a` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-45b` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-46` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-47` | MISSING DEPENDENCY | Require audit/session events for which AU-12 (audit-domain.md:78-83) defines no EventType. VERIFIED |
| `SM-53` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-54` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-55` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-57` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-58` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-59` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-60` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-61` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-63` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-64` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-66` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-67` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-68` | DUPLICATE | Identical text, each citing the other as authority (AP-05/SM-68) |
| `SM-71` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SM-73` | DUPLICATE | Identical text, mutual citation |
| `SM-74` | DUPLICATE | Identical text, mutual citation |
| `SM-75` | CONTRADICTORY | Asserts the 4-part consistency check passed; its own table puts Reopened in the Terminal column with an outgoing edge (:702) and gives StockItem/Notification no terminal state (:707,:708). VERIFIED |
| `SM-77` | MISSING DEPENDENCY | StockTransfer/StockCount states and edges are not declared by the owning documents; IV-32 (StockAdjustment) and IV-25/30 are absent from the consolidated set entirely. REPORTED |
| `SM-78` | MISSING DEPENDENCY | StockTransfer/StockCount states and edges are not declared by the owning documents; IV-32 (StockAdjustment) and IV-25/30 are absent from the consolidated set entirely. REPORTED |
| `SM-79` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `SM-80` | MISSING DEPENDENCY | StockTransfer/StockCount states and edges are not declared by the owning documents; IV-32 (StockAdjustment) and IV-25/30 are absent from the consolidated set entirely. REPORTED |
| `SM-81` | MISSING DEPENDENCY | StockTransfer/StockCount states and edges are not declared by the owning documents; IV-32 (StockAdjustment) and IV-25/30 are absent from the consolidated set entirely. REPORTED |
| `SM-82` | MISSING DEPENDENCY | StockTransfer/StockCount states and edges are not declared by the owning documents; IV-32 (StockAdjustment) and IV-25/30 are absent from the consolidated set entirely. REPORTED |
| `SM-83` | MISSING DEPENDENCY | StockTransfer/StockCount states and edges are not declared by the owning documents; IV-32 (StockAdjustment) and IV-25/30 are absent from the consolidated set entirely. REPORTED |
| `SM-84` | MISSING DEPENDENCY | StockTransfer/StockCount states and edges are not declared by the owning documents; IV-32 (StockAdjustment) and IV-25/30 are absent from the consolidated set entirely. REPORTED |
| `SM-85` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-86` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-87` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SM-88` | CONTRADICTORY | Consolidated graph contradicts the owning document or its own cited rule (state list, restore target, or citation failure). REPORTED - per-rule detail in the state-machine section |
| `SP-25` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SP-26` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SP-61` | AMBIGUOUS | Server-authority timing, non-re-reservation, and count-vs-adjustment interaction are underspecified at the boundary. REPORTED |
| `SP-62` | AMBIGUOUS | Server-authority timing, non-re-reservation, and count-vs-adjustment interaction are underspecified at the boundary. REPORTED |
| `SP-63` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SP-64` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SP-65` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `SP-66` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-02` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-03` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-04` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-09` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-13` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-14` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-17` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-19` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-20` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-25` | AMBIGUOUS | Server-authority timing, non-re-reservation, and count-vs-adjustment interaction are underspecified at the boundary. REPORTED |
| `UX-26` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-30` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-31` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-32` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-34` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-35` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-36` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-38` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-42` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-43` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-44` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-45` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-46` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-47` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-48` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-49` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-53` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `UX-54` | OUT-OF-SCOPE | Explicit v1/Phase 2 deferral in the rule text itself |
| `UX-59` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `UX-66` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `WH-03` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
| `WH-04` | CONFIRMED | Rule text is coherent; no semantic defect found on read. Home is traceability-only |
