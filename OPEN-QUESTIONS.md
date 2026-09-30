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
- **Blocked:** nothing in the schema.
- **Meanwhile:** domain 1 records the *fact* (`deactivated_at`, `deactivated_by`) and invents no state names or
  transitions. No reactivation path is built.

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

## How to use this file

- Add an entry the moment you hit something the specification does not answer. Then continue with a different task.
- Do not ask the owner about anything not listed under **Ask the owner only for** in [CLAUDE.md](CLAUDE.md):
  choosing the tech stack, changing an owner decision, or anything needing money, secrets, or real hardware.
- Resolve from `/docs` first. If `/docs` answers it, it is not an open question and does not belong here.
- Close an entry only by recording the decision and where it is recorded. Do not delete an entry.
