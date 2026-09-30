# Open Questions

**Last updated:** 2026-09-30

Unresolved questions and owner inputs. Anything here must not stall engineering: resolve what you can from
`/docs`, work around what you can design around, and keep going.

Each entry: what is unknown, why it cannot be answered from the specification, what is blocked on it, and what to
do meanwhile. Do not fill a gap here with a plausible guess.

## Release-only — not blocking engineering

These need the owner, and for `GAP-044` legal counsel. None of them blocks schema derivation or implementation.

### GAP-044 — Jurisdictional tax facts

- **Unknown:** which taxes apply to a sale, at what rate, the rounding mode, and a shop's printed-receipt
  obligations.
- **Why not answerable from `/docs`:** these are legal facts a jurisdiction imposes, not specification choices. The
  *mechanism* is specified (`SP-33..38`, `PR-38..41`); the rates are not. This is decision **D-12**, still OPEN.
- **Blocked on:** owner **and legal counsel**.
- **Blocked:** release. A shop cannot lawfully issue a receipt without them.
- **Meanwhile:** build the mechanism with rates as data, not as code or schema constants. Do not invent a rate.

### GAP-038 — RPO / RTO and restore window

- **Unknown:** acceptable data loss (RPO) and acceptable restore time (RTO).
- **Why not answerable from `/docs`:** the rules name the requirement and the permissions (`Config.Backup`,
  `Backup.Restore`) but not the numbers. This is decision **D-13**, still OPEN.
- **Blocked on:** owner.
- **Blocked:** release only. Not schema.
- **Meanwhile:** the offline queue is in scope for backup and local integrity (`OF-45`). Design the backup shape;
  leave the numbers as configuration.

### GATE-Q2-LICENCE — Licence naming and OSS terms clearance

- **Unknown:** the specific licence, and whether each selected dependency's terms are compatible with it.
- **Why not answerable from `/docs`:** decision **D-10** settled that SmartStore is sold commercially, and left
  naming and clearance to owner and counsel. Naming a licence is a legal conclusion, not a documentation one.
- **Blocked on:** owner **and legal counsel**.
- **Blocked:** release and distribution. Engineering is not blocked, but licence compatibility and third-party
  dependency review are a pre-release requirement — check every selected dependency's terms and record it before
  distribution.
- **Meanwhile:** record dependency licences as you choose them, so the review is possible later.

## Engineering questions — found while designing the schema

These are not release-only. Each has a stated fallback so design continues. Nothing here has been decided; the
fallback is a design that holds either answer, not a guess at the answer.

### OQ-001 — Lifecycle vocabulary for Organization, Store, Warehouse and StorageLocation

- **Unknown:** whether these entities have a lifecycle state set, what its names are, whether a deactivated store can
  be reactivated, and who may do it.
- **Why not answerable from `/docs`:** `state-machines.md` lists no machine for any of them, yet overview §3.7 says
  every lifecycle transition is listed and an unlisted one is a bug. The rules say only that a store is "deactivated"
  (`ORG-05`, `RT-445`, `RT-508`), an organization is "deactivated" (`ORG-03`, `RT-506`), and `BI-40` says "archived".
  For a warehouse nothing is said. For a location, only that `IsSellable` can be turned off and that it is never
  deleted while it holds stock or a movement (`WH-03`).
- **Blocked:** nothing in the schema.
- **Meanwhile:** domain 1 records the *fact* for organization and store (`deactivated_at`, `deactivated_by`, written
  once, server time) and invents no state names or transitions. No reactivation path is built. A warehouse has no
  deactivation; a location has only `is_sellable`.

### OQ-002 — Where the "BlockNegative for warehouses" default lives

- **Unknown:** organization-model §3.2 records `CON-07`: v1 default is `AllowNegative` for stores and `BlockNegative`
  for warehouses. But §3 lists the negative-stock policy as a **Store** setting, §4 lists no Warehouse field for it, and
  `IV-16` evaluates "the store's" policy. `WH-02` fixes never-negative only for a central warehouse's `Receipts`
  location.
- **Blocked:** domain 3 (inventory) must know whether a store-attached warehouse's location can have a different
  policy from its store.
- **Meanwhile:** the policy is a versioned store setting. A central warehouse's locations are `BlockNegative` by
  `WH-02`, enforced in domain 3.

### OQ-003 — Business date: derived or advanced, and the cut-off

- **Unknown:** `RT-449` and `EC-64` say "the business date is a store setting" and that closing a day early is audited
  with the old and new date. No rule says whether the business date is derived from the store's time zone or is a
  stored value an operator advances, or where the cut-off falls. `GAP-041` already registers the trading calendar.
- **Blocked:** the acceptance criterion of `RT-449`.
- **Meanwhile:** `business_date` is a `date` stored on each document, assigned by the application in the store's time
  zone. The store has no business-date column.

### OQ-004 — Document-number prefixes and whether the counter resets

- **Unknown:** overview §3.4 formats a document number `PREFIX-YYYYMM-NNNNNN` but names no prefix per document type
  and does not say whether `NNNNNN` restarts each month.
- **Blocked:** nothing in the schema.
- **Meanwhile:** one never-reset counter per `(store, document type)`, allocated in the creating transaction (`BI-42`,
  `RT-479`). Uniqueness holds either way. A monthly reset would add one column to the counter's key. The prefix is data.

### OQ-005 — `RT-003` cites `WH-01` for a different rule

- **Unknown:** nothing. This is a citation defect. `RT-003` ("a warehouse is either store-attached or central, never
  both") cites `WH-01`, but `WH-01` in organization-model.md is "a sale line may only draw from a location where
  `IsSellable = true`". The exclusivity rule is organization-model §4.
- **Blocked:** nothing. The rule is unambiguous, so the schema is unaffected. It is a defect in the C-06 mechanical
  rebuild.
- **Meanwhile:** cite `RT-003` and organization-model §4 for exclusivity, and `WH-01` only for the sellable rule.
  Do not edit `requirements-traceability.md` without running `measure-c06.ps1` (CLAUDE.md).

### OQ-006 — Which currency, and its minor-unit exponent

- **Unknown:** the currency of the first deployment and its ISO 4217 minor-unit exponent. `tax-and-currency.md` records
  that the target market appears in the task instruction but is not a documented business decision (`GR-05`); `D-12` is open.
- **Blocked:** release configuration only.
- **Meanwhile:** the `currency` table ships with no rows. Test fixtures use the ISO 4217 test code `XTS` and are
  labelled TEST-ONLY. The exponent is data and is never assumed to be 2 (overview §3.1). ISO 4217 is outside `/docs`,
  so any real currency's exponent is **UNVERIFIED** until checked against the standard.

### OQ-007 — Which time zone defines the business date: the organization's or the store's

- **Unknown:** overview §3.3 says the business date is a calendar date "in the store's configured time zone", and
  organization-model §3 says reports group by business date "in the *store's* zone". But `ORG-02` makes the
  **organization's** "business time zone" immutable once financial documents exist, and `RT-505`'s acceptance says
  "the business date follows the organization zone rather than the server or the terminal". No rule protects the
  store's zone the way `ORG-02` protects the organization's.
- **Why not answerable from `/docs`:** the documents contradict each other. Overview §3 says it wins any conflict, so
  the store's zone governs, but then the protection `ORG-02` intends would sit on the wrong zone.
- **Blocked:** nothing in v1, which has one store onboarded with the organization's zone.
- **Meanwhile:** the business date is computed in the **store's** zone (overview §3, the declared tie-breaker). The
  organization zone is guarded by `ORG-02` as written. A store's time zone is set at creation and the application
  role cannot change it: no store time-zone edit is built until this is answered. Also recorded against `GAP-041`.

### OQ-008 — Warehouse and location code uniqueness

- **Unknown:** no rule says warehouse or storage-location codes are unique, or in what scope.
- **Why not answerable from `/docs`:** the entities are specified with a "code" but no uniqueness rule.
- **Blocked:** nothing.
- **Meanwhile:** a code is unique where it is used to find the thing: store and warehouse codes per organization,
  location codes per warehouse. This is a data-integrity choice, not business behaviour, and it is listed as such in
  the domain 1 design so it can be reversed.

### OQ-009 — Product `Draft → Hidden`: drawn but not contracted

- **Unknown:** `state-machines.md` §1's diagram draws a `Draft → Hidden` branch, but the §22.1 transition contract
  (the eight attributes per edge) lists only `Active → Hidden`.
- **Why not answerable from `/docs`:** the two representations in one document disagree. §22 is the contract, the
  diagram is not.
- **Blocked:** nothing.
- **Meanwhile:** the §22.1 table is built. `Draft → Hidden` is refused (`SS004`). Adding it later is one row in
  `state_machine_edge`.

### OQ-010 — Variant lifecycle: deactivation, archival, reactivation

- **Unknown:** no variant state machine exists. `EC-33` and `RT-443` say a variant is "deactivated", which blocks new
  use but keeps stock. `PR-48` and `RT-495` say a variant is "archived" while its product stays on sale. Nothing says
  whether these are one edge or two, or whether either can be reversed.
- **Why not answerable from `/docs`:** there is no machine and no §22 contract for `ProductVariant`.
- **Blocked:** nothing in the schema.
- **Meanwhile:** one write-once archival fact (`archived_at`, `archived_by`) satisfies both descriptions: it blocks new
  use and never touches stock. No reactivation is built.

### OQ-011 — What the product completeness check requires

- **Unknown:** `SM-12` requires a completeness check on `Draft → Active`. `PR-02` defines it as "at least one active
  variant", and `RT-042` requires a price on an active variant. But `RT-028`'s acceptance also says "a non-draft
  product lacking a barcode cannot be activated", which contradicts `PR-11` and `RT-489`: a search-only variant may
  have no barcode and is still sellable.
- **Why not answerable from `/docs`:** the domain rule and an acceptance criterion disagree. The traceability matrix
  says the domain document is authoritative for a rule's wording.
- **Blocked:** nothing.
- **Meanwhile:** activation requires `PR-02` and `RT-042` (a live variant, each priced), and no barcode. A barcode
  requirement would be one more condition in `product_before_status_change()`.

### OQ-012 — Tax jurisdiction selection and compound taxes

- **Unknown:** a tax rate carries "a jurisdiction label" (product-domain §9), but no rule says how a store selects its
  jurisdiction, or whether several rates (for example national plus local) apply to one category at once.
- **Why not answerable from `/docs`:** jurisdictional tax is decision `D-12`, still open (`GAP-044`).
- **Blocked:** release, with `GAP-044`. Not engineering.
- **Meanwhile:** one rate is in force per tax category at a time (the latest version whose effective time has passed),
  and the jurisdiction is a label. Compound taxes would need a rate-to-store mapping, which is additive.

### OQ-013 — Stock adjustment approval: always, or beyond a threshold; and how to withdraw one

- **Unknown:** `state-machines.md` §22.17 gives one path to `Posted`: `Draft → PendingApproval → Approved → Posted`.
  Approval is by `Inventory.Adjust.Large.Approve`, from a different employee. But inventory-domain §5 says an
  adjustment needs approval only "beyond threshold" (`IV-35`: on quantity or value), and no threshold values are
  configured anywhere. Nor does the contract give any way out of `PendingApproval` or `Approved` except forward: no
  reject, no withdraw, no cancel.
- **Why not answerable from `/docs`:** the contract and the domain table disagree, and the threshold values are not
  specified.
- **Blocked:** nothing in the schema. Operationally, every adjustment, and every opening balance, needs two people in
  v1.
- **Meanwhile:** the contract's edges are enforced exactly as written: approval always, and no exit except forward. A
  below-threshold skip edge (`Draft → Approved` or an automatic approve) and a reject edge are each one row in
  `state_machine_edge`, plus a threshold setting.

### OQ-014 — Shift: `Reconciling → Open` and `Closed → Reopened`

- **Unknown:** `state-machines.md` §12's diagram draws a `Reconciling → Open` loop that the §22.11 contract does not
  list, and the contract's `Closed → Reopened` edge has an `OPEN DECISION` permission (`GAP-036`).
- **Blocked:** abandoning a count back to trading, and reopening a closed shift (`CD-26`).
- **Meanwhile:** both are refused (`SS004`); the architecture's fallback for an unkeyed transition is to refuse.

### OQ-015 — Cash drawer arithmetic: change and cash refunds

- **Unknown:** `CD-06`'s expected-amount formula counts cash *applied* (which is already net of change) and has no
  change term, but `CD-07` says "£13 was applied, so the drawer received £13 and disbursed £7", which does not add up if
  both are drawer terms. `CD-18` also says change is a drawer disbursement "or the expected count cannot be computed".
  Separately, `CD-06` *adds* "cash refunds paid from this drawer", which reduce the drawer.
- **Why not answerable from `/docs`:** the formulas contradict each other.
- **Blocked:** nothing in v1 sales. The refund term matters in domain 5.
- **Meanwhile:** a payment's amount is what was applied (`SP-39`, `PY-02`), and cash also records the tendered amount.
  Change is recorded on the sale and as a `ChangeDisbursed` drawer row (`CD-18`, `RT-132`, `RT-135`). Expected cash =
  float + cash applied (`CD-06`'s terms), without subtracting change a second time. A cash refund will *reduce* expected
  cash (domain 5), and that sign is flagged here.

### OQ-016 — Card-only tills: does every sale need a drawer and a shift?

- **Unknown:** `RT-122` (MUST) says every sale resolves a terminal, a drawer, a shift and an employee, "a sale with no
  shift attribution is impossible by constraint". But `CD-05` says card-only terminals are normal and a terminal
  without a drawer has no cash shift.
- **Blocked:** card-only tills.
- **Meanwhile:** `RT-122` is enforced: a till that sells has a drawer and an open shift.

### OQ-017 — Voiding a completed sale

- **Unknown:** sales-pos §1 and `SP-52` make a completed-sale void a `SaleVoid` document under
  `Sale.Void.Posted.Approve` with a different approver, reversing movements and refunding payments (`SP-53`, `SP-54`).
  But §22.6 gives the `Completed → Voided` edge the permission `Sale.Void`, says it has "no stock, no money", and
  allows it only before a receipt prints (`SM-34`).
- **Blocked:** sale voids.
- **Meanwhile:** voids are not built. A reversal movement on a sale is refused (`SS044`), and the sale's status is not
  updatable by the application. Returns (domain 5) are the v1 correction.

### OQ-018 — Payment transition permissions (needed before the till takes a card)

- **Unknown:** §22.10 gives `(creation) → Pending` (submit), `Authorized → Captured` (capture) and `→ Voided` (void)
  the permission `OPEN DECISION`. `GAP-036` lists them; `SM-02d` forbids deriving them from a neighbouring key.
- **Why not answerable from `/docs`:** naming a permission key is the owner's decision.
- **Blocked:** Step 3 cannot authorise a card payment's submit, capture or void; the architecture's fallback is to
  refuse. Cash capture inside the completion transaction can be read as a side effect of `Sale.Create` (§22.6 lists
  "payment captured" among its effects), but the submit edge that creates the payment is also unkeyed.
- **Meanwhile:** the schema carries the machine unchanged. **The owner needs to name these keys before the card path
  is built.**

### OQ-019 — Which location a till sells from

- **Unknown:** a sale line draws from a sellable location (`WH-01`), but no rule says which one when a store has
  several.
- **Meanwhile:** each till is configured with a `sell_from_location_id`, which must be a sellable location of its own
  store. A line may use any sellable location of the store.

### OQ-020 — Shift variance tolerance and the second-approver threshold

- **Unknown:** `CD-23`: "variance within tolerance closes automatically; beyond it needs acknowledgement … and, beyond
  a higher threshold, a different approver". No tolerance or higher threshold is specified or configured.
- **Meanwhile:** the tolerance is zero, so any non-zero variance needs an acknowledgement with a reason. The
  second-approver threshold is not enforced until one is configured.

### OQ-021 — What `Maintenance` mode does to a sale

- **Unknown:** `PT-03` restricts `Training` (no real sale, no stock, no tender). `RT-423` says "a separate service
  state is what refuses a sale". Nothing says whether `Maintenance` mode refuses a sale.
- **Meanwhile:** only `Training` blocks by mode, and the device status must be `Active`.

### OQ-022 — `RT-119`'s "no payment record" against `PY-38`'s order

- **Unknown:** `RT-119`'s acceptance says a fault in completion leaves "no payment record". But `PY-38` captures a card
  *before* the commit, and `PY-42` records every attempt, so a card payment record legitimately exists before
  completion.
- **Meanwhile:** the completion transaction leaves no record of its own (cash tenders, sale, lines, movements, change)
  when it fails, which is tested. Card attempts made before it remain, as `PY-38` and `PY-42` require, and are
  reconciled (`PY-40`).

## How to use this file

- Add an entry the moment you hit something the specification does not answer. Then continue with a different task.
- Do not ask the owner about anything not listed under **Ask the owner only for** in [CLAUDE.md](CLAUDE.md):
  choosing the tech stack, changing an owner decision, or anything needing money, secrets, or real hardware.
- Resolve from `/docs` first. If `/docs` answers it, it is not an open question and does not belong here.
- Close an entry only by recording the decision and where it is recorded. Do not delete an entry.
