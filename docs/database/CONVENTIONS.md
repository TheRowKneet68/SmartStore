# Database conventions

**Phase 3 — database design. Applies to every migration in `db/migrations/`.**

Status: **DESIGNED.** Nothing here is IMPLEMENTED or TESTED until the migration and the test that prove it exist and
have run; each domain document says which are which.

Every convention below is either taken from the specification, and cites it, or is a mechanical choice the
specification leaves open, and says so. Where the specification does not decide something the schema needs, the
question is in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md) and the schema is built to hold either answer.

Sources: [product-overview.md](../product/product-overview.md) §3 (the canonical conventions, which win over any
domain document), [PHASE-2-ARCHITECTURE.md](../architecture/PHASE-2-ARCHITECTURE.md) (`ADR-04`, `ADR-05`, `ADR-06`,
`ADR-10`, `ADR-11`, `ADR-21`, `ADR-25`), [ADR-31](../architecture/ADR-31-V1-STACK-AND-TOOLING.md),
[retention-and-deletion.md](../domain/retention-and-deletion.md).

---

## 1. Naming

- Tables and columns are `snake_case`. A table is named for its entity in the singular: `Store` is `store`,
  `StorageLocation` is `storage_location`. The specification's `StoreId` is the column `store_id`.
- Primary key `id`. Foreign key `<entity>_id`. Timestamps `<event>_at`. Booleans read as a fact (`is_sellable`).
- Constraint and index names are explicit, so an error message and a `COMMENT` can name them:
  `pk_<table>`, `fk_<table>_<column>`, `uq_<table>_<columns>`, `ck_<table>_<what>`, `ix_<table>_<columns>`.
- Migration files: `<UTC timestamp>_d<N>_<domain>.sql`. `N` is the domain's number in the Step 2 order; `d0` is
  shared foundations.

## 2. Identifiers

- Every entity's primary key is `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, a random version-4 UUID
  (`gen_random_uuid()` is core PostgreSQL, no extension). **Source:** overview §3.4, "opaque and non-derivable. No
  sequential IDs are exposed to clients, and no entity type is inferable from an ID."
  *Mechanical choice:* version 4 rather than the time-ordered version 7, because a time-ordered id is derivable
  information and §3.4 says non-derivable.
- An **append-only ledger or audit table** additionally has `seq bigint GENERATED ALWAYS AS IDENTITY`: a total order
  used for rebuilds and range scans, never returned by an API. It is not a second identity.
- A **document** (sale, order, receipt) also has a human-readable number allocated in the creating transaction by
  `allocate_document_number` (`BI-42`, `RT-479`; domain 1). It is never reused, including after cancellation.
- A client-generated `ClientOperationId` is a `uuid` with a unique index (`SM-04`, `ADR-07`, overview §3.10).

## 3. Time

- Every instant is `timestamptz` (stored as UTC). **Source:** overview §3.3. Columns named `*_at` are instants.
- `created_at timestamptz NOT NULL DEFAULT now()` on every row that is not a pure reference row.
- A **business date** is a separate `date` column, computed by the application in the store's time zone at write time
  and stored on the document. It is never derived later from an instant. **Source:** overview §3.3.
  *Open:* how the business date is rolled and audited is `GAP-041`; see `OQ-003`.
- The device clock is never a business timestamp (`PHASE-2-ARCHITECTURE` §11.1).

## 4. Money

- Money is `bigint` **integer minor units** (`ADR-04`, `ADR-06`). Never `numeric`, `real` or `double precision`.
- Every table with a money column also has `currency_code text NOT NULL REFERENCES currency(code)`. **Source:**
  overview §3.1, "every monetary amount carries an explicit currency code"; `BI-01`, "a recorded currency minor-unit
  exponent". A child row repeats its parent's currency through a **composite foreign key**
  `(parent_id, currency_code)`, so a line can never disagree with its document. (`text` with a `CHECK`, never
  `char(n)`, whose blank-padding makes comparisons surprising.)
- `currency.minor_unit_exponent` records how many decimal places the currency has. It is never assumed to be 2
  (overview §3.1).
- A money column has a `CHECK (col >= 0)` unless its meaning is a signed effect, in which case the domain document says
  so. Refunds, voids and reversals are **new rows** (`P5`, `BI-08`), not negative edits.
- Rounding is half-up, once per document type, at the point the domain document names (overview §3.1, `BI-01`). The
  database stores rounded results and never rounds.

## 5. Quantity

- A quantity is `numeric(18,4)` in the product's **base unit** (`ADR-06`, overview §3.2). Countable goods use whole
  numbers; the scale for measurable goods is the unit's, recorded on the line.
- A quantity on an entry line is `CHECK (qty > 0)` or `>= 0` as the domain says. It is never signed (`BI-05`, overview
  §3.2): direction is a separate column, so a sign cannot be lost or flipped.
- Nothing in the application does arithmetic on a quantity as a float. `numeric` comes back to JavaScript as a string.

## 6. Text

- Codes, names and labels use the domain `nonblank_text`: no leading or trailing whitespace, never empty.
- Barcodes and other identifiers that look like numbers are **text** (`PR-12`): a leading zero is data.
- Uniqueness of a code is exact, case-sensitive equality. The specification does not ask for case folding.

## 7. Closed vocabularies

- A **small closed set owned by one table** (a state, a mode, a kind) is `text` with a named `CHECK … IN (…)`.
  **Source:** overview §3.7, "a closed, enumerated set per entity". Adding a value is a reviewed migration that
  replaces the constraint (`ADR-21`).
- A vocabulary that **several tables share or that organizations extend** (audit event types, permission keys, reason
  codes, storage-location types) is a **reference table** with a foreign key, so the set is data and the closure is a
  constraint.
- State names follow overview §3.7: a noun or past participle, never an imperative, never a negative.
- No PostgreSQL `ENUM` types: adding a value cannot be undone and cannot be used in the same transaction that adds it.

## 8. Scoping: organization and store

- A **store-scoped** table has `store_id uuid NOT NULL REFERENCES store(id)`. **Source:** `MS-01`, `BI-13`, `RT-001`,
  overview §3.9. No store-scoped column is nullable or absent.
- An **organization-global** table has `organization_id uuid NOT NULL REFERENCES organization(id)` and **no**
  `store_id`. Overview §3.9: `StoreId` is absent, not null, only for organization-global entities.
- A store-scoped table does not repeat `organization_id`, because the store determines it, **unless** it needs the
  column for a composite foreign key that proves a parent is in the same organization (for example a store price of
  an organization-global variant).
- A row that must belong to the **same** store or organization as another row uses a composite foreign key on
  `(id, store_id)` or `(id, organization_id)`, so a mismatch is impossible rather than checked.
- The scope predicate is applied in the repository layer before pagination, filtering, sorting and aggregation
  (`MS-02`, `MS-04`, `ADR-10`). There is no unscoped query function (`MS-05`). A test asserts that a cross-store read
  fails (`PHASE-2-ARCHITECTURE` §29.2). Row-level security is **not** used in v1; that is a separate decision.

## 9. Lifecycle, archival and deletion

- **No hard delete of anything that has history** (`BI-40`, overview §3.6, [retention-and-deletion.md](../domain/retention-and-deletion.md)).
  The runtime role is granted **no `DELETE`** on a table unless the domain document justifies it. Removal from
  operational use is a status or a `deactivated_at` fact, set by a permissioned, audited operation.
- **No `ON DELETE CASCADE`.** Every foreign key restricts (`AU-32`: no cascade or bulk delete reaches an audit event).
- An entity with a lifecycle state records **when it entered its current state and who caused it** (overview §3.7).
  Where the specification names no state machine for an entity, the schema records the *fact* (`deactivated_at`,
  `deactivated_by`) and does not invent a state vocabulary. Those cases are `OPEN SPECIFICATION`, in OPEN-QUESTIONS.md.
- A finalized document's header and lines are immutable (overview §3.11, `BI-08`). Counters on the parent line
  (`ReturnedQuantity`, `RefundableAmount`) are the one permitted mutation, updated in the same transaction as the
  compensating document.

## 10. Append-only, roles and privileges

Two roles (ADR-31 §6): `smartstore_owner` owns the schema and runs migrations; `smartstore_app` is the runtime role.

- **Grants are explicit, per table, in the migration that creates the table.** They are the visible statement of
  `ADR-11`. The default is `SELECT, INSERT, UPDATE`; see §9 for `DELETE`.
- An **append-only** table (movements, audit, immutable versions, finalized documents' lines) is granted
  **`SELECT, INSERT` only**. `UPDATE` and `DELETE` are never granted. This is enforced by the database, not by
  convention (`PHASE-2-ARCHITECTURE` §14.1, `BI-24`, `P5`). Each such table has a test that the app role's `UPDATE`
  and `DELETE` are refused.
- The runtime role is never a superuser, owns no object, and cannot create objects.

## 11. Actor columns

A column recording *who* (`created_by`, `deactivated_by`, `decided_by`) is `uuid` referencing `employee(id)`. The
`employee` table belongs to domain 7 (identity), which is designed after the tables that need it. Until then these
columns exist **without a foreign key**, and each is listed in the register below. Domain 7's migration adds every
constraint, and a test then asserts that no column named `*_by` lacks one.

| Table | Column | Added in |
|---|---|---|
| `organization` | `deactivated_by` | Domain 1 |
| `store` | `deactivated_by` | Domain 1 |
| `store_setting_version` | `created_by` | Domain 1 |
| `storage_location_attribution` | `created_by` | Domain 1 |
| `tax_rate` | `created_by` | Domain 2 |
| `category` | `archived_by` | Domain 2 |
| `product` | `status_changed_by` | Domain 2 |
| `product_variant` | `archived_by` | Domain 2 |
| `product_barcode` | `archived_by` | Domain 2 |
| `variant_price` | `created_by` | Domain 2 |
| `store_variant_price` | `created_by` | Domain 2 |
| `variant_standard_cost` | `created_by` | Domain 2 |
| `reason_code` | `archived_by` | Domain 3 |
| `stock_adjustment` | `created_by`, `submitted_by`, `approved_by`, `status_changed_by` | Domain 3 |
| `inventory_transaction` | `created_by` | Domain 3 |
| `pos_terminal` | `status_changed_by` | Domain 4 |
| `cash_shift` | `opened_by`, `closed_by`, `status_changed_by` | Domain 4 |
| `cash_transaction` | `created_by` | Domain 4 |
| `store_payment_method` | `changed_by` | Domain 4 |
| `checkout` | `created_by` | Domain 4 |
| `payment` | `created_by`, `status_changed_by` | Domain 4 |
| `sale` | `employee_id` (named for the spec's `EmployeeId`; domain 7's test must include it) | Domain 4 |
| `shift_count` | `counted_by`, `acknowledged_by` | Domain 4 |
| `customer_return` | `created_by`, `posted_by`, `late_approved_by`, `status_changed_by` | Domain 5 |
| `refund` | `created_by`, `submitted_by`, `approved_by`, `status_changed_by` | Domain 5 |

Creation of master data (organization, store, warehouse, location) is attributed by its audit event (domain 6), not
by a `created_by` column. An organization is necessarily created before any of its employees exists, so a
`created_by` there could not be a foreign key. The other master data follows the same pattern for consistency.
Onboarding order is therefore organization, then its first employee, then store and settings, so the first
`store_setting_version.created_by` has an employee to name.

> **Correction (2026-10-01, domain 6).** The paragraph above promised an attribution the audit vocabulary cannot give.
> The vocabulary is closed (`AU-11`, `AU-12c`) and has no type for creating an organization, store, warehouse or
> location, nor for configuration changes. In v1, master data's creation is therefore attributed by no event and by
> no column. Recorded as OQ-024; the owner can add types by the `AU-13` change.

`audit_event.actor_id` and `effective_actor_id` (domain 6) are the authenticated principal taken from the audit
context (§17), not `*_by` columns. Domain 7 decides whether they reference `employee`; a failed sign-in has no actor.

**Domain 7 (2026-10-01).** Every `*_by` column, and `sale.employee_id`, now references `employee (id)`. The migration
adds a key to every such column in the catalog, so a new one cannot be forgotten, and `schema-rules.test.ts` asserts
that none lacks one. A new table's `*_by` column adds its own key in its own migration. `audit_event.actor_id` does not
reference `employee`, deliberately ([D7](D7-EMPLOYEE-ROLE-PERMISSION.md) §5).

## 12. Guards that depend on tables designed later

Some rules are defined by the *existence of rows* that a later domain creates: `ORG-01`/`ORG-02` (the organization's
currency and time zone are immutable once a financial document exists), `SP-33`/`PR-38` (a store's tax mode is
immutable once a sale exists), `ORG-05` (a store is not deactivated while it holds stock or has an open shift).

**The guard is created by the migration that creates the first table whose rows can trigger it, and that domain's
tests prove it.** No placeholder guard is created early: a guard that cannot fire cannot be tested, and an untested
guard would read as enforcement (`P10`). Until the guarded tables exist, the rule cannot be violated, because the
rows that would violate it cannot exist.

Each domain document lists the guards it leaves pending, and the domain that closes one says so. The register:

| Rule | Guard | Created by |
|---|---|---|
| `ORG-01`, `RT-504` | Organization currency unchangeable once a financial document exists | The first migration creating a financial-document table |
| `ORG-02`, `RT-505` | Organization time zone unchangeable once a financial document exists | Same |
| `SP-33`, `PR-38`, `RT-046` | No settings version may change a store's tax mode once the store has a sale | Domain 4 |
| `ORG-05`, `RT-445`, `RT-508`, `EC-39` | A store is not deactivated while it holds stock | Domain 3 |
| `ORG-05`, `RT-445`, `EC-89` | A store is not deactivated while it has an open shift | Domain 4 |
| `WH-01`, `RT-004`, `MS-18` | Stock is sold only from a sellable location | Domains 3 and 4 |
| `WH-02` | A central-warehouse location never goes negative | Domain 3 |
| `MS-16`, `MS-19`, `D-03` | A movement's store is the location's warehouse store, or a store attributed to the central location | Domain 3 |
| `SP-55`, `BI-41` | A sale with a posted return cannot be voided | The migration that builds voids (OQ-017); until then no sale can be voided (`SS044`) |
| `AU-05`, `BI-33` | A document's `*_by` columns equal the authenticated principal of the change (the audit context's actor) | Domain 7, with the employee table. **Superseded 2026-10-01 (domain 7):** assigned to the one authorization gate (architecture §8.2, Step 3), which sets the audit context and the document's actor from the same session. The database keeps the actors' existence (keys to `employee`). |
| `AU-09`, `RT-295` | Personal fields are redacted in an audit event's `before` and `after` at write time | Domain 7, which brings the first personal data (the employee). **Done** (`audit_redacted_field`, `audit_redact()`). |

## 13. Citations

Every table, constraint (other than a primary key), index not backing a constraint, function, trigger and domain
carries a `COMMENT` in this form, where each ID appears in `/docs`:

```sql
COMMENT ON TABLE store IS 'Cites: RT-001, MS-01. One sentence saying what it is for.';
```

`server/test/citations.test.ts` fails the build if one is missing, malformed, or cites an ID that does not appear in
`/docs`. It cannot judge whether the citation is *right*; review does. Where a citation in
`requirements-traceability.md` looks wrong, cite the rule and record the discrepancy; never edit the traceability
matrix without running `measure-c06.ps1` (CLAUDE.md).

## 14. Migrations

- **Forward-only.** No migration undoes another. A mistake is corrected by a new migration. Each file ends with a
  `-- migrate:down` section that raises an error, so an accidental `dbmate rollback` fails loudly instead of quietly
  unrecording a migration. **Source:** Constitution §14, CLAUDE.md "never delete data or history",
  `PHASE-2-ARCHITECTURE` §27.2.
- A development or test database may be dropped and rebuilt from the migrations. That is not a migration and is never
  done to a database holding real data.
- `dbmate migrate --strict` fails an out-of-order migration. `db/schema.sql` is regenerated by dbmate and committed;
  it is a generated view of the schema for review and is never edited by hand. dbmate dumps without owners and
  **without privileges**, so `schema.sql` shows every table, constraint and `COMMENT` but not the `GRANT`s. Read those
  in the migrations.
- No extension is required. If one is ever needed it is recorded in ADR-31 first.
- Nothing in a migration hardcodes an answer to an open decision (`PHASE-2-ARCHITECTURE` §30.5 rule 4). Rates,
  thresholds and policies are rows, not constants.

## 15. Error codes raised by the schema

A guard raises a SQLSTATE the application can map to a specific message (`UX-55`, `UX-56`); tests assert codes, never
message text. Standard codes are used where PostgreSQL raises them itself: `23502` not null, `23503` foreign key,
`23505` unique, `23514` check, `42501` insufficient privilege. SmartStore's own codes use class `SS`, which the SQL
standard leaves to implementations and PostgreSQL does not use:

| Code | Meaning | Raised by |
|---|---|---|
| `SS001` | A recorded fact (who and when) cannot be rewritten | `record_deactivation()`, `record_archival()`, `record_revocation()`, `record_session_end()`, `customer_return_before_write()`, `refund_before_write()` |
| `SS002` | A warehouse must have its Default storage location | `assert_warehouse_has_default_location()` |
| `SS003` | A document-number counter cannot move backwards | `forbid_document_number_decrease()` |
| `SS004` | Not a legal state for creation, or not an edge of the machine | `enforce_state_transition()` |
| `SS005` | A product cannot be activated without an active variant | `product_before_status_change()` |
| `SS006` | A category cannot be moved under itself or its own descendant | `prevent_category_cycle()` |
| `SS007` | A variant with live barcodes must have exactly one primary | `assert_variant_has_primary_barcode()` |
| `SS008` | An active variant of a released product needs a price in force | `product_before_status_change()`, `assert_new_variant_usable()` |
| `SS009` | Nothing new may reference an archived product | `assert_new_variant_usable()` |
| `SS010` | An append-only ledger refuses UPDATE, DELETE and TRUNCATE, for every role (movements, cash, audit events, the audit chain) | `forbid_ledger_rewrite()` |
| `SS011` | Not enough stock under `BlockNegative` (the message names what is available) | `apply_inventory_movement()` |
| `SS012` | A service variant cannot be stocked | `apply_inventory_movement()` |
| `SS013` | A quantity has more decimals than its unit allows | `apply_inventory_movement()` |
| `SS014` | The movement's store may not move stock at that location | `apply_inventory_movement()` |
| `SS015` | A reversal must mirror the movement it reverses | `apply_inventory_movement()` |
| `SS016` | The causing document is not in a state that moves stock that way | `assert_movement_adjustment_state()`, `assert_movement_sale_state()`, `assert_movement_return_state()` |
| `SS017` | The store has no settings in force | `apply_inventory_movement()` |
| `SS018` | Document lines change only while the document is a draft (adjustment, return, refund) | `stock_adjustment_line_draft_only()`, `customer_return_line_rules()`, `refund_line_rules()` |
| `SS019` | A store holding stock cannot be deactivated | `forbid_store_deactivation_with_stock()` |
| `SS020` | A deactivated store moves no stock | `apply_inventory_movement()` |
| `SS021` | A used unit's quantity kind cannot change | `freeze_used_quantity_kind()` |
| `SS022` | Posting or reversal did not write exactly its movements | `assert_adjustment_posting_complete()`, `assert_return_posting_complete()` |
| `SS023` | A Transit location is reached only by transfer movements | `apply_inventory_movement()` |
| `SS024` | An archived reason code takes no new documents | `stock_adjustment_before_write()`, `assert_reason_code_live()` (also for an audit context's reason) |
| `SS025` | The till is not in service, or is in training, for a real sale or a cash refund | `checkout_before_write()`, `sale_before_insert()`, `cash_shift_before_write()`, `refund_before_write()` |
| `SS026` | The shift is not open | `checkout_before_write()`, `sale_before_insert()`, `refund_before_write()` |
| `SS027` | The checkout is not open | `payment_before_write()`, `sale_before_insert()` |
| `SS028` | The variant is not sellable (product status or archived variant) | `sale_line_before_insert()` |
| `SS029` | The variant is unclassified for tax, or not taxed at the rate in force | `sale_line_before_insert()` |
| `SS030` | The line price is not the price in force when the server quoted it | `sale_line_before_insert()` |
| `SS031` | The line cost is not the standard cost in force | `sale_line_before_insert()` |
| `SS032` | The location is not a sellable location of the store | `sale_line_before_insert()`, `assert_terminal_sells_from_own_location()` |
| `SS033` | The scanned barcode does not identify the variant | `sale_line_before_insert()` |
| `SS034` | The sale is not whole at commit (lines, totals, tenders, change or stock) | `assert_sale_complete()` |
| `SS035` | A payment or refund in a terminal state is never changed | `payment_before_write()`, `refund_before_write()` |
| `SS036` | Written only in the sale's completion transaction | `sale_line_before_insert()`, `assert_movement_sale_state()` |
| `SS037` | The organization's currency and time zone are fixed once a financial document exists | `freeze_organization_money_settings()` |
| `SS038` | Tax mode or settings snapshot conflict (fixed once sold; not the version in force; a scheduled change) | `sale_before_insert()`, `freeze_tax_mode_after_sale()` |
| `SS039` | A store with an open shift cannot be deactivated | `forbid_store_deactivation_with_open_shift()` |
| `SS040` | A sold variant's name is fixed | `freeze_referenced_variant_name()` |
| `SS041` | A discontinued product sells only from stock on hand | `assert_movement_sale_state()` |
| `SS042` | Shift opening float, counting or close precondition not met | `assert_shift_opening_float()`, `shift_count_before_write()`, `assert_shift_close_ready()` |
| `SS043` | A checkout closes once, and completes only with its sale | `checkout_before_write()`, `assert_checkout_outcome()` |
| `SS044` | Voiding a sale is not built in v1 (OQ-017) | `assert_movement_sale_state()` |
| `SS045` | The payment method is not enabled at the store | `payment_before_write()` |
| `SS046` | More than is still returnable on the sold line (`DETAIL`: the remainder) | `customer_return_line_rules()`, `apply_return_posting()` |
| `SS047` | The return's disposition does not go to that kind of location | `customer_return_line_rules()` |
| `SS048` | The return window has closed and there is no late approval (`DETAIL`: the closing date) | `customer_return_before_write()` |
| `SS049` | More than is still refundable on the sold line (`DETAIL`: the remainder) | `apply_refund_hold()` |
| `SS050` | The original tender is not a captured payment of the refund's sale | `refund_before_write()` |
| `SS051` | A refund for a return names a line that the posted return did not take back | `apply_refund_hold()` |
| `SS052` | The refund's tax is not the line's stored tax in proportion to the amount refunded | `apply_refund_hold()` |
| `SS053` | The refund is not whole at commit (its lines; the drawer payout and the completion) | `assert_refund_whole()`, `assert_refund_payout_completes()` |
| `SS054` | An audited change, or an application event, lacks the authenticated actor, source or correlation id | `write_audit_event()`, `record_audit_event()` |
| `SS055` | A transition whose contract needs a reason has none from its document or the audit context | `write_audit_event()` |
| `SS056` | The application tried to record an event type the database writes itself | `record_audit_event()` |
| `SS057` | An employee with a till shift that is not closed cannot be terminated | `forbid_termination_with_open_shift()` |

Where a refusal names a quantity, an amount or a date, the value is in the error's `DETAIL` field, so the application
can show it without parsing the message.

## 16. What every domain delivers

1. `docs/database/D<N>-<domain>.md`: tables, columns, constraints, each cited to `RT-xxx` rows and rule IDs; the
   decisions taken; the open questions; what is deferred; and which tests prove which claim.
2. The migration(s), forward-only, with grants and `COMMENT`s.
3. Tests that run against the migrated schema: every constraint that enforces a rule is shown to reject the violation
   and to accept the legitimate case, and every append-only table is shown to refuse `UPDATE` and `DELETE` to the
   runtime role. A test that could pass with the constraint removed is not a test of it.
4. An update to BUILD-STATUS.md, including anything that failed.

## 17. The audit context

Every audited change runs with the authenticated request context set for its transaction (`AU-05`, `AU-10`,
[D6](D6-AUDIT.md) §4):

```sql
SELECT set_config('smartstore.actor_id', $1, true),
       set_config('smartstore.source', $2, true),          -- UI, API, Job, Device, OfflineSync or Terminal
       set_config('smartstore.correlation_id', $3, true);
```

The optional settings are `effective_actor_id` (impersonation), `role`, `terminal_id`, `client_operation_id`,
`ip_address`, and `reason_code_id`, for a transition that needs a reason its document cannot carry. The repository
layer sets them from the signed-in session, never from a request body. It sets them with the third argument `true`,
so they end with the transaction. Without the three required settings, an audited change is refused (`SS054`). A
new table whose changes the specification audits gets its trigger in its own migration. A new machine's edges carry
their §22 Audit type and reason flag in `state_machine_edge`.
