# Domain 1 — Organization / Store / Warehouse

**Phase 3 — database design.** Migration: `db/migrations/20260930130000_d1_organization_store_warehouse.sql`.
Conventions: [CONVENTIONS.md](CONVENTIONS.md).

| State (Constitution §5) | What |
|---|---|
| **DESIGNED** | Everything in this document |
| **IMPLEMENTED** | The migration: tables, constraints, triggers, grants, citations |
| **TESTED** | `server/test/d1-organization.test.ts` (44 tests), `schema-rules.test.ts` (11), `citations.test.ts` (2), all passing on PostgreSQL 17.11 |
| **Not yet** | No application code uses any of it. The guards in §6 do not exist yet, because the tables that trigger them do not |

Sources: [organization-model.md](../product/organization-model.md), [multi-store-domain.md](../product/multi-store-domain.md),
[product-overview.md](../product/product-overview.md) §3, `OWNER-DECISIONS.md` **D-03**, `business-invariants.md`
(`BI-01`, `BI-14`, `BI-40`, `BI-42`), requirements `RT-001`, `RT-003`, `RT-004`, `RT-046`, `RT-057`, `RT-269`,
`RT-445`, `RT-479`, `RT-483`, `RT-504`..`RT-510`, `RT-353`.

---

## 1. Scope

**In this domain:** currency, organization, store, versioned store settings, warehouse, storage location, the D-03
store attribution of central-warehouse locations, and document numbering.

**Elsewhere, on purpose:**

| Item | Where | Why there |
|---|---|---|
| `PosTerminal`, `CashDrawer` | Domain 4 | Needed first by the sale (`PT-01`, `RT-122`) and the shift (`BI-39`); cash-management owns them (overview §4.1) |
| `ReasonCode` | Domain 3 | First needed by stock adjustments (overview §3.8) |
| FEFO policy, expiry windows, expiry blocking | Domain 3 | Owned by `batch-expiry-fefo.md`, which specifies a `ShortDated` window organization-model does not mention (`BE-19`) |
| Return disposition default | Domain 5 | Owned by the returns domain, where `RR-17` and `UX-30` decide how a default relates to a required choice |
| Price lists | Domain 2 | Catalog |
| Locale formatting (date, number, language) | Deferred | No v1 behaviour uses it (`UX-71`: no multi-language UI). Additive later |
| Approval thresholds, receipt templates, feature switches | Deferred | No v1 slice feature needs them yet |

Settings added by later domains become new columns on `store_setting_version`. The value backfilled onto older
versions is what the system did before the setting existed (for example FEFO `Off`), so no past version is misstated.

## 2. Tables

### `currency` — reference

| Column | Type | Rule |
|---|---|---|
| `code` | `text` PK, `^[A-Z]{3}$` | `BI-01` |
| `minor_unit_exponent` | `smallint`, 0..18 | `BI-01` (a recorded exponent), `ADR-04` (integer minor units; `10^18` fits a `bigint`) |

No rows ship: the deployment currency is owner configuration (**OQ-006**). The application may add a currency but
never change an exponent. Changing one would reinterpret every stored amount, so there is no `UPDATE` grant. That is a
design consequence of `ADR-04`, not a new business rule.

### `organization` — tenant

`legal_name`, `trading_name`, `registration_identifier` (organization-model §2), `currency_code` (`ORG-01`),
`time_zone` (`ORG-02`), `deactivated_at`/`deactivated_by` (`ORG-03`, `RT-506`).

- Never deleted (`RT-506`, `BI-40`): the runtime role has no `DELETE`.
- Deactivation is written once. The application sets `deactivated_by`, and the trigger stamps `deactivated_at` with
  server time (`RT-353`). A second change of either raises `SS001`. No reactivation is specified (**OQ-001**).
- `currency_code` and `time_zone` are updatable **until a financial document exists** (`ORG-01`, `ORG-02`; `RT-505`:
  "before that it is settable"). The guard is pending (§6).

### `store` — organization-scoped

`code` (unique per organization, **OQ-008**), `name`, `address`, `contact_details`, `time_zone`, `currency_code`,
deactivation as for organization.

- Never deleted (`ORG-05`, `RT-508`).
- `currency_code` is **immutable** (organization-model §3.1: "Currency | Immutable"): there is no `UPDATE` grant.
- `time_zone` is not updatable by the application until **OQ-007** is answered.
- `organization_id` is immutable: a store never changes tenant.
- v1 onboards one store with the organization's currency; the schema does not force equality, because overview §3.1
  says single-currency is a `SHOULD`.

### `store_setting_version` — store-scoped, append-only

`REQ-AU-06` (organization-model §3.1): "every store setting that can change the meaning of money or stock must
record an effective timestamp, and every financial document must record the settings snapshot it was computed
under." A version row is immutable, so a document that references its id has recorded the snapshot.

| Column | Rule |
|---|---|
| `effective_from` (defaults to now) | Prospective only: `CHECK (effective_from >= created_at)`, and `created_at` cannot be supplied |
| `tax_mode` `Inclusive` \| `Exclusive` | `SP-33`, `PR-38`, `RT-046`. Immutable once a sale exists (guard pending, §6) |
| `negative_stock_policy` `AllowNegative` \| `BlockNegative` | `IV-16`, `RT-483`. v1 default `AllowNegative` for stores (`CON-07`), supplied by onboarding, not by a column default |
| `created_by` | The employee who made the change (actor FK in domain 7) |

The version in force at time `t`:

```sql
SELECT * FROM store_setting_version
WHERE store_id = $1 AND effective_from <= $2
ORDER BY effective_from DESC LIMIT 1;   -- a backward scan of uq_store_setting_version_effective
```

`UNIQUE (store_id, effective_from)` makes that answer unambiguous. A store with no version in force cannot trade; the
sale path refuses it (`RT-457`, domain 4).

Not specified, so not built: cancelling a future-dated version before it takes effect.

### `warehouse` — scope chosen per row

`kind` `StoreAttached` \| `Central`, `store_id` exactly when store-attached (`RT-003`), `code` unique per
organization (**OQ-008**), `name`, `address`.

- A store-attached warehouse's store must be in the same organization: a composite FK to `store (id, organization_id)`.
- **Every warehouse has exactly one `Default` location.** "At most one" is a partial unique index. "At least one" is a
  deferred constraint trigger checked at commit (`SS002`). Organization-model §1: "the default location is required"
  (no rule ID; cited as `MS-17`/`RT-057`).
- `kind`, `store_id` and `organization_id` are immutable to the application. Re-homing a warehouse is not a
  specified operation.
- Not built: warehouse FEFO participation (organization-model §4), which domain 3 adds with FEFO.

### `storage_location` — organization-scoped (D-03)

`code` (unique per warehouse), `name`, `location_type`, `is_sellable`. It carries `organization_id` and
`warehouse_kind`, both proven by a composite FK to `warehouse (id, kind, organization_id)`.

- **No `store_id`.** Owner decision D-03: "`StorageLocation` does not carry a single `StoreId` as the ownership
  model." This supersedes organization-model §8.2's listing of `StorageLocation` as store-specific, because an owner
  decision outranks a phase specification (Constitution §2). A location's store is its warehouse's store, or an
  attribution row (below).
- `location_type` is organization-model §5's standard set: `Default`, `Receiving`, `Quarantine`, `Damaged`,
  `ReturnsPending`, `Transit`. It is immutable to the application, so the Default stays the Default.
- **Only a `Default` location can be sellable** (§5 table; `WH-01`, `WH-04`, `RT-510`).
- **No location of a central warehouse can be sellable** (`MS-15`, `MS-18`, `RT-004`, `WH-02`). That makes `RT-004`
  ("a sale drawing from a central warehouse is refused") structural, once domain 3 enforces `WH-01`.
- `is_sellable` can be turned off, and back on, at any time (`WH-03`, `RT-509`).
- Never deleted by the application. `WH-03` forbids deleting a location that holds stock or has a movement, which
  implies an empty one could be deleted. But overview §3.6 gives a closed list of hard-deletable entities that does not
  include locations, and it wins conflicts. No v1 screen needs a location delete.
- Pending: `batch-expiry-fefo.md` uses an `ExpiredHold` location (`BE-24`) that organization-model §5 does not list.
  Domain 3 adds it to the type check by migration (`ADR-21`) if it builds expiry holds.

### `storage_location_attribution` — store-scoped, append-only (D-03)

`(storage_location_id, store_id)` for **central-warehouse locations only**, with `created_by`. Composite foreign keys
prove the location is central and that location and store share an organization. One location may be attributed to
several stores (D-03: "capable of representing several stores drawing from the same central-warehouse location").

A store-attached location has no row: its attribution is its warehouse's store. Not specified, so not built: ending an
attribution.

### `document_type` and `document_number_sequence` — numbering (`BI-42`, `RT-479`)

- `document_type` is a closed reference set, extended only by the migration of the domain that creates a document
  (`ADR-21`). The application cannot add a type.
- `allocate_document_number(store, type)` is one `INSERT … ON CONFLICT DO UPDATE … RETURNING`, run inside the creating
  transaction. The counter row stays locked until commit, so allocations for one store and type are serialized.
  Callers take stock locks before calling it (`PHASE-2-ARCHITECTURE` §20.2: stock before document).
- A rollback returns its number unissued, so no gap is left. That is not reuse, because no committed document held the
  number, and nothing prints before commit (`PHASE-2-ARCHITECTURE` §12.5). `BI-42` permits a gap; it does not require
  one.
- A counter can never move backwards (`SS003`). Uniqueness of the issued number on each document table is added by the
  domain that creates the document.
- Not decided here: prefixes, formatting (`PREFIX-YYYYMM-NNNNNN`) and any monthly reset (**OQ-004**). Offline
  numbering allocated on a till (`state-machines.md` §22.14) is designed with offline sync.

## 3. Runtime role grants

| Table | `SELECT` | `INSERT` | `UPDATE` columns | `DELETE` |
|---|---|---|---|---|
| `currency` | yes | `code`, `minor_unit_exponent` | — | — |
| `organization` | yes | identity, `currency_code`, `time_zone` | identity, `currency_code`, `time_zone`, `deactivated_by` | — |
| `store` | yes | identity, `time_zone`, `currency_code` | `code`, `name`, `address`, `contact_details`, `deactivated_by` | — |
| `store_setting_version` | yes | all but `created_at` | — (append-only) | — |
| `warehouse` | yes | all but `created_at` | `code`, `name`, `address` | — |
| `storage_location` | yes | all but `created_at` | `code`, `name`, `is_sellable` | — |
| `storage_location_attribution` | yes | all but `created_at` | — (append-only) | — |
| `document_type` | yes | — | — | — |
| `document_number_sequence` | yes | yes | `last_value` | — |

`created_at` is never insertable, so it is always server time (`RT-353`). A column missing from the `UPDATE` list is
immutable to the application.

## 4. Decisions taken here, and their authority

| Decision | Authority |
|---|---|
| A location carries no `store_id` | **D-03** (owner), over organization-model §8.2 |
| Business date computed in the store's zone; store zone not editable in v1 | Overview §3 tie-break; **OQ-007** |
| Settings as immutable versions referenced by documents | `REQ-AU-06`, `PHASE-2-ARCHITECTURE` P5 |
| Only Default locations are sellable; central locations never | Organization-model §5 table, `MS-15`, `MS-18`, `RT-004` |
| Deactivation written once with server time; no reactivation | `BI-40`, `RT-353`; **OQ-001** |
| No hard delete of any domain-1 row | `BI-40`, overview §3.6 |
| No `created_by` on master data; attribution by audit event | CONVENTIONS §11 |

**Choices the specification does not dictate**, listed so they can be reversed: code uniqueness scopes (**OQ-008**),
the 0..18 exponent bound (a `bigint` limit), the IANA-only time-zone check (PostgreSQL also accepts abbreviations and
POSIX strings, which carry no daylight-saving rules and which a browser's `Intl` rejects), and the absence of a DB
default for `negative_stock_policy`.

## 5. Tests — what proves what

Every constraint that enforces a rule is shown to reject the violation **and** to accept the legitimate case.

| Rule | Proven by |
|---|---|
| `RT-001`, `MS-01` | `schema-rules`: every table classified; store-scoped tables have `store_id NOT NULL` with a FK; organization-scoped have `organization_id`, no `store_id` |
| `BI-01` | `schema-rules`: no `real`/`double precision` column; `d1`: currency code and exponent checks |
| `ADR-11`, `BI-40`, `RT-346` | `schema-rules`: the runtime role has no `DELETE`/`TRUNCATE` anywhere, owns nothing, cannot create objects; append-only tables grant no `UPDATE` |
| `RT-353` | `schema-rules`: `created_at` never insertable or updatable; `d1`: deactivation stamped with the transaction's time |
| `AU-32` | `schema-rules`: no FK cascades or nulls on delete or update |
| `RT-003`, `MS-15`, `BI-14` | `d1` warehouse: kind/store coupling, same-organization store, kind and store immutable |
| Default location required | `d1`: a warehouse without its Default fails at commit (`SS002`); a second Default is refused |
| `RT-004`, `MS-18`, `WH-02` | `d1`: a central location cannot be made sellable |
| `WH-01`, `WH-04`, `RT-510` | `d1`: each non-Default type refused as sellable, accepted as unsellable |
| `WH-03`, `RT-509` | `d1`: sellability toggles both ways; location never deleted; type immutable |
| `D-03`, `MS-16`, `MS-19` | `d1`: central location attributed to two stores; store-attached location refused; cross-organization refused; append-only |
| `REQ-AU-06`, `SP-33`, `IV-16` | `d1`: prospective only, version in force by time, no same-instant pair, append-only, value sets |
| `ORG-01`, `ORG-02`, `RT-505` | `d1`: settable before financial history; IANA zones only |
| `ORG-03`, `ORG-05`, `RT-506`, `RT-508` | `d1`: no delete; deactivation once, with who and server time |
| `RT-269` | `d1`: a second store in one organization |
| `BI-42`, `RT-479` | `d1`: numbering per store and type; **1,000 concurrent allocations unique and contiguous**; a rollback leaves no committed duplicate; a counter cannot move backwards; unknown types refused; the application cannot add a type |
| CLAUDE.md citations | `citations`: every table, constraint, index, function, trigger and domain carries `Cites:` with IDs present in `/docs`; a self-test proves the checker catches violations |

**Mutation check (2026-09-30).** Removing the central-not-sellable check, removing the Default-location trigger, and
granting the application `UPDATE` on `location_type` each turned the corresponding test red. Each test fails when its
guard is gone, so none of the three passes vacuously. A first run of this check wrongly reported the first mutation as
undetected: the mutated migration still contained the constraint's `COMMENT`, so it failed to apply, no test ran, and
the harness misread the crash as a pass. Redone correctly, the test is red.

## 6. Guards pending in later domains

These rules cannot be violated yet, because the rows that would violate them cannot exist. Each is created, with its
test, by the migration that creates those rows (CONVENTIONS §12):

| Rule | Guard | Domain |
|---|---|---|
| `ORG-01`, `ORG-02`, `RT-504`, `RT-505` | Organization currency and time zone frozen once a financial document exists | First financial-document table |
| `SP-33`, `PR-38` | A settings version cannot change the tax mode once the store has a sale, including a version already scheduled | 4 |
| `ORG-05`, `RT-445`, `EC-39` | No store deactivation while it holds stock | 3 |
| `ORG-05`, `RT-445`, `EC-89` | No store deactivation while it has an open shift | 4 |
| `WH-01`, `RT-004` | Sale lines draw only from sellable locations | 3, 4 |
| `WH-02` | A central location never goes negative | 3 |
| `MS-16`, `MS-19`, `D-03` | A movement's store is the location's warehouse store or an attributed store | 3 |
| `RT-457`, `EC-86` | A store with no terminal, drawer or settings in force cannot trade | 4 |

## 7. Multi-store readiness

v1 runs one store (`EC-91`). Everything a second store needs already exists: a non-null `store_id` on every
store-scoped row (`RT-001`), per-store numbering, per-store settings, and central warehouses with explicit
attribution (D-03). Enabling a second store is data, not a migration (`RT-269`). Cross-store transfers stay disabled
by configuration (`MS-20`), and nothing here enables them.

## 8. Performance

Nothing here is on the scan path. The per-sale reads are the settings version in force (one backward index scan) and
the document number (one upsert on a primary key). The time-zone check costs about 0.1 ms and runs only when a zone is
written. The alternative, a lookup in `pg_timezone_names`, measured about 175 ms per call on this machine.
