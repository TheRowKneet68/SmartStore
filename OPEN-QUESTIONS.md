# Open Questions

**Last updated:** 2026-10-01

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
- **2026-09-30, domain 5:** implemented as a subtraction. Cash-management §5 gives `RefundFromDrawer` the direction
  `Out`, and `PY-27` says a refund missing from the drawer record leaves the count short; both contradict `CD-06`'s plus
  sign. Tested: a 100 cash refund in a shift with a 1000 float and 300 of cash sales leaves 1200 expected.

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
- **Step 3 reading, 2026-10-01, stated so the owner can veto it.** §22.6 lists "payment captured" among the side
  effects of completing a sale (`Sale.Create`), "all in one transaction". So a **cash** tender exists only inside the
  sale's completion transaction, and its creation, authorization and capture there are that transition's side effects,
  authorized by `Sale.Create`. No cash payment is ever submitted or captured on its own. Card submit, capture and void
  remain separate transitions with `OPEN DECISION` permissions, and the gate refuses them.

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

### OQ-023 — Returns and refunds: undecided permissions, skipped approval, settling, and the window's edges

- **Unknown, and needed from the owner before Step 3 pays a refund:** §22.7 gives the permission `OPEN DECISION` to
  five transitions. On the refund: `submit to provider` (`Approved → Processing`, the step that pays) and `cancel`. On
  the return: `cancel`, `settle` and `close`. `SM-02d` forbids borrowing a neighbouring key, and architecture §8.4 says
  an unkeyed transition refuses. So **no refund can be paid in v1, not even in cash, until the owner names the
  `submit to provider` key.** This is the same kind of decision as OQ-018.
- **Unknown, not blocking the schema:**
  1. *Skipping approval.* State-machines §8 says approval "may be skipped where none is required", and the §12.2
     diagram marks `PendingApproval` "(if required)". But §22.7 contracts only `Draft → PendingApproval → Approved`,
     with approver ≠ issuer, and the `LargeRefund` threshold (approval-workflows §1, per store and per currency) has no
     values. There is also no way out of `Draft` or `PendingApproval` except forward: no reject, no withdraw.
     *Meanwhile:* every refund is approved by a second person, as OQ-013 does for adjustments. A skip edge and a
     threshold setting are additive.
  2. *Settling a return.* `Posted → Settled` needs "the refundable amount is zero, or the remainder is written off with
     a reason". A return's refundable amount is not defined: presumably each line's settled amount prorated by the
     quantity returned, but with what rounding? Where a write-off is recorded is not defined either. *Meanwhile:*
     there is no settle or close edge, and a return rests at `Posted`. A refund for a return may pay only lines that
     return took back, bounded by each line's settled amount (`RR-03`), not by the value of the quantity returned.
  3. *The window's edges.* `RR-10` makes the window a store setting; `RT-150` and `EC-66` say "per store and per
     category". `EC-66` says a late return is "Rejected … unless the store has extended it", where `RR-11` escalates it
     to an approver with a reason. *Meanwhile:* one window per store, `RR-11`'s escalation, the window's last day
     (sale business date + N days) inside it, and N taken from the settings version in force when the return is
     posted.
  4. *Refunding a service.* Nothing comes back, so a service line cannot be returned (its movement is refused,
     `SS012`), and its refund is therefore a goodwill refund with a reason. Confirm that is intended.
  5. *Refund tax rounding.* `RR-06` says "at the same proportion". The schema rounds the cumulative refunded tax of a
     line half away from zero (overview §3.1), so partial refunds add up to exactly the tax charged. Confirm.
  6. *A cap per tender.* `PY-22` bounds a refund per line and per sale. Nothing bounds the refunds sent back to one
     original tender by what that tender paid: for example, a sale paid half cash and half card, refunded in full
     to the card. *Meanwhile:* no such cap; the per-line and per-sale bounds hold.
- **Why not answerable from `/docs`:** permission keys are the owner's to name; the rest is silent or contradictory.
- **Blocked:** paying any refund in Step 3 (the first point). Nothing else.

### OQ-024 — Audit: vocabulary gaps and two contradictions

- **Unknown:**
  1. *`Cash.In`.* §22.11 records opening a shift as `Cash.In`, but `AU-12`'s closed list does not contain it, although
     `AU-12b` says every type a rule requires is in the set. *Meanwhile:* added to the vocabulary, citing §22.11.
  2. *Reading the log.* `AU-25` and `RT-300` require an event for every access to the log, naming the reader and what
     was read. No type in `AU-12` records it. *Meanwhile:* not recorded. Reads of the log go unaudited until a type is
     named (`AU-13`).
  3. *Expiry.* `AU-02` says no event is deleted "at any privilege… not by retention cleanup"; `AU-20` says "expiring an
     event removes a row". *Meanwhile:* no deletion path exists. Retention, expiry and archival wait for the
     configured financial periods (`AU-17`, a legal floor like `GAP-044`), and the two rules must be reconciled first.
  4. *Master data and configuration.* No type covers creating an organization, store, warehouse or location, or
     changing settings (the negative-stock policy, the tax mode, the return window), tax rates, standard costs, reason
     codes, payment-method enablement, or store deactivation. CONVENTIONS §11 had said master-data creation would be
     attributed by its audit event; the closed vocabulary cannot do that. *Meanwhile:* not audited; CONVENTIONS
     corrected.
  5. *The tender's event.* §22.6 says a sale records "`Payment.Capture` or `Cash.PayOut` for the tender". *Meanwhile:*
     every capture records `Payment.Capture` (§22.10), and every cash transaction records `Cash.In` or `Cash.PayOut` by
     its direction, so change, the closing float and cash refunds are `Cash.PayOut`, with the cash type in the event.
  6. *Product activation's reason.* §22.1's note says every product edge is reason-bearing; the activate row lists
     only the completeness check. *Meanwhile:* activation needs no reason, and the other five edges do.
  7. *"Twenty categories".* `RT-292`'s acceptance speaks of "the twenty listed categories"; `AU-03` lists about twelve.
     *Meanwhile:* every `AU-03` category that v1 builds is recorded and tested; permission changes, provider
     configuration and sign-in events arrive with domain 7 and the application.
- **Why not answerable from `/docs`:** the documents are silent (2, 4) or disagree (1, 3, 5, 6, 7), and a new event type
  is a reviewed change for the owner (`AU-13`).
- **Blocked:** nothing in the schema; auditing reads of the log waits for a type.

### OQ-025 — Employees and access: unnamed permissions, drawn edges, and the templates' notation

- **Unknown, and needed from the owner before Step 3 builds these screens:**
  1. *Reversal edges with no permission.* The contract's Reversal column names four edges but gives each no
     permission (and the first two no event):
     - an employee's return from leave (`OnLeave → Active`, §22.9);
     - an employee's reactivation from suspension (`Suspended → Active`, §22.9);
     - re-enabling a disabled till (`Disabled → Active`, §22.12);
     - retrying a failed refund (`Failed → Processing`, §22.7).

     `SM-02d` forbids borrowing the forward edge's key. *Meanwhile:* built as edges ("reactivate" is `SM-50`'s word)
     with the permission `OpenDecision`, so the gate refuses them. **Until keys are named, no employee returns from
     leave or suspension, no disabled till is re-enabled, and no failed refund is retried.**
- **Unknown, not blocking the schema:**
  2. *Drawn but not contracted.* §10's diagram draws `Suspended → Terminated` and `Active → Archived`. §22.9 contracts
     `OnLeave → Terminated` and `Terminated → Archived` instead. *Meanwhile:* the contract's edges; the drawn ones
     refuse (as OQ-009, OQ-014).
  3. *A suspension leaves no event of its own.* §22.9 audits a suspension as `Security.SessionEnded` per revoked
     session, and `D-06` gives it no `Employee.StateChange`. Suspending someone with no live session therefore
     records no event, and its reason nowhere. *Meanwhile:* as contracted.
  4. *Store access and role definitions have no event type.* `EM-15` and `PC-01` require audit entries for store
     access and role changes, but `AU-12` names none (`Security.Role.Assign` covers assignments, and is used for
     them). *Meanwhile:* not audit events; the history is kept in the rows as revocation facts, never deleted.
  5. *The templates are notation, not data.* actors-and-roles §4 uses names the catalogue lacks:
     - `Sales.*`, although no key starts with `Sales.`;
     - `Refund.Large.Approve` and `Cost.View`, where the catalogue has `Sale.Refund.Large.Approve` and
       `Product.Cost.View`;
     - limits such as "(low limit)";
     - the Auditor's "read-only access to all transactional documents".

     §2.13 cites `Payment.Capture` (SEP-06) and `Purchase.Return.Create.Approve` (SEP-11), neither of which is a
     catalogue key. *Meanwhile:* no template is seeded; roles are built from catalogue keys, and custom roles are
     permitted.
  6. *Organization-level actions.* Editing the catalogue or organization configuration names no store.
     *Meanwhile:* it needs an organization-wide assignment (`MS-11`); a store-scoped one authorizes only that store.
  7. *Usernames.* Unique per organization, whatever the case, so sign-in resolves the organization first (from the
     till or the address). Confirm, or require usernames unique across organizations.
- **Why not answerable from `/docs`:** naming permission keys is the owner's (`SM-02d`, as OQ-018 and OQ-023); the
  rest is silent or contradictory.
- **Blocked:** item 1's features in Step 3. Nothing else.

### OQ-026 — Which permission authorizes managing warehouses and storage locations

- **Unknown:** the catalogue key for creating a warehouse or a storage location, renaming one, and turning a
  location's `IsSellable` on or off (`WH-03`).
  - Actors-and-roles §3.3 gives "create warehouses and locations" to the Super Administrator, whose template (§4)
    holds `Config.*` and `Device.*`.
  - No key's description covers it. `Config.Store` is "change store settings", and organization-model §3 lists
    settings that do not include warehouses. `Config.Organization` is "organization settings, tax, reason codes,
    approval thresholds".
- **Why not answerable from `/docs`:** choosing which key authorizes an action is the owner's (`SM-02d`, architecture
  §8.4), as in OQ-018, OQ-023 and OQ-025.
- *Meanwhile:* onboarding creates the store's warehouse and its Default location, which every warehouse must have.
  No route manages warehouses or locations.
- **Blocked:** any location beyond the Default, including the Quarantine, Damaged and ExpiredHold locations that a
  return's non-sellable dispositions need (D5). Put to the owner with the key list before Domain 5 (working
  agreement 8). Nothing else.

### OQ-027 — How long a session lasts, and how many failed sign-ins throttle a credential

- **Unknown:** three numbers.
  - The session lifetime. `user_session.expires_at` is required, so every session must have one. Architecture §7.2
    warns against a 30-day lifetime and names no figure.
  - The number of failed sign-ins that throttle a credential.
  - The window those failures are counted over. `SM-49` says "a credential is throttled", never the employee, and
    gives no figures.
- **Why not answerable from `/docs`:** no document states any of the three. They are security policy, so they are the
  owner's.
- *Meanwhile:* each is a **required** setting with no default:
  - `SESSION_LIFETIME_MINUTES`;
  - `SIGN_IN_FAILURE_LIMIT`;
  - `SIGN_IN_FAILURE_WINDOW_MINUTES`.

  The server refuses to start until the owner sets them in `.env`. Tests use TEST-ONLY values.
- **Blocked:** running the server until the owner sets them. Nothing in the code waits on the answer.
- **Also unstated:** any rule for passwords, such as a minimum length. *Meanwhile:* any non-empty password is accepted.
- **Added 2026-10-01: how long a price quote stays valid.**
  - `RT-124` fixes a line's price at the moment it is added. D4 §3 has the scan sign each quote and the application
    bound its age, so an old quote cannot be replayed at an old price.
  - No document gives the bound. *Meanwhile:* a fourth required setting, `QUOTE_MAX_AGE_MINUTES`, with no default.
  - A cart older than that must be rescanned.
- **Added 2026-10-01: how long to wait for a contended stock balance.**
  - `IV-23` wants "a short, bounded timeout" on the balance-row lock, after which the operation fails cleanly and the
    cashier is told to retry. No document gives the number.
  - *Meanwhile:* a fifth required setting, `LOCK_TIMEOUT_MS`, with no default. It applies to every transaction that
    moves stock (a sale, posting or reversing an adjustment).

### OQ-028 — `Config.Roles` and `Role.Create`/`Role.Edit` overlap

- **Unknown:** which key governs defining roles.
  - Actors-and-roles §2.8 has `Role.View`/`Role.Create`/`Role.Edit`, "manage role definitions", and `Role.Assign`.
  - §2.12 has `Config.Roles`, "change role definitions and assignments".
  - `SEP-03` says `Config.Roles` and `Role.Assign` should not be held together, which reads as `Config.Roles` covering
    definitions. That is what `Role.Create`/`Role.Edit` cover.
- **Why not answerable from `/docs`:** two catalogue keys describe the same action, and choosing which one authorizes
  it is the owner's (`SM-02d`).
- *Meanwhile:* the routes ask for the narrower `Role.*` keys (D7 §9). `Config.Roles` authorizes nothing yet.
- **Blocked:** nothing. Put to the owner with the key list before Domain 5 (working agreement 8).

### OQ-029 — May the declared closing float exceed what was counted?

- **Unknown:** `CD-20` requires "a declaration of the closing float for the next shift", which cash-management §5
  records as a `ClosingFloat` movement out of the drawer. Nothing says whether the declaration may exceed the latest
  counted amount. That would hand on more cash than the drawer was found to hold.
- **Why not answerable from `/docs`:** no rule bounds the declaration. The schema takes any non-negative amount
  (`ck_cash_transaction_amount`).
- **Blocked:** nothing. A bound, if wanted, is one check in the close (`server/src/modules/sales/shift-close.ts`).
- *Meanwhile:* the declaration is recorded as made. It feeds no expected amount:
  - this shift's expected amount is fixed at the count, before the close writes the float;
  - the next shift counts its own opening float when it opens (`CD-10`, `CD-13`).

### OQ-030 — The minimum touch-target size and the contrast ratio

- **Unknown:** the two numbers behind `UX-53`, `UX-54` and `RT-380`:
  - `UX-53` defers the minimum target size to Phase 2;
  - `UX-54` asks for text contrast that "meets a published ratio";
  - `RT-380` requires both to exist and be asserted in the acceptance suite.

  Phase 2 says only "sufficient contrast" (architecture §5.4). No document states either number.
- **Why not answerable from `/docs`:** both numbers were deferred, and nothing later sets them.
- **Blocked:** `RT-380`'s acceptance assertion, which needs the owner's numbers.
- *Meanwhile:* the web UI uses the strictest published levels, each one variable in `web/src/styles.css`:
  - every text colour pair meets WCAG 2.2 level AAA, 7:1 or more. The lowest pair measures 7.29:1;
  - every control is at least 3rem tall, 54 CSS px at the 18 px base.

### OQ-031 — Archiving a brand, a unit or a tax category

- **Unknown:** whether a brand, a unit or a tax category can be archived, and what archiving one would stop.
  - The owner's brief of 2026-10-01 lists "reference-data edit/archive (brands, units, tax categories)".
  - `/docs` gives archival to categories (`PR-05`, `RT-027`), variants (`PR-48`, `RT-495`) and barcodes (`PR-09`),
    and deactivation to a unit conversion that has been used (`PR-18`). It gives none to a brand, a unit or a tax
    category, and the schema has no archive column for them (D2 §3, §4).
- **Why not answerable from `/docs`:** an archive must say what it blocks. For example, does it stop new variants on
  a unit, or in a tax category, while the old ones go on selling? No rule says.
- **Blocked:** archiving those three only. Editing them is not blocked. The schema lets a unit's code, names, kind
  and decimal places change, and a tax category's code and name, and a brand's name (D2 §4). A unit's kind is frozen
  once anything uses it (`PR-14`, `RT-491`), and a tax rate changes only by a new version (`RT-047`).
- *Meanwhile:* none of the three can be archived.

## How to use this file

- Add an entry the moment you hit something the specification does not answer. Then continue with a different task.
- Do not ask the owner about anything not listed under **Ask the owner only for** in [CLAUDE.md](CLAUDE.md):
  choosing the tech stack, changing an owner decision, or anything needing money, secrets, or real hardware.
- Resolve from `/docs` first. If `/docs` answers it, it is not an open question and does not belong here.
- Close an entry only by recording the decision and where it is recorded. Do not delete an entry.
