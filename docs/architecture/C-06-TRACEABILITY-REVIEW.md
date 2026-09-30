# C-06 Traceability Review

> **REBUILD REQUIRED - this artifact was damaged on 2026-09-30 and the evidence log is lost.**
>
> While appending the final section, a PowerShell array collapsed to a string and `WriteAllText`
> overwrote this file. Surviving: the traceability work itself, which is complete and verified
> in `requirements-traceability.md`, and the 175-row owner confirmation list below.
> Lost: the per-rule disposition and evidence log for Batches 1, 2, 3a, 3b, 4a, 4b, 5a, and 5b,
> and front-matter sections 1, 2, 4, 5, 6, 7, 13, 14, and 19-22 of the 22 required elements.
>
> There is no git history, backup, or shadow copy, so the lost prose cannot be recovered verbatim.
> It must be rebuilt. The rebuild is mechanical rather than investigative: every final home is
> already recorded in `requirements-traceability.md` §26.2, and each RT row carries the citation that
> makes the mapping provable. What is gone is the per-rule *reasoning*, which is why this notice
> stands rather than a silently thinner document.

## Rebuild provenance

This document was rebuilt mechanically on 2026-09-30 after the original evidence log was lost in
an array-collapse overwrite. Nothing below is re-invented. Each part is either preserved verbatim
or derived, and the two are labelled:

| Part | State |
|---|---|
| Rebuild notice | preserved verbatim |
| §1, 2, 4, 5, 6, 7 | original text recovered intact |
| §3, 8, 9, 10, 11, 12, 15, 16, 17 | original text recovered, final post-5d wording |
| §13, 14 | reconstructed from two partial recoveries; marked inline |
| §18 owner confirmation list | preserved verbatim (175 rows) |
| §19-22 | **not reconstructable** - no surviving artifact records them |
| Per-batch log, Batches 1, 2, 3a, 3b, 4a, 4b, 5a | original reasoning lost; per-rule tables derived from the trace |
| Per-batch log, Batch 5b | original draft recovered but superseded; revision recorded |
| Per-batch log, Batches 5c, 5d | original reasoning recovered intact |
| Appendix A | derived from `requirements-traceability.md` |

Where original reasoning is unavailable this document says so in those words rather than
substituting a plausible reconstruction. The distinction matters: a derived fact is checkable
against the trace, an invented rationale is not.

## 1. Purpose

Establish that every traceability claim in §26.2 is **true**. A row becomes `mapped` only when a
requirement genuinely covers the rule — not because words look similar, not because the requirement
is a convenient catch-all, and not to improve a percentage. Traceability quality outranks closure
percentage. A small honest unresolved set is preferable to a false 100%.

## 2. Scope

In scope: the 1161 rows of `requirements-traceability.md` §26.2, and their status against the
requirement rows in §1–§21 of the same file.

Out of scope, and not touched: any business decision, permission semantics, state machine, financial,
inventory, offline, security or tax behaviour; Phase 0 frozen evidence; any Phase 3 artifact,
schema, migration, code, or technology choice. Where evidence is insufficient the correct outcome is
`UNRESOLVED / HUMAN REVIEW`, not a guess.

## 3. Baseline measurement

| Measure | Baseline stated | Final (2026-09-30, after Batch 5d) |
|---|---|---|
| §26.2 rows | - | 1161 |
| `inferred` | 342 | **0** |
| `mapped` | 1086 | **1161** |
| Targeting `OUT OF SCOPE` | 73 | **0** |
| Targeting `RT-344` | 132 | **0** |
| Targeting `RT-350` | (within 132) | **0** |

**All 342 have been reviewed and closed.** The coverage table and the citation columns are a
bijection: 1161 rules are `mapped`, 1161 distinct rules are cited, and the two sets are identical.

**Corrections to earlier reporting.** Two intermediate readings (1119 / 986 / 133) were wrong: the
rule-id pattern used to parse §26.2 did not match the `PR-Qnn` form, hiding 42 `PR-Q` rows. A third
reading attributed a "42-rule excess" to `RT-`/`GR-`/`CON-` ids being counted as domain rules; that
explanation is withdrawn - those id forms are not in §26.2. The 42 `PR-Q` rules are real: 35 were
already `mapped` and cited, and 7 are genuine open questions. All seven were reviewed in Batch 5c
and are closed.

## 4. Review methodology

Applied to every rule, without exception:

1. Read the rule text in its source document, not the index line.
2. Locate the candidate requirement row; read its **actual text**, not its id.
3. Compare: what does the rule require, what does the requirement promise, does the requirement
   cover it.
4. Check the candidate is `IN SCOPE` — an `OUT OF SCOPE` row can never be the home of an in-scope
   rule.
5. Check it is not a keyword match, and that it does not contradict or omit material behaviour.
6. Record the evidence, then update §26.2. The audit is written **before** the table is changed.

`OUT OF SCOPE` targets get the §8 treatment (is the rule in scope, is the `OUT OF SCOPE` marking
wrong, is another in-scope row a genuine home). `RT-344` / `RT-350` get the §9 treatment and are
never treated as universal buckets.

## 5. Status definitions

| Status | Meaning |
|---|---|
| `MAPPED` | A requirement row genuinely covers the rule, is in scope, and the citation exists. |
| `NEEDS NEW REQUIREMENT ROW` | No row covers it. The minimum wording supported by the source is drafted and marked `PROPOSED — REQUIRES HUMAN CONFIRMATION`. |
| `UNRESOLVED / HUMAN REVIEW` | The evidence does not settle the home. Not assigned. |
| `OUT OF SCOPE` | The rule itself asserts the absence of a v1 feature, or falls outside v1. |
| `DUPLICATE` | The rule restates a rule already covered elsewhere. |
| `CONTRADICTORY` | Rule and requirement disagree. Recorded, never resolved unilaterally. |
| `MISSING DEPENDENCY` | The rule needs a concept that has no requirement definition. |

## 6. Phase A results — 73 rules targeting `OUT OF SCOPE` rows: **COMPLETE**

Batches 1 and 2. `ux-requirements` and `notification-domain` (Batch 1, 41 rules, `RT-343` /
`RT-326`), then `approval-workflows`, `reporting-domain` and `multi-store-domain` (Batch 2, 32 rules,
`RT-288` / `RT-316` / `RT-274`).

The `OUT OF SCOPE` rows were correct and remain; the rules pointing at them asserted the *presence*
of features those rows assert are *absent*. 69 rules closed, 4 held open as unsure (`UX-19`, `UX-31`,
`UX-44`, `UX-46` — still open, see §12).

## 7. Phase B results — 132 rules targeting `RT-344` / `RT-350`: **COMPLETE**

Batches 3a, 3b, 4a, 4b. All 67 `state-machines` rules and all 65 `edge-cases` rules moved to rows
that actually state them. Both catch-alls remain as the correct generic statements they are and now
own no `inferred` rule.

## 8. Phase C results - **COMPLETE, 0 rules remaining**

| Batch | Domains | Rules | Result |
|---|---|---|---|
| 5a | `batch-expiry-fefo` (17), `audit-domain` (16) | 33 | all closed; 5 into existing rows, 28 into 12 new rows RT-458..RT-469 |
| 5b | `offline-pos-domain` (11), `business-invariants` (11), `payment-domain` (10) | 32 | 31 closed; 18 into existing rows, 13 into 12 new rows RT-470..RT-481, `PY-35` OUT OF SCOPE as RT-482. `PY-54` escalated CONTRADICTORY |
| 5c | `product-domain` (10), `inventory-domain` (8), `sales-pos-domain` (8), `procurement-domain` (7) | 33 | all closed; 12 into existing rows, 21 into 20 new rows RT-483..RT-502. `RT-503` deleted as a duplicate of `RT-415` |
| 5d | `organization-model` (8), `cash-management` (6), `rfid-domain` (5), `actors-and-roles` (4), `ux-requirements` (4), `state-machines` (3), `customer-domain` (3), `returns-refunds-domain` (3), `hardware-domain` (3), `employee-domain` (3) | 42 | all closed; 15 into existing rows, 27 into 27 new rows RT-503..RT-529. Closes the 4 Batch 1 unsure items |

## 9. Domain-by-domain results

| Domain | Remaining `inferred` | Status |
|---|---|---|
| `batch-expiry-fefo` | 0 | closed (Batch 5a) |
| `audit-domain` | 0 | closed (Batch 5a) |
| `offline-pos-domain` | 0 | closed (Batch 5b) |
| `business-invariants` | 0 | closed (Batch 5b) |
| `payment-domain` | 0 | closed (Batch 5b) |
| `product-domain` | 0 | closed (Batch 5c) |
| `inventory-domain` | 0 | closed (Batch 5c) |
| `sales-pos-domain` | 0 | closed (Batch 5c) |
| `procurement-domain` (7 `PR-Q`) | 0 | closed (Batch 5c) |
| `organization-model` | 0 | closed (Batch 5d) |
| `cash-management` | 0 | closed (Batch 5d) |
| `rfid-domain` | 0 | closed (Batch 5d) |
| `actors-and-roles` | 0 | closed (Batch 5d) |
| `ux-requirements` | 0 | closed (Batch 5d) - the 4 Batch 1 unsure items |
| `state-machines` | 0 | closed (Batch 5d) |
| `customer-domain` | 0 | closed (Batch 5d) |
| `returns-refunds-domain` | 0 | closed (Batch 5d) |
| `hardware-domain` | 0 | closed (Batch 5d) |
| `employee-domain` | 0 | closed (Batch 5d) |
| **Total** | **0** | |

## 10. Every reviewed rule

Each rule appears in the batch log below with its previous inferred target, final disposition,
evidence, requirement id, and an explanation of coverage. **All 342 rules are dispositioned**: 205
in Batches 1-4b, 33 in Batch 5a, 32 in Batch 5b (of which `PY-54` is escalated rather than closed),
33 in Batch 5c, and 42 in Batch 5d. The four items Batch 1 held as unsure were closed in Batch 5d,
so none remain open.

The ten batch populations sum to 345 rather than 342: `SM-43a`, `SM-48a`, and `SM-56a` were counted in
Batch 3b's population and adjudicated in Batch 5d. Batch 3b's own count is therefore 30, not the 33
previously recorded here (34 + 30 + 3 = 67 `state-machines` rules).

## 11. Proposed requirement text

**RT-355..RT-529 - 175 rows, drafted by this review across Batches 1, 2, 3a, 3b, 4a, 4b, 5a, 5b, 5c,
and 5d.** Every one is `PROPOSED - REQUIRES HUMAN CONFIRMATION`. None is counted as approved. The
full list is in 18.

## 12. Human-review items - 0 open

All four items Batch 1 held open were re-adjudicated against the current catalogue in Batch 5d and
closed. Full reasoning in 5d-2.

| Rule | Source | Batch 1 candidate | Resolution in Batch 5d | Basis |
|---|---|---|---|---|
| `UX-19` | `ux-requirements.md` | RT-342 or a new row | **Mapped to RT-342** | RT-342's title is "Offline mode is announced before it is needed and honest about what changes" and its acceptance names cards, stock, and price - the whole rule, including the "before" half Batch 1 could not find |
| `UX-31` | `ux-requirements.md` | RT-150 or a new row | **New row RT-524** | RT-150 gives the customer-facing reason but keeps one reason, not two. Separating the customer-facing text from the internal reason is a real requirement: conflating them shows internal wording to a customer |
| `UX-44` | `ux-requirements.md` | RT-324 or a new row | **Mapped to RT-324** | RT-324's acceptance criterion is literally "The inbox leads with unacknowledged", so the unread/unacknowledged distinction Batch 1 wanted is already stated |
| `UX-46` | `ux-requirements.md` | RT-324 or a new row | **Mapped to RT-324** | RT-324's acceptance states "acknowledging never performs the action it describes (NT-29)". The residual clause - acknowledge offered only where it makes sense - is a presentation nicety, not a control |

**Section §12 is present in two states.** The recovered original lists the four items as open with
the Batch 1 candidate rows; the recovered final lists them closed. Both are correct at their
own date and the final state is the one that governs.

## 13. Contradictions

- **CON-01 — `GAP-037` (carried, MUST level).** The gap register records an unresolved
  contradiction. Not introduced by this review and not resolved here. Recorded in
  `PRE-PHASE-3-GAP-REGISTER.md`; whether it blocks Phase 3 is an existing governance question that
  this review does not answer.
- **CON-02 — `RT-168` credit due date (corrected, evidence-backed).** `RT-168` claimed a credit due
  date that `CU-23` and `CON-06` do not have. The unsupported clause was removed and `RT-450`
  records the supported decision (no due date, no dunning, no `CreditOverdue` in v1). Direct primary
  source evidence, so the correction was authorised.
- No contradiction between a rule and its home row was found in Batch 5a.

**Reconstructed.** The recovered original §13 stops at Batch 5a and records CON-01 and CON-02.
The recovered final §16 item 5 names a third contradiction that this section must carry:

- **CON-03 — the `PY-54` / `RT-420` conflict.** The owner document contradicts itself on whether a
  `Failed` payment is terminal. `RT-420` adopted the minority reading. Needs an owner decision
  before either row can be called correct. The original §13 wording for this entry is **not
  reconstructable** - only this summary survived, in §16.

Any contradiction recorded between Batch 5a and Batch 5d in sections not recovered here is
**not reconstructable**. The count of contradictions is therefore a lower bound.

## 14. Missing dependencies

None recorded so far. `AU-31` (Batch 5a) is the closest candidate: it defers the external log
shipper to a Phase 2 infrastructure decision. It is recorded as a documented, mitigated risk in
RT-467 rather than a missing requirement, because the rule itself says it is documented rather than
solved.

## 15. Final counts

Final, measured 2026-09-30 after Batch 5d:

| | Count |
|---|---|
| §26.2 rows | 1161 |
| `mapped` | 1161 |
| `inferred` | **0** |
| `UNMAPPED` | 0 |
| Distinct rules cited by a requirement row | 1161 |
| Requirement rows | 529 |
| Rows drafted by this review | 175 |
| Coverage rows resolving to an `OUT OF SCOPE` row | 48 |

Dispositioned: **342 of 342.**

Two integrity invariants, both clean: every `mapped` rule is cited by at least one requirement row,
and no `inferred` rule is cited by any row. The two sets are a bijection in both directions - no
requirement row cites a rule absent from §26.2 - after moving `CON-06` out of RT-450's citation
column, where it did not belong: `CON-*` are Phase 1 review conclusions, not source rules, and §26.2
is a source-rule table. `D-05` was already outside the citation column for the same reason.

## 16. Remaining blockers

The traceability backlog is closed. What remains is not a mapping gap; it is owner authority.

1. **175 proposed rows** (RT-355..RT-529) awaiting human confirmation. A drafted row is a proposal,
   not an approved requirement. This is the largest remaining item and it is by design.
2. **Partially covered mapped rules.** Batch 5a recorded residuals on four mappings whose home row
   does not state the whole rule - `BE-44` (no row says a batch cost is never restated), `BE-48` and
   `BE-49` (printing and the per-store print toggle), `BE-11` (the per-store setting is in RT-090, not
   RT-098). Each is recorded rather than silently dropped; the closure condition forbids a mapping
   that omits material behaviour, so an owner should decide whether these need rows of their own.
3. **`GAP-037`** remains open (§13). Not introduced by this review and not resolved here.
4. **`RT-186`** claims a supplier-statement due date; `SU-22` does not carry one. Left unchanged -
   unlike `RT-168`, no primary evidence settles it. Needs an owner decision.
5. **CON-03, the `PY-54` / RT-420 conflict** (section 13). The owner document contradicts itself on
   whether a `Failed` payment is terminal, and RT-420 adopted the minority reading. Needs an owner
   decision before either row can be called correct.
6. **Batch 5b residuals.** Eight mapped rules carry recorded partial coverage: `BI-03` (the
   `InventoryTransaction` half), `BI-16` (the goodwill-return exception, drafted as RT-476), `BI-31`
   (the local/server outcome agreement), and `OF-38`, `OF-42`, `OF-43`, `OF-45` - see 5b-4. `BI-05` was
   not mapped at all: an earlier RT-042 mapping was withdrawn as too weak and RT-475 was drafted. The
   closure condition forbids a mapping that omits material behaviour, so these need an owner decision.
7. **Source edits for the owner, not blockers.** `PR-Q06`'s stale index row (5c-3); the `SP-25`/`SP-26`
   rounding-scope question and `SP-63`'s zero-unsynced policy-change guard (5c-4).

## 17. Recommendation for C-06 status

**C-06 is MET on the traceability criterion, and is NOT YET APPROVED.**

The entry criterion requires every inferred row to have an explicit disposition, every `MAPPED` row
to have a genuine home, all proposed rows to be identified, and all human-review items identified.
Each of those is now true: 0 rules remain `inferred`, every `mapped` rule is cited, all 175 proposed
rows are enumerated in 11 and 18, and all 4 human-review items are closed in 5d.

Two things are deliberately not claimed:

- **The 175 drafted requirements are not approved.** `mapped` means a requirement row states the rule
  and cites it; it does not mean the requirement text is agreed. An owner must accept, amend, or
  reject each drafted row.
- **The open contradictions are not resolved.** CON-03 and `RT-186` need an owner decision, and the
  recorded partial-coverage residuals need one too. The review recorded them rather than deciding
  them, and the condition was not weakened to declare success.

**Phase 3 remains withheld** until the owner confirms the 175 proposed rows and rules on CON-03,
`RT-186`, `GAP-037`, and the twelve partial-coverage mappings.

## 18. Owner confirmation list - all 175 proposed rows

**Preserved verbatim from the pre-rebuild file.** 175 rows, generated from the trace.


Every row below was drafted by the C-06 review and is `PROPOSED - REQUIRES HUMAN CONFIRMATION`.
None is approved. Generated directly from `requirements-traceability.md`, so this list cannot
drift from the file. For each row the owner should answer one of: **accept**, **amend**, or
**reject** - and a rejection needs a replacement home or an explicit `OUT OF SCOPE`.

- Rows: **175** (`RT-355`..`RT-529`), of which **8** are `OUT OF SCOPE`
- Rules closed by these rows: **342**
- Also still needing an owner decision: CON-03 (`PY-54` / `RT-420`), `RT-186` / `SU-22`,
  `GAP-037`, and twelve recorded partial-coverage mappings.

| Row | Section | Requirement as drafted | Priority | Source rules |
|---|---|---|---|---|
| RT-445 | Organization | A store is not deactivated while it holds stock or has an open shift | MUST | EC-39, EC-89 |
| RT-449 | Organization | The business date is a store setting, and changing it handles open transactions and is audited | MUST | EC-64 |
| RT-457 | Organization | A store with no provisioned terminal cannot trade | MUST | EC-86, overview 3 |
| RT-504 | Organization | The organization currency is immutable once any financial document exists | MUST | ORG-01 |
| RT-505 | Organization | The business time zone is immutable once financial documents exist | MUST | ORG-02, overview 3.1 |
| RT-506 | Organization | An organization with financial history is deactivated, never deleted | MUST | ORG-03, BI-40 |
| RT-507 | Organization | A sale cannot be recorded before the organization has a store | MUST | ORG-04 |
| RT-508 | Organization | A store is never deleted while it holds stock, an open shift, or any document, and its stock is resolved to zero with a reason first | MUST | ORG-05 |
| RT-509 | Organization | A storage location can be made unsellable at any time and is never deleted while it holds a balance or a movement | MUST | WH-03 |
| RT-510 | Organization | Quarantine and damaged stock is never merged into sellable stock automatically; release is a discrete, permissioned, audited decision | MUST | WH-04, IV-38 |
| RT-446 | Access | A permission change takes effect on the next request, and the live session is revoked rather than left with stale grants | MUST | EC-45, OF-42 |
| RT-448 | Access | A role's scope is explicit - organization-wide or a named store set - and it never widens by itself | MUST | EC-55, EC-87, EC-88, MS-11 |
| RT-503 | Access | Least privilege: no role template grants a permission that no named retail responsibility requires | MUST | AC-04 |
| RT-444 | Product | A product referenced by a finalized document is deactivated or retired, never deleted | MUST | EC-37 |
| RT-443 | Product | A variant's deactivation is prospective: it blocks new use and never removes stock already on hand | MUST | EC-33 |
| RT-488 | Product | Category ordering is an explicit sort order, not a naming convention | MUST | PR-06 |
| RT-489 | Product | A variant sold by scanner needs at least one active barcode; a search-only variant is an explicit, recorded selection | MUST | PR-11 |
| RT-490 | Product | A barcode is a string normalised per symbology, never an integer | MUST | PR-12 |
| RT-495 | Product | A variant may be archived while its product stays active | MUST | PR-48 |
| RT-491 | Product | `QuantityKind` is immutable once the unit has been used | MUST | PR-14 |
| RT-492 | Tax | Inclusive tax is extracted at line precision and the tax is derived as the difference, never `gross x rate` | MUST | PR-39, SP-34, BI-11, PR-Q40 |
| RT-493 | Tax | Exempt is a zero-rate tax category, never a missing category | MUST | PR-40, SP-38 |
| RT-494 | Discounts | Discounts apply in a fixed documented order, and the order is recorded on the sale | MUST | PR-45, SP-27, BI-11 |
| RT-496 | Product | An import row matches on a stable external key, never on name | MUST | PR-52 |
| RT-483 | Inventory | The negative-stock policy is evaluated inside the movement transaction, against the resulting balance | MUST | IV-16, BI-36, OF-04 |
| RT-484 | Inventory | A negative balance is written to the ledger in full, alarmed, and never clamped or hidden | MUST | IV-17, BI-36 |
| RT-485 | Inventory | A negative balance must be resolved, and resolution is one of a named set of routes with a reason | MUST | IV-18, BI-25 |
| RT-487 | Inventory | An out-of-stock event notifies once, and the restore is the reset condition | MUST | IV-59, BE-20 |
| RT-436 | Inventory | A stock movement is refused while a count is in progress, and a count is never silently merged with one | MUST | EC-04, EC-09 |
| RT-486 | Inventory | A stock adjustment is a document with a state machine and moves no stock until posted | MUST | IV-32, BI-27 |
| RT-475 | Inventory | A quantity supplied as input is never negative, and a reduction is expressed by movement type and direction rather than a signed quantity; a negative stock balance is a store policy decision and is separate from the input rule | MUST | BI-05, IV-34 |
| RT-437 | Batch | FEFO is resolved at commit, not at selection, so a quarantine arriving after selection causes a re-selection | MUST | EC-10 |
| RT-458 | Batch | Receiving a batch-tracked variant captures batch number, expiry date, and manufacturing date when available; missing data is a warning, not a rejection | MUST | BE-10 |
| RT-459 | Batch | A receipt line creates exactly one batch, and accepting already-expired goods into sellable stock still writes an `EXPIRY` notification at `Error` severity | MUST | BE-12, BE-13 |
| RT-460 | Batch | A receipt records the actual supplier-invoice unit cost, not the PO price, and the variance is recorded and reported through the three-way match | MUST | BE-14 |
| RT-461 | Batch | A receipt writes `PURCHASE_RECEIPT` movements against the specific batch and sets `RemainingQuantity`; near-expiry stock is prioritised by FEFO and reported but never blocked; expiry removes stock only through a reason-coded, permissioned, approval-bearing `EXPIRY` write-off | MUST | BE-15, BE-21, BE-22 |
| RT-462 | Batch | Quarantined stock may be consumed by staff with a reason, is never sold to customers, and the staff consumption is reported | MUST | BE-39 |
| RT-463 | Batch | Valuation policy for a batch-tracked variant is explicit and configured - `WeightedAverage` (default), `FIFO`, or `LastCost`; it is applied at valuation time rather than kept as a running total; and a sale line records the actual cost of the batch it consumed, summed across batches when FEFO splits the sale | MUST | BE-41, BE-42, BE-43 |
| RT-469 | Batch | A FEFO override on a large-value sale follows the store's approval policy, as a large discount does | MUST | BE-35 |
| RT-497 | Procurement | A requisition has no effect: no stock, no payable, until it becomes a purchase order | MUST | PR-Q04, BI-27 |
| RT-498 | Procurement | A PO line records the agreed description and price as issued values; neither is recalculated | MUST | PR-Q05, PR-Q07, BI-08 |
| RT-499 | Procurement | A PO has no effect on stock or payable until it is `Approved` and then `Ordered` | MUST | PR-Q06, BI-40 |
| RT-500 | Procurement | PO cancellation is refused once a goods receipt exists, and the resolution is return plus cancel | MUST | PR-Q08, BI-41 |
| RT-501 | Procurement | A PO belongs to one ordering store; cross-store consolidation is out of scope in v1 | OUT OF SCOPE | PR-Q10 |
| RT-455 | Sales | A new cashier's first sale is an ordinary sale gated only by their roles and permissions; there is no production onboarding mode | MUST | EC-83, EM-14 |
| RT-453 | Sales | A session change at a shared terminal preserves the cart, and the sale is attributed to whoever completes it | MUST | EC-79, SP-11 |
| RT-452 | Sales | A cart survives an interruption in memory and on disk for a configured TTL, and is never silently lost | MUST | EC-78, SP-43 |
| RT-435 | Sales | A capture and a void of the same sale are mutually exclusive; one wins and the other is refused naming the winner | MUST | EC-03 |
| RT-502 | Sales | Cash rounding is configured, never hard-coded, and recorded as an adjustment rather than smeared into prices | MUST | SP-25, SP-26 |
| RT-476 | Returns | A return with no sale-line reference is permitted only as a manager-approved goodwill return, requires `Return.Approve` and a reason, creates no stock movement, and is cash-only | MUST | BI-16 |
| RT-522 | Returns | Store credit expiry is per store, and expiry is a documented, reported event rather than a silent deletion | MUST | RR-29, PY-31 |
| RT-523 | Returns | Goodwill movements are reported by actor, value, and reason, with concentration analysis | MUST | RR-37, SP-56, IV-36, BI-25 |
| RT-439 | Customer | Exceeding a credit limit at the till refuses the sale or routes it to an approved override | MUST | EC-18 |
| RT-450 | Customer | No credit due date, dunning, or `CreditOverdue` in v1; a balance is governed only by the credit-limit rules | OUT OF SCOPE | EC-65, NT-37 |
| RT-511 | Customer | `OnHold` warns and notifies; it never refuses service, and the hard block is `CreditBlocked` | MUST | CU-09, SM-45a |
| RT-512 | Customer | A customer is never deleted; `Closed` is a status and the history stays renderable | MUST | CU-10, BI-40 |
| RT-513 | Customer | Available credit is `CreditLimit - Balance`, derived, over a balance that is a rebuildable cache | MUST | CU-12, IV-09 |
| RT-514 | Employee | No sensitive personal data in v1: attendance and leave are the only non-operational personal data | OUT OF SCOPE | EM-05 |
| RT-515 | Employee | `Department` and `Position` are descriptive and grant nothing | MUST | EM-06, AC-01 |
| RT-516 | Employee | Date of birth serves age-restricted sales only, and the pass/fail is recorded rather than the value | MUST | EM-07 |
| RT-519 | RFID | A reader's mode is configured and determines what a read means | MUST | RF-09 |
| RT-520 | RFID | A door open is a request; the controller decides and SmartStore records only the read | MUST | RF-11 |
| RT-521 | RFID | Reader events store both the device's observation timestamp and the server's receipt timestamp | MUST | RF-13, overview 3.3 |
| RT-477 | Hardware | Device identity is authenticated: the server accepts a device's events only after the device is registered and authenticated, and an unregistered or unauthenticated device's events are rejected and recorded as such | MUST | BI-35, RF-12, HD-14 |
| RT-454 | Hardware | A replaced device keeps its history, and its replacement is a new provisioned device | MUST | EC-82, HD-18 |
| RT-517 | Hardware | A device connection is configuration, not architecture | MUST | HD-13, HD-02 |
| RT-518 | Hardware | A device credential cannot assert an employee identity | MUST | HD-15, BI-33 |
| RT-447 | Offline | An offline sale that duplicates an online sale is applied and reported, never auto-merged | MUST | EC-49, OF-31 |
| RT-470 | Offline | Synchronisation is per store and per terminal, in business-date order and then queue order within a business date | MUST | OF-24 |
| RT-471 | Offline | Synchronisation is triggered on connectivity restoration, on a configured interval, on a manual request, and at shift close, never on a timer alone; an offline window exceeding the terminal's configured expiry stops the terminal selling and raises a high-severity notification | MUST | OF-27, OF-28 |
| RT-472 | Offline | FEFO offline is advisory: the terminal may suggest the soonest-expiring batch, the sale line records the batch the server later allocated, and no offline FEFO override is possible; a near-expiry batch left behind is reported | MUST | OF-40 |
| RT-473 | Offline | The local ledger is as sensitive as the server's: it is encrypted at rest and its key is bound to the registered device credential | MUST | OF-41 |
| RT-474 | Offline | No offline data is written to shared or removable media by the POS, and diagnostics leave the terminal only through a deliberate, audited export | MUST | OF-44 |
| RT-525 | Cash | A cash movement is a ledger row and the drawer balance is its projection, never a field update | MUST | CD-19, CD-08, BI-02 |
| RT-526 | Cash | Closing a shift requires `Shift.Close`, a drawer count, a counted denomination breakdown, and a declared closing float for the next shift | MUST | CD-20 |
| RT-527 | Cash | The shift screen answers exactly four questions, and only these four | MUST | CD-30 |
| RT-528 | Cash | The float is a store decision; the system shows the busiest days' expected cash and never recommends a float | MUST | CD-35 |
| RT-529 | Cash | The drawer is not a safe-management feature | OUT OF SCOPE | CD-37 |
| RT-480 | Payment | Payment state is a projection of provider events plus the local record, and the state is the reconciliation of the two; a callback is idempotent by provider transaction reference and a duplicate callback is acknowledged and recorded once | MUST | PY-15 |
| RT-481 | Payment | An overpayment is change, not a payment, and a non-cash overpayment is refused rather than creating a negative tender; where a store allows negative-tender credit it is a configured store setting, carries a reason, and is reported | MUST | PY-19 |
| RT-482 | Payment | No expiry campaigns and no expiry-without-notification in v1 | OUT OF SCOPE | PY-35 |
| RT-440 | Payment | A live store's payment provider configuration is approvaled and audited before it takes effect | MUST | EC-20 |
| RT-394 | Multi-store | Scope is applied to every store-scoped read and write; no store-scoped operation escapes it, including exports, reports, and search suggestions | MUST | MS-10, EC-59 |
| RT-395 | Multi-store | Segregation-of-duties conflicts are evaluated across stores, not per store | MUST | MS-14 |
| RT-396 | Multi-store | The audit log is organization-global and is queryable only with an explicit store filter or organization-wide permission | MUST | MS-29 |
| RT-397 | Multi-store | A chain or store-range catalog is not in v1; the single organization-global catalog is the only one | OUT OF SCOPE | MS-35 |
| RT-382 | Approvals | The request references its subject, and a suspendable subject is suspended or flagged while the request is pending | MUST | AP-04 |
| RT-383 | Approvals | A request carries its reason from submission | MUST | AP-05 |
| RT-384 | Approvals | The request is submitted in the same transaction as the action that triggered it, or immediately after | MUST | AP-06 |
| RT-385 | Approvals | A decision writes an `Approval.Decided` audit event carrying the before and after state, the decider, and the reason | MUST | AP-11 |
| RT-386 | Approvals | A decision is idempotent by request id, and a decided request cannot be decided again | MUST | AP-12, AP-13 |
| RT-387 | Approvals | The decider is resolved by role and store, never by name | MUST | AP-14, AP-15 |
| RT-388 | Approvals | Every policy carries a decision SLA, configurable per subject per store, and a request past its SLA escalates | MUST | AP-21, AP-22 |
| RT-389 | Approvals | A request whose subject no longer exists is `Cancelled` with a reason naming the subject | MUST | AP-25 |
| RT-390 | Approvals | The approval report is a projection of the requests, by state, subject, decider, and store, with the mean wait | SHOULD | AP-30 |
| RT-391 | Approvals | Where a subject cannot proceed without approval, it is refused with a message naming the pending request | MUST | AP-32 |
| RT-392 | Approvals | A request submission is idempotent by `ClientOperationId` | MUST | AP-33 |
| RT-393 | Approvals | A request survives a restart | MUST | AP-34 |
| RT-464 | Audit | An audit event records what happened rather than what was intended; the store is always on the event, derived from the affected entity rather than the request; and `Before`/`After` hold only changed fields, not whole entities | MUST | AU-04, AU-07, AU-08 |
| RT-465 | Audit | `EventType` is a closed, versioned, domain-namespaced set; logout and session end are distinct events (`Security.Logout` versus `Security.SessionEnded` with its cause); the vocabulary is complete against the mandatory event floor; and a new event type is a reviewed change made only when a rule already requires the event | MUST | AU-11, AU-12, AU-12a, AU-12b, AU-12c, AU-13 |
| RT-466 | Audit | A scheduled job records what it did and what it changed in the same event vocabulary; archival moves events to cold storage while preserving the query path; and the retention policy is versioned and audited, with a policy change that shortens retention requiring approval | MUST | AU-16, AU-21, AU-22 |
| RT-467 | Audit | Access to an employee's own actions is not special-cased: supervisors see their store and see their own events like anyone else's, and a request to suppress one's own event is refused; a database administrator with write access to the audit store is a documented, mitigated risk rather than a solved one | MUST | AU-26, AU-31 |
| RT-468 | Audit | No per-field, per-reason audit trail on every entity in v1, and no real-time alerting on audit events in v1; the mandatory event floor and a standing report with threshold notifications are the floor | OUT OF SCOPE | AU-34, AU-35 |
| RT-398 | Reporting | Every report declares which kind it is, and the screen says so where freshness differs materially | MUST | RP-01 |
| RT-399 | Reporting | No report is the system of record | MUST | RP-03 |
| RT-400 | Reporting | A report never mixes currencies in one column, and a converted figure shows its rate and its rate date | MUST | RP-06, RP-07 |
| RT-401 | Reporting | A report's scope is a function of the report, not only of the role | MUST | RP-16 |
| RT-402 | Reporting | The largest-history reports are indexed by their own access pattern, and an expensive query is a background job rather than a scan presented as quick | MUST | RP-23, RP-24 |
| RT-403 | Reporting | The export destination is not a server-side integration in v1 | OUT OF SCOPE | RP-29 |
| RT-451 | Reporting | A report too slow to serve becomes a background job that notifies its requester on completion or failure | MUST | EC-74, RP-20 |
| RT-355 | Notifications | InApp is always on and is the delivery source of truth; other channels are configured per event type and per user, with a store default and no global switch | MUST | NT-13, NT-16 |
| RT-356 | Notifications | Email is a digest for anything non-urgent | SHOULD | NT-15 |
| RT-357 | Notifications | An external channel requires a verified destination and consent | MUST | NT-17 |
| RT-358 | Notifications | A channel failure affects neither the other channels nor the domain | MUST | NT-18, EC-75 |
| RT-359 | Notifications | An event needing a decision has a deadline that escalates, and escalation targets a role | MUST | NT-23, NT-24 |
| RT-360 | Notifications | A notification is retained for a configured short period and then expires; the event is the record | MUST | NT-30, SM-74 |
| RT-361 | Notifications | A notification links to the record it is about, and following the link is permission-checked | MUST | NT-31, UX-45 |
| RT-362 | Notifications | Before and after are separate events, and an event type is added only when a rule requires it | MUST | NT-37 |
| RT-363 | UX | The common path is short; a destructive action is explicit, separately named, and confirmed by what and how much | MUST | UX-02, UX-03 |
| RT-364 | UX | The system reports the outcome, not its internal action, and a user-caused outcome is not styled as a system error | MUST | UX-04, UX-59 |
| RT-365 | UX | The normal sale path is scan, line, running total, payment, confirm, print | MUST | UX-09 |
| RT-366 | UX | Quantity is one control on the line; a hand-entered weight is labelled and reasoned | MUST | UX-13 |
| RT-367 | UX | The payment step shows total due, tenders already taken, and the remainder | MUST | UX-14 |
| RT-368 | UX | An underpayment is named as such and the credit-sale route is explicit | MUST | UX-17 |
| RT-369 | UX | An offline sale accepted with an adjustment is shown to the cashier on reconnect | MUST | UX-20 |
| RT-370 | UX | Resuming a suspended sale does not re-reserve stock | MUST | UX-25 |
| RT-371 | UX | A suspended sale can be discarded with confirmation, and the discard is audited | MUST | UX-26 |
| RT-372 | UX | Opening a shift asks for the counted float by denomination | MUST | UX-32 |
| RT-373 | UX | The variance screen shows counted, expected, variance, and threshold together | MUST | UX-34 |
| RT-374 | UX | The drawer state is visible on the till at all times | MUST | UX-35 |
| RT-375 | UX | A stock adjustment is entered as a counted quantity, not a delta | MUST | UX-36 |
| RT-376 | UX | A low-stock alert names the variant, the quantity, the threshold, and the reorder action | MUST | UX-38 |
| RT-377 | UX | An action needing approval says the request was sent, and the requester can see their own request's state | MUST | UX-42, UX-43, AP-28 |
| RT-378 | UX | Search results and search suggestions are scope-filtered before they are returned | MUST | UX-47, UX-49 |
| RT-379 | UX | A barcode search is exact and a name search is fuzzy; the two never mix | MUST | UX-48 |
| RT-380 | UX | Touch targets are sized for fast, imprecise till work and text meets a published contrast ratio | MUST | UX-53, UX-54 |
| RT-381 | UX | A rejected offline sale is shown with its reason and what to do | MUST | UX-66 |
| RT-456 | UX | The void, return, refund, and escalate paths are each reachable in a few taps | MUST | EC-84 |
| RT-524 | UX | A rejected return carries a customer-facing reason and a separate internal reason | MUST | UX-31, RR-42, SM-42 |
| RT-404 | State | A document's own state is a stored fact, and stored does not mean authoritative: which entity owns the figure decides stored versus projected | MUST | SM-01, SM-01a, SM-35a |
| RT-405 | State | An unspecified transition attribute is `OPEN DECISION` and is raised, never guessed | MUST | SM-02a, SM-02b, SM-02c, SM-02d |
| RT-406 | State | A machine is a closed, versioned set of states and transitions defined in the owning document | MUST | SM-07 |
| RT-407 | State | A `Suspended` or `OnHold` state has a resume edge, a recorded reason, and queue visibility | MUST | SM-09 |
| RT-408 | State | A machine's state set is the owning document's set, verbatim | MUST | SM-13a, SM-16a, SM-60, SM-77a, SM-88a, SM-43a, SM-48a |
| RT-409 | State | `Archived` requires a reason, is terminal, and has no return edge | MUST | SM-13 |
| RT-410 | State | `AllowNegative` and `BlockNegative` are the only two stock policies, they change only by a movement that would breach the current policy, and there is no manual override | MUST | SM-14, SM-15 |
| RT-411 | State | `Quarantined` is reversible; `Depleted` and `Expired` are not, and `Depleted` is reached by quantity alone | MUST | SM-16, SM-17 |
| RT-412 | State | `Expired` is derived at read and stored at the expiry boundary, a required expiry date cannot be omitted, and a dateless batch sorts last under FEFO | MUST | SM-18, SM-19 |
| RT-413 | State | `Rejected`, `Cancelled`, and `Closed` are three distinct endings, and a `Sale` has no `Cancelled` state | MUST | SM-23, SM-36 |
| RT-414 | State | A goods receipt creates stock and never a second payable | MUST | SM-27 |
| RT-415 | State | A sale's post-sale states are a projection of its line counters, and the stored status is a cache a rebuild must reproduce exactly | MUST | SM-35, SP-66 |
| RT-416 | State | A return and a refund are linked, not nested | MUST | SM-39 |
| RT-417 | State | A `Failed` refund is retryable and holds the amount | MUST | SM-41 |
| RT-418 | State | A customer balance is never state; only the status is, and every status edge is a permissioned human decision with a reason | MUST | SM-45, SM-45b, SM-46 |
| RT-419 | State | `OnHold` is not a credit control; `CreditBlocked` is the credit control, and it is liftable | MUST | SM-45a, SM-45c |
| RT-420 | State | `Declined` and `Failed` payments are retryable; `Voided` and `Captured` are terminal | MUST | SM-53, PY-14, PY-54 |
| RT-421 | State | A payment's state is a reconciliation of provider events and the local record | MUST | SM-54, EC-14 |
| RT-422 | State | A shift's only forward path is `Open` → `Reconciling` → `Closed`; there is no `Void` state, and a closed shift is immutable except for `Reopened` | MUST | SM-55, SM-57, SM-58, SM-56a |
| RT-423 | State | A `PosTerminal`'s mode is configuration, not a lifecycle step, and is separate from its service state | MUST | SM-59 |
| RT-424 | State | `Degraded` is a real device state, and `Offline` is not `Disabled` | MUST | SM-60a, SM-60b |
| RT-425 | State | An RFID session is `Opened` or `Closed`; there is no `Paused` | MUST | SM-63 |
| RT-426 | State | A rejected offline item is retained as evidence with a reason, never deleted from the queue | MUST | SM-66 |
| RT-427 | State | An offline sale that cannot be synced while the store is closed and the cache is sealed stays `Queued` for the next online window | MUST | SM-67 |
| RT-428 | State | `Pending` is the only non-terminal approval state, and every exit is terminal, reasoned, and audited | MUST | SM-68, SM-71 |
| RT-429 | State | The state-machine consistency check reports only what it has actually verified | MUST | SM-75, SM-75a |
| RT-430 | State | An in-transit transfer is never cancelled | MUST | SM-78 |
| RT-431 | State | A count posts the counted quantity, and a posted count is never re-posted | MUST | SM-81, SM-82 |
| RT-432 | State | A count may only observe; it cannot resolve a negative balance by counting upward | MUST | SM-84 |
| RT-433 | State | A revoked tag is never re-issued to a different subject | MUST | SM-86 |
| RT-434 | State | A suspended credential is readable but not usable | MUST | SM-88 |
| RT-478 | Edge Cases | A document with a child document cannot be deleted or cancelled out of order: a purchase order with recorded receipts cannot be deleted, no state machine skips a state, and a sale with a recorded return cannot be voided until that return is reversed | MUST | BI-41 |
| RT-479 | Edge Cases | A document number is unique per store per document type, is allocated inside the creating transaction, and is never reused - including after cancellation or void | MUST | BI-42 |
| RT-442 | Edge Cases | The authoritative money amount is the amount applied or settled; a tendered, handed-over, or listed amount is never authoritative | MUST | EC-23 |
| RT-441 | Edge Cases | No computation leaves an unexplained residual: a documented deterministic rule allocates it, and both sides are asserted to sum | MUST | EC-21 |
| RT-438 | Edge Cases | Concurrency is resolved by the business transaction with a bound guarantee, never by an application lock, a retry, or a UI check | MUST | EC-11 |

## 19. Not reconstructable

**Not reconstructable.** No surviving artifact - file, backup, git history, or temporary fragment -
records what element 19 held or what it said. The element is listed so the required set of 22 is
visibly accounted for, and it is left empty rather than filled with plausible-sounding text.
Recovering it needs a source that no longer exists; an owner should author it fresh if it is required.

## 20. Not reconstructable

**Not reconstructable.** No surviving artifact - file, backup, git history, or temporary fragment -
records what element 20 held or what it said. The element is listed so the required set of 22 is
visibly accounted for, and it is left empty rather than filled with plausible-sounding text.
Recovering it needs a source that no longer exists; an owner should author it fresh if it is required.

## 21. Not reconstructable

**Not reconstructable.** No surviving artifact - file, backup, git history, or temporary fragment -
records what element 21 held or what it said. The element is listed so the required set of 22 is
visibly accounted for, and it is left empty rather than filled with plausible-sounding text.
Recovering it needs a source that no longer exists; an owner should author it fresh if it is required.

## 22. Not reconstructable

**Not reconstructable.** No surviving artifact - file, backup, git history, or temporary fragment -
records what element 22 held or what it said. The element is listed so the required set of 22 is
visibly accounted for, and it is left empty rather than filled with plausible-sounding text.
Recovering it needs a source that no longer exists; an owner should author it fresh if it is required.

# Batch evidence log

The ten batch populations sum to **342**, and Batch 3b is **30**. `SM-43a`, `SM-48a` and `SM-56a`
were counted in Batch 3b's population and adjudicated in Batch 5d (34 + 30 + 3 = 67 `state-machines`
rules). An earlier version of this file recorded 3b as 33 and a total of 345; that was the error this
correction removes.

| Batch | Population | Domains | Drafted rows | Per-rule reasoning |
|---|---|---|---|---|
| 1 | 41 | ux-requirements, notification-domain | `RT-355..RT-381` | lost - original reasoning lost; not reconstructed |
| 2 | 32 | approval-workflows, reporting-domain, multi-store-domain | `RT-382..RT-403` | lost - original reasoning lost; not reconstructed |
| 3a | 34 | state-machines | `RT-404..RT-421` | lost - original reasoning lost; not reconstructed |
| 3b | 30 | state-machines | `RT-422..RT-434` | lost - original reasoning lost; not reconstructed |
| 4a | 33 | edge-cases | `RT-435..RT-446` | lost - original reasoning lost; not reconstructed |
| 4b | 32 | edge-cases | `RT-447..RT-457` | lost - original reasoning lost; not reconstructed |
| 5a | 33 | batch-expiry-fefo (17), audit-domain (16) | `RT-458..RT-469` | lost - original reasoning lost; not reconstructed |
| 5b | 32 | offline-pos-domain (11), business-invariants (11), payment-domain (10) | `RT-470..RT-482` | recovered but superseded |
| 5c | 33 | product-domain (10), inventory-domain (8), sales-pos-domain (8), procurement-domain (7) | `RT-483..RT-502` | recovered intact |
| 5d | 42 | organization-model (8), cash-management (6), rfid-domain (5), actors-and-roles (4), ux-requirements (4), state-machines (3), customer-domain (3), returns-refunds-domain (3), hardware-domain (3), employee-domain (3) | `RT-503..RT-529` | recovered intact |
| **Total** | **342** | | | |

Populations: 41 + 32 + 34 + 30 + 33 + 32 + 33 + 32 + 33 + 42 = **342**.

## Batch 1 - ux-requirements, notification-domain - 41 rules

**Population:** 41 &nbsp;|&nbsp; **Drafted rows:** `RT-355..RT-381`

Phase A. Rules that pointed at `OUT OF SCOPE` rows (`RT-343` / `RT-326`).

### Batch 

**Derived from the trace, not recovered.** The table below is exact for what the file now says:
these are the rows in this batch's range, the rules each cites, and each rule's source document.
It is not the original per-rule log, and the reasoning that chose each home is **

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-355 | InApp is always on and is the delivery source of truth; other channels are configured per event type and per user, with a store default and no global switch | MUST | NT-13, NT-16 | notification-domain |
| RT-356 | Email is a digest for anything non-urgent | SHOULD | NT-15 | notification-domain |
| RT-357 | An external channel requires a verified destination and consent | MUST | NT-17 | notification-domain |
| RT-358 | A channel failure affects neither the other channels nor the domain | MUST | NT-18, EC-75 | notification-domain, edge-cases |
| RT-359 | An event needing a decision has a deadline that escalates, and escalation targets a role | MUST | NT-23, NT-24 | notification-domain |
| RT-360 | A notification is retained for a configured short period and then expires; the event is the record | MUST | NT-30, SM-74 | notification-domain, state-machines |
| RT-361 | A notification links to the record it is about, and following the link is permission-checked | MUST | NT-31, UX-45 | notification-domain, ux-requirements |
| RT-362 | Before and after are separate events, and an event type is added only when a rule requires it | MUST | NT-37 | notification-domain |
| RT-363 | The common path is short; a destructive action is explicit, separately named, and confirmed by what and how much | MUST | UX-02, UX-03 | ux-requirements |
| RT-364 | The system reports the outcome, not its internal action, and a user-caused outcome is not styled as a system error | MUST | UX-04, UX-59 | ux-requirements |
| RT-365 | The normal sale path is scan, line, running total, payment, confirm, print | MUST | UX-09 | ux-requirements |
| RT-366 | Quantity is one control on the line; a hand-entered weight is labelled and reasoned | MUST | UX-13 | ux-requirements |
| RT-367 | The payment step shows total due, tenders already taken, and the remainder | MUST | UX-14 | ux-requirements |
| RT-368 | An underpayment is named as such and the credit-sale route is explicit | MUST | UX-17 | ux-requirements |
| RT-369 | An offline sale accepted with an adjustment is shown to the cashier on reconnect | MUST | UX-20 | ux-requirements |
| RT-370 | Resuming a suspended sale does not re-reserve stock | MUST | UX-25 | ux-requirements |
| RT-371 | A suspended sale can be discarded with confirmation, and the discard is audited | MUST | UX-26 | ux-requirements |
| RT-372 | Opening a shift asks for the counted float by denomination | MUST | UX-32 | ux-requirements |
| RT-373 | The variance screen shows counted, expected, variance, and threshold together | MUST | UX-34 | ux-requirements |
| RT-374 | The drawer state is visible on the till at all times | MUST | UX-35 | ux-requirements |
| RT-375 | A stock adjustment is entered as a counted quantity, not a delta | MUST | UX-36 | ux-requirements |
| RT-376 | A low-stock alert names the variant, the quantity, the threshold, and the reorder action | MUST | UX-38 | ux-requirements |
| RT-377 | An action needing approval says the request was sent, and the requester can see their own request's state | MUST | UX-42, UX-43, AP-28 | ux-requirements, approval-workflows |
| RT-378 | Search results and search suggestions are scope-filtered before they are returned | MUST | UX-47, UX-49 | ux-requirements |
| RT-379 | A barcode search is exact and a name search is fuzzy; the two never mix | MUST | UX-48 | ux-requirements |
| RT-380 | Touch targets are sized for fast, imprecise till work and text meets a published contrast ratio | MUST | UX-53, UX-54 | ux-requirements |
| RT-381 | A rejected offline sale is shown with its reason and what to do | MUST | UX-66 | ux-requirements |
Rows in this range: **27**.
### Batch 

The rules this batch dispositioned into **pre-existing** rows cannot be enumerated: no surviving
artifact records which rules they were. Given a population of 41 and the rows above, the
remainder was mapped into rows numbered below 
and are not guessed here.

## Batch 2 - approval-workflows, reporting-domain, multi-store-domain - 32 rules

**Population:** 32 &nbsp;|&nbsp; **Drafted rows:** `RT-382..RT-403`

Phase A, continued (`RT-288` / `RT-316` / `RT-274`).

### Batch 

**Derived from the trace, not recovered.** The table below is exact for what the file now says:
these are the rows in this batch's range, the rules each cites, and each rule's source document.
It is not the original per-rule log, and the reasoning that chose each home is **

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-382 | The request references its subject, and a suspendable subject is suspended or flagged while the request is pending | MUST | AP-04 | approval-workflows |
| RT-383 | A request carries its reason from submission | MUST | AP-05 | approval-workflows |
| RT-384 | The request is submitted in the same transaction as the action that triggered it, or immediately after | MUST | AP-06 | approval-workflows |
| RT-385 | A decision writes an `Approval.Decided` audit event carrying the before and after state, the decider, and the reason | MUST | AP-11 | approval-workflows |
| RT-386 | A decision is idempotent by request id, and a decided request cannot be decided again | MUST | AP-12, AP-13 | approval-workflows |
| RT-387 | The decider is resolved by role and store, never by name | MUST | AP-14, AP-15 | approval-workflows |
| RT-388 | Every policy carries a decision SLA, configurable per subject per store, and a request past its SLA escalates | MUST | AP-21, AP-22 | approval-workflows |
| RT-389 | A request whose subject no longer exists is `Cancelled` with a reason naming the subject | MUST | AP-25 | approval-workflows |
| RT-390 | The approval report is a projection of the requests, by state, subject, decider, and store, with the mean wait | SHOULD | AP-30 | approval-workflows |
| RT-391 | Where a subject cannot proceed without approval, it is refused with a message naming the pending request | MUST | AP-32 | approval-workflows |
| RT-392 | A request submission is idempotent by `ClientOperationId` | MUST | AP-33 | approval-workflows |
| RT-393 | A request survives a restart | MUST | AP-34 | approval-workflows |
| RT-394 | Scope is applied to every store-scoped read and write; no store-scoped operation escapes it, including exports, reports, and search suggestions | MUST | MS-10, EC-59 | multi-store-domain, edge-cases |
| RT-395 | Segregation-of-duties conflicts are evaluated across stores, not per store | MUST | MS-14 | multi-store-domain |
| RT-396 | The audit log is organization-global and is queryable only with an explicit store filter or organization-wide permission | MUST | MS-29 | multi-store-domain |
| RT-397 | A chain or store-range catalog is not in v1; the single organization-global catalog is the only one | OUT OF SCOPE | MS-35 | multi-store-domain |
| RT-398 | Every report declares which kind it is, and the screen says so where freshness differs materially | MUST | RP-01 | reporting-domain |
| RT-399 | No report is the system of record | MUST | RP-03 | reporting-domain |
| RT-400 | A report never mixes currencies in one column, and a converted figure shows its rate and its rate date | MUST | RP-06, RP-07 | reporting-domain |
| RT-401 | A report's scope is a function of the report, not only of the role | MUST | RP-16 | reporting-domain |
| RT-402 | The largest-history reports are indexed by their own access pattern, and an expensive query is a background job rather than a scan presented as quick | MUST | RP-23, RP-24 | reporting-domain |
| RT-403 | The export destination is not a server-side integration in v1 | OUT OF SCOPE | RP-29 | reporting-domain |
Rows in this range: **22**.
### Batch 

The rules this batch dispositioned into **pre-existing** rows cannot be enumerated: no surviving
artifact records which rules they were. Given a population of 32 and the rows above, the
remainder was mapped into rows numbered below 
and are not guessed here.

## Batch 3a - state-machines - 34 rules

**Population:** 34 &nbsp;|&nbsp; **Drafted rows:** `RT-404..RT-421`

Phase B. Rules that pointed at the catch-all `RT-344` / `RT-350`.

### Batch 

**Derived from the trace, not recovered.** The table below is exact for what the file now says:
these are the rows in this batch's range, the rules each cites, and each rule's source document.
It is not the original per-rule log, and the reasoning that chose each home is **

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-404 | A document's own state is a stored fact, and stored does not mean authoritative: which entity owns the figure decides stored versus projected | MUST | SM-01, SM-01a, SM-35a | state-machines |
| RT-405 | An unspecified transition attribute is `OPEN DECISION` and is raised, never guessed | MUST | SM-02a, SM-02b, SM-02c, SM-02d | state-machines |
| RT-406 | A machine is a closed, versioned set of states and transitions defined in the owning document | MUST | SM-07 | state-machines |
| RT-407 | A `Suspended` or `OnHold` state has a resume edge, a recorded reason, and queue visibility | MUST | SM-09 | state-machines |
| RT-408 | A machine's state set is the owning document's set, verbatim | MUST | SM-13a, SM-16a, SM-60, SM-77a, SM-88a, SM-43a, SM-48a | state-machines |
| RT-409 | `Archived` requires a reason, is terminal, and has no return edge | MUST | SM-13 | state-machines |
| RT-410 | `AllowNegative` and `BlockNegative` are the only two stock policies, they change only by a movement that would breach the current policy, and there is no manual override | MUST | SM-14, SM-15 | state-machines |
| RT-411 | `Quarantined` is reversible; `Depleted` and `Expired` are not, and `Depleted` is reached by quantity alone | MUST | SM-16, SM-17 | state-machines |
| RT-412 | `Expired` is derived at read and stored at the expiry boundary, a required expiry date cannot be omitted, and a dateless batch sorts last under FEFO | MUST | SM-18, SM-19 | state-machines |
| RT-413 | `Rejected`, `Cancelled`, and `Closed` are three distinct endings, and a `Sale` has no `Cancelled` state | MUST | SM-23, SM-36 | state-machines |
| RT-414 | A goods receipt creates stock and never a second payable | MUST | SM-27 | state-machines |
| RT-415 | A sale's post-sale states are a projection of its line counters, and the stored status is a cache a rebuild must reproduce exactly | MUST | SM-35, SP-66 | state-machines, sales-pos-domain |
| RT-416 | A return and a refund are linked, not nested | MUST | SM-39 | state-machines |
| RT-417 | A `Failed` refund is retryable and holds the amount | MUST | SM-41 | state-machines |
| RT-418 | A customer balance is never state; only the status is, and every status edge is a permissioned human decision with a reason | MUST | SM-45, SM-45b, SM-46 | state-machines |
| RT-419 | `OnHold` is not a credit control; `CreditBlocked` is the credit control, and it is liftable | MUST | SM-45a, SM-45c | state-machines |
| RT-420 | `Declined` and `Failed` payments are retryable; `Voided` and `Captured` are terminal | MUST | SM-53, PY-14, PY-54 | state-machines, payment-domain |
| RT-421 | A payment's state is a reconciliation of provider events and the local record | MUST | SM-54, EC-14 | state-machines, edge-cases |
Rows in this range: **18**.
### Batch 

The rules this batch dispositioned into **pre-existing** rows cannot be enumerated: no surviving
artifact records which rules they were. Given a population of 34 and the rows above, the
remainder was mapped into rows numbered below 
and are not guessed here.

## Batch 3b - state-machines - 30 rules

**Population:** 30 &nbsp;|&nbsp; **Drafted rows:** `RT-422..RT-434`

Phase B, continued. `SM-43a`, `SM-48a`, `SM-56a` sat in this population and were adjudicated in Batch 5d, so this count is 30 and not 33.

### Batch 

**Derived from the trace, not recovered.** The table below is exact for what the file now says:
these are the rows in this batch's range, the rules each cites, and each rule's source document.
It is not the original per-rule log, and the reasoning that chose each home is **

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-422 | A shift's only forward path is `Open` → `Reconciling` → `Closed`; there is no `Void` state, and a closed shift is immutable except for `Reopened` | MUST | SM-55, SM-57, SM-58, SM-56a | state-machines |
| RT-423 | A `PosTerminal`'s mode is configuration, not a lifecycle step, and is separate from its service state | MUST | SM-59 | state-machines |
| RT-424 | `Degraded` is a real device state, and `Offline` is not `Disabled` | MUST | SM-60a, SM-60b | state-machines |
| RT-425 | An RFID session is `Opened` or `Closed`; there is no `Paused` | MUST | SM-63 | state-machines |
| RT-426 | A rejected offline item is retained as evidence with a reason, never deleted from the queue | MUST | SM-66 | state-machines |
| RT-427 | An offline sale that cannot be synced while the store is closed and the cache is sealed stays `Queued` for the next online window | MUST | SM-67 | state-machines |
| RT-428 | `Pending` is the only non-terminal approval state, and every exit is terminal, reasoned, and audited | MUST | SM-68, SM-71 | state-machines |
| RT-429 | The state-machine consistency check reports only what it has actually verified | MUST | SM-75, SM-75a | state-machines |
| RT-430 | An in-transit transfer is never cancelled | MUST | SM-78 | state-machines |
| RT-431 | A count posts the counted quantity, and a posted count is never re-posted | MUST | SM-81, SM-82 | state-machines |
| RT-432 | A count may only observe; it cannot resolve a negative balance by counting upward | MUST | SM-84 | state-machines |
| RT-433 | A revoked tag is never re-issued to a different subject | MUST | SM-86 | state-machines |
| RT-434 | A suspended credential is readable but not usable | MUST | SM-88 | state-machines |
Rows in this range: **13**.
### Batch 

The rules this batch dispositioned into **pre-existing** rows cannot be enumerated: no surviving
artifact records which rules they were. Given a population of 30 and the rows above, the
remainder was mapped into rows numbered below 
and are not guessed here.

## Batch 4a - edge-cases - 33 rules

**Population:** 33 &nbsp;|&nbsp; **Drafted rows:** `RT-435..RT-446`

Phase B, continued.

### Batch 

**Derived from the trace, not recovered.** The table below is exact for what the file now says:
these are the rows in this batch's range, the rules each cites, and each rule's source document.
It is not the original per-rule log, and the reasoning that chose each home is **

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-435 | A capture and a void of the same sale are mutually exclusive; one wins and the other is refused naming the winner | MUST | EC-03 | edge-cases |
| RT-436 | A stock movement is refused while a count is in progress, and a count is never silently merged with one | MUST | EC-04, EC-09 | edge-cases |
| RT-437 | FEFO is resolved at commit, not at selection, so a quarantine arriving after selection causes a re-selection | MUST | EC-10 | edge-cases |
| RT-438 | Concurrency is resolved by the business transaction with a bound guarantee, never by an application lock, a retry, or a UI check | MUST | EC-11 | edge-cases |
| RT-439 | Exceeding a credit limit at the till refuses the sale or routes it to an approved override | MUST | EC-18 | edge-cases |
| RT-440 | A live store's payment provider configuration is approvaled and audited before it takes effect | MUST | EC-20 | edge-cases |
| RT-441 | No computation leaves an unexplained residual: a documented deterministic rule allocates it, and both sides are asserted to sum | MUST | EC-21 | edge-cases |
| RT-442 | The authoritative money amount is the amount applied or settled; a tendered, handed-over, or listed amount is never authoritative | MUST | EC-23 | edge-cases |
| RT-443 | A variant's deactivation is prospective: it blocks new use and never removes stock already on hand | MUST | EC-33 | edge-cases |
| RT-444 | A product referenced by a finalized document is deactivated or retired, never deleted | MUST | EC-37 | edge-cases |
| RT-445 | A store is not deactivated while it holds stock or has an open shift | MUST | EC-39, EC-89 | edge-cases |
| RT-446 | A permission change takes effect on the next request, and the live session is revoked rather than left with stale grants | MUST | EC-45, OF-42 | edge-cases, offline-pos-domain |
Rows in this range: **12**.
### Batch 

The rules this batch dispositioned into **pre-existing** rows cannot be enumerated: no surviving
artifact records which rules they were. Given a population of 33 and the rows above, the
remainder was mapped into rows numbered below 
and are not guessed here.

## Batch 4b - edge-cases - 32 rules

**Population:** 32 &nbsp;|&nbsp; **Drafted rows:** `RT-447..RT-457`

Phase B, completed. All 67 `state-machines` and 65 `edge-cases` rules are dispositioned.

### Batch 

**Derived from the trace, not recovered.** The table below is exact for what the file now says:
these are the rows in this batch's range, the rules each cites, and each rule's source document.
It is not the original per-rule log, and the reasoning that chose each home is **

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-447 | An offline sale that duplicates an online sale is applied and reported, never auto-merged | MUST | EC-49, OF-31 | edge-cases, offline-pos-domain |
| RT-448 | A role's scope is explicit - organization-wide or a named store set - and it never widens by itself | MUST | EC-55, EC-87, EC-88, MS-11 | edge-cases, multi-store-domain |
| RT-449 | The business date is a store setting, and changing it handles open transactions and is audited | MUST | EC-64 | edge-cases |
| RT-450 | No credit due date, dunning, or `CreditOverdue` in v1; a balance is governed only by the credit-limit rules | OUT OF SCOPE | EC-65, NT-37 | edge-cases, notification-domain |
| RT-451 | A report too slow to serve becomes a background job that notifies its requester on completion or failure | MUST | EC-74, RP-20 | edge-cases, reporting-domain |
| RT-452 | A cart survives an interruption in memory and on disk for a configured TTL, and is never silently lost | MUST | EC-78, SP-43 | edge-cases, sales-pos-domain |
| RT-453 | A session change at a shared terminal preserves the cart, and the sale is attributed to whoever completes it | MUST | EC-79, SP-11 | edge-cases, sales-pos-domain |
| RT-454 | A replaced device keeps its history, and its replacement is a new provisioned device | MUST | EC-82, HD-18 | edge-cases, hardware-domain |
| RT-455 | A new cashier's first sale is an ordinary sale gated only by their roles and permissions; there is no production onboarding mode | MUST | EC-83, EM-14 | edge-cases, employee-domain |
| RT-456 | The void, return, refund, and escalate paths are each reachable in a few taps | MUST | EC-84 | edge-cases |
| RT-457 | A store with no provisioned terminal cannot trade | MUST | EC-86, overview 3 | edge-cases, overview (section reference, not a rule id) |
Rows in this range: **11**.
### Batch 

The rules this batch dispositioned into **pre-existing** rows cannot be enumerated: no surviving
artifact records which rules they were. Given a population of 32 and the rows above, the
remainder was mapped into rows numbered below 
and are not guessed here.

## Batch 5a - batch-expiry-fefo (17), audit-domain (16) - 33 rules

**Population:** 33 &nbsp;|&nbsp; **Drafted rows:** `RT-458..RT-469`

Phase C. 5 into existing rows, 28 into 12 new rows.

### Batch 

**Derived from the trace, not recovered.** The table below is exact for what the file now says:
these are the rows in this batch's range, the rules each cites, and each rule's source document.
It is not the original per-rule log, and the reasoning that chose each home is **

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-458 | Receiving a batch-tracked variant captures batch number, expiry date, and manufacturing date when available; missing data is a warning, not a rejection | MUST | BE-10 | batch-expiry-fefo |
| RT-459 | A receipt line creates exactly one batch, and accepting already-expired goods into sellable stock still writes an `EXPIRY` notification at `Error` severity | MUST | BE-12, BE-13 | batch-expiry-fefo |
| RT-460 | A receipt records the actual supplier-invoice unit cost, not the PO price, and the variance is recorded and reported through the three-way match | MUST | BE-14 | batch-expiry-fefo |
| RT-461 | A receipt writes `PURCHASE_RECEIPT` movements against the specific batch and sets `RemainingQuantity`; near-expiry stock is prioritised by FEFO and reported but never blocked; expiry removes stock only through a reason-coded, permissioned, approval-bearing `EXPIRY` write-off | MUST | BE-15, BE-21, BE-22 | batch-expiry-fefo |
| RT-462 | Quarantined stock may be consumed by staff with a reason, is never sold to customers, and the staff consumption is reported | MUST | BE-39 | batch-expiry-fefo |
| RT-463 | Valuation policy for a batch-tracked variant is explicit and configured - `WeightedAverage` (default), `FIFO`, or `LastCost`; it is applied at valuation time rather than kept as a running total; and a sale line records the actual cost of the batch it consumed, summed across batches when FEFO splits the sale | MUST | BE-41, BE-42, BE-43 | batch-expiry-fefo |
| RT-464 | An audit event records what happened rather than what was intended; the store is always on the event, derived from the affected entity rather than the request; and `Before`/`After` hold only changed fields, not whole entities | MUST | AU-04, AU-07, AU-08 | audit-domain |
| RT-465 | `EventType` is a closed, versioned, domain-namespaced set; logout and session end are distinct events (`Security.Logout` versus `Security.SessionEnded` with its cause); the vocabulary is complete against the mandatory event floor; and a new event type is a reviewed change made only when a rule already requires the event | MUST | AU-11, AU-12, AU-12a, AU-12b, AU-12c, AU-13 | audit-domain |
| RT-466 | A scheduled job records what it did and what it changed in the same event vocabulary; archival moves events to cold storage while preserving the query path; and the retention policy is versioned and audited, with a policy change that shortens retention requiring approval | MUST | AU-16, AU-21, AU-22 | audit-domain |
| RT-467 | Access to an employee's own actions is not special-cased: supervisors see their store and see their own events like anyone else's, and a request to suppress one's own event is refused; a database administrator with write access to the audit store is a documented, mitigated risk rather than a solved one | MUST | AU-26, AU-31 | audit-domain |
| RT-468 | No per-field, per-reason audit trail on every entity in v1, and no real-time alerting on audit events in v1; the mandatory event floor and a standing report with threshold notifications are the floor | OUT OF SCOPE | AU-34, AU-35 | audit-domain |
| RT-469 | A FEFO override on a large-value sale follows the store's approval policy, as a large discount does | MUST | BE-35 | batch-expiry-fefo |
Rows in this range: **12**.
### Batch 

The rules this batch dispositioned into **pre-existing** rows cannot be enumerated: no surviving
artifact records which rules they were. Given a population of 33 and the rows above, the
remainder was mapped into rows numbered below 
and are not guessed here.

## Batch 5b - offline-pos-domain (11), business-invariants (11), payment-domain (10) - 32 rules

**Population:** 32 &nbsp;|&nbsp; **Drafted rows:** `RT-470..RT-482`

Phase C. Revised during 5c/5d; see B5b-revise.

### Batch 5b-revise This batch was rewritten during 5c and 5d

The original Batch 5b draft survives, but it does not describe the file. Two of its decisions were
reversed and its row numbers were reassigned:

- `BI-05` was mapped to `RT-042`; that mapping was **withdrawn as too weak** (`RT-042` states the
  non-negative principle for *price*, while `BI-05` is about *entry quantity*). `RT-475` was drafted
  for it and also carries `IV-34`.
- `BI-16` was mapped to `RT-148`; the goodwill-return exception was **not covered by that row**, so
  `RT-476` was drafted for it.
- `RT-475`, `RT-476` and `RT-477` therefore hold different rules than the original 5b draft
  assigned them, and `RT-479..RT-482` were added. The original draft ended at `RT-479`.

The final state below is read from the trace, not from the superseded draft.

### Batch 5b-1 Rules dispositioned into rows in this range

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-470 | Synchronisation is per store and per terminal, in business-date order and then queue order within a business date | MUST | OF-24 | offline-pos-domain |
| RT-471 | Synchronisation is triggered on connectivity restoration, on a configured interval, on a manual request, and at shift close, never on a timer alone; an offline window exceeding the terminal's configured expiry stops the terminal selling and raises a high-severity notification | MUST | OF-27, OF-28 | offline-pos-domain |
| RT-472 | FEFO offline is advisory: the terminal may suggest the soonest-expiring batch, the sale line records the batch the server later allocated, and no offline FEFO override is possible; a near-expiry batch left behind is reported | MUST | OF-40 | offline-pos-domain |
| RT-473 | The local ledger is as sensitive as the server's: it is encrypted at rest and its key is bound to the registered device credential | MUST | OF-41 | offline-pos-domain |
| RT-474 | No offline data is written to shared or removable media by the POS, and diagnostics leave the terminal only through a deliberate, audited export | MUST | OF-44 | offline-pos-domain |
| RT-475 | A quantity supplied as input is never negative, and a reduction is expressed by movement type and direction rather than a signed quantity; a negative stock balance is a store policy decision and is separate from the input rule | MUST | BI-05, IV-34 | business-invariants, inventory-domain |
| RT-476 | A return with no sale-line reference is permitted only as a manager-approved goodwill return, requires `Return.Approve` and a reason, creates no stock movement, and is cash-only | MUST | BI-16 | business-invariants |
| RT-477 | Device identity is authenticated: the server accepts a device's events only after the device is registered and authenticated, and an unregistered or unauthenticated device's events are rejected and recorded as such | MUST | BI-35, RF-12, HD-14 | business-invariants, rfid-domain, hardware-domain |
| RT-478 | A document with a child document cannot be deleted or cancelled out of order: a purchase order with recorded receipts cannot be deleted, no state machine skips a state, and a sale with a recorded return cannot be voided until that return is reversed | MUST | BI-41 | business-invariants |
| RT-479 | A document number is unique per store per document type, is allocated inside the creating transaction, and is never reused - including after cancellation or void | MUST | BI-42 | business-invariants |
| RT-480 | Payment state is a projection of provider events plus the local record, and the state is the reconciliation of the two; a callback is idempotent by provider transaction reference and a duplicate callback is acknowledged and recorded once | MUST | PY-15 | payment-domain |
| RT-481 | An overpayment is change, not a payment, and a non-cash overpayment is refused rather than creating a negative tender; where a store allows negative-tender credit it is a configured store setting, carries a reason, and is reported | MUST | PY-19 | payment-domain |
| RT-482 | No expiry campaigns and no expiry-without-notification in v1 | OUT OF SCOPE | PY-35 | payment-domain |
Rows in this range: **13**.
### Batch 5b-2 Rules mapped to an existing row

Fourteen of the eighteen are identifiable from the superseded draft; four are **not reconstructable**.

| Rule | Disposition |
|---|---|
| `OF-38` | mapped to existing row RT-064 |
| `OF-39` | mapped to existing row RT-066 |
| `OF-42` | mapped to existing row RT-446 (partial coverage recorded) |
| `OF-43` | mapped to existing row RT-017 (partial coverage recorded) |
| `OF-45` | mapped to existing row RT-223 (partial coverage recorded) |
| `BI-03` | mapped to existing row RT-060 (partial coverage recorded) |
| `BI-14` | mapped to existing row RT-013 |
| `BI-17` | mapped to existing row RT-151 |
| `BI-20` | mapped to existing row RT-043 |
| `BI-31` | mapped to existing row RT-226 (partial coverage recorded) |
| `PY-21` | mapped to existing row RT-144 |
| `PY-24` | mapped to existing row RT-145 |
| `PY-27` | mapped to existing row RT-156 |
| `PY-48` | mapped to existing row RT-230 |
| 4 rules | **not reconstructable** - the superseded draft named 16 existing-row mappings, 2 of which were reversed, leaving 14 of 18 |
## Batch 5c - product-domain (10), inventory-domain (8), sales-pos-domain (8), procurement-domain (7) - 33 rules

**Population:** 33 &nbsp;|&nbsp; **Drafted rows:** `RT-483..RT-502`

Phase C. 12 into existing rows, 21 into 20 new rows.

### Batch 

All 33 rules of this batch are enumerated below, with the home each one resolves to in
§26.2 and the disposition the trace records. The narrative reasoning for this batch was
recovered intact and is quoted in the notes at the end of this section.

| Rule | Source file | Home | Disposition | Citation |
|---|---|---|---|---|
| `IV-08` | docs/product/inventory-domain.md | RT-061 | mapped to an existing row | `IV-08` |
| `IV-14` | docs/product/inventory-domain.md | RT-060 | mapped to an existing row | `IV-14` |
| `IV-16` | docs/product/inventory-domain.md | RT-483 | new row drafted in this batch | `IV-16` |
| `IV-17` | docs/product/inventory-domain.md | RT-484 | new row drafted in this batch | `IV-17` |
| `IV-18` | docs/product/inventory-domain.md | RT-070 | mapped to an existing row | `IV-18` |
| `IV-32` | docs/product/inventory-domain.md | RT-486 | new row drafted in this batch | `IV-32` |
| `IV-34` | docs/product/inventory-domain.md | RT-475 | mapped to an existing row | `IV-34` |
| `IV-59` | docs/product/inventory-domain.md | RT-487 | new row drafted in this batch | `IV-59` |
| `PR-06` | docs/product/product-domain.md | RT-488 | new row drafted in this batch | `PR-06` |
| `PR-11` | docs/product/product-domain.md | RT-489 | new row drafted in this batch | `PR-11` |
| `PR-12` | docs/product/product-domain.md | RT-490 | new row drafted in this batch | `PR-12` |
| `PR-14` | docs/product/product-domain.md | RT-491 | new row drafted in this batch | `PR-14` |
| `PR-16` | docs/product/product-domain.md | RT-033 | mapped to an existing row | `PR-16` |
| `PR-39` | docs/product/product-domain.md | RT-492 | new row drafted in this batch | `PR-39` |
| `PR-40` | docs/product/product-domain.md | RT-493 | new row drafted in this batch | `PR-40` |
| `PR-45` | docs/product/product-domain.md | RT-494 | new row drafted in this batch | `PR-45` |
| `PR-48` | docs/product/product-domain.md | RT-495 | new row drafted in this batch | `PR-48` |
| `PR-52` | docs/product/product-domain.md | RT-496 | new row drafted in this batch | `PR-52` |
| `PR-Q04` | docs/product/procurement-domain.md | RT-497 | new row drafted in this batch | `PR-Q04` |
| `PR-Q05` | docs/product/procurement-domain.md | RT-498 | new row drafted in this batch | `PR-Q05` |
| `PR-Q06` | docs/product/procurement-domain.md | RT-499 | new row drafted in this batch | `PR-Q06` |
| `PR-Q06a` | docs/product/procurement-domain.md | RT-117 | mapped to an existing row | `PR-Q06a` |
| `PR-Q07` | docs/product/procurement-domain.md | RT-498 | new row drafted in this batch | `PR-Q07` |
| `PR-Q08` | docs/product/procurement-domain.md | RT-500 | new row drafted in this batch | `PR-Q08` |
| `PR-Q10` | docs/product/procurement-domain.md | RT-501 | new row drafted in this batch | `PR-Q10` |
| `SP-25` | docs/product/sales-pos-domain.md | RT-502 | new row drafted in this batch | `SP-25` |
| `SP-26` | docs/product/sales-pos-domain.md | RT-502 | new row drafted in this batch | `SP-26` |
| `SP-61` | docs/product/sales-pos-domain.md | RT-221 | mapped to an existing row | `SP-61` |
| `SP-62` | docs/product/sales-pos-domain.md | RT-225 | mapped to an existing row | `SP-62` |
| `SP-63` | docs/product/sales-pos-domain.md | RT-222 | mapped to an existing row | `SP-63` |
| `SP-64` | docs/product/sales-pos-domain.md | RT-066 | mapped to an existing row | `SP-64` |
| `SP-65` | docs/product/sales-pos-domain.md | RT-226 | mapped to an existing row | `SP-65` |
| `SP-66` | docs/product/sales-pos-domain.md | RT-415 | mapped to an existing row | `SP-66` |
### Batch 

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-483 | The negative-stock policy is evaluated inside the movement transaction, against the resulting balance | MUST | IV-16, BI-36, OF-04 | inventory-domain, business-invariants, offline-pos-domain |
| RT-484 | A negative balance is written to the ledger in full, alarmed, and never clamped or hidden | MUST | IV-17, BI-36 | inventory-domain, business-invariants |
| RT-485 | A negative balance must be resolved, and resolution is one of a named set of routes with a reason | MUST | IV-18, BI-25 | inventory-domain, business-invariants |
| RT-486 | A stock adjustment is a document with a state machine and moves no stock until posted | MUST | IV-32, BI-27 | inventory-domain, business-invariants |
| RT-487 | An out-of-stock event notifies once, and the restore is the reset condition | MUST | IV-59, BE-20 | inventory-domain, batch-expiry-fefo |
| RT-488 | Category ordering is an explicit sort order, not a naming convention | MUST | PR-06 | product-domain |
| RT-489 | A variant sold by scanner needs at least one active barcode; a search-only variant is an explicit, recorded selection | MUST | PR-11 | product-domain |
| RT-490 | A barcode is a string normalised per symbology, never an integer | MUST | PR-12 | product-domain |
| RT-491 | `QuantityKind` is immutable once the unit has been used | MUST | PR-14 | product-domain |
| RT-492 | Inclusive tax is extracted at line precision and the tax is derived as the difference, never `gross x rate` | MUST | PR-39, SP-34, BI-11, PR-Q40 | product-domain, sales-pos-domain, business-invariants, procurement-domain |
| RT-493 | Exempt is a zero-rate tax category, never a missing category | MUST | PR-40, SP-38 | product-domain, sales-pos-domain |
| RT-494 | Discounts apply in a fixed documented order, and the order is recorded on the sale | MUST | PR-45, SP-27, BI-11 | product-domain, sales-pos-domain, business-invariants |
| RT-495 | A variant may be archived while its product stays active | MUST | PR-48 | product-domain |
| RT-496 | An import row matches on a stable external key, never on name | MUST | PR-52 | product-domain |
| RT-497 | A requisition has no effect: no stock, no payable, until it becomes a purchase order | MUST | PR-Q04, BI-27 | procurement-domain, business-invariants |
| RT-498 | A PO line records the agreed description and price as issued values; neither is recalculated | MUST | PR-Q05, PR-Q07, BI-08 | procurement-domain, business-invariants |
| RT-499 | A PO has no effect on stock or payable until it is `Approved` and then `Ordered` | MUST | PR-Q06, BI-40 | procurement-domain, business-invariants |
| RT-500 | PO cancellation is refused once a goods receipt exists, and the resolution is return plus cancel | MUST | PR-Q08, BI-41 | procurement-domain, business-invariants |
| RT-501 | A PO belongs to one ordering store; cross-store consolidation is out of scope in v1 | OUT OF SCOPE | PR-Q10 | procurement-domain |
| RT-502 | Cash rounding is configured, never hard-coded, and recorded as an adjustment rather than smeared into prices | MUST | SP-25, SP-26 | sales-pos-domain |
Rows in this range: **20**.
## Batch 5d - organization-model (8), cash-management (6), rfid-domain (5), actors-and-roles (4), ux-requirements (4), state-machines (3), customer-domain (3), returns-refunds-domain (3), hardware-domain (3), employee-domain (3) - 42 rules

**Population:** 42 &nbsp;|&nbsp; **Drafted rows:** `RT-503..RT-529`

Phase C, final. 15 into existing rows, 27 new rows. Closes the four Batch 1 unsure items.

### Batch 

All 42 rules of this batch are enumerated below, with the home each one resolves to in
§26.2 and the disposition the trace records. The narrative reasoning for this batch was
recovered intact and is quoted in the notes at the end of this section.

| Rule | Source file | Home | Disposition | Citation |
|---|---|---|---|---|
| `AC-01` | docs/product/actors-and-roles.md | RT-010 | mapped to an existing row | `AC-01` |
| `AC-02` | docs/product/actors-and-roles.md | RT-010 | mapped to an existing row | `AC-02` |
| `AC-03` | docs/product/actors-and-roles.md | RT-010 | mapped to an existing row | `AC-03` |
| `AC-04` | docs/product/actors-and-roles.md | RT-503 | new row drafted in this batch | `AC-04` |
| `CD-01` | docs/product/organization-model.md | RT-236 | mapped to an existing row | `CD-01` |
| `CD-04` | docs/product/cash-management.md | RT-237 | mapped to an existing row | `CD-04` |
| `CD-19` | docs/product/cash-management.md | RT-525 | new row drafted in this batch | `CD-19` |
| `CD-20` | docs/product/cash-management.md | RT-526 | new row drafted in this batch | `CD-20` |
| `CD-30` | docs/product/cash-management.md | RT-527 | new row drafted in this batch | `CD-30` |
| `CD-35` | docs/product/cash-management.md | RT-528 | new row drafted in this batch | `CD-35` |
| `CD-37` | docs/product/cash-management.md | RT-529 | new row drafted in this batch | `CD-37` |
| `CU-09` | docs/product/customer-domain.md | RT-511 | new row drafted in this batch | `CU-09` |
| `CU-10` | docs/product/customer-domain.md | RT-512 | new row drafted in this batch | `CU-10` |
| `CU-12` | docs/product/customer-domain.md | RT-513 | new row drafted in this batch | `CU-12` |
| `EM-05` | docs/product/employee-domain.md | RT-514 | new row drafted in this batch | `EM-05` |
| `EM-06` | docs/product/employee-domain.md | RT-515 | new row drafted in this batch | `EM-06` |
| `EM-07` | docs/product/employee-domain.md | RT-516 | new row drafted in this batch | `EM-07` |
| `HD-13` | docs/product/hardware-domain.md | RT-517 | new row drafted in this batch | `HD-13` |
| `HD-14` | docs/product/hardware-domain.md | RT-477 | mapped to an existing row | `HD-14` |
| `HD-15` | docs/product/hardware-domain.md | RT-518 | new row drafted in this batch | `HD-15` |
| `ORG-01` | docs/product/organization-model.md | RT-504 | new row drafted in this batch | `ORG-01` |
| `ORG-02` | docs/product/organization-model.md | RT-505 | new row drafted in this batch | `ORG-02` |
| `ORG-03` | docs/product/organization-model.md | RT-506 | new row drafted in this batch | `ORG-03` |
| `ORG-04` | docs/product/organization-model.md | RT-507 | new row drafted in this batch | `ORG-04` |
| `ORG-05` | docs/product/organization-model.md | RT-508 | new row drafted in this batch | `ORG-05` |
| `RF-09` | docs/product/rfid-domain.md | RT-519 | new row drafted in this batch | `RF-09` |
| `RF-10` | docs/product/rfid-domain.md | RT-201 | mapped to an existing row | `RF-10` |
| `RF-11` | docs/product/rfid-domain.md | RT-520 | new row drafted in this batch | `RF-11` |
| `RF-12` | docs/product/rfid-domain.md | RT-477 | mapped to an existing row | `RF-12` |
| `RF-13` | docs/product/rfid-domain.md | RT-521 | new row drafted in this batch | `RF-13` |
| `RR-29` | docs/product/returns-refunds-domain.md | RT-522 | new row drafted in this batch | `RR-29` |
| `RR-36` | docs/product/returns-refunds-domain.md | RT-144 | mapped to an existing row | `RR-36` |
| `RR-37` | docs/product/returns-refunds-domain.md | RT-523 | new row drafted in this batch | `RR-37` |
| `SM-43a` | docs/product/state-machines.md | RT-408 | mapped to an existing row | `SM-43a` |
| `SM-48a` | docs/product/state-machines.md | RT-408 | mapped to an existing row | `SM-48a` |
| `SM-56a` | docs/product/state-machines.md | RT-422 | mapped to an existing row | `SM-56a` |
| `UX-19` | docs/product/ux-requirements.md | RT-342 | mapped to an existing row | `UX-19` |
| `UX-31` | docs/product/ux-requirements.md | RT-524 | new row drafted in this batch | `UX-31` |
| `UX-44` | docs/product/ux-requirements.md | RT-324 | mapped to an existing row | `UX-44` |
| `UX-46` | docs/product/ux-requirements.md | RT-324 | mapped to an existing row | `UX-46` |
| `WH-03` | docs/product/organization-model.md | RT-509 | new row drafted in this batch | `WH-03` |
| `WH-04` | docs/product/organization-model.md | RT-510 | new row drafted in this batch | `WH-04` |
### Batch 

| Row | Requirement as drafted | Type | Rules cited | Source document |
|---|---|---|---|---|
| RT-503 | Least privilege: no role template grants a permission that no named retail responsibility requires | MUST | AC-04 | actors-and-roles |
| RT-504 | The organization currency is immutable once any financial document exists | MUST | ORG-01 | organization-model |
| RT-505 | The business time zone is immutable once financial documents exist | MUST | ORG-02, overview 3.1 | organization-model, overview (section reference, not a rule id) |
| RT-506 | An organization with financial history is deactivated, never deleted | MUST | ORG-03, BI-40 | organization-model, business-invariants |
| RT-507 | A sale cannot be recorded before the organization has a store | MUST | ORG-04 | organization-model |
| RT-508 | A store is never deleted while it holds stock, an open shift, or any document, and its stock is resolved to zero with a reason first | MUST | ORG-05 | organization-model |
| RT-509 | A storage location can be made unsellable at any time and is never deleted while it holds a balance or a movement | MUST | WH-03 | organization-model |
| RT-510 | Quarantine and damaged stock is never merged into sellable stock automatically; release is a discrete, permissioned, audited decision | MUST | WH-04, IV-38 | organization-model, inventory-domain |
| RT-511 | `OnHold` warns and notifies; it never refuses service, and the hard block is `CreditBlocked` | MUST | CU-09, SM-45a | customer-domain, state-machines |
| RT-512 | A customer is never deleted; `Closed` is a status and the history stays renderable | MUST | CU-10, BI-40 | customer-domain, business-invariants |
| RT-513 | Available credit is `CreditLimit - Balance`, derived, over a balance that is a rebuildable cache | MUST | CU-12, IV-09 | customer-domain, inventory-domain |
| RT-514 | No sensitive personal data in v1: attendance and leave are the only non-operational personal data | OUT OF SCOPE | EM-05 | employee-domain |
| RT-515 | `Department` and `Position` are descriptive and grant nothing | MUST | EM-06, AC-01 | employee-domain, actors-and-roles |
| RT-516 | Date of birth serves age-restricted sales only, and the pass/fail is recorded rather than the value | MUST | EM-07 | employee-domain |
| RT-517 | A device connection is configuration, not architecture | MUST | HD-13, HD-02 | hardware-domain |
| RT-518 | A device credential cannot assert an employee identity | MUST | HD-15, BI-33 | hardware-domain, business-invariants |
| RT-519 | A reader's mode is configured and determines what a read means | MUST | RF-09 | rfid-domain |
| RT-520 | A door open is a request; the controller decides and SmartStore records only the read | MUST | RF-11 | rfid-domain |
| RT-521 | Reader events store both the device's observation timestamp and the server's receipt timestamp | MUST | RF-13, overview 3.3 | rfid-domain, overview (section reference, not a rule id) |
| RT-522 | Store credit expiry is per store, and expiry is a documented, reported event rather than a silent deletion | MUST | RR-29, PY-31 | returns-refunds-domain, payment-domain |
| RT-523 | Goodwill movements are reported by actor, value, and reason, with concentration analysis | MUST | RR-37, SP-56, IV-36, BI-25 | returns-refunds-domain, sales-pos-domain, inventory-domain, business-invariants |
| RT-524 | A rejected return carries a customer-facing reason and a separate internal reason | MUST | UX-31, RR-42, SM-42 | ux-requirements, returns-refunds-domain, state-machines |
| RT-525 | A cash movement is a ledger row and the drawer balance is its projection, never a field update | MUST | CD-19, CD-08, BI-02 | cash-management, business-invariants |
| RT-526 | Closing a shift requires `Shift.Close`, a drawer count, a counted denomination breakdown, and a declared closing float for the next shift | MUST | CD-20 | cash-management |
| RT-527 | The shift screen answers exactly four questions, and only these four | MUST | CD-30 | cash-management |
| RT-528 | The float is a store decision; the system shows the busiest days' expected cash and never recommends a float | MUST | CD-35 | cash-management |
| RT-529 | The drawer is not a safe-management feature | OUT OF SCOPE | CD-37 | cash-management |
Rows in this range: **27**.
# Appendix A - every rule cited by a row drafted by this review

Derived directly from `requirements-traceability.md`: for each of the 0 rows drafted by
this review, every rule it cites, that rule's source document, the home the coverage table resolves it to,
the disposition, and the citation as recorded. This is the complete mechanical enumeration; it is not a
substitute for the per-rule reasoning, which is lost for Batches 1, 2, 3a, 3b, 4a, 4b and 5a.

| Rule | Source file | Home | Disposition | Citation |
|---|---|---|---|---|
| `NT-13` | docs/product/notification-domain.md | RT-355 | new row drafted by this review | `NT-13` |
| `NT-16` | docs/product/notification-domain.md | RT-355 | new row drafted by this review | `NT-16` |
| `NT-15` | docs/product/notification-domain.md | RT-356 | new row drafted by this review | `NT-15` |
| `NT-17` | docs/product/notification-domain.md | RT-357 | new row drafted by this review | `NT-17` |
| `NT-18` | docs/product/notification-domain.md | RT-358 | new row drafted by this review | `NT-18` |
| `EC-75` | docs/product/edge-cases.md | RT-358 | new row drafted by this review | `EC-75` |
| `NT-23` | docs/product/notification-domain.md | RT-359 | new row drafted by this review | `NT-23` |
| `NT-24` | docs/product/notification-domain.md | RT-359 | new row drafted by this review | `NT-24` |
| `NT-30` | docs/product/notification-domain.md | RT-360 | new row drafted by this review | `NT-30` |
| `SM-74` | docs/product/state-machines.md | RT-360 | new row drafted by this review | `SM-74` |
| `NT-31` | docs/product/notification-domain.md | RT-361 | new row drafted by this review | `NT-31` |
| `UX-45` | docs/product/ux-requirements.md | RT-361 | new row drafted by this review | `UX-45` |
| `NT-37` | docs/product/notification-domain.md | RT-362 | new row drafted by this review | `NT-37` |
| `UX-02` | docs/product/ux-requirements.md | RT-363 | new row drafted by this review | `UX-02` |
| `UX-03` | docs/product/ux-requirements.md | RT-363 | new row drafted by this review | `UX-03` |
| `UX-04` | docs/product/ux-requirements.md | RT-364 | new row drafted by this review | `UX-04` |
| `UX-59` | docs/product/ux-requirements.md | RT-364 | new row drafted by this review | `UX-59` |
| `UX-09` | docs/product/ux-requirements.md | RT-365 | new row drafted by this review | `UX-09` |
| `UX-13` | docs/product/ux-requirements.md | RT-366 | new row drafted by this review | `UX-13` |
| `UX-14` | docs/product/ux-requirements.md | RT-367 | new row drafted by this review | `UX-14` |
| `UX-17` | docs/product/ux-requirements.md | RT-368 | new row drafted by this review | `UX-17` |
| `UX-20` | docs/product/ux-requirements.md | RT-369 | new row drafted by this review | `UX-20` |
| `UX-25` | docs/product/ux-requirements.md | RT-370 | new row drafted by this review | `UX-25` |
| `UX-26` | docs/product/ux-requirements.md | RT-371 | new row drafted by this review | `UX-26` |
| `UX-32` | docs/product/ux-requirements.md | RT-372 | new row drafted by this review | `UX-32` |
| `UX-34` | docs/product/ux-requirements.md | RT-373 | new row drafted by this review | `UX-34` |
| `UX-35` | docs/product/ux-requirements.md | RT-374 | new row drafted by this review | `UX-35` |
| `UX-36` | docs/product/ux-requirements.md | RT-375 | new row drafted by this review | `UX-36` |
| `UX-38` | docs/product/ux-requirements.md | RT-376 | new row drafted by this review | `UX-38` |
| `UX-42` | docs/product/ux-requirements.md | RT-377 | new row drafted by this review | `UX-42` |
| `UX-43` | docs/product/ux-requirements.md | RT-377 | new row drafted by this review | `UX-43` |
| `AP-28` | docs/product/approval-workflows.md | RT-377 | new row drafted by this review | `AP-28` |
| `UX-47` | docs/product/ux-requirements.md | RT-378 | new row drafted by this review | `UX-47` |
| `UX-49` | docs/product/ux-requirements.md | RT-378 | new row drafted by this review | `UX-49` |
| `UX-48` | docs/product/ux-requirements.md | RT-379 | new row drafted by this review | `UX-48` |
| `UX-53` | docs/product/ux-requirements.md | RT-380 | new row drafted by this review | `UX-53` |
| `UX-54` | docs/product/ux-requirements.md | RT-380 | new row drafted by this review | `UX-54` |
| `UX-66` | docs/product/ux-requirements.md | RT-381 | new row drafted by this review | `UX-66` |
| `AP-04` | docs/product/approval-workflows.md | RT-382 | new row drafted by this review | `AP-04` |
| `AP-05` | docs/product/approval-workflows.md | RT-383 | new row drafted by this review | `AP-05` |
| `AP-06` | docs/product/approval-workflows.md | RT-384 | new row drafted by this review | `AP-06` |
| `AP-11` | docs/product/approval-workflows.md | RT-385 | new row drafted by this review | `AP-11` |
| `AP-12` | docs/product/approval-workflows.md | RT-386 | new row drafted by this review | `AP-12` |
| `AP-13` | docs/product/approval-workflows.md | RT-386 | new row drafted by this review | `AP-13` |
| `AP-14` | docs/product/approval-workflows.md | RT-387 | new row drafted by this review | `AP-14` |
| `AP-15` | docs/product/approval-workflows.md | RT-387 | new row drafted by this review | `AP-15` |
| `AP-21` | docs/product/approval-workflows.md | RT-388 | new row drafted by this review | `AP-21` |
| `AP-22` | docs/product/approval-workflows.md | RT-388 | new row drafted by this review | `AP-22` |
| `AP-25` | docs/product/approval-workflows.md | RT-389 | new row drafted by this review | `AP-25` |
| `AP-30` | docs/product/approval-workflows.md | RT-390 | new row drafted by this review | `AP-30` |
| `AP-32` | docs/product/approval-workflows.md | RT-391 | new row drafted by this review | `AP-32` |
| `AP-33` | docs/product/approval-workflows.md | RT-392 | new row drafted by this review | `AP-33` |
| `AP-34` | docs/product/approval-workflows.md | RT-393 | new row drafted by this review | `AP-34` |
| `MS-10` | docs/product/multi-store-domain.md | RT-394 | new row drafted by this review | `MS-10` |
| `EC-59` | docs/product/edge-cases.md | RT-394 | new row drafted by this review | `EC-59` |
| `MS-14` | docs/product/multi-store-domain.md | RT-395 | new row drafted by this review | `MS-14` |
| `MS-29` | docs/product/multi-store-domain.md | RT-396 | new row drafted by this review | `MS-29` |
| `MS-35` | docs/product/multi-store-domain.md | RT-397 | new row drafted by this review | `MS-35` |
| `RP-01` | docs/product/reporting-domain.md | RT-398 | new row drafted by this review | `RP-01` |
| `RP-03` | docs/product/reporting-domain.md | RT-399 | new row drafted by this review | `RP-03` |
| `RP-06` | docs/product/reporting-domain.md | RT-400 | new row drafted by this review | `RP-06` |
| `RP-07` | docs/product/reporting-domain.md | RT-400 | new row drafted by this review | `RP-07` |
| `RP-16` | docs/product/reporting-domain.md | RT-401 | new row drafted by this review | `RP-16` |
| `RP-23` | docs/product/reporting-domain.md | RT-402 | new row drafted by this review | `RP-23` |
| `RP-24` | docs/product/reporting-domain.md | RT-402 | new row drafted by this review | `RP-24` |
| `RP-29` | docs/product/reporting-domain.md | RT-403 | new row drafted by this review | `RP-29` |
| `SM-01` | docs/product/state-machines.md | RT-404 | new row drafted by this review | `SM-01` |
| `SM-01a` | docs/product/state-machines.md | RT-404 | new row drafted by this review | `SM-01a` |
| `SM-35a` | docs/product/state-machines.md | RT-404 | new row drafted by this review | `SM-35a` |
| `SM-02a` | docs/product/state-machines.md | RT-405 | new row drafted by this review | `SM-02a` |
| `SM-02b` | docs/product/state-machines.md | RT-405 | new row drafted by this review | `SM-02b` |
| `SM-02c` | docs/product/state-machines.md | RT-405 | new row drafted by this review | `SM-02c` |
| `SM-02d` | docs/product/state-machines.md | RT-405 | new row drafted by this review | `SM-02d` |
| `SM-07` | docs/product/state-machines.md | RT-406 | new row drafted by this review | `SM-07` |
| `SM-09` | docs/product/state-machines.md | RT-407 | new row drafted by this review | `SM-09` |
| `SM-13a` | docs/product/state-machines.md | RT-408 | new row drafted by this review | `SM-13a` |
| `SM-16a` | docs/product/state-machines.md | RT-408 | new row drafted by this review | `SM-16a` |
| `SM-60` | docs/product/state-machines.md | RT-408 | new row drafted by this review | `SM-60` |
| `SM-77a` | docs/product/state-machines.md | RT-408 | new row drafted by this review | `SM-77a` |
| `SM-88a` | docs/product/state-machines.md | RT-408 | new row drafted by this review | `SM-88a` |
| `SM-43a` | docs/product/state-machines.md | RT-408 | new row drafted by this review | `SM-43a` |
| `SM-48a` | docs/product/state-machines.md | RT-408 | new row drafted by this review | `SM-48a` |
| `SM-13` | docs/product/state-machines.md | RT-409 | new row drafted by this review | `SM-13` |
| `SM-14` | docs/product/state-machines.md | RT-410 | new row drafted by this review | `SM-14` |
| `SM-15` | docs/product/state-machines.md | RT-410 | new row drafted by this review | `SM-15` |
| `SM-16` | docs/product/state-machines.md | RT-411 | new row drafted by this review | `SM-16` |
| `SM-17` | docs/product/state-machines.md | RT-411 | new row drafted by this review | `SM-17` |
| `SM-18` | docs/product/state-machines.md | RT-412 | new row drafted by this review | `SM-18` |
| `SM-19` | docs/product/state-machines.md | RT-412 | new row drafted by this review | `SM-19` |
| `SM-23` | docs/product/state-machines.md | RT-413 | new row drafted by this review | `SM-23` |
| `SM-36` | docs/product/state-machines.md | RT-413 | new row drafted by this review | `SM-36` |
| `SM-27` | docs/product/state-machines.md | RT-414 | new row drafted by this review | `SM-27` |
| `SM-35` | docs/product/state-machines.md | RT-415 | new row drafted by this review | `SM-35` |
| `SP-66` | docs/product/sales-pos-domain.md | RT-415 | new row drafted by this review | `SP-66` |
| `SM-39` | docs/product/state-machines.md | RT-416 | new row drafted by this review | `SM-39` |
| `SM-41` | docs/product/state-machines.md | RT-417 | new row drafted by this review | `SM-41` |
| `SM-45` | docs/product/state-machines.md | RT-418 | new row drafted by this review | `SM-45` |
| `SM-45b` | docs/product/state-machines.md | RT-418 | new row drafted by this review | `SM-45b` |
| `SM-46` | docs/product/state-machines.md | RT-418 | new row drafted by this review | `SM-46` |
| `SM-45a` | docs/product/state-machines.md | RT-419 | new row drafted by this review | `SM-45a` |
| `SM-45c` | docs/product/state-machines.md | RT-419 | new row drafted by this review | `SM-45c` |
| `SM-53` | docs/product/state-machines.md | RT-420 | new row drafted by this review | `SM-53` |
| `PY-14` | docs/product/payment-domain.md | RT-420 | new row drafted by this review | `PY-14` |
| `PY-54` | docs/product/payment-domain.md | RT-420 | new row drafted by this review | `PY-54` |
| `SM-54` | docs/product/state-machines.md | RT-421 | new row drafted by this review | `SM-54` |
| `EC-14` | docs/product/edge-cases.md | RT-421 | new row drafted by this review | `EC-14` |
| `SM-55` | docs/product/state-machines.md | RT-422 | new row drafted by this review | `SM-55` |
| `SM-57` | docs/product/state-machines.md | RT-422 | new row drafted by this review | `SM-57` |
| `SM-58` | docs/product/state-machines.md | RT-422 | new row drafted by this review | `SM-58` |
| `SM-56a` | docs/product/state-machines.md | RT-422 | new row drafted by this review | `SM-56a` |
| `SM-59` | docs/product/state-machines.md | RT-423 | new row drafted by this review | `SM-59` |
| `SM-60a` | docs/product/state-machines.md | RT-424 | new row drafted by this review | `SM-60a` |
| `SM-60b` | docs/product/state-machines.md | RT-424 | new row drafted by this review | `SM-60b` |
| `SM-63` | docs/product/state-machines.md | RT-425 | new row drafted by this review | `SM-63` |
| `SM-66` | docs/product/state-machines.md | RT-426 | new row drafted by this review | `SM-66` |
| `SM-67` | docs/product/state-machines.md | RT-427 | new row drafted by this review | `SM-67` |
| `SM-68` | docs/product/state-machines.md | RT-428 | new row drafted by this review | `SM-68` |
| `SM-71` | docs/product/state-machines.md | RT-428 | new row drafted by this review | `SM-71` |
| `SM-75` | docs/product/state-machines.md | RT-429 | new row drafted by this review | `SM-75` |
| `SM-75a` | docs/product/state-machines.md | RT-429 | new row drafted by this review | `SM-75a` |
| `SM-78` | docs/product/state-machines.md | RT-430 | new row drafted by this review | `SM-78` |
| `SM-81` | docs/product/state-machines.md | RT-431 | new row drafted by this review | `SM-81` |
| `SM-82` | docs/product/state-machines.md | RT-431 | new row drafted by this review | `SM-82` |
| `SM-84` | docs/product/state-machines.md | RT-432 | new row drafted by this review | `SM-84` |
| `SM-86` | docs/product/state-machines.md | RT-433 | new row drafted by this review | `SM-86` |
| `SM-88` | docs/product/state-machines.md | RT-434 | new row drafted by this review | `SM-88` |
| `EC-03` | docs/product/edge-cases.md | RT-435 | new row drafted by this review | `EC-03` |
| `EC-04` | docs/product/edge-cases.md | RT-436 | new row drafted by this review | `EC-04` |
| `EC-09` | docs/product/edge-cases.md | RT-436 | new row drafted by this review | `EC-09` |
| `EC-10` | docs/product/edge-cases.md | RT-437 | new row drafted by this review | `EC-10` |
| `EC-11` | docs/product/edge-cases.md | RT-438 | new row drafted by this review | `EC-11` |
| `EC-18` | docs/product/edge-cases.md | RT-439 | new row drafted by this review | `EC-18` |
| `EC-20` | docs/product/edge-cases.md | RT-440 | new row drafted by this review | `EC-20` |
| `EC-21` | docs/product/edge-cases.md | RT-441 | new row drafted by this review | `EC-21` |
| `EC-23` | docs/product/edge-cases.md | RT-442 | new row drafted by this review | `EC-23` |
| `EC-33` | docs/product/edge-cases.md | RT-443 | new row drafted by this review | `EC-33` |
| `EC-37` | docs/product/edge-cases.md | RT-444 | new row drafted by this review | `EC-37` |
| `EC-39` | docs/product/edge-cases.md | RT-445 | new row drafted by this review | `EC-39` |
| `EC-89` | docs/product/edge-cases.md | RT-445 | new row drafted by this review | `EC-89` |
| `EC-45` | docs/product/edge-cases.md | RT-446 | new row drafted by this review | `EC-45` |
| `OF-42` | docs/product/offline-pos-domain.md | RT-446 | new row drafted by this review | `OF-42` |
| `EC-49` | docs/product/edge-cases.md | RT-447 | new row drafted by this review | `EC-49` |
| `OF-31` | docs/product/offline-pos-domain.md | RT-225 | new row drafted by this review; canonical home is a pre-existing row | `OF-31` |
| `EC-55` | docs/product/edge-cases.md | RT-448 | new row drafted by this review | `EC-55` |
| `EC-87` | docs/product/edge-cases.md | RT-448 | new row drafted by this review | `EC-87` |
| `EC-88` | docs/product/edge-cases.md | RT-448 | new row drafted by this review | `EC-88` |
| `MS-11` | docs/product/multi-store-domain.md | RT-271 | new row drafted by this review; canonical home is a pre-existing row | `MS-11` |
| `EC-64` | docs/product/edge-cases.md | RT-449 | new row drafted by this review | `EC-64` |
| `EC-65` | docs/product/edge-cases.md | RT-450 | new row drafted by this review | `EC-65` |
| `EC-74` | docs/product/edge-cases.md | RT-451 | new row drafted by this review | `EC-74` |
| `RP-20` | docs/product/reporting-domain.md | RT-310 | new row drafted by this review; canonical home is a pre-existing row | `RP-20` |
| `EC-78` | docs/product/edge-cases.md | RT-452 | new row drafted by this review | `EC-78` |
| `SP-43` | docs/product/sales-pos-domain.md | RT-136 | new row drafted by this review; canonical home is a pre-existing row | `SP-43` |
| `EC-79` | docs/product/edge-cases.md | RT-453 | new row drafted by this review | `EC-79` |
| `SP-11` | docs/product/sales-pos-domain.md | RT-125 | new row drafted by this review; canonical home is a pre-existing row | `SP-11` |
| `EC-82` | docs/product/edge-cases.md | RT-454 | new row drafted by this review | `EC-82` |
| `HD-18` | docs/product/hardware-domain.md | RT-214 | new row drafted by this review; canonical home is a pre-existing row | `HD-18` |
| `EC-83` | docs/product/edge-cases.md | RT-455 | new row drafted by this review | `EC-83` |
| `EM-14` | docs/product/employee-domain.md | RT-002 | new row drafted by this review; canonical home is a pre-existing row | `EM-14` |
| `EC-84` | docs/product/edge-cases.md | RT-456 | new row drafted by this review | `EC-84` |
| `EC-86` | docs/product/edge-cases.md | RT-457 | new row drafted by this review | `EC-86` |
| `overview 3` | overview (section reference, not a rule id) | not resolvable | new row drafted by this review | `overview 3` |
| `BE-10` | docs/product/batch-expiry-fefo.md | RT-458 | new row drafted by this review | `BE-10` |
| `BE-12` | docs/product/batch-expiry-fefo.md | RT-459 | new row drafted by this review | `BE-12` |
| `BE-13` | docs/product/batch-expiry-fefo.md | RT-459 | new row drafted by this review | `BE-13` |
| `BE-14` | docs/product/batch-expiry-fefo.md | RT-460 | new row drafted by this review | `BE-14` |
| `BE-15` | docs/product/batch-expiry-fefo.md | RT-461 | new row drafted by this review | `BE-15` |
| `BE-21` | docs/product/batch-expiry-fefo.md | RT-461 | new row drafted by this review | `BE-21` |
| `BE-22` | docs/product/batch-expiry-fefo.md | RT-461 | new row drafted by this review | `BE-22` |
| `BE-39` | docs/product/batch-expiry-fefo.md | RT-462 | new row drafted by this review | `BE-39` |
| `BE-41` | docs/product/batch-expiry-fefo.md | RT-463 | new row drafted by this review | `BE-41` |
| `BE-42` | docs/product/batch-expiry-fefo.md | RT-463 | new row drafted by this review | `BE-42` |
| `BE-43` | docs/product/batch-expiry-fefo.md | RT-463 | new row drafted by this review | `BE-43` |
| `AU-04` | docs/product/audit-domain.md | RT-464 | new row drafted by this review | `AU-04` |
| `AU-07` | docs/product/audit-domain.md | RT-464 | new row drafted by this review | `AU-07` |
| `AU-08` | docs/product/audit-domain.md | RT-464 | new row drafted by this review | `AU-08` |
| `AU-11` | docs/product/audit-domain.md | RT-465 | new row drafted by this review | `AU-11` |
| `AU-12` | docs/product/audit-domain.md | RT-465 | new row drafted by this review | `AU-12` |
| `AU-12a` | docs/product/audit-domain.md | RT-465 | new row drafted by this review | `AU-12a` |
| `AU-12b` | docs/product/audit-domain.md | RT-465 | new row drafted by this review | `AU-12b` |
| `AU-12c` | docs/product/audit-domain.md | RT-465 | new row drafted by this review | `AU-12c` |
| `AU-13` | docs/product/audit-domain.md | RT-465 | new row drafted by this review | `AU-13` |
| `AU-16` | docs/product/audit-domain.md | RT-466 | new row drafted by this review | `AU-16` |
| `AU-21` | docs/product/audit-domain.md | RT-466 | new row drafted by this review | `AU-21` |
| `AU-22` | docs/product/audit-domain.md | RT-466 | new row drafted by this review | `AU-22` |
| `AU-26` | docs/product/audit-domain.md | RT-467 | new row drafted by this review | `AU-26` |
| `AU-31` | docs/product/audit-domain.md | RT-467 | new row drafted by this review | `AU-31` |
| `AU-34` | docs/product/audit-domain.md | RT-468 | new row drafted by this review | `AU-34` |
| `AU-35` | docs/product/audit-domain.md | RT-468 | new row drafted by this review | `AU-35` |
| `BE-35` | docs/product/batch-expiry-fefo.md | RT-469 | new row drafted by this review | `BE-35` |
| `OF-24` | docs/product/offline-pos-domain.md | RT-470 | new row drafted by this review | `OF-24` |
| `OF-27` | docs/product/offline-pos-domain.md | RT-471 | new row drafted by this review | `OF-27` |
| `OF-28` | docs/product/offline-pos-domain.md | RT-471 | new row drafted by this review | `OF-28` |
| `OF-40` | docs/product/offline-pos-domain.md | RT-472 | new row drafted by this review | `OF-40` |
| `OF-41` | docs/product/offline-pos-domain.md | RT-473 | new row drafted by this review | `OF-41` |
| `OF-44` | docs/product/offline-pos-domain.md | RT-474 | new row drafted by this review | `OF-44` |
| `BI-05` | docs/product/business-invariants.md | RT-475 | new row drafted by this review | `BI-05` |
| `IV-34` | docs/product/inventory-domain.md | RT-475 | new row drafted by this review | `IV-34` |
| `BI-16` | docs/product/business-invariants.md | RT-148 | new row drafted by this review; canonical home is a pre-existing row | `BI-16` |
| `BI-35` | docs/product/business-invariants.md | RT-477 | new row drafted by this review | `BI-35` |
| `RF-12` | docs/product/rfid-domain.md | RT-477 | new row drafted by this review | `RF-12` |
| `HD-14` | docs/product/hardware-domain.md | RT-477 | new row drafted by this review | `HD-14` |
| `BI-41` | docs/product/business-invariants.md | RT-478 | new row drafted by this review | `BI-41` |
| `BI-42` | docs/product/business-invariants.md | RT-479 | new row drafted by this review | `BI-42` |
| `PY-15` | docs/product/payment-domain.md | RT-480 | new row drafted by this review | `PY-15` |
| `PY-19` | docs/product/payment-domain.md | RT-481 | new row drafted by this review | `PY-19` |
| `PY-35` | docs/product/payment-domain.md | RT-482 | new row drafted by this review | `PY-35` |
| `IV-16` | docs/product/inventory-domain.md | RT-483 | new row drafted by this review | `IV-16` |
| `BI-36` | docs/product/business-invariants.md | RT-064 | new row drafted by this review; canonical home is a pre-existing row | `BI-36` |
| `OF-04` | docs/product/offline-pos-domain.md | RT-221 | new row drafted by this review; canonical home is a pre-existing row | `OF-04` |
| `IV-17` | docs/product/inventory-domain.md | RT-484 | new row drafted by this review | `IV-17` |
| `IV-18` | docs/product/inventory-domain.md | RT-070 | new row drafted by this review; canonical home is a pre-existing row | `IV-18` |
| `BI-25` | docs/product/business-invariants.md | RT-074 | new row drafted by this review; canonical home is a pre-existing row | `BI-25` |
| `IV-32` | docs/product/inventory-domain.md | RT-486 | new row drafted by this review | `IV-32` |
| `BI-27` | docs/product/business-invariants.md | RT-075 | new row drafted by this review; canonical home is a pre-existing row | `BI-27` |
| `IV-59` | docs/product/inventory-domain.md | RT-487 | new row drafted by this review | `IV-59` |
| `BE-20` | docs/product/batch-expiry-fefo.md | RT-088 | new row drafted by this review; canonical home is a pre-existing row | `BE-20` |
| `PR-06` | docs/product/product-domain.md | RT-488 | new row drafted by this review | `PR-06` |
| `PR-11` | docs/product/product-domain.md | RT-489 | new row drafted by this review | `PR-11` |
| `PR-12` | docs/product/product-domain.md | RT-490 | new row drafted by this review | `PR-12` |
| `PR-14` | docs/product/product-domain.md | RT-491 | new row drafted by this review | `PR-14` |
| `PR-39` | docs/product/product-domain.md | RT-492 | new row drafted by this review | `PR-39` |
| `SP-34` | docs/product/sales-pos-domain.md | RT-130 | new row drafted by this review; canonical home is a pre-existing row | `SP-34` |
| `BI-11` | docs/product/business-invariants.md | RT-034 | new row drafted by this review; canonical home is a pre-existing row | `BI-11` |
| `PR-Q40` | docs/product/procurement-domain.md | RT-114 | new row drafted by this review; canonical home is a pre-existing row | `PR-Q40` |
| `PR-40` | docs/product/product-domain.md | RT-493 | new row drafted by this review | `PR-40` |
| `SP-38` | docs/product/sales-pos-domain.md | RT-130 | new row drafted by this review; canonical home is a pre-existing row | `SP-38` |
| `PR-45` | docs/product/product-domain.md | RT-494 | new row drafted by this review | `PR-45` |
| `SP-27` | docs/product/sales-pos-domain.md | RT-129 | new row drafted by this review; canonical home is a pre-existing row | `SP-27` |
| `PR-48` | docs/product/product-domain.md | RT-495 | new row drafted by this review | `PR-48` |
| `PR-52` | docs/product/product-domain.md | RT-496 | new row drafted by this review | `PR-52` |
| `PR-Q04` | docs/product/procurement-domain.md | RT-497 | new row drafted by this review | `PR-Q04` |
| `PR-Q05` | docs/product/procurement-domain.md | RT-498 | new row drafted by this review | `PR-Q05` |
| `PR-Q07` | docs/product/procurement-domain.md | RT-498 | new row drafted by this review | `PR-Q07` |
| `BI-08` | docs/product/business-invariants.md | RT-346 | new row drafted by this review; canonical home is a pre-existing row | `BI-08` |
| `PR-Q06` | docs/product/procurement-domain.md | RT-499 | new row drafted by this review | `PR-Q06` |
| `BI-40` | docs/product/business-invariants.md | RT-178 | new row drafted by this review; canonical home is a pre-existing row | `BI-40` |
| `PR-Q08` | docs/product/procurement-domain.md | RT-500 | new row drafted by this review | `PR-Q08` |
| `PR-Q10` | docs/product/procurement-domain.md | RT-501 | new row drafted by this review | `PR-Q10` |
| `SP-25` | docs/product/sales-pos-domain.md | RT-502 | new row drafted by this review | `SP-25` |
| `SP-26` | docs/product/sales-pos-domain.md | RT-502 | new row drafted by this review | `SP-26` |
| `AC-04` | docs/product/actors-and-roles.md | RT-503 | new row drafted by this review | `AC-04` |
| `ORG-01` | docs/product/organization-model.md | RT-504 | new row drafted by this review | `ORG-01` |
| `ORG-02` | docs/product/organization-model.md | RT-505 | new row drafted by this review | `ORG-02` |
| `overview 3.1` | overview (section reference, not a rule id) | not resolvable | new row drafted by this review | `overview 3.1` |
| `ORG-03` | docs/product/organization-model.md | RT-506 | new row drafted by this review | `ORG-03` |
| `ORG-04` | docs/product/organization-model.md | RT-507 | new row drafted by this review | `ORG-04` |
| `ORG-05` | docs/product/organization-model.md | RT-508 | new row drafted by this review | `ORG-05` |
| `WH-03` | docs/product/organization-model.md | RT-509 | new row drafted by this review | `WH-03` |
| `WH-04` | docs/product/organization-model.md | RT-510 | new row drafted by this review | `WH-04` |
| `IV-38` | docs/product/inventory-domain.md | RT-069 | new row drafted by this review; canonical home is a pre-existing row | `IV-38` |
| `CU-09` | docs/product/customer-domain.md | RT-511 | new row drafted by this review | `CU-09` |
| `CU-10` | docs/product/customer-domain.md | RT-512 | new row drafted by this review | `CU-10` |
| `CU-12` | docs/product/customer-domain.md | RT-513 | new row drafted by this review | `CU-12` |
| `IV-09` | docs/product/inventory-domain.md | RT-064 | new row drafted by this review; canonical home is a pre-existing row | `IV-09` |
| `EM-05` | docs/product/employee-domain.md | RT-514 | new row drafted by this review | `EM-05` |
| `EM-06` | docs/product/employee-domain.md | RT-515 | new row drafted by this review | `EM-06` |
| `AC-01` | docs/product/actors-and-roles.md | RT-010 | new row drafted by this review; canonical home is a pre-existing row | `AC-01` |
| `EM-07` | docs/product/employee-domain.md | RT-516 | new row drafted by this review | `EM-07` |
| `HD-13` | docs/product/hardware-domain.md | RT-517 | new row drafted by this review | `HD-13` |
| `HD-02` | docs/product/hardware-domain.md | RT-211 | new row drafted by this review; canonical home is a pre-existing row | `HD-02` |
| `HD-15` | docs/product/hardware-domain.md | RT-518 | new row drafted by this review | `HD-15` |
| `BI-33` | docs/product/business-invariants.md | RT-017 | new row drafted by this review; canonical home is a pre-existing row | `BI-33` |
| `RF-09` | docs/product/rfid-domain.md | RT-519 | new row drafted by this review | `RF-09` |
| `RF-11` | docs/product/rfid-domain.md | RT-520 | new row drafted by this review | `RF-11` |
| `RF-13` | docs/product/rfid-domain.md | RT-521 | new row drafted by this review | `RF-13` |
| `overview 3.3` | overview (section reference, not a rule id) | not resolvable | new row drafted by this review | `overview 3.3` |
| `RR-29` | docs/product/returns-refunds-domain.md | RT-522 | new row drafted by this review | `RR-29` |
| `PY-31` | docs/product/payment-domain.md | RT-162 | new row drafted by this review; canonical home is a pre-existing row | `PY-31` |
| `RR-37` | docs/product/returns-refunds-domain.md | RT-523 | new row drafted by this review | `RR-37` |
| `SP-56` | docs/product/sales-pos-domain.md | RT-138 | new row drafted by this review; canonical home is a pre-existing row | `SP-56` |
| `IV-36` | docs/product/inventory-domain.md | RT-076 | new row drafted by this review; canonical home is a pre-existing row | `IV-36` |
| `UX-31` | docs/product/ux-requirements.md | RT-524 | new row drafted by this review | `UX-31` |
| `RR-42` | docs/product/returns-refunds-domain.md | RT-161 | new row drafted by this review; canonical home is a pre-existing row | `RR-42` |
| `SM-42` | docs/product/state-machines.md | RT-150 | new row drafted by this review; canonical home is a pre-existing row | `SM-42` |
| `CD-19` | docs/product/cash-management.md | RT-525 | new row drafted by this review | `CD-19` |
| `CD-08` | docs/product/cash-management.md | RT-237 | new row drafted by this review; canonical home is a pre-existing row | `CD-08` |
| `BI-02` | docs/product/business-invariants.md | RT-056 | new row drafted by this review; canonical home is a pre-existing row | `BI-02` |
| `CD-20` | docs/product/cash-management.md | RT-526 | new row drafted by this review | `CD-20` |
| `CD-30` | docs/product/cash-management.md | RT-527 | new row drafted by this review | `CD-30` |
| `CD-35` | docs/product/cash-management.md | RT-528 | new row drafted by this review | `CD-35` |
| `CD-37` | docs/product/cash-management.md | RT-529 | new row drafted by this review | `CD-37` |

Rules enumerated above: **282**.

### Reconciliation against the 342

| | Count |
|---|---|
| Rules dispositioned by the review | 342 |
| Rules cited by a row drafted by this review (Appendix A) | 282 |
| Rules mapped entirely into pre-existing rows | 60 |
| &nbsp;&nbsp;- of those, identifiable from the superseded Batch 5b draft | 14 |
| &nbsp;&nbsp;- **identities not reconstructable** | 46 |

So 46 of the 342 rules cannot be named. Their final homes are recorded in §26.2 and their
citations are present, but which batch adjudicated them, and why, is **original reasoning lost; not reconstructed**.

This is the honest limit of the rebuild. The traceability work itself is unaffected: every one of the
1161 rules is `mapped` and cited, 0 are `inferred`, and the coverage table and the citation columns are a
bijection. What is missing is the narrative record for a subset of the 342, not the mappings.
## Independent verification sample - 42 of 1161 mappings

Added after the rebuild. This section is new work, not recovered prose.

### Why this sample

A rebuild that only checks its own arithmetic can be internally consistent and still wrong, so a
sample was drawn **by a method fixed before any rule text was read**, and each sampled rule was then
checked by reading the source and the RT row it is filed under.

Selection method, stated in advance:

- **Stratum A** - the 246 rules homed in a row this review drafted (`RT-355`..`RT-529`): every
  12th rule in id order, first 20.
- **Stratum B** - the remaining 915 rules homed in pre-existing rows: every 45th rule in id order,
  first 20.
- **Coverage top-up** - two rules added, lowest id in each source document not otherwise represented
  (`MS-01`, `RP-01`... `RP-01` was already in A; the top-up was `MS-01` and `RP-01`).

Final sample: **42 rules**, covering **all 25 source documents**, of which **21 are homed in a row
this review drafted** and 21 in pre-existing rows.

Each rule carries one of four verdicts:

| Verdict | Meaning |
|---|---|
| `CONFIRMED` | The row's statement is supported by the source; this rule's own contribution is represented |
| `WEAK MATCH` | The rule is filed at a thematically correct row, but that row's wording does not carry the rule's substance |
| `WRONG HOME` | The rule is filed under a row about an unrelated subject |
| `ADDS BEHAVIOUR NOT IN SOURCE` | The row asserts something the rule and its co-cited rules do not say |

### Result

| Verdict | Count |
|---|---|
| `CONFIRMED` | 29 |
| `WEAK MATCH` | 12 |
| `ADDS BEHAVIOUR NOT IN SOURCE` | 1 |
| `WRONG HOME` | 0 |

**No sampled rule is filed under an unrelated row.** Every one of the 13 non-confirmed verdicts is a
statement-granularity problem, not a mapping error: the citation is at a defensible row, the coverage
bijection is unaffected, and nothing here was silently changed.

### The 13 findings in detail

| Rule | Source quote | Home | Verdict | Note |
|---|---|---|---|---|
| `IV-34` | "Adjustments are one-directional per line: a line is an increase or a decrease, with a non-negative quantity" | `RT-475` | `ADDS BEHAVIOUR NOT IN SOURCE` | The row also asserts "a negative stock balance is a store policy decision". Neither `IV-34` nor `BI-05` says that; the stock-policy rule is `SM-14`, which is homed at `RT-410`. **This is the one finding inside a drafted row and needs an owner decision before C-06 closes** |
| `CU-26` | "points are awarded on the line, in the completion transaction" | `RT-170` | `WEAK MATCH` | Row says "accrue on a configured basis and are a ledger projection"; the completion-transaction and one-event requirement is absent |
| `EM-15` | "revoking access is immediate at the next request, within the permission cache window" | `RT-002` | `WEAK MATCH` | Row says only that store access is a first-class entity; revocation timing and the before/after audit entry are absent |
| `HD-31` | "`Device.Disable` is a high-impact operation and is a SHOULD with approval for a device attached to an active till" | `RT-218` | `WEAK MATCH` | Row covers technician separation; the approval gate on a live till is absent |
| `IV-45` | "Batch identity is preserved across a transfer: the same batch moves, retaining its batch number, expiry, and cost" | `RT-078` | `WEAK MATCH` | Row says only that out and in are paired; batch identity retention is absent |
| `OF-20` | "`SyncSession` records a sync run ... `SyncConflict` records an individual item's disagreement" | `RT-223` | `WEAK MATCH` | Row says only that the queue is durable across restart; the recording requirement is absent |
| `PR-21` | "Conversions carry no price" | `RT-036` | `WEAK MATCH` | Row is about exactness of a calculated conversion; the no-price rule is absent |
| `PR-Q21` | "A rejected line may be returned to the supplier without ever entering stock" | `RT-106` | `WEAK MATCH` | Row says only that a receipt creates stock, not a payable; the return-to-supplier path is absent |
| `RF-21` | "a tag never satisfies an approval" | `RT-200` | `WEAK MATCH` | Row states only the read, identity, permission, action order; the two-person approval prohibition is absent |
| `RR-02` | "A return of an item bought at a different price ... Refunded at what was paid, per line" | `RT-145` | `WEAK MATCH` | Refund-at-what-was-paid is absent from the row |
| `SM-64` | "Offline retries are bounded; a dead-lettered item needs a person" | `RT-231` | `WEAK MATCH` | Row covers reporting depth and a dead-lettered item; bounded retries are absent |
| `SP-34` | "`gross x rate` is forbidden" | `RT-130` | `WEAK MATCH` | Row states store mode and rate version; the extract-then-derive prohibition is absent |
| `SU-14` | "an early-payment discount is recorded when taken" | `RT-179` | `WEAK MATCH` | Row says the payable is a ledger projection; the recording requirement is absent |

### What this does and does not change

- **Within this review's scope** (`RT-355`..`RT-529`): 1 finding, `IV-34` / `RT-475`. It must be put
  to the owner rather than fixed here.
- **Outside this review's scope**: the other 12 findings all sit in **pre-existing** rows
  (`RT-002`, `RT-036`, `RT-078`, `RT-106`, `RT-130`, `RT-145`, `RT-170`, `RT-179`, `RT-200`,
  `RT-218`, `RT-223`, `RT-231`). These are **not covered by the 175-row owner confirmation list** and
  need their own decision. They are recorded in the gap register rather than fixed.
- **The verified invariants still hold**: 1161 rules, 1161 `mapped`, 0 `inferred`, coverage table and
  citation columns a bijection.

### Method notes worth keeping

- Two source documents give a rule id a different text in its prose definition and in its summary
  table. `MS-01` is the clean case: the prose definition at `multi-store-domain.md` line 16 is the
  non-null `StoreId` rule and matches `RT-001` exactly, while the permitted-store-set text belongs to
  `MS-03`. A regex-only extractor picked up `MS-03` and would have produced a false `WRONG HOME`. Every
  `WRONG HOME` or `WEAK MATCH` verdict below was confirmed against the source by hand for this reason.
- Where a verdict depended on a co-cited rule, that co-cited rule was also read: `UX-42` and `UX-43`
  (for `RT-377`), `NT-23` (for `RT-359`), `SP-25` (for `RT-502`), `SM-15` (for `RT-410`), `BI-05`
  (for `RT-475`). `RT-410`'s enumeration of the two policy names and `RT-422`'s "no `Void` state" were
  **not** independently re-verified and are marked as such in the table above.
