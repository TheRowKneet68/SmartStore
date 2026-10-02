# Domain 2 — Product / Barcode / Unit

**Phase 3 — database design.** Migration: `db/migrations/20260930140000_d2_product_barcode_unit.sql`.
Conventions: [CONVENTIONS.md](CONVENTIONS.md). Previous: [D1](D1-ORGANIZATION-STORE-WAREHOUSE.md).

| State (Constitution §5) | What |
|---|---|
| **DESIGNED** | Everything in this document |
| **IMPLEMENTED** | The migration: tables, constraints, triggers, grants, the Product machine as data |
| **TESTED** | `server/test/d2-product.test.ts` (48 tests), plus the schema-wide suites; 105 passing, 10 consecutive clean runs |
| **Not yet** | No application code. The barcode normalizer the till uses is Step 3; the database already refuses non-canonical values |

Sources: [product-domain.md](../product/product-domain.md) (`PR-01`..`PR-48`), [state-machines.md](../product/state-machines.md)
§1 and §22.1 (`SM-02`..`SM-13a`), [edge-cases.md](../product/edge-cases.md) (`EC-33`, `EC-37`, `EC-41`, `EC-42`),
requirements `RT-021`..`RT-047`, `RT-443`, `RT-444`, `RT-488`..`RT-495`, organization-model §8.

---

## 1. Scope

**Built:** the state-machine tables (used first by Product), unit, tax category and rate, category, brand,
product, variant, barcode, organization default price, store price, and standard cost. That is what a till needs to
scan, price, tax and sell a variant.

**Designed for, not built in v1.** Each is additive. None changes a table below. All are recorded in BUILD-STATUS:

| Deferred | Rules | Why |
|---|---|---|
| Variant option matrix (Size × Colour) | `PR-03`, `RT-030` | v1 variants carry a descriptive `name`; option tables attach to variants later |
| Unit conversions, packaging sales | `PR-16`..`PR-23`, `RT-034`..`RT-037` | Purchasing and pack sales are outside the v1 slice; v1 sells in base units |
| Weighed goods | `PR-13`, `PR-24`..`PR-28`, `RT-038`, `RT-039` | Needs scales (devices are deferred) and weight-embedded barcode parsing |
| Discounts, coupons | `PR-42`..`PR-45`, `RT-049`..`RT-052`, `RT-494` | Not in the v1 slice; any line-level price adjustment is decided with domain 4 |
| Customer-group prices | `PR-30` tier 1 | Customers are outside the v1 slice |
| Supplier products, imports, attributes, images | `PR-07`, `PR-49`..`PR-55` | Procurement and bulk import are outside the v1 slice |
| Approval-gated price changes | `PR-32` (backdated), `PR-33` (below cost), `RT-043` | There is no approval workflow in v1, so these are **refused**, the fallback §8.4 of the architecture prescribes |

## 2. Lifecycle machines as data

`state_machine_state (machine, state, is_initial)` and `state_machine_edge (machine, from_state, to_state, event)`
hold every machine's graph. One trigger function, `enforce_state_transition(machine, column)`, refuses a creation
state that is not initial and a change of state that is not an edge (`SS004`), so a table's lifecycle is enforced by
declaring it:

```sql
CREATE TRIGGER … BEFORE INSERT OR UPDATE OF status ON product
  FOR EACH ROW EXECUTE FUNCTION enforce_state_transition('Product', 'status');
```

- A state with no outgoing edge is terminal (`SM-05`). The graph is asserted in tests (the `PY-12` approach, which
  `SM-05` applies to every machine).
- Repeating the current state is a no-op, never an edge (`SM-04`; a `CHECK` forbids self-loops).
- The application can read the machines but never change them (`SM-07`, `ADR-21`).
- Later domains add their machines (Sale, Payment, Return, Refund, Shift) as rows. Their permission keys and audit
  types, the rest of the `ADR-19` "single authorization table", become columns when domains 6 and 7 create those
  vocabularies.

**The Product machine** is the §22.1 contract table verbatim: `Draft→Active` (activate), `Active→Discontinued`,
`Discontinued→Active`, `Active→Hidden`, `Hidden→Active`, and `Draft|Active|Discontinued|Hidden→Archived`.

- Not edges: `Active→Draft`, whose reversal is `OPEN DECISION` in §22.1; `Draft→Hidden`, which §1's diagram draws but
  which has no contract row (**OQ-009**); and anything out of `Archived` (`PR-47`, `SM-13`).
- `OutOfStock` is never stored. It is "Active, nothing in stock", a derived condition (`SM-13a`, `BI-02`). A `CHECK`
  refuses it even if the trigger were bypassed, and a test proves that with the trigger disabled.

## 3. Tables

### `unit` — organization-global (`PR-14`, `PR-15`)

`code` (unique per organization), `name`, `plural_name`, `quantity_kind` `Countable` | `Measurable` | `Service`,
`scale` 0..4 (`ADR-06`: quantities are `numeric(18,4)`). A countable unit has scale 0 (overview §3.2). `quantity_kind`
stays updatable until the unit is used in a movement or document; that guard arrives with those tables (`RT-491`).
"`Service` cannot be stocked" is enforced by domain 3.

### `tax_category`, `tax_rate` (`PR-37`, `PR-40`, `BI-18`)

- A category is organization-global. **None is seeded**: categories and rates are jurisdictional facts (`D-12`,
  `GAP-044`). Test data is labelled TEST-ONLY.
- A rate is append-only and effective-dated. A change is a new version, never an edit (`RT-047`), so a sale line can
  reference the version it applied and it can never change. Prospective only (a design choice; §6).
- The rate in force for a category is the latest version whose `effective_from` has passed. The jurisdiction is a
  label: how a store selects among jurisdictions, and whether rates compound, is **OQ-012**.
- `rate_percent numeric(9,4) >= 0`. Zero is how exemption is expressed (`PR-40`).
- `product_variant.tax_category_id` is nullable: null is the *unclassified* state, which a document line must refuse
  (`RT-493`, domain 4). It never means exempt.

### `category` — a single-parent tree (`PR-04`..`PR-06`, `RT-026`, `RT-027`, `RT-488`)

- `parent_id` references a category of the same organization (composite FK). `sort_order` is explicit and required
  (`RT-488`).
- **No cycles** (`RT-026`, `EC-42`). A move walks the new parent's ancestors and refuses if it meets the category
  itself (`SS006`). Two concurrent moves could each pass alone and together form a cycle, so moves are serialized per
  organization's tree by a transaction-scoped advisory lock. A test runs two such moves concurrently: one succeeds and
  the other is refused. A `CHECK` also refuses a category created as its own parent.
- Archived once, with server time, never deleted (`PR-05`, `RT-027`).

### `brand` — optional (product-domain §3)

Unique by name within the organization, case-insensitive (`lower(name)` unique index). A product with no brand has a
null brand, never a placeholder.

### `product` — the SPU (`RT-021`, `PR-01`, `PR-02`)

`category_id` required (`PR-04`), optional `brand_id`, `name`, `description`, `status` with `status_changed_at`
(server time) and `status_changed_by` (overview §3.7).

- Every product is created `Draft`: `status` is not insertable (`PR-02`).
- **Activation (`Draft→Active`) is the completeness check** (`SM-12`). It needs at least one live variant (`PR-02`,
  `SS005`), and every live variant must have an organization default price in force (`RT-042`, `SS008`).
- Never deleted (`RT-444`, `EC-37`).

### `product_variant` — the SKU (`RT-021`, `RT-022`)

`product_id`, `name` (descriptive, standing in for the deferred option matrix), `base_unit_id`, `tax_category_id`,
and archival.

- `product_id` and `base_unit_id` are immutable. A new base unit would reinterpret every stored quantity (`PR-15`).
- A variant added to a released product (not `Draft`) must have a price in force by commit (`RT-042`, deferred check,
  `SS008`). A variant of an `Archived` product is refused (`SS009`: "nothing new may reference it", §22.1). The check
  takes `FOR SHARE` on the product row, so a variant added while the product is being activated cannot slip in
  unpriced.
- **Archival** (`PR-48`, `RT-495`, `EC-33`, `RT-443`): written once with server time. It blocks new use and never
  touches stock, and it never archives the product. `EC-33`/`RT-443` call this "deactivation" and `PR-48`/`RT-495`
  call it "archival". No variant machine exists, so one fact serves both, with no reactivation (**OQ-010**).
- `name` stays editable until a document references the variant (`PR-03`'s intent; the guard arrives with the first
  document table).

### `product_barcode` (`PR-08`..`PR-12`, `RT-023`..`RT-025`, `RT-490`, `EC-41`)

`value` (text, never a number), `kind` (the ten symbologies of §5.1), `is_primary`, archival, and a generated
`lookup_key`.

- **Canonical storage** (`PR-12`, `RT-490`): no whitespace, leading zeros kept, and the GS1 check digit validated for
  `EAN13`, `EAN8`, `UPC_A`, `ITF14`, and `UPC_E` (via its UPC-A expansion). An `Internal` code can never look like a
  retail GTIN. `Code128`/`GS1-128` are printable ASCII.
- **The scan path.** `lookup_key = barcode_lookup_key(value)` left-pads an all-digit code of GTIN length (8, 12, 13,
  14) to 14 digits and leaves anything else unchanged. It pads, never trims. A scan is looked up with the same
  function:

  ```sql
  SELECT variant_id FROM product_barcode
  WHERE organization_id = $1 AND lookup_key = barcode_lookup_key($2) AND archived_at IS NULL;
  ```

  That is an exact match on `uq_product_barcode_active_key (organization_id, lookup_key) WHERE archived_at IS NULL`:
  one index probe, and at most one row.
- **Organization-wide uniqueness** (`PR-08`, `RT-024`, `EC-41`) is that same unique index, enforced as a constraint,
  never a check-then-act. Because it is on the key, a UPC-A `012345678905` and the same code read as EAN-13
  `0012345678905` are one barcode: registering both on different variants is refused, and scanning either finds the
  one variant. A scanner configured for 12 or 13 digits therefore cannot split one product in two, and a trimmed
  leading zero (`12345678905`) finds nothing rather than something wrong.
- **Never reassigned** (`PR-09`, `RT-025`): `value`, `kind` and `variant_id` are immutable. To move a code, archive it
  (it leaves the unique index) and issue a new barcode. The value can then be reissued (`PR-10`). The "only if no
  un-archived document references it" half of `PR-10` arrives with the first document table.
- One live primary per variant (`PR-08`): at most one by a partial unique index, at least one (when any live barcode
  exists) by a deferred check (`SS007`). An archived barcode is never primary.
- Not built: a lookup of archived codes for historical scans (`PR-09`), which no v1 flow needs; the full-key index is
  additive. A UPC-E code and its UPC-A expansion are separate registrations, because a scanner that expands UPC-E
  sends 12 digits.

### `variant_price`, `store_variant_price`, `variant_standard_cost` — append-only, effective-dated

| Table | Scope | Rule |
|---|---|---|
| `variant_price` | Organization default, the last tier of `PR-30` | `amount > 0` (`RT-042`: zero or negative is refused; a free item is a 100% discount line, `PR-34`) |
| `store_variant_price` | Store (organization-model §8.2) | Same, and in the **store's own currency** (composite FK to `store (id, currency_code)`) |
| `variant_standard_cost` | Organization | `amount >= 0`. Standard cost for margin and the below-cost check, not the batch's actual cost (`PR-35`) |

- **Prospective** (`PR-32`, `RT-041`): `effective_from >= created_at`, and `created_at` is always server time. A
  backdated price needs approval, which v1 does not build, so it is refused.
- **Resolution** (`PR-30`, `RT-040`): the store price in force if one exists, else the organization default in force.
  Customer-group prices, tier 1, are deferred. Each lookup is a backward scan of the table's unique
  `(…, effective_from)` index. Domain 4 resolves prices server-side and snapshots the applied price onto the line
  (`BI-30`, `ADR-08`).
- **"Always present on an active variant"** (`RT-042`) is read as: the variant's own price, the organization
  default, is present. Store prices are overrides. This reading is stated so it can be corrected.
- Not built: removing a store price override. It can be changed but not dropped, because the table is append-only
  and no "no store price" marker is specified.

## 4. Runtime role grants

| Table | `UPDATE` columns | Notes |
|---|---|---|
| `state_machine_state`, `state_machine_edge` | — | `SELECT` only |
| `unit` | `code`, `name`, `plural_name`, `quantity_kind`, `scale` | |
| `tax_category` | `code`, `name` | |
| `tax_rate`, `variant_price`, `store_variant_price`, `variant_standard_cost` | — | Append-only |
| `category` | `parent_id`, `name`, `sort_order`, `archived_by` | |
| `brand` | `name` | |
| `product` | `category_id`, `brand_id`, `name`, `description`, `status`, `status_changed_by` | `status` not insertable |
| `product_variant` | `name`, `tax_category_id`, `archived_by` | |
| `product_barcode` | `is_primary`, `archived_by` | |

No `DELETE` anywhere. `created_at`, `archived_at` and `status_changed_at` are always server time.

## 5. Open questions raised

**OQ-009** (`Draft→Hidden`), **OQ-010** (variant lifecycle), **OQ-011** (the `RT-028` barcode clause against `PR-11`),
**OQ-012** (tax jurisdiction). All are in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md) with their fallbacks.

## 6. Choices the specification does not dictate

The 14-digit lookup key (from GS1, not `/docs`: GTIN-8, -12, -13 and -14 share one number space when right-aligned);
prospective-only tax rates and standard costs (only prices are stated prospective, by `PR-32`); unit and tax-category
code uniqueness per organization; the organization default being the price `RT-042` requires. Each is reversible by a
migration.

## 7. Tests — what proves what

| Rule | Proven by (`d2-product.test.ts`) |
|---|---|
| `SM-05`, `SM-07`, `SM-13`, `PR-47` | Graph assertions: Archived has no outgoing edge; every state reachable from Draft; the application cannot add a state or edge |
| `SM-02`, `SM-04`, `SM-13a` | Every §22.1 edge allowed; `Active→Draft`, `Draft→Hidden`, `Draft→Discontinued`, and every exit from Archived refused (`SS004`); same-state is a no-op; `OutOfStock` refused by the trigger and, with the trigger disabled, by the `CHECK` |
| `PR-02`, `SM-12`, `RT-042` | No live variant (`SS005`); an archived variant does not count; an unpriced or only-future-priced variant (`SS008`); a priced one activates |
| `RT-042` | A variant added to a released product needs a price by commit; `SS009` for an archived product |
| `RT-022`, `RT-495`, `RT-443`, `PR-15` | Three variants; archiving one leaves the product and siblings; archival once; no delete; product and base unit immutable; cross-organization unit and tax category refused |
| `PR-12`, `RT-490` | Valid and invalid check digits for EAN-13, EAN-8, UPC-A, UPC-E, ITF-14; a leading zero round-trips; whitespace refused; Internal cannot look like a GTIN |
| `PR-08`, `RT-024`, `EC-41` | Duplicate refused organization-wide, allowed across organizations; UPC-A and EAN-13 forms are one barcode; three spellings of one code scan to the one variant; a trimmed zero finds nothing |
| `PR-09`, `PR-10`, `RT-025` | Barcode cannot be re-pointed or re-valued; archive then reissue; the scan follows the new variant |
| `PR-04`..`PR-06`, `RT-026`, `RT-027`, `RT-488`, `EC-42` | Move allowed; under itself (`SS006`, and `23514` on create); under a descendant (`SS006`); **two concurrent moves forming a cycle, one refused**; cross-organization parent; sort order required; archival once; no delete |
| `PR-30`, `PR-32`, `PR-34`, `RT-040`..`RT-042` | Zero and negative refused; backdated refused; the store price wins once in force, the default before; store price in the store's currency and organization; prices are append-only |
| `PR-35`, `PR-37`, `PR-40`, `RT-047`, `RT-493` | Cost ≥ 0 and prospective; rate ≥ 0 with zero allowed; rate append-only, new versions effective-dated; rate category in the same organization |

**Mutation check (2026-09-30).** Dropping the category cycle trigger, skipping the no-active-variant check, removing
the lookup-key padding, and dropping the organization-wide barcode unique index each turned the corresponding test
red. The harness confirmed each mutated migration applied before reading the result.

**Two flaky tests found and fixed** (they appeared in about 3 of 17 runs):
1. Two tests asked "what is in force now?" using the test process's clock, while `effective_from` was stamped by the
   database. Whenever the JavaScript clock read a fraction of a millisecond behind, nothing was in force yet. The tests
   now use the database's `now()`. This is the class of bug `RT-353` forbids in production code.
2. A privilege test called `has_column_privilege(…, 'created_at', …)` with a literal column name. SQL does not fix the
   order WHERE conditions are evaluated in, so the call sometimes ran for `schema_migrations`, which has no such
   column. It now passes each row's own `column_name`.

Ten consecutive full runs are clean since the fixes.

## 8. Guards pending in later domains

| Rule | Guard | Domain |
|---|---|---|
| `PR-14`, `RT-491` | A unit's `quantity_kind` is frozen once used in a movement or document | 3 |
| `PR-03` | A variant's descriptive name is frozen once a document references it | 4 |
| `PR-10` | An archived value is reissued only if no un-archived document references it | 4 |
| `RT-493` | A document line refuses a variant with no tax category | 4 |
| `RT-031`, `SM-11` | Discontinued is sellable from stock, not orderable; Draft, Hidden and Archived are not sellable | 3, 4 |
| `RT-489` | A scanner sale needs a live barcode; a search-only selection is recorded as explicit | 4 |
| "Service cannot be stocked" | Refuse stock movements for a variant whose base unit is `Service` | 3 |

## 9. Application layer (Step 3, 2026-10-01)

| State | What |
|---|---|
| **IMPLEMENTED** | The catalogue routes, the Product machine on the transition endpoint, the below-cost refusal, and the till's scan |
| **TESTED** | `server/src/modules/catalog/catalog.test.ts`: 20 tests, building items through the routes and scanning them |
| **Not built** | Renaming units, tax categories and brands, and reading a store's price list or cost history: no v1 screen needs them yet |

**The scan** (`GET /api/v1/stores/:storeId/scan/:code`) is one statement:
- the exact match on the live barcode's lookup key, so any GTIN spelling finds the one variant;
- the variant, product, unit and currency;
- the price in force: the store's own, else the organization default (`PR-30`);
- the server's quote time, which the sale carries so its price is checked again at save (`RT-124`).

It reads no stock and takes no lock (`UX-25`; ADR-31 §8). The code is trimmed of a scanner's trailing whitespace.

The scan refuses with a distinct answer each:
- an unknown code (`unknown_barcode`, 404, `UX-11`);
- an unreleased product (`not_for_sale`: only Active and Discontinued sell, `SM-11`);
- a variant with no tax category (`unclassified`, `RT-493`);
- a missing price (`no_price`).

**The below-cost rule (`PR-33`) is enforced here, not in the schema.** A price, default or store, below the
standard cost in force is refused (`below_cost`). The rule allows it only with `Price.BelowCost.Approve` by another
employee, and v1 builds no approvals (architecture §8.4's fallback, as §1 records).

**Routes and their permissions.** Catalogue keys are organization-wide (OQ-025 item 6).

| Routes | Permission |
|---|---|
| Read units, categories, brands, products | `Product.View` |
| Create units, categories, brands, products, variants (with their first barcodes) | `Product.Create` |
| Change a product, category or variant; archive a category or variant; add, promote or archive a barcode | `Product.Edit` |
| Product transitions | The edge's own key (§22.1): `Product.Edit`, or `Product.Archive` for archiving |
| Read tax categories with their rates in force | `Tax.View` |
| Add a tax category or rate version | `Tax.Edit` |
| Read or add default price versions | `Price.View` / `Price.Edit` |
| Add a store price | `Price.Edit` in that store |
| A variant created with its first price | `Product.Create` and `Price.Edit` |
| Add a standard cost | `Product.Edit` and `Product.Cost.View` |
| Scan at the till | `Sale.Create` in the store |

**Decisions, stated so they can be reversed:**

- **Creating a product is `Product.Create`.** §22.1 has no creation row, and the catalogue's description is
  "create and amend catalog entries".
- **Archiving a variant is `Product.Edit`.** `Product.Archive` is the product's own archive edge, and a variant has
  no machine (OQ-010).
- **Setting a cost needs `Product.Cost.View` too.** Cost is visible only with that key (`PR-36`), so setting a value
  you cannot see is refused.
- **Scanning is `Sale.Create`**, because a scan is how a sale is rung up (`UX-09`). A price check without selling
  is not built.
- **A repeat archive changes nothing**, for a category or a variant (`SM-04`).
- **A name search is a case-blind "contains" match.** Its wildcards are escaped, and it never mixes with barcodes
  (`UX-48`). Trigram search would need an extension, which ADR-31 §6 says is recorded there first.

**Mutation check (2026-10-01).** 26 mutations, all detected:
- reference data (5);
- products, variants, barcodes, prices and costs (13);
- the scan (9).

Planning found nine guards no test reached, and a test was added for each:
- four cross-organization writes and reads, any of which would have let one organization reach into another's
  catalogue;
- a new primary taking over;
- an archived variant;
- future prices;
- Discontinued still selling.

One more survived the first run: a variant's first barcode added on its own. It now has a test too.

## 10. Phase D: editing reference data (2026-10-01)

| Route | Permission | Changes |
|---|---|---|
| `PATCH /units/:id` | `Product.Edit` | `code`, `name`, `pluralName`, `quantityKind`, `scale` |
| `PATCH /tax-categories/:id` | `Tax.Edit` | `code`, `name` |
| `PATCH /brands/:id` | `Product.Edit` | `name` |

- Each writes only the fields sent, which are the columns §4 lets the runtime role update. A request that changes
  nothing is refused by name. Another organization's row is not found (architecture §24.3).
- **The database keeps each rule an edit could break:**
  - a used unit's kind (`RT-491`, `SS021`, now with a message of its own);
  - a countable unit's decimal places (`PR-15`);
  - the uniqueness of codes, and of brand names whatever the case.
- **A tax rate is never edited.** A rate is not a field of its category. A change of rate is a new version
  (`RT-047`), through the existing `POST /tax-categories/:id/rates`.
- **Not built: archiving a brand, a unit or a tax category.** `/docs` gives none of them an archive, and the schema
  has no column for one (OQ-031).
- The web screen is `web/src/back/Reference.tsx`. It sends only what changed, and says a countable unit's decimal
  places, a malformed rate and an unchanged form before the server does.

**Decision, stated so it can be reversed:** units and brands are changed with `Product.Edit`, as categories are.
The catalogue's `Product.*` keys cover "catalog entries", and no key names reference data.

**Mutation check:** 11 mutations, all detected, including D7 §10's two:
- writing only the fields sent;
- refusing a change of nothing;
- the organization's row only, and not found otherwise;
- the plural name's own column;
- each route's key, against someone holding every other manager key;
- `SS021`'s message.

## 11. Phase D: price history (2026-10-01)

`GET /variants/:id/prices` (`Price.View`) now also answers who set each version (`setByName`), and the currency's
decimal places (`minorUnitExponent`). The web's price history uses both.

- **The web screen** is "Prices" (`web/src/back/Prices.tsx`), shown with `Product.View` and `Price.View` held
  organization-wide.
  - It finds a product by name, a page at a time.
  - It shows each live variant's versions newest first: scheduled, in force, or replaced (`PR-32`, `RT-041`).
  - With `Price.Edit`, a new price is set from now or a later time. The server's refusals (zero, the past, below
    cost: `PR-33`) are shown in its words.
- **Not shown:** a store's own prices, `PR-30`'s store tier. No route reads them yet.
- **Limit:** the read answers the 50 newest versions. Paging it belongs to Phase D's "consistent paging on every
  list".
- **Mutation check:** the setter's join, 1 of 1 detected; it fails if the reader is named instead.
  - The decimal places come from the currency row. The test fixtures have one currency, with two places, so a
    mutant fixing the value at 2 would survive. No check of it is claimed.
