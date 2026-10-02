# Pre-Phase-3 Gap Register

**Master register of every gap, decision, and open question that stands between Phase 2 (architecture) and
Phase 3 (implementation).**

Status: **DRAFT — PRE-PHASE-3**
Owner: SmartStore documentation set.
Derived from: `requirements-traceability.md`, `PHASE-1-REVIEW.md`, `state-machines.md`, `PHASE-2-ARCHITECTURE.md`,
and the product domain documents. Every claim below is traceable to a file and line; nothing here is invented.

## 1. Statuses used in this register

| Status | Meaning |
|---|---|
| `RESOLVED` | The existing documentation answers the question; no owner decision required |
| `DECIDED` | An owner decision has been taken, is recorded in `OWNER-DECISIONS.md`, and has been applied to the specification |
| `OPEN DECISION` | A business or owner-only decision. Documented, options named, **not picked here** |
| `OPEN SPECIFICATION` | A specification gap. Behavior is governed by rules, but a needed document or detail does not exist |
| `DEFERRED` | Explicitly out of scope for a stated version |
| `OUT OF SCOPE` | Emphatically not in scope, named in the owning document |
| `BLOCKER` | Blocks Phase 2 or Phase 3 unless closed |
| `NON-BLOCKING` | Open but does not block the phase |
| `UNKNOWN` | Cannot be determined from the documentation as it stands |

No gap below is marked `RESOLVED` without the evidence line that supports it. No `OPEN DECISION` is resolved on
the owner's behalf.

## 2. The 20 fields

Each gap row carries: `ID`, `Domain`, `Description`, `Evidence`, `Current Status`, `Type`, `Impact`, `Phase
affected`, `Can documentation resolve it?`, `Requires owner decision?`, `Database impact`, `Security impact`,
`Financial/inventory impact`, `Recommended action`, `Final decision/status`, plus `Priority`, `Source`, `Gate`,
`Resolved by`, `Notes`.

> **Known cosmetic defect, recorded 2026-09-29 rather than guessed at.** A field-count check over this table found
> seven pre-existing rows that do not carry exactly 20 cells: `GAP-006`, `GAP-008`, `GAP-010`, `GAP-015`,
> `GAP-027`, `GAP-028`, `GAP-029` carry 21, because prose was placed in a column that the header does not define
> (for example `GAP-006`'s CU-17 "overdue balance" note sits in the Security-impact column). They render with
> misaligned columns but no content is lost and no status is ambiguous. Repairing them means choosing which
> header column each note belongs to, which is an editorial judgement about prose, not a factual correction, so it
> was **left alone and recorded here** instead of being silently rearranged. `GAP-034`'s missing trailing `Notes`
> cell was restored, and all rows added on 2026-09-29 (`GAP-035`..`GAP-044`) carry the full 20 fields.

## 3. The register

| ID | Domain | Description | Evidence | Current Status | Type | Impact | Phase affected | Can documentation resolve it? | Requires owner decision? | Database impact | Security impact | Financial/inventory impact | Recommended action | Final decision/status | Priority | Source | Gate | Resolved by | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GAP-001 | Payable | When a supplier payable exists: at invoice `Matched` or at `ApprovedForPayment`? The two answers put the same invoice on the liability ledger on different dates | state-machines §22.5 note: `SM-29` says payable is created at `ApprovedForPayment`; `procurement-domain §5` says "an invoice creates a payable" without naming a state; mapped to `RT-106`, `RT-109`. `RT-110`: disputed invoice creates no payable | DECIDED | Business decision | **High** | Phase 2 (ledger + schema) | No | **Yes — decided (D-02)** | Ledger posting date and outstanding-payable column differ | None directly | Real balance difference on AP ledger (SU-09) | Applied: the owner chose `ApprovedForPayment`; the state is now named wherever the payable is described | DECIDED — (b) the payable is created at `ApprovedForPayment` | High | PHASE-1-REVIEW §8.1 defect 9 | GATE-PAYABLE | OWNER-DECISIONS.md D-02 | Historical: the review ranked this business-decision blocker #1. D-02 chose (b). `SM-29`, `SU-09`, `BI-38`, `RT-109`, and `RT-110` now agree; `RT-110`'s disputed-invoice exception is unchanged. |
| GAP-002 | Access model | 13 permission keys required by state transitions were reported absent from the access-model catalogue, blocking 29 transitions across 8 machines | state-machines §22.0.1 table; `SM-02d`; architecture §8.4; **premise refuted 2026-09-29** — all 13 keys are present in `actors-and-roles.md` §2 (lines 39, 59, 61, 72, 105, 126, 146, 152) and resolve through the existing wildcard template grants | DECIDED | Missing dependency — premise corrected | **High** | Phase 2 (access model + schema) | Partly | **Yes — decided (D-01)** | None: the 13 keys need no new columns and no new templates | Resolved, subject to the `Purchase.Order.*` division-of-duty conditions D-01 attaches | Lifecycle features enabled once the grant set is built | D-01 option (a): keep all 13 keys exactly as written, assign them through the existing wildcard template grants, and enforce the `Purchase.Order.*` separation of duties explicitly | DECIDED — (a): no new templates, no renamed keys | High | SM-02d; state-machines §22.0.1 | GATE-PERMKEYS | OWNER-DECISIONS.md D-01 | Historical: this row was BLOCKER and asserted a real catalogue gap. The Constitution Enforcement Test (2026-09-29) found all 13 keys already present — what was actually open is that none is granted as a **standalone** permission, each being reachable only through a wildcard. Closed on the corrected premise, not on the original claim. The `‡` markers that carried the refuted claim are removed in state-machines §22.0/§22.0.1. The **distinct** population of 27 transitions that name **no key at all** was never registered and is tracked in GAP-026. |
| GAP-003 | Offline + inventory | Ownership of a unit of stock sold offline: server-side reservation before sale, or apply-and-reconcile? | OF-02 (server asked later), OF-03 (offline requires AllowNegative), OF-38 (two terminals sell last unit; both apply; negative recorded), IV-49 (no implicit reservation at the till) | DECIDED | Business/design decision | **High** | Phase 2 (schema, reservations, negative-stock reporting) | Partly | **Yes** | Reservation vs reconciliation model | None | Reported negative balance is the reconciled outcome (IV-17) | Document A/B per architecture §11.4; code refuses guessing | DECIDED — (b) allow-and-reconcile | High | architecture §11.4 | GATE-OFFLINE-INVENTORY | OWNER-DECISIONS.md D-04 | Same question as D-03, viewed twice; attribution resolved by the D-03 explicit `(StorageLocation, Store)` model. Reservations only exist for explicit dated holds (IV-46-49); the offline case is allow-and-reconcile (OF-38) |
| GAP-004 | Multi-store | Does one central-warehouse location carry one store attribution or several? | MS-16/MS-19 (central-warehouse stock store-attributed by originating store; MS-17 identifies by variant+location only); organization-model §8.2; EC-91 fixes v1 to one store; architecture §23.4 | OPEN DECISION | Schema decision | **Medium** | Phase 2 (schema) | No | **Yes** | StoreId cardinality on stock-location | None | Reporting attribution only | Options A/B documented in architecture §23.4 | OPEN DECISION | High | MR-16/MS-19; review §10; architecture §23.4 | GATE-Q1 | OWNER-DECISIONS.md | Only schema-constraining question (architecture §29.3); moot in v1, a Phase 2 multi-store blocker |
| GAP-005 | Customer credit | Is a store-credit balance repayable by a due date? The docs record "no due date in v1"; `EC-65` references a dunning policy no rule defines | CON-06 (no CreditOverdue), notification-domain NT-37 note (CreditOverdue deliberately absent), customer-domain §4 ledger (no due-date element), reporting-domain AP aging exists; EC-65 = MISSING DEPENDENCY | DECIDED | Business decision | **Medium** | Phase 2 if yes; Phase 1 backlog if no | No | **Yes** | `DueDate`, AR aging, dunning state if yes | None | None — decision is "no" | `EC-65` corrected to drop due-date/dunning dependency (D-05) | DECIDED — (a) no due date in v1 | High | PHASE-1-REVIEW §6.1; EC-65 | GATE-Q4-DUNNING | OWNER-DECISIONS.md D-05 | Phase 1 review line 149: Q4 is Phase 2 only if answered yes; answered no, so it is closed by the EC-65 correction alone |
| GAP-006 | Customer credit | Credit limits: specification is complete and coherent | CU-12..CU-19; CU-14 check in completion transaction; CU-17 limit never lowered below balance; CU-21 payment bounded atomically | RESOLVED | None | Low | — | n/a | No | None | The CU-17 "overdue balance" phrase (customer-domain:121-123) is wording; no due date exists | None | None | One wording flag: "overdue balance" in CU-17 while GAP-005/D-05 record no due date. Wording preserved per the D-05 directive (CU-12..CU-23 unchanged); "overdue" is loose prose, not a due-date rule | RESOLVED (wording) | Low | customer-domain §4 | — | GAP-005 (D-05) | Not a blocker |
| GAP-007 | Reporting | AR aging / overdue report does not exist in v1 because no due date exists; AP aging exists (SU-13, SU-15) | reporting-domain:145 "Payables ageing ... By due date" is supplier AP; no AR counterpart | RESOLVED | Consequence of GAP-005 | Low | Phase 2/3 | No | **Yes** (inherited from Q4) | Report only | None | Credit exposure not aged | Add AR aging if Q4 yes; drop the expectation if no | CLOSED — D-05 (no due date in v1) | Medium | reporting-domain §? | GATE-Q4-DUNNING | GAP-005 (D-05) | Documented as a consequence, not a new requirement; "no" closes it |
| GAP-008 | Customer credit | Customer statement is reproducible from the ledger, shows running balance, limit, available credit, past-period rendering | CU-23; CU-34/35/36 (PII, consent, data export) | RESOLVED | None | None | — | n/a | No | None | Statement render is permission-gated (CU-37) | None | None | None | RESOLVED | Medium | customer-domain §4.3 | — | — | |
| GAP-009 | Loyalty | Loyalty is basic points with no tiers/campaigns/portal in v1; the Tier field is reserved and unused; the accrual basis is **decided (D-11): net of discount, excluding tax** | CU-24..CU-32; overview §6; CU-25; RR-41 | RESOLVED — incl. accrual basis (D-11) | Business decision (accrual basis) | Low | Phase 3 | No | **Yes** for accrual basis | None | Points mint value; adjustments must be reason-bearing (CU-28), SEP watch-list | Points balance is a projection (CU-24) | Basis decided — net of discount, excluding tax (D-11); mechanism unchanged (all three bases still configurable) | RESOLVED (D-11) | Medium | customer-domain §5 (CU-25) | — | OWNER-DECISIONS.md D-11 | Changing the basis needs no schema change; value is a store/org config item |
| GAP-010 | Audit | Audit event vocabulary: five events other rules required had no type; all five added and each traced to a source rule | AU-03 floor; AU-12 list; AU-12b five additions (`Inventory.FEFOOverride` ← BE FEFO override, `Offline.SyncAppliedWithAdjustment` ← OF-36/SM-65, `Product.Archive` ← PR-47, `Employee.Terminate` ← EM-10, `Audit.EventExpired` ← AU retention) | RESOLVED | None | None | — | n/a | No | None | Closed, versioned vocabulary (AU-11, AU-12c) | None | None | None | RESOLVED | Medium | audit-domain §3 | GATE-AUDITTYPES | — | The remaining `GATE-AUDITTYPES` work (the `OPEN DECISION` audit cells on transitions) was decided by D-06: **closed**. Twenty types added; audit cells mapped to existing/new type or `—`; the one cell left `OPEN DECISION` (offline `DeadLetter`) is D-07's, not audit's |
| GAP-011 | Traceability | 342 inferred rules (335 rule ids + 7 PR-Q ids) are home-assigned by a script and unverified; 232 of the 320 audit-time rules are CONFIRMED with no requirement row | §26.2 of requirements-traceability (1161 rows = 819 mapped + 342 inferred); §26.3; Appendix A (320: 232/21/21/18/16/12); review §4 | BLOCKER (first Phase 2 item) | Process gap | **High** | Phase 2 | Yes — mechanical | No | None | None | None | Move each inferred id into its real requirement row; rows flip `inferred` → `mapped` | OPEN SPECIFICATION | High | review §4; §26 | — | Phase 2 work | "232 confirmed rules" = CONFIRMED-in-audit; 232 is NOT a count of missing requirements |
| GAP-012 | Cross-domain | 13 findings remain `REPORTED — NOT INDEPENDENTLY VERIFIED`; none produced an edit | review §8.2 | NON-BLOCKING | Unverified finds | Medium | Phase 2 | Yes | No | None | Includes session revocation, RFID-attendance mapping, open-cart pricing, inventory completeness, offline sync | None | Re-verify in primary source; promote or close each | OPEN SPECIFICATION | Medium | review §7, §8.2 | — | Phase 2 review | Not load-bearing until verified |
| GAP-013 | Tax | The **product-configuration layer** is fully specified: tax is a configured rate set on a per-store, per-currency basis, snapshotted onto the sale, with rounding declared once and an inclusive/exclusive mode. The **jurisdictional legal facts** are not declared and are split out to GAP-044 | SP-33..38; PR-38..41; §27.3 fix (PR-Q39/Q40 = purchase-tax-separation / tax-inclusive-extraction, not tax configuration); GR-05 (jurisdictional specifics absent); `tax-and-currency.md`, which documents the mechanism as product configuration and explicitly never as legal advice; `configuration-model.md` | DECIDED (mechanism) | Business decision → split | **High** | Phase 2 (config schema) | **Yes** — for the mechanism | No, for the mechanism | Tax-config schema per store/currency; rounding mode (`SP-26`) | No legal claim is made anywhere in the project | Every receipt's tax line is computed by the configured mechanism | Mechanism documented from the existing rules; no legal fact is asserted | DECIDED (mechanism) | High | `SP-26`; `tax-and-currency.md` | — | GAP-044 (legal half) | Every receipt's tax line is now computable from configuration alone. Nothing in the project asserts a rate, a registration, an exemption, a classification, or a receipt mandate, because none was supplied. The legal half remains open as **GAP-044** and is **pre-release owner+legal work, not a schema input**. |
| GAP-044 | Tax | Jurisdictional tax and currency facts are absent: no tax rates, no Nepali tax registration, no exemptions, no product classification rules, no fiscal-calendar or receipt-mandate rules, and no NPR rate source or refresh rule | `tax-and-currency.md`; `GR-05`; the split recorded in GAP-013 | OPEN DECISION | Owner + legal input | Medium | **Pre-release**, not schema | No | **Yes** — these are facts, not choices | None: rates are configuration values, and the schema stores a snapshot, not a rate table of Nepal's actual rates | **No legal claim without in-project authority.** Publishing an invented rate would be a compliance defect, not a design choice | **Every tax figure on every receipt is wrong until these are supplied** | Owner plus legal counsel supply the facts before release. No rate, registration, exemption, or mandate is invented here | **OPEN — deliberately not invented** | Medium | `GR-05`; `tax-and-currency.md` | — | — | Split out of GAP-013 on 2026-09-29. Classified **non-blocking for schema and non-blocking for Phase 3**: the mechanism is fully specified, so the schema is derivable, and the *values* are runtime configuration. It **is** a hard **release** blocker, because a shop cannot lawfully issue a receipt without them. |
| GAP-014 | Operations | Backup and recovery: the rules named the requirement but no recovery design was consolidated | AU-21 (archival preserves query path), OF-45 (offline queue in backup + integrity check), actors-and-roles: `Config.Backup` / `Backup.Restore` (Backup.Restore = most dangerous permission), org-model §3.1 (backup policy), Product classes | DECIDED (consolidated) | Was: missing doc | Medium | Phase 2/3 | Yes | Partly | Storage, snapshots, restore path — **declared Phase 3; no storage or technology choice is made in the spec** | Backup.Restore privileges (actors-and-roles line 179) | Recovery RPO/RTO is a business choice | Consolidation delivered; the remaining content is owner input, tracked as D-13 | RESOLVED (consolidation) | Medium | AU-21, OF-45, actors-and-roles | — | `product/backup-and-recovery.md` (2026-09-29) | The consolidation draft now exists, so the "no recovery design exists" claim is stale. **D-13 remains genuinely open:** no phase-0 repository states a recovery target, and the document deliberately records **no** RPO/RTO values rather than inventing them. See GAP-038. |
| GAP-015 | Product/stock import | Import spec is complete: dry-run-first, row identity, never silently overwrite, audited, per-batch commit | PR-51..55; IV-13/IV-51 (opening balance + validated stock import); PR-Q0 (stock import requires reason, writes movements never balances) | RESOLVED | None | None | — | n/a | No | None | Import is permissioned (`Import.Run`/`Import.Approve`) and audited (PR-54) | Movement-gated, never balance-writes | None | None | RESOLVED | Medium | product-domain §6; inventory IV-13 | — | data-import.md consolidates | |
| GAP-016 | Hardware | Hardware specification exists (HD rules, RT-211 no SDK in business logic) and the requirements/owner-list document has now been consolidated | hardware-domain; HD-02, HD-07, HD-16, HD-17; RT-211 | DECIDED (consolidated) | Was: missing doc | Medium | Phase 2/3 | Yes | Partly (budget/selection is owner) | None | Device identity/credential binding (HD-14/15) | Terminal fleet is the operational reality (§27.2) | Consolidation delivered with no SKU or budget invented; make/model, quantities, and budget stay owner input | RESOLVED (consolidation) | Medium | hardware-domain; architecture §27.2 | — | `hardware/HARDWARE-REQUIREMENTS.md` (2026-09-29) | The "no hardware requirements doc" claim is stale — the document now exists and deliberately names **no** vendor, SKU, quantity, or budget. See GAP-039. |
| GAP-017 | Testing | Testing approach is rule-established and the consolidating document has now been written | IV-09, PY-12, IV-21..24; BI-15 rebuild | DECIDED (consolidated) | Was: missing doc | Medium | Phase 3 | Yes | No | None | None | Test suite is a release gate; cannot be skipped | Consolidation delivered; no framework chosen | RESOLVED (consolidation) | Medium | IV-09, PY-12 | — | `testing/TEST-STRATEGY.md` (2026-09-29) | The "not consolidated" claim is stale — the document now exists. Framework selection remains Phase 3, and **no test has been executed**: this closure pass is a documentation pass only. |
| GAP-018 | Concurrency | Concurrency model is complete: atomic balance update, in-transaction policy check, bounded lock, deterministic lock order | IV-21..24 (inventory), PY-36..42 (payments), OF-38 (offline), BI-36/BI-37 | RESOLVED | None | None | — | n/a | No | Row-level, atomic single statement (IV-21) | None | Oversell race closed (BI-36) | None | RESOLVED | Medium | inventory §7, payment §8 | — | — | |
| GAP-019 | Payments | Payment failure model is complete: authorize→capture→commit→print, timeout = Pending not failure, reconciliation job, retry is a new Payment | PY-10/11/38/40/41/54; SP-03; HD-20 | RESOLVED | None | None | — | n/a | No | Pending/holds, idempotent commit (PY-39) | Provider creds rotated, unreadable (PY-45) | No double-charge (PY-11), no given-away sale (PY-37) | None | RESOLVED | Medium | payment §8 | — | — | |
| GAP-020 | Offline sync | Sync filing: self-contained queue item, per-item response, ordering, server-authoritative document numbers — all specified | OF-17..28; SP-06/SP-18 (snapshot), OF-20 (SyncSession/SyncConflict), OF-25 (document number authority) | RESOLVED | None | None | — | n/a | No | Idempotency constraint on (TerminalId, ClientOperationId) (OF-22) | Encrypted local ledger, device-bound key (OF-41) | Nothing silently discarded (BI-31) | None | RESOLVED | Medium | offline-pos-domain §5-6 | — | — | |
| GAP-021 | State machines | Transition contract exists (8 attributes), 13 keys undefined (GAP-002), permission rows `OPEN DECISION`; all state sets are now owned (Notification D-08, StockCount D-09) | SM-02a..02d; §22 table (118 transition rows; permission buckets 38 usable / 29 undefined / 29 open / 23 system = 119 with a one-row census difference noted in §22.0) | PARTLY OPEN | Spec gap + decisions | Medium | Phase 2 | Partly | Yes (permission cells) | Audited event types per transition | Refuse rather than guess (SM-02d) | N/A | **Audit cells decided (D-06 + D-07).** Close GATE-PERMKEYS | OPEN DECISION | Medium | SM-02d; §22 | GATE-PERMKEYS | OWNER-DECISIONS.md | `GATE-AUDITTYPES` closed by D-06; `GATE-DEADLETTER` closed by D-07; `GATE-NOTIFICATION-STATES` closed by D-08; `GATE-STOCKCOUNT-STATES` closed by D-09 |
| GAP-022 | Licence | SmartStore is a **product sold commercially** (owner decision D-10); the specific licence is not named, and licence compatibility + third-party dependency terms review remain a pre-release requirement | GR-04 (licence not traceable, unresolved); phase-0 license matrix | DECIDED (D-10) — pre-release clearance remains | Business/legal decision | Medium | Release, not engineering | No | **Yes** | None | None | None | Owner/legal names and clears the licence; development is not blocked | RESOLVED (release) | Medium | GR-04 | GATE-Q2-LICENCE | OWNER-DECISIONS.md | Blocks release, not engineering (architecture §28.3). Pre-release: every dependency's terms checked against the licence and recorded |
| GAP-023 | Security | Security controls are rule-established across domains (PII min, card data never stored, no PII in logs, impenetrable audit); no consolidated checklist | BI-33, PY-43..46, CU-35/37, OF-41..45, AU-02/09, ED-? | OPEN SPECIFICATION | Missing checklist | Medium | Phase 2/3 | Yes | No | None | Consolidated checklist is a control | None | Consolidate existing security rules into a checklist doc; no new rules invented | OPEN SPECIFICATION | Medium | multiple | — | security checklist doc | Partially covered by PHASE-2-ARCHITECTURE §28 |
| GAP-024 | Observability | Device health is telemetry not business fact (SM-60b/61), jobs record what they did (AU-16), failure report by provider exists (PY-42); no consolidated ops doc | SM-60b/61, HD-17/24, AU-16, PY-42 | OPEN SPECIFICATION | Missing doc | Low | Phase 3 | Yes | No | None | None | None | Consolidate; existing rules sufficient | OPEN SPECIFICATION | Low | SM-60b, PY-42 | — | — | Not a blocker |
| GAP-025 | Configuration | Configuration is data per store and per currency, snapshotted on the sale; the configuration-model document has now been consolidated | organization-model §3.1; NT-16 (per-store defaults); PY-04/05 (method enablement); architecture §27.3 | DECIDED (consolidated) | Was: missing doc | Medium | Phase 2/3 | Yes | No | Config schema per store/currency | Import/backup config permissions exist (Import, Config.Backup) | SettingsSnapshot governs totals (SP-33) | Consolidation delivered | RESOLVED (consolidation) | Medium | org-model §3.1; architecture §27.3 | — | `product/configuration-model.md` (2026-09-29) | The "no configuration-model doc" claim is stale — the document now exists. It is also the owning document for the D-11 loyalty default (**net of discount, excluding tax**), with all three configured bases still supported. |
| GAP-026 | Retention/deletion | Retention and deletion are fully specified: archive-not-delete, configured per-category retention, consent ceiling, whole-event expiry, purge is audited | AU-17..22, AU-32, CU-38, BI-40, overview §3.10/§10 | RESOLVED | None | None | — | n/a | No | Expiry jobs, no cascade delete reaches audit (AU-32) | Right-to-be-forgotten ceiling (AU-17) | Financial floor not deletable (AU-18) | None | RESOLVED | Medium | AU-17..22 | — | — | |
| GAP-027 | Notifications | `Notification` states were state-machines' own; the owning doc now enumerates them | notification-domain §7 (NT-27..31, NT-30 expiry not a state); state-machines §22.16 | DECIDED (D-08) | None | None | Low | Phase 2 | Yes | No | None | None | None | Confirm the three states; reconcile with NT-30 | RESOLVED | Low | SM-72..74; NT-28/30 | GATE-NOTIFICATION-STATES | OWNER-DECISIONS.md | **DECIDED (D-08):** `Unread`/`Read`/`Acknowledged` owned by notification-domain §7; expiry outside the machine (NT-30); `Read`/`Acknowledged` independent (NT-28, RT-324); ack never performs the action (NT-29); reads/acks unaudited (AU-14) |
| GAP-028 | Stock counts | `StockCount`'s behavior (IV-25..31) was fully specified but the state names were state-machines' own; the owner now enumerates them | IV-25..31; state-machines §22.17 | DECIDED (D-09) | None | None | Low | Phase 2 | Yes | No | None | None | None | Confirm the four states or name them in inventory-domain | RESOLVED | Low | SM-81..83 | GATE-STOCKCOUNT-STATES | OWNER-DECISIONS.md | **DECIDED (D-09):** `Open`/`Posted`/`Cancelled`/`Reversed` owned by inventory-domain §8.3; `Posted` immutable, `Reversed` by compensating movement (IV-30, SM-82); no `Approval` state (IV-28's approval is a posting precondition) |
| GAP-029 | Offline queue | Whether the server ever observes a `DeadLetter` status is unstated; OF-29 emphatically three server outcomes | OF-29; SM-64a | DECIDED (D-07) | None | None | Low | Phase 2 | Yes | No | Sync status column | None | A fourth server status contradicts OF-29 | **DECIDED (D-07):** client-retention-only | RESOLVED | Medium | SM-64a; OF-29 | GATE-DEADLETTER | OWNER-DECISIONS.md | `DeadLetter` stays client-side (`SM-64a`); the server result vocabulary remains exactly `Applied`/`AppliedWithAdjustment`/`Rejected` (`OF-29` untouched); the §22 `any → DeadLetter` edge audits `—` — the last `OPEN DECISION` audit cell is closed (D-06 + D-07) |
| GAP-030 | Scope | Product scope audit: v1 out-of-scope list is explicit and dimensional | overview §6; CU-31/32, NT-32..36, PY-49..53, AU-33..35, SP-49 note | RESOLVED | None | None | — | n/a | No | None | None | None | None | RESOLVED | Low | overview §6 | — | — | |
| GAP-031 | Consistency | Small-things audit: role templates were reported as writing `Sales.*`, which is not a real permission | sales-pos-domain §1 preamble note ("several role templates still write `Sales.*`"); architecture §27.3 config | RESOLVED | Cosmetics | Low | Phase 2 | Yes | No | None | None | None | Sweep executed and verified 2026-09-29 | RESOLVED | Low | sales-pos §1; actors-and-roles §2 | — | consistency sweep (2026-09-29) | Verified: the catalogue's real namespace is `Sale.*` (`actors-and-roles.md` §2, lines 83-91) and no SmartStore role template uses `Sales.*`. The single remaining `Sales.*` occurrence in the repository is `domain/business-invariants.md` line 473, which quotes the **surveyed** system's prefix-matching hazard (`Sales.Refund` also granted `Sales.RefundLarge`). It is evidence about a different system, not a SmartStore permission, and is **deliberately left unchanged**. |
| GAP-032 | Readiness | Domain readiness (34 domains in the product doc set): each is owned by a document and indexed | 27 files under `docs/product/` (§34 matures to the 27 domain files present) | RESOLVED | None | None | — | n/a | No | None | None | None | None | RESOLVED | Low | glob of docs/product/*.md | — | — | 27 domain files present; count asserted per-task-inventory in §34 |
| GAP-033 | Dead-letter states | Dead-letter retention states (client-side) — see GAP-029 | SM-64a, OF-36 | DECIDED (D-07) | Duplicate of GAP-029 | Low | — | No | Yes | — | — | — | Fold into GAP-029 | RESOLVED | Low | — | GATE-DEADLETTER | GAP-029 | Merged — resolved with GAP-029 by D-07 |
| GAP-034 | Product scope | Offline-capable payment: offline card goes to acquirer, distinct population — resolved | PY-47/48, OF-02 | RESOLVED | None | None | — | n/a | No | None | None | Offline card settlement separately reconciled | None | RESOLVED | Low | payment §9 | — | — | |
| GAP-035 | Traceability | 342 rule rows carry `inferred` mappings. Measured 2026-09-29: **73 of the 342 (21%) point at one of only 16 requirement rows that are themselves marked OUT OF SCOPE**, and a further 132 point at two generic catch-all rows (`RT-344`, a generic state row; `RT-350`, an edge-case test row) | `requirements-traceability.md` §26.2/§26.3 (`inferred 342`; `1161 = 819 mapped + 342 inferred`). OUT OF SCOPE targets: `RT-343`(30), `RT-288`(17), `RT-326`(11), `RT-316`(9), `RT-274`(6). Concentration: `RT-344`(67), `RT-350`(65) | **BLOCKER** | Traceability-coverage defect | **High** | Phase 3, by the project's own C-06 acceptance rule | **No** — a human must read each rule against its domain source | **Yes** — each home must be confirmed or reassigned | None directly, but a wrong home hides a rule from the trace and can ship an unimplemented `MUST` | None directly | An audit-append-only rule homes to `RT-291`; an `ApprovalRequest` rule homes to `RT-343`, a UX row marked OUT OF SCOPE | Do **not** mass-rename `inferred` to `mapped`. Have a human confirm or reassign all 342 against their domain sources, then recount | **OPEN — remains a Phase 3 blocker** | **High** | §26.2/§26.3; C-06 | — | — | The project's own governance makes this a hard gate (C-06: "Blocker, Phase 2's first work item, carried into Phase 3"). The 73/342 OUT OF SCOPE figure is the measured proof that the generated assignments are not acceptable as recorded. **The exact action that closes it: a human confirms or reassigns each of the 342 homes.** |
| GAP-036 | Access model | **27 transitions across 8 machines name no permission key at all.** This population was never registered and is distinct from GAP-002's 13 keys, which *do* exist | Counted mechanically 2026-09-29 in the `state-machines.md` §22 Permission column: `StockBatch` 2 (§22.2), `PurchaseOrder` 7 (§22.3), `PurchaseReceipt` 1 (§22.4), `SupplierInvoice` 5 (§22.5), `Return`/`Refund` 5 (§22.7), `Payment` 3 (§22.10), `Shift` 1 (§22.11), `StockTransfer` 3 (§22.18). One of them, the `→ ApprovedForPayment` edge, is already flagged inside D-02 ("**Not assumed**") | OPEN DECISION | Missing dependency | **High** | Feature enablement — **not** schema derivation | No | **Yes** — the owner names the keys | None: the permission set is closed and versioned (`AU-11`), so an undecided key is a nullable reference, not an ambiguity in table shape | Until a key exists the transition is unauthorized; the specified fallback is that it **refuses** (architecture §29.1) | Refused edges block money and stock movement: cancel or close a PO, cancel a GRN, dispute or write off an invoice, cancel a return, refund, and reverse a payment | Owner names the key per transition. `SM-02d` forbids renaming to a near neighbour, so these cannot be derived mechanically | **OPEN — 27 keys undecided** | High | state-machines §22; `SM-02c`; architecture §29.1 | GATE-PERMKEYS (new) | — | Registered 2026-09-29. Classified **not** a schema blocker and **not** a Phase 3 blocker, because every one of these rows already carries its full source, destination, trigger, precondition, side effect, and audit attributes, and the un-keyed behaviour is fully specified (refuse, §29.1). It **is** a blocker for enabling the affected features. |
| GAP-037 | Inventory | **A `MUST` acceptance criterion is unsatisfiable at the default configuration.** `RT-067` (`MUST`) requires that "two concurrent checkouts for one remaining unit yield exactly one completed sale and one refusal". But `BI-36` states the outcome is "either exactly one succeeds, **or both succeed and the balance is negative and flagged**", selected by the store's negative-stock policy — and `CON-07` sets the v1 default to `AllowNegative` | `requirements-traceability.md` `RT-067`; `edge-cases.md` `EC-01` (line 27) and `EC-24` (line 69); `business-invariants.md` `BI-36` (line 726); `organization-model.md` `CON-07` (line 137). `RT-067` cites `BI-37` (a reservation invariant) rather than `BI-36`; `EC-01` cites `BI-02` (a projection invariant) | OPEN DECISION | **`MUST`-level contradiction** | **High** | Implementation correctness; release | No | **Yes** — a `MUST` may not be silently rewritten | None: the write path is fully specified by `BI-36` — one atomic statement, then the policy check inside the same transaction | None | At the default `AllowNegative`, the store that would pass the stated `RT-067` test is the one that blocks the sale, i.e. the acceptance text encodes the opposite of the configured policy | Owner decides whether the default becomes `BlockNegative` or the acceptance text becomes policy-conditional. **The `MUST` is not changed here** | **OPEN — recorded, not resolved** | **High** | `EC-01`/`RT-067` vs `BI-36`/`CON-07` | — | — | Registered 2026-09-29. Classified **not** a schema blocker (`BI-36` fixes the mechanism and therefore the build) but a **live contradiction inside the requirement set**, so the set cannot be called coherent until it is decided. Two linked citation defects fall out of the same decision: `EC-01`'s `BI-02` and `RT-067`'s `BI-37`. |
| GAP-038 | Operations | Recovery objectives (RPO/RTO), retention, and restore-test cadence are **not stated anywhere** in the specification or in any phase-0 repository | `product/backup-and-recovery.md` (consolidated 2026-09-29), which deliberately records no numeric target; split out of GAP-014 | OPEN DECISION | Owner input | Medium | Operational readiness — **not** schema | No | **Yes** | None: RPO/RTO are service objectives, not domain structure. The backup **rule** (`AU-21`, `OF-45`) and the `Backup.Restore` privilege already fix the required behaviour | Yes — `Backup.Restore` is named the most dangerous permission in the access model | Determines whether recovery is fit for the business, so it gates release | Owner sets RPO/RTO, retention, and restore-test cadence | **OPEN — values deliberately not invented** | Medium | `backup-and-recovery.md`; `AU-21`; `OF-45` | — | — | Split out of GAP-014 on 2026-09-29. The consolidation is delivered; only the numbers are missing, and they are the owner's to give. Classified **non-blocking for schema**: no Phase 3 artifact depends on the numbers, and supplying them would not change any table. |
| GAP-039 | Hardware | Terminal fleet make/model, quantities, budget, and site environment are owner inputs and are **not** stated in the specification | `hardware/HARDWARE-REQUIREMENTS.md` (consolidated 2026-09-29); split out of GAP-016; architecture §27.2 | OPEN DECISION | Owner input | Low–Medium | Procurement — **not** schema | No | **Yes** | None: `HD-14`/`HD-15` already fix device identity and credential binding, so the schema does not depend on the fleet | Yes — device identity and credential binding are hardware-facing but already specified | None | Owner supplies the fleet list and budget | **OPEN — values deliberately not invented** | Low–Medium | `HARDWARE-REQUIREMENTS.md`; `HD-02`, `HD-07` | — | — | Split out of GAP-016 on 2026-09-29. No SKU, quantity, or budget is named anywhere in the specification, and none was invented. |
| GAP-040 | Access/session | `Terminated` does not require live-session revocation, although `Suspended` does. `EM-13`/`SM-47` revoke live sessions for `Suspended` and §22.9 audits `Security.SessionEnded` per revoked session; the `→ Terminated` row's effect column says only "Authentication permanently refused" and is **silent on existing live sessions**, and does not require the session-ended event | `state-machines.md` §22.9 (lines 1134-1135), `SM-47` (line 485), `SM-48` (line 488); `audit-domain.md` lines 26, 81-82 (`Security.Login`/`Logout`/`SessionEnded` all exist) | OPEN SPECIFICATION | Security specification gap | **High** | Access model | Partly | **Yes** — the intended behaviour is an owner call | Yes: whether a `Session` row is force-ended on termination, and whether sessions are keyed to the employee record, is schema-level | **Yes.** A terminated employee is the strictly stronger case, yet the rule is the weaker one, and a live session surviving termination is an authentication-bypass path | None | Owner states the termination behaviour; then add the revocation rule to `SM-47`/`SM-48` and the §22.9 row, and require `Security.SessionEnded` | **OPEN** | **High** | `EC-45`; `SM-47`; `SM-48`; §22.9 | — | — | Registered 2026-09-29, replacing an earlier, **wider** claim that this closure pass refuted: `EC-45` is about role-assignment removal and already states "the next request is refused; the session is revoked" (no contradiction with the session rules), and suspension *is* audited. The genuine finding is the narrower one recorded here. |
| GAP-041 | Reporting / date | Two open decisions. **(a)** There is no store trading calendar or opening-hours rule, so the business-date boundary is defined only by a time zone, and `EC-64` asserts that changing the business date "is audited" with no corresponding audit event or trigger. **(b)** `RP-06` offers multi-currency reporting as either per-currency columns **or** a single reporting currency with rate and rate date, and no default is chosen | `organization-model.md` line 65 (business date = the store time zone's calendar day), line 91 (reports group by business date in the store's zone), line 368 (trading calendar "should be added before production … an open decision"); `edge-cases.md` `EC-64`; `reporting-domain.md` `RP-05`, `RP-06`, `RP-26`; no business-date event in `audit-domain.md` | OPEN DECISION | Owner input plus a small specification gap | Medium | Reporting; **not** core transaction schema | Partly | **Yes** | (a) None — a business date is already a store setting. (b) Yes: choosing a single reporting currency requires a rate table and a rate date on every figure | (a) An unaudited business-date change can silently re-date open transactions. (b) None | (a) Mis-dated reports and shift reconciliation | Owner sets trading-calendar and opening-hours rules and chooses the multi-currency reporting default; add a business-date-change audit event for `EC-64` | **OPEN** | Medium | `EC-64`; `RP-06`; organization-model §3 | — | — | Registered 2026-09-29. Split out of GAP-013. Classified **not** a schema blocker: a store already has a business-date value, and the reporting choice does not alter any transaction table. `EC-64`'s unbacked audit claim is a real, small specification gap and is recorded rather than invented. |
| GAP-042 | Procurement | The **shape** of purchase-order payment terms is unspecified. `PurchaseOrder` carries "payment terms" and the three-way match compares PO terms against invoice terms, but nothing states whether terms is a structured value (net days, which would compute a due date) or a free-text record | `procurement-domain.md` line 75 (`payment terms` field on `PurchaseOrder`), line 206 (`Terms \| payment terms \| — \| invoice terms \| Terms change` in the match-variance table) | OPEN DECISION | Owner input | Medium | **Schema shape** on `PurchaseOrder`/`SupplierInvoice` | No | **Yes** | **Yes** — a structured term is a typed column set, a free-text term is one string | None | Minor: with free text, the `Terms change` variance row is not machine-comparable | Owner states whether terms is structured. Whatever is chosen, the mandatory part is already fixed: the terms actually agreed are recorded on both documents | **OPEN** | Medium | procurement-domain §4/§6 | — | — | Registered 2026-09-29. Distinct from GAP-005/D-05, which settled *customer store credit* (no due date in v1); supplier payment terms were never addressed. Phase 3 can start on this by recording the term verbatim, so it is **non-blocking**, but the column cannot be finalised until it is decided. |
| GAP-043 | Customer | The `CustomerAccount` **status** machine has an unresolved exit: `SM-45c` states that until the `CreditBlocked` exit is decided, the status is specified as non-terminal with an unresolved exit, and that Phase 2 must not invent a resolution | `state-machines.md` `SM-45c` (lines 447-455), §21 diagram (line 436), the terminal-state check (line 901) and the self-check (line 909); `state-machines.md` line 1122 | OPEN DECISION | Missing dependency | Medium | Customer status model | No | **Yes** | Yes: a credit block that can never be lifted, and one that lifts automatically, are different schemas | **Yes** — `CreditBlocked` restricts taking goods on account; a rule that never lifts it strands a customer with no path back | None | Owner states the credit-block release rule (manual unblock, time-boxed, or automatic on payment) and its permission | **OPEN** | Medium | `SM-45c`; §22.8 | — | — | Registered 2026-09-29; the document already flagged it but **no register row existed**. `SM-45c` is explicit that Phase 2 must not invent a resolution, and none was invented. |
 |

## 4. Owner decisions required (summary — see OWNER-DECISIONS.md)

**Every decision below is DECIDED. The owner took all of them; none was chosen on the owner's behalf.**

| Decision | Gate | Blocks | Outcome |
|---|---|---|---|
| Who may hold the 13 permission keys | GATE-PERMKEYS | 29 transitions | **DECIDED (D-01):** the premise was refuted — all 13 keys exist; keep them as written, assign via the existing wildcard grants, enforce the `Purchase.Order.*` separation of duties explicitly |
| When a supplier payable exists | GATE-PAYABLE | AP ledger shape | **DECIDED (D-02):** at `ApprovedForPayment`. The `→ ApprovedForPayment` permission is *not* covered and is tracked in GAP-036 |
| One attribution or several for a central-warehouse location | GATE-Q1 | Stock schema | **DECIDED (D-03):** explicit `(StorageLocation, Store)` model |
| Server reservation or apply-and-reconcile for offline stock | GATE-OFFLINE-INVENTORY | Offline sync schema | **DECIDED (D-04):** apply-and-reconcile; reservations only for explicit dated holds |
| Is store credit repayable by a due date (Q4) | GATE-Q4-DUNNING | Credit/dunning model | **DECIDED (D-05):** no due date in v1. `EC-65` corrected; no AR aging, no `CreditOverdue`, no dunning |
| Event types for `OPEN DECISION` audit cells | GATE-AUDITTYPES | Audit schema migration | **DECIDED (D-06):** 20 types added and cells mapped |
| Does the server ever observe a dead-letter status | GATE-DEADLETTER | Sync status model | **DECIDED (D-07):** client-only; server vocabulary stays `Applied`/`AppliedWithAdjustment`/`Rejected` |
| `Notification` state set ownership | GATE-NOTIFICATION-STATES | Notification schema | **DECIDED (D-08):** `Unread`/`Read`/`Acknowledged`, owned by notification-domain §7; expiry outside the machine |
| `StockCount` state set ownership | GATE-STOCKCOUNT-STATES | Count schema | **DECIDED (D-09):** `Open`/`Posted`/`Cancelled`/`Reversed`, owned by inventory-domain §8.3; `Posted` immutable, `Reversed` by compensating movement |
| Licence for distribution/release | GATE-Q2-LICENCE | Release, not engineering | **DECIDED (D-10):** sold/commercial; licence naming and OSS-terms clearance remain pre-release owner+legal work |
| Loyalty accrual basis | — | Config value only | **DECIDED (D-11):** net of discount, excluding tax; all three configured bases still supported |
| Tax mechanism vs tax legal facts | — | Tax schema | **SPLIT (2026-09-29):** the mechanism is decided (GAP-013); the jurisdictional legal facts remain open (GAP-044) |
| RPO/RTO | — | Backup design | **OPEN (D-13):** no values supplied and none invented (GAP-038) |

## 5. Blockers at a glance

*Re-derived 2026-09-29 during the final closure pass. The previous version of this section still listed four
gates as Phase 2 blockers; all four have since been decided by the owner.*

- **Phase 3 blockers (schema derivation): one.**
  - `GAP-035` — the 342-row traceability backlog. 73 of the 342 homes point at OUT OF SCOPE requirement rows.
    This is a blocker by the project's own C-06 acceptance rule, not by a design gap, and it closes by human
    review of the 342 homes.
- **Open but NOT Phase 3 blockers** (each is either non-schema, or has a specified fallback, and is registered):
  - `GAP-036` — 27 transitions with no permission key. Blocks those features; schema is unaffected because the
    behaviour is specified (refuse, §29.1).
  - `GAP-037` — a `MUST`-level contradiction between `RT-067`/`EC-01` and `BI-36`/`CON-07`. Blocks coherence of
    the requirement set and release; `BI-36` determines the build, so the schema is unaffected.
  - `GAP-040` — `Terminated` does not revoke live sessions. Security-relevant, access-model decision.
  - `GAP-041` — trading calendar / business-date audit; multi-currency reporting default.
  - `GAP-042` — purchase-order payment-terms shape. Phase 3 can start by recording the term verbatim.
  - `GAP-043` — `CreditBlocked` exit rule. `SM-45c` forbids inventing it.
  - `GAP-038`, `GAP-039` — owner input (RPO/RTO; fleet and budget). Not schema.
- **Release blockers:** `GAP-044` (jurisdictional tax facts — a shop cannot lawfully issue a receipt without
  them) and `GATE-Q2-LICENCE` (D-10 leaves licence naming and OSS-terms clearance to owner+legal).

**Consequence:** the design decisions that Phase 2 was waiting on have all been made. The single remaining
Phase 3 gate is traceability coverage.

## 6. Sources

- `requirements-traceability.md` (§26 header/§26.3): 1161 / 819 / 342, `UNMAPPED` 0. **Correction (2026-09-29):**
  the 342 `inferred` homes are not all sound — 73 point at OUT OF SCOPE rows. See GAP-035.
- `PHASE-1-REVIEW.md` (§1 table, §4, §7): 342 inferred, 320 at audit time, 13 unverified finds, blockers 7,
  business decisions 4.
- `state-machines.md` §22: **118** transition rows (census total 119 noted as off-by-one in §22.0); permission
  counts 38/29/29/23. **Correction (2026-09-29):** the 29 `‡` rows no longer carry a live defect — all 13 keys
  they name exist in `actors-and-roles.md` §2 (D-01). The 27 permission-column `OPEN DECISION` cells are a
  separate, previously unregistered population; see GAP-036.
- `PHASE-2-ARCHITECTURE.md` §28.3: the 10 gates above.
## 7. Addendum 2026-09-30 - C-06 rebuild, verification, and re-measurement
**Append-only.** Everything above this line is unchanged. This addendum records what happened to C-06 on
2026-09-30 and what the re-measurement found. Where it disagrees with an earlier section, this addendum
governs; the earlier text is left as the historical record.

### 7.1 What happened

`C-06-TRACEABILITY-REVIEW.md` was damaged on 2026-09-30: a PowerShell array collapsed to a string and
`WriteAllText` overwrote the file, destroying the per-rule disposition log for Batches 1, 2, 3a, 3b, 4a,
4b, 5a and 5b. The traceability work itself was never at risk - every home is recorded in
`requirements-traceability.md` section 26.2 and every rule is cited there.

The artifact was rebuilt mechanically: the pre-damage file was recovered from the git baseline
(`9283038`, 28,727 bytes), the rebuild notice and the 175-row owner confirmation list were preserved
verbatim, and the remaining sections were recovered from surviving fragments or derived from section 26.2
and labelled as such. **Nothing lost was invented.** 49 of the 342 rule identities are not reconstructable
and say so.

### 7.2 New register rows

Same 20 fields as section 3. `GAP-035` is not repeated; its status change is in 7.3.

| ID | Domain | Description | Evidence | Current Status | Type | Impact | Phase affected | Can documentation resolve it? | Requires owner decision? | Database impact | Security impact | Financial/inventory impact | Recommended action | Final decision/status | Priority | Source | Gate | Resolved by | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GAP-045 | Traceability | The C-06 review artifact was destroyed on 2026-09-30 by a PowerShell write defect, losing the per-rule disposition log for 8 of the 10 batches. The traceability work was unaffected; only the evidence log was lost | git baseline `9283038`; rebuild notice and "Rebuild provenance" in the audit; surviving temporary fragments; full backup `D:\SmartStore-backup-20260930-094918` (3021 files, 358,420,886 bytes) | RESOLVED | Process defect | High - this artifact is the evidence for a Phase 3 gate | Phase 3 (the gate evidence) | Yes - rebuilt and verified | Yes - only to accept or reject the rebuild | None | None | None | Owner reads the "Rebuild provenance" section and accepts the rebuild, or names a section to reject | RESOLVED - rebuilt; acceptance pending | High | `C-06-TRACEABILITY-REVIEW.md` | C-06 | - | Measured by `measure-c06.ps1` (38 checks, all passing). 49 of the 342 identities are marked not reconstructable rather than guessed. Appendix A was corrected from 282 to **279** rules: 3 of its rows were section references, not rules |
| GAP-046 | Traceability | 12 pre-existing requirement rows are filed correctly but their wording is too thin to carry the rules citing them. Found by independent sampling of 42 of 1161 mappings: 29 CONFIRMED, 12 WEAK MATCH, 1 ADDS BEHAVIOUR NOT IN SOURCE, **0 WRONG HOME** | `RT-002` (`EM-15`), `RT-036` (`PR-21`), `RT-078` (`IV-45`), `RT-106` (`PR-Q21`), `RT-130` (`SP-34`), `RT-145` (`RR-02`), `RT-170` (`CU-26`), `RT-179` (`SU-14`), `RT-200` (`RF-21`), `RT-218` (`HD-31`), `RT-223` (`OF-20`), `RT-231` (`SM-64`) - each rule named in the audit's verification section | OPEN SPECIFICATION | Traceability quality | Medium - a reader consulting the row does not learn what the cited rule requires | Phase 2 close-out; not a Phase 3 blocker | No - each row needs a wording decision | **Yes** - the owner decides whether to widen the row or re-file the rule | None | None | None: none of the 12 rows is itself wrong, it is under-stated | Owner widens the 12 row statements to state the cited rules, or re-files the rules | OPEN - recorded, not rewritten | Medium | `C-06-TRACEABILITY-REVIEW.md` verification section | - | - | **These 12 are not covered by the 175-row owner confirmation list**, so they will not be decided by approving that list. No mapping is wrong and the coverage bijection is unaffected; this is statement granularity only. Separately, `IV-34` / `RT-475` is the one finding **inside** a drafted row and asserts "a negative stock balance is a store policy decision", which neither `IV-34` nor `BI-05` states (`SM-14` is the policy rule, homed at `RT-410`) |
| GAP-047 | Traceability | `requirements-traceability.md` section 26.3 states 48 coverage rows resolve to an OUT OF SCOPE requirement row. Measured 2026-09-30: 50 by canonical home, 52 by any listed home | 24 requirement rows carry `Pri` = `OUT OF SCOPE`; `measure-c06.ps1` reports all three figures | OPEN SPECIFICATION | Stale summary figure | Low - no mapping is affected | None | Yes - it is a one-line correction | No | None | None | None | Correct the figure in section 26.3, or state the counting rule the 48 was produced under | OPEN | Low | `requirements-traceability.md` section 26.3 | C-06 | - | The 48 predates the OUT OF SCOPE rows added by Batches 5b, 5c and 5d, which added `RT-482`, `RT-501`, `RT-514` and `RT-529`. **The trace was deliberately not edited** - only the four governance documents are in scope for this pass, so the stale figure is recorded here rather than silently changed |

### 7.3 GAP-035 status change

`GAP-035` recorded 342 rule rows carrying `inferred` mappings and asked a human to confirm or reassign all
342. **That adjudication is done.** All 342 now read `mapped`, `inferred` is 0, and 1161 rules are `mapped`
with 1161 distinct rules cited - the coverage table and the citation columns are a bijection, verified in
both directions by `measure-c06.ps1`.

What is left is not the backlog. It is 175 drafted requirement rows, every one of which is
`PROPOSED - REQUIRES HUMAN CONFIRMATION`, and the acceptance of the rebuilt audit. `mapped` is not
`approved`: it means a requirement row states a rule and cites it, not that the requirement text is agreed.

`GAP-035` therefore moves from **OPEN - remains a Phase 3 blocker** to
**OPEN - reduced to owner approval of 175 drafted rows**, and the exact action that closes C-06 is now:
the owner accepts, amends or rejects the 175 rows in section 18 of the audit, and accepts the rebuild.
### 7.4 C-06 criterion status, stated exactly

Section 7.3 gives the `GAP-035` register status. The C-06 *criterion* status, identical to the wording in
`PHASE-3-ENTRY-CRITERIA.md`, `PHASE-2-REVIEW.md` and `CONSTITUTION-READINESS-AUDIT.md`, is:

> **MET pending owner approval of 175 proposed rows and acceptance of the rebuilt audit**

It is recorded here so this register can be read on its own. `GAP-035` is not closed by that wording:
`GAP-045`, `GAP-046` and `GAP-047` are open alongside it, and `GAP-046` is the one approving the 175-row list
will not decide.

### 7.5 C-06 owner decisions recorded 2026-09-30

The owner reviewed `OWNER-APPROVAL-WORKSHEET.md` and recorded decisions. The criterion status in 7.4 narrows
from two conditions to one:

- **Row approvals: DONE.** 175 rows, no blanks. 10 owner decisions among the drafted rows (13 GAP-046
  corrections, of which `RT-475` is in the drafted range, plus the `RT-435` reword and the `RT-476` citation
  change), and 165 rows dispositioned by agent review under explicit owner delegation. Both kinds are labelled
  distinctly in the worksheet so owner judgement and delegated review are never conflated.
- **Applied to the trace:** 15 rows. 14 wordings (the 13 approved GAP-046 corrections plus the owner's `RT-435`
  reword) and 1 citation (`RR-09` added to `RT-476`). `RR-09` is now cited by `RT-148` and `RT-476`; its canonical
  home in 26.2 is unchanged and the 1161-rule bijection still measures clean.
- **Still OPEN: owner acceptance of the rebuilt audit.** This is the owner's own judgement and has deliberately
  not been answered. Until it is, the C-06 criterion status remains:

> **MET pending owner approval of 175 proposed rows and acceptance of the rebuilt audit**

with the first condition now satisfied and the second outstanding. `GAP-046` is closed by the 13 approvals.
`GAP-045` and `GAP-047` remain open. `measure-c06.ps1` passes all checks after the change.
### 7.6 C-06 closed; the three carried contradictions classified

Recorded 2026-09-30. **Append-only.** This section supersedes the open items named in 7.5; it does not edit them.

**Owner acceptance of the rebuilt C-06 audit: YES**, with the owner's stated limits - original per-rule reasoning
lost, mechanical rebuild, independently re-sampled. Combined with the 175 recorded row decisions, both conditions
of the C-06 criterion are met: **C-06 is `MET` and closed, and `GAP-035` closes with it.** `GAP-045` and `GAP-046`
close. `GAP-047` remains open and is a documentation correction, not a build input.

`GAP-035` was the only Phase 3 blocker listed in section 5. The classification below was derived after that
2026-09-29 pass, which is why `CON-03` did not appear in it.

#### 7.6.1 Classification of the three carried items

| Item | Classification | Evidence | One-line reason |
|---|---|---|---|
| `CON-03` - `PY-54` / `RT-420` | **PHASE-3 BLOCKER** | `payment-domain.md` L128-131 (`PY-54`): "a retry is a new `Payment`, never a reopened one... `Failed` and `Voided` are terminal... The state graph must have no edge out of either." Against `SM-53` and `RT-420`: "`Failed` is retryable". `RT-420` cites `PY-54` while asserting the opposite. | The dispute is whether the `Failed` state has an outgoing edge, and the state-graph edge set is precisely what Phase 3 derives, so the contradiction is schema-determining rather than behavioural. |
| `RT-186` / `SU-22` | NON-BLOCKING | `RT-186` (`MUST`): "A statement to a supplier is the ledger with a running balance and due date", cited to `SU-22`. `SU-22` (`supplier-domain.md` L173) is "no supplier portal in v1", which says nothing about statement content. The content is stated in full by `SU-12` (L108-109): "a statement is reproducible from the ledger (BI-11), shows the running balance, the terms, the due date, and states its scope (SU-02)", with `SU-13` fixing due-date computation. | Mis-citation only. The behaviour and the schema are already fully determined by `SU-12`/`SU-13`; re-citing `RT-186` from `SU-22` to `SU-12` is a one-cell documentation fix and has not been applied. |
| `GAP-037` | NON-BLOCKING | `RT-067`/`EC-01` (`MUST`) requires "two concurrent checkouts for one remaining unit yield exactly one completed sale and one refusal"; `BI-36` (`business-invariants.md` L726) resolves the last-unit race deterministically on a different basis. | `BI-36` determines the build, so schema is unaffected. It remains a requirement-coherence and release defect, consistent with the existing section 5 classification. |

#### 7.6.2 Net effect on the blocker list

- **Phase 3 blockers: one.** `CON-03`. It is genuine, so it is not waived here.
- `GAP-036`, `GAP-040`, `GAP-041`, `GAP-042`, `GAP-043`, `GAP-038`, `GAP-039` stay non-blocking, as section 5 records.
- **Release blockers unchanged:** `GAP-044` and `GATE-Q2-LICENCE`.
- `RT-420`'s agent-review approval is withdrawn pending `CON-03`. The row is not itself defective; it cannot be
  called correct while its cited source disagrees with it.

**Phase 3 has not been started and must not be started while `CON-03` is open.**
### 7.7 `CON-03` closed by owner decision D-14; Phase 3 blocker list is empty

Recorded 2026-09-30. **Append-only.** This section supersedes 7.6.1 and 7.6.2; it does not edit them.

**D-14 â€” `CON-03` resolved in favour of `PY-54`.** A customer `Payment` in `Failed` is **terminal for that
record**; a retry is a **new `Payment` against the same sale**. `Declined` remains retryable by a new attempt
(PY-14). `SM-30` (supplier invoice `Failed`) and `SM-41` (refund `Failed`) are **unchanged** - the decision is
scoped to the customer `Payment` machine only. `CON-03` is **CLOSED**.

#### 7.7.1 What the decision changed

| Location | Before | After |
|---|---|---|
| `state-machines.md` `SM-53` | "`Declined` is retryable; `Failed` is retryable; ..." | "`Declined` and `Failed` payments are retryable by writing a new `Payment`; the `Failed` record itself is terminal; `Voided` and `Captured` are terminal" |
| `requirements-traceability.md` `RT-420` | same wording, citing `SM-53, PY-14, PY-54` | same corrected wording; **all three citations kept** |
| `requirements-traceability.md` `RT-186` | cited `SU-22` | re-cited `SU-12` |

`SM-53` was the **only** contradiction. `PY-54`, the payment state table, the edge table, the machine table,
`BI-25` and the `SM-53` summary line already stated that `Failed` is terminal and a retry is a new `Payment`;
they were not changed. The state graph is now single-reading: no edge out of `Failed`, and every retry is a new row.

`RT-186` is re-cited from `SU-22` ("no supplier portal in v1", which says nothing about statement content) to
`SU-12`, which states the statement content in full. `SU-13` was considered and is **not** cited: it governs how a
due date is computed and stored, not what a statement shows. `SU-22` stays cited by `RT-184`, so no rule is
orphaned and the 1161-rule bijection is unaffected.

#### 7.7.2 Whole-tree sweep for the same contradiction

Every statement in `docs/` about a customer `Payment` in `Failed` was re-read. Two were genuine contradictions
(`SM-53`, `RT-420`) and both are fixed above. The following were examined and are **already consistent** with
D-14, so they were deliberately left alone:

| Location | Statement | Verdict |
|---|---|---|
| `payment-domain.md` L109, L125 | graph `Failed (terminal)`; "**No.** Terminal for this `Payment` (PY-54)" | already correct |
| `payment-domain.md` L128-131 | `PY-54` "a retry is a new `Payment`, never a reopened one" | already correct - now the single authority |
| `payment-domain.md` L257 | `PY-41` an unreachable provider stays `Pending`, never auto-failed | consistent; a timeout is not a `Failed` state |
| `state-machines.md` L517-523 | payment graph: `Declined (retryable)`, `Failed` with no retry annotation | already correct |
| `state-machines.md` L1185, L887, L1419 | edge table "**None.** Terminal for this `Payment` (PY-54)"; machine table; `SM-53` summary | already correct |
| `business-invariants.md` L206 | "`Failed` terminal. `Captured` has no outgoing transition except a linked `Refund`" | already correct |
| `requirements-traceability.md` `RT-255` | a timeout stays pending, never auto-failed | already correct |
| `RT-113`, `RT-154`, `RT-417`; `SM-30`, `SM-41`; `edge-cases.md` `EC-15`; `notification-domain.md` `RefundFailed` | supplier-invoice and refund `Failed` retryable | **out of scope by owner instruction** (D-14) |

No notification or edge-case rule asserts that a customer `Payment` `Failed` can move back to another state.
`RT-289` (an approval-notification failure never un-does a completed action) is compatible with a terminal
`Failed`.

#### 7.7.3 Net blocker state

- **Genuine Phase 3 blockers: none.** `CON-03` was the last one.
- **Open but not Phase 3 blockers** (unchanged from 5): `GAP-036`, `GAP-037`, `GAP-038`, `GAP-039`, `GAP-040`,
  `GAP-041`, `GAP-042`, `GAP-043`. `GAP-038`/`GAP-039` are owner input (RPO/RTO, fleet and budget) and are
  "not schema" by section 5.
- **Release blockers, unchanged:** `GAP-044` (jurisdictional tax facts) and `GATE-Q2-LICENCE` (D-10 leaves
  licence naming and OSS-terms clearance to owner and legal). `D-12` tracks `GAP-044`; `D-13` tracks `GAP-038`.
  Neither gates schema derivation.

**No Phase 3 artifact has been created. The gate condition is met; Phase 3 has still not been started.**

### 7.8 `GAP-036` narrowed by owner decision D-16 (2026-10-02)

Appended; nothing above is changed. The owner named the permission keys that `PERMISSION-KEY-PROPOSAL.md` asked for
(D-16).
- **Seven of `GAP-036`'s 27 transitions now carry keys:**
  - state-machines §22.7: the return's cancel, and the refund's `submit to provider` and cancel;
  - §22.10: the payment's submit, capture and void;
  - §22.11: the shift's reopen.
- **`GAP-036` stays open for the other 20** (state-machines §22.0.2): batches, purchasing, goods receipts, supplier
  invoices, transfers, and a return's settle and close.
- **D-16 also named keys outside the 27:** four reversal edges (a refund's retry, an employee's return from leave and
  reactivation, and a till's re-enable), and managing warehouses and storage locations.
- Five keys are new, so the catalogue holds 122.
- `GAP-036` stays non-blocking, as section 5 records.
