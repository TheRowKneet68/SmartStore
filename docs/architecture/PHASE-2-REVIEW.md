# Phase 2 Review

**The review of Phase 2 (architecture) carried out at the Phase-2/Phase-3 boundary.**

What this document is: the verification record of the closure pass — what was checked, what was re-measured, what
was corrected, and what remains open. It is the companion to
[PRE-PHASE-3-GAP-REGISTER.md](PRE-PHASE-3-GAP-REGISTER.md) and [OWNER-DECISIONS.md](OWNER-DECISIONS.md).

What this document is not: a re-derivation of the architecture. `PHASE-2-ARCHITECTURE.md` is the architecture;
this is its boundary review.

---

## 1. What was verified (independent of the claims)

Every claim below was re-measured against the primary sources, not taken on trust from the document that made it.

| Claim | Measured | Source |
|---|---|---|
| Appendix A classifies 320 inferred rules | 320 rows: CONFIRMED 232, CONTRADICTORY 21, DUPLICATE 21, MISSING DEPENDENCY 18, OUT-OF-SCOPE 16, AMBIGUOUS 12; UNKNOWN 0 | PHASE-1-REVIEW.md Appendix A |
| "232 confirmed rules not mapped to requirement rows" | True as a traceability-only statement: 232 of the 320 are CONFIRMED with no requirement row. The other 88 are the defective classes (21+21+18+16+12) | PHASE-1-REVIEW Appendix A |
| Coverage appendix §26.2 rows | **1161** total = **819** mapped + **342** inferred (335 rule ids + 7 `PR-Q` ids); UNMAPPED 0 | requirements-traceability.md §26.2 |
| §26 header / §26.3 summary | **STALE before this pass**: claimed 1139 / 819 / 320. **Corrected to 1161 / 819 / 342.** Same correction applied to PHASE-1-REVIEW §1 table, §4, §7, and GR-01/GR-06 | this pass |
| All 22 Phase-1 correction rules present in §26.2 | True; 1 of 22 fails a strict regex match but is present as `PR-Q06a` (line 1339) | this pass |
| 13 undefined permission keys | **REFUTED 2026-09-29.** Originally read "True" for `Product.Edit`, `Purchase.Order.Submit`, `Purchase.Order.Approve`, `Purchase.Order.Send`, `Customer.Edit`, `Employee.Create`, `Employee.Edit`, `Device.Register`, `Device.Edit`, `Device.Disable`, `Shift.Close`, `Inventory.Count.Post`, `Inventory.Transfer.Receive`. All 13 are in fact **defined** in `actors-and-roles.md` §2 (lines 39, 59, 61, 72, 105, 126, 146, 152); they are simply reachable only through §4 wildcard template grants. D-01 kept all 13 as written. The `‡` markers asserting otherwise were removed from the 29 affected §22 rows | `state-machines.md` §22.0.1 (corrected) |
| 29 transitions / 8 machines affected | **PARTLY REFUTED 2026-09-29.** Originally read "True (56 of 119 §22 rows are `OPEN DECISION` or undefined-key; the 29/29 split is measured)". The measured split is 29 keys-resolved + **27** no-key, not 29/29, and the buckets now sum to 117 against a 118-row body. The **27 no-key** rows were never registered and are now tracked as `GAP-036` | `state-machines.md` §22, §22.0.2 |
| 5 missing audit event types | True: `Inventory.FEFOOverride`, `Offline.SyncAppliedWithAdjustment`, `Product.Archive`, `Employee.Terminate`, `Audit.EventExpired`; each traced to a source rule (BE FEFO-override, OF-36/SM-65, PR-47, EM-10, retention expiry) | audit-domain §3 AU-12b |
| Credit has no due date in v1 | True: CON-06, NT-37 note, notification-domain:69-70 (`CreditOverdue` deliberately absent) | customer-domain, notification-domain |
| EC-65 dependent on an undefined dunning policy | True: no rule defines a dunning policy | edge-cases.md EC-65 |
| Payable timing genuinely open | **True when written, now DECIDED.** Originally "True: SM-29 says `ApprovedForPayment`; procurement-domain §5 says 'an invoice creates a payable' without a state; mapped to RT-106/RT-109; RT-110 disputed→no payable; review defect 9 keeps `OPEN DECISION`". The owner decided D-02 in favour of `ApprovedForPayment`; `GAP-001` is corrected and `SM-29`/`SU-09`/`BI-38`/`RT-109`/`RT-110` now agree. The `→ ApprovedForPayment` **permission** is still unnamed and is tracked in `GAP-036` | `state-machines` §22.5; PHASE-1-REVIEW §8.1; OWNER-DECISIONS D-02 |

## 2. What was corrected in this pass

1. `requirements-traceability.md` §26 header: "1139 defined rules" → **1161**.
2. `requirements-traceability.md` §26.3: defined rules **1139→1161**, inferred **320→342**; backlog text updated
   (342 = 335 rule ids + 7 PR-Q ids).
3. `requirements-traceability.md` GR-01 and GR-06: 320 → 342, with the composition (and the "320 at audit time
   + 22 added by correction pass") recorded.
4. `PHASE-1-REVIEW.md` §1 count table: 1139 → **1161**, 320 → **342** (defined / inferred rows).
5. `PHASE-1-REVIEW.md` §4: opening "320 rules are cited by no requirement row" → **342**; the "all 320 read and
   classified" note now distinguishes the 320 audit-time rules (Appendix A) from the 22 added by the correction
   pass, without retro-editing Appendix A (which §8.2 says stays the audit-time record).
6. `PHASE-1-REVIEW.md` §7: "All 320 rules in the coverage appendix" → **342** with the same distinction.

No evidence was altered to fit a count. All corrections are arithmetic and both documents now agree.

## 3. The residual OPEN DECISIONs — deliberately not closed here

These are owner decisions (see OWNER-DECISIONS.md). None was decided in this pass:

| Gate | Question | Key evidence |
|---|---|---|
| GATE-PAYABLE | When does a payable exist? | **DECIDED (D-02): at `ApprovedForPayment`.** SM-29, SU-09, BI-38, RT-109, RT-110 now agree |
| GATE-PERMKEYS | Who holds the 13 keys? | **DECIDED (D-01): all 13 are already defined in `actors-and-roles.md` §2; kept as written, assigned via the existing wildcard grants, `Purchase.Order.*` separation of duties enforced explicitly.** SM-02d; §22.0.1 (corrected) |
| GATE-Q1 | One or several attributions for a warehouse location? | **DECIDED (D-03):** the explicit `(StorageLocation, Store)` model. §23.4 |
| GATE-OFFLINE-INVENTORY | Reservation or reconcile? | **DECIDED (D-04): allow-and-reconcile.** OF-02/03/38, IV-49 |
| GATE-Q4-DUNNING | Does store credit have a due date? | **DECIDED (D-05): no.** CON-06, EC-65 (corrected), NT-37 |
| GATE-AUDITTYPES | Event types for open audit cells | **DECIDED (D-06): 20 per-machine types; cells mapped; the remaining cell (dead-letter) resolved by D-07.** AU-11/12/13 |
| GATE-DEADLETTER | Does the server see a dead-letter status? | **DECIDED (D-07): no — client-only retention.** OF-29, SM-64a |
| GATE-NOTIFICATION-STATES | Notification states owner | **DECIDED (D-08): `Unread`/`Read`/`Acknowledged`, owned by notification-domain §7.** NT-28, NT-30, SM-72, RT-324 |
| GATE-STOCKCOUNT-STATES | StockCount states owner | **DECIDED (D-09): `Open`/`Posted`/`Cancelled`/`Reversed`, owned by inventory-domain §8.3.** IV-25..31, SM-81..83 |
| GATE-Q2-LICENCE | Distribution licence | **DECIDED (D-10): sold/commercial**; no licence named, OSS-terms review pre-release. GR-04 |

Plus one remaining non-gate decision, now split: the tax **mechanism** is decided and documented (GAP-013), while
the **jurisdictional legal facts** remain owner+legal work tracked as GAP-044 and are a release blocker, not a schema
input. Loyalty accrual basis is **DECIDED (D-11): net of discount, excluding tax** (CU-25, RR-41) — a config value,
no schema change.

## 4. Phase 2 verdict

**Phase 2 produced a complete, internally consistent, citation-verified architecture** (30/30 sections, 30/30
ADRs, 10/10 gates, 46/46 cited IDs defined; a single pre-existing broken link in the frozen
`repository-analysis/license-matrix.md`). The boundary review found the count-related stale text in
`requirements-traceability.md` and `PHASE-1-REVIEW.md` (fixed here) and confirmed every closed question has its
evidence line.

**Correction, 2026-09-29 (final closure pass).** This section previously read "ten gates are open by design,
because they are owner decisions, not documentation gaps". **That is no longer true: all ten are now decided**
(D-01..D-11). The remaining Phase 3 gate is not a gate at all but the traceability backlog C-06, and it is a
traceability-coverage defect rather than a design gap. The correct statement is: Phase 2 is **complete**, and
Phase 3 may not start while C-06 stands (see PHASE-3-ENTRY-CRITERIA.md and GAP-035).

## 5. Known risks carried into Phase 3

- **The 342-rule traceability backlog (C-06) is the only remaining Phase 3 gate.** Measured 2026-09-29, 73 of the
  342 homes point at requirement rows that are themselves OUT OF SCOPE and 132 point at two generic catch-all rows,
  so the generated assignments cannot simply be re-labelled `mapped` (GAP-035).
- 27 transitions across 8 machines name no permission key at all. Behaviour is specified (refuse, §29.1) so the
  schema is unaffected, but the features they carry are not. Never registered before 2026-09-29 (GAP-036).
- A `MUST`-level contradiction: `RT-067`/`EC-01` require exactly one success on a concurrent last-unit sale, while
  `BI-36` and the `AllowNegative` default (`CON-07`) permit both to succeed with a flagged negative balance. `BI-36`
  still fixes the build, so this is not a schema blocker, but the requirement set is not coherent until the owner
  decides (GAP-037). Two linked citation defects (`EC-01`→`BI-02`, `RT-067`→`BI-37`) fall out of the same decision.
- `Terminated` does not require live-session revocation although `Suspended` does; a live session surviving
  termination is an authentication-bypass path (GAP-040).
- 13 `REPORTED` cross-domain findings are unverified and non-load-bearing until read in the primary source. One of
  them — session revocation — has now been read and narrowed to GAP-040; the wider form of its claim was refuted,
  because `EC-45` does already revoke the session on role removal.
- `CU-17` uses the phrase "overdue balance" while D-05 records no credit due date in v1 — a wording flag,
  preserved as-is per the D-05 directive (CU-12..CU-23 unchanged); "overdue" is loose prose, not a due-date rule.
- `AU-31`: database-administrator write access to the audit store is a documented, chain-mitigated risk, not a
  solved one — the external log shipper decision is Phase 2 infra, outstanding.
- The consistency sweep has been executed (2026-09-29): every SmartStore permission is `Sale.*`. The single
  remaining `Sales.*` occurrence quotes the surveyed system's hazard and is deliberately unchanged (GAP-031).