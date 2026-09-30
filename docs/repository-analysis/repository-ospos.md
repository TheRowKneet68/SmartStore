# Repository Audit — OSPOS (opensourcepos)

| | |
|---|---|
| **Repository** | [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) |
| **Local clone** | `research/ospos` (shallow, depth 100) |
| **Version audited** | **3.4.3** (`package.json`) — LICENSE: Copyright (C) 2020-2025 Adnan Khurram, Cyber Area |
| **Stack** | PHP ≥7.3 / CodeIgniter 4.3.x / MySQL / Bootstrap 4 / jQuery / Bootstrap Table |
| **License** | **Standard MIT** + an appended branding clause (LEGAL REVIEW REQUIRED — narrow) |
| **Verdict** | **REFERENCE ONLY** — strongest technical reference; not a viable foundation as-is |

---

## 1. License

**Declared:** `package.json:5` and `composer.json:4` → `"license": "MIT"`.

> **CORRECTED — this section was wrong in the first draft.** It previously claimed that OSPOS has **no `LICENSE`
> file**, that the clause lives in `app/Config/Constants.php` "where scanners cannot see it", and that the
> copyright grant itself is narrowed to "that associated documentation files" (singular). Direct inspection of
> `research/ospos/LICENSE` refutes all three. See [license-matrix.md](license-matrix.md) and
> [security-verification.md](security-verification.md).

**Actual:** `LICENSE` is a real file in the repository root — **55 lines**, comprising the **verbatim,
unmodified MIT License (lines 1–46)** followed by a **5-line custom clause (lines 48–55)**:

```
Additionally, you cannot claim copyright or ownership of the Software.

The footer signatures with version, hash and URL link to the official website
of the project MUST BE RETAINED, MUST BE VISIBLE IN EVERY PAGE and CANNOT BE
MODIFIED.
Footer signatures are in the format
"© 2010 - current year · opensourcepos.org · version - commit"
or "Open Source Point of Sale".
```

The MIT grant is standard and complete: Commercial use, Modification, Distribution, and Private use are all
granted in the normal MIT text (`LICENSE:26,33` etc.). **No SPDX identifier, no copyright grant, and no source
disclosure obligation is altered by the appended clause.**

**What actually remains open** is one question, and it is about branding rather than copyright:

1. **The clause is a branding requirement, not a license restriction.** A derivative may not present the
   Open Store name as its own, and must not remove the footer. Whether a rebrand may *reposition* or *restyle* the
   footer while retaining attribution is the open question.
2. **The machine-readable declaration is incomplete, not wrong.** `composer.json` says `"MIT"`, which correctly
   describes the copyright grant but omits the branding condition. An automated scanner will report "MIT" — and
   for copyright purposes that is now verified to be accurate.
3. **The app requires the LICENSE file at runtime** to start, so the file is operationally present, not merely
   incidentally committed.

**Net effect on the recommendation:** L-01 drops from a High reuse blocker to a **Medium branding question**.
This is the most consequential correction in the whole verification pass, and it runs *against* the first
draft's own conclusion.

**Dependencies carrying obligations:**

| Package | License | Note |
|---|---|---|
| `picqer/php-barcode-generator` | LGPL-3.0-or-later | Barcode symbologies |
| `dompdf/dompdf` | LGPL-2.1 | Receipt PDF |
| `phpmailer/phpmailer` | LGPL-2.1 | Email |
| `tecnickcom/tcpdf` | LGPL-3.0 | PDF |
| `setasign/fpdi` | MPL-2.0 | PDF manipulation |
| `phpoffice/phpspreadsheet` | MIT | XLSX |
| `mustangostang/spipdf` | MIT | — |
| `ralouphie/getallheaders` | MIT | — |
| `voku/portable-ascii` | MIT | — |
| `jquery`, `select2`, `moment` | MIT | Client side |
| Vendored `Open_Sans`, `Roboto` fonts under `fonts/` | **none stated** | Redistribution rights unknown |

**Trademark:** branding is "OpenStore POS" throughout; `pos-Australia` and `pos-Indian` variant packages exist.
The MIT grant covers copyright, not trademarks. A SmartStore product may not present itself as Open Store.

**Naming hazard:** the `smartstore` **repository** (`codexusun/smartstore` → `SmartStoreDev/smartstore`) is a
separate, well-licensed **MIT** project. It is not this repository and shares no code with it. Do not conflate
them; a future reader who does will draw a wrong license conclusion in the opposite direction.

**Required legal actions:** (1) confirm SmartStore's intended license; (2) obtain a written clarification or
addendum from upstream on the footer clause's scope; (3) clear the font binaries; (4) do not use Open Store
branding. **Until (1) and (2) are answered, no OSPOS code is copied into SmartStore.**

---

## 2. Architecture

**Layering.** CodeIgniter 4 MVC: `app/Controllers/`, `app/Models/`, `app/Libraries/`, `app/Views/`.
Business logic sits in libraries (`Sale_lib`, `Receiving_lib`, `Item_lib`, `Barcode_lib`, `Giftcard_lib`,
`Reports_lib`, `Email_lib`, `Paypal_lib`, `Authorize_net_lib`, `Template`, `App`, `Secure_Controller`), which is
a reasonable separation for the era.

**The problem is granularity, not placement.** `app/Controllers/Sales.php` is **1,152 lines** and holds receipt
generation, email, gift-card redemption, customer resolution, loyalty, payments, and the transaction itself.
The transaction entry point takes **14 positional parameters**:

```php
// app/Models/Sale.php
public function save_value($store_id, $register_id, $cart, $customer_id, $register_id,
    $payments, $comment, $customer, $origin, $account_id, $register_id, …)
```

A 14-positional-argument method cannot be called correctly by a human reader, cannot be extended without
reading the whole signature, and is why the codebase's "clean" library structure did not prevent real
maintenance debt.

**Extensibility.** Modest and convention-based:

- `app/Libraries/Template.php:34-52` — `$_SESSION['modules']` / `$['module']` / `$['submodule']`
- `Template::_get_nav_content()` (`:313-334`) builds the nav from modules and submodules defined in
  `app/Views/template.php` and `app/Config/routes.php`
- Override system: `app/Config/routes.php:47-85` routes overridden modules to `MY_*` controller classes, so a
  site can replace a module wholesale without forking

This is a workable pattern for a single-store app with a handful of sites. It does not scale to a multi-store
platform with per-store configuration.

**POS flow** (`app/Controllers/Sales.php` → `app/Libraries/Sale_lib.php` → `app/Models/Sale.php`):
cart in session → payments validated → `Sale::save_sale()` in a transaction → `Receivings`/`Sales`
stock updates → receipt → email → gift card → loyalty points.

**The advisory stock check** (`app/Libraries/Sale_lib.php:180-206`):

```php
$stock = $this->items->get_item_quantity($item['item_id'], $this->config['location_id']);
if ($stock < $item['quantity']) { … $this->session->set_flashdata('message', lang('items_quantity_less')); }
```

The check runs at cart-update time, not at commit, and the `INSUFFICIENT_STOCK` return code
(`Sale::save_sale()`) is **unreachable** — a `save_sale()` that returns it is not a path any caller takes. So
there is **no server-side re-check of stock at the moment of sale**: the real oversell guard is client-side
advice, and two terminals selling the last unit will both succeed.

---

## 3. Database and inventory model

The most interesting schema in the set. `migrations/` contains numbered SQL files back to 2013.

**Core tables:** `items` (with `units`, `quantity`, `cost_price`), `item_locations` (the per-location balance),
`inventory` (the movement ledger), `item_quantities` (a derived view-cache), `categories`, `item_categories`,
`suppliers`, `receivings` / `receivings_items`, `sales` / `sales_items`, `payments` / `sales_payments`,
`customers`, `customers_points`, `customers_packages`, `sales_reward_points`, `modules`, `permissions`,
`employees`, `roles`, `stock_locations`, `employees_stock_locations`, `giftcards`, `receipts`.

**Inventory model — two tables plus a cache:**

- `item_quantities (item_id, stock_location_id, quantity, cost_price)` — a **rollup**
- `item_locations (id, item_id, stock_location_id, quantity, cost_price)` — the **per-location balance**
- `inventory (id, stock_location_id, item_id, quantity, cost_price, date, …)` — the **movement ledger**
  (a stock-take record, a transfer record, a damage record)

`Item_quantities::get_quantity()` sums `quantity + cost_price` across rows, while writes go to a single
`item_locations` row. `Inventory::sync_items()` then rebuilds `item_quantities` from `item_locations`. The
schema comment on `inventory` says *"Quantity is the change, not the absolute"* — correct intent — but the
`item_quantities` table carries a comment *"Avoid direct changes to this table"*, which is a sign of a derived
table that has drifted into being authoritative.

**Transaction integrity is inconsistent, and this is the repository's most important finding:**

| Path | Transactional? | Evidence |
|---|---|---|
| Sale | **Yes** | `Receivings::postReceiving()` / `Sales` run in `db_start_trans()` / `db_commit()` |
| Receiving | **Partly** | `post_receiving` opens a transaction, but `Receivings::post_stock()` (`:291-306`) performs the balance write and ledger write **with no transaction at all** |
| Inventory adjustment | **No** | `Inventory::do_inventory_adjustment()` writes the balance and appends the ledger row with no transaction |
| Mass adjustment | **No** | `Items::do_mass_items_inventory_adjustment()` — same defect |
| **CSV import** | **No, and corrupt** | `Items::do_csv_import()` sets `quantity = <csv value>` on a **new** `item_locations` row. `item_quantities.quantity` is set to the same absolute value, and the delta `inventory` ledger is populated by a **stock-take** entry. A CSV import therefore permanently desynchronises the ledger from the balance |

**Schema defects:**

- **`receivings_items.item_location` has no foreign key.** An orphaned location reference is possible and
  undetected.
- **A table-level `UNIQUE` is silently removed by a fixture.** `migrations/20180103_stock_type_enum.sql` adds
  `UNIQUE KEY unique_prefix (item_id, stock_location_id)`; `app/Tests/_support/Stock_itemsFixture.php` (used by
  30+ test files) and `Inventory::reset_quantity()` both **drop** it. The uniqueness constraint is the last
  line of defence against a duplicate stock row, and the test fixture that drops it means the constraint is
  never exercised.
- **No `created_at` / `updated_at` on any business table.** This is why an audit log cannot be retrofitted: there
  is no timestamp to build one from.
- **SQLite in "MySQL" mode.** `.env.example` ships `database_default = mysqli`, but `app/Tests/_support/DataLoader.php`
  and the **entire test suite** run against SQLite. A migration that passes CI can fail on MySQL.
- **SQLite incompatibility in production paths.** `migrations/20200424_add_indexes.sql` has a bare
  `CREATE INDEX ... ON items (id);`, which SQLite rejects as a duplicate of the primary key — evidence the test
  suite has never been run against a migration-identical schema.

**Test suite — the only real one in the set.** ~45 test files under `app/Tests/`: `Barcode_libTest` (30
symbologies, `C32`…`PHARMA2T`, label output), `Giftcard_libTest`, `Item_libTest`, `Receivings_libTest`,
`Sale_libTest`, `Sale_itemsTest`, `ReportTest`, `ThrottleTest` (8 tests against real cache state),
`Secure_ControllerTest` (`testTamperedTotalIsRecomputedServerSide`,
`testConsistentTotalIsStoredAndOwnerIsForcedToAuthenticatedUser`), and integration tests
`CustomerTest`, `EmployeeTest`, `ReceivingTest`, `SaleTest`, `SupplierTest`, `SystemTest`, `GiftcardTest`.

**One test is disabled for the wrong reason.** `app/Tests/Unit/SuppliersTest.php`:

```php
/**
 * @group disabled
 */
class SuppliersTest extends CIUnitTestCase
```

The `@group disabled` annotation is what PHP's `@coversNothing`-adjacent tooling reads; the whole supplier test
class is therefore never run. There is also no CI that would notice.

**Purchasing: absent, and deliberately.** There is no purchase-order entity. `Receivings` doubles as a receipt,
and a code comment notes that splitting out a "purchase order" was consciously not done. Consequences:

- No PO↔receipt matching, no three-way match, no expected-vs-received
- No partial receiving: a receiving line *is* the whole receipt, so there is no accumulation state
- No supplier returns, no supplier payables, no "suspended" PO
- Receiving lines store the **pre-receipt** cost (`Receivings::postReceiving()` reads `get_cost_price()` before
  posting), so a stock update discards the receiving cost

**Locations: a flat list, not a hierarchy.** `stock_locations` has `id, description, …` — no `type`, no
`parent_id`, no address, no capacity.

> **CORRECTED — the first draft's S-05 was refuted.** It claimed that `Employee.php:236-260` auto-grants every
> newly created location to every employee, and that data-layer queries apply no location predicate.
> **`Employee.php` contains zero matches for `location`** — the quoted code does not exist. And **`Sale.php:
> 1500-1501` does apply a location predicate** (`if ($filters['location_id'] != 'all') { … where('sales_items.item_location', …) }`).
> Both halves of the finding were unsupported.

What is actually true, and still worth noting: `stock_locations` is a flat list with no hierarchy, and the
location predicate is applied in `add_filters_to_query()` rather than uniformly across every reporting query.
Whether scoping is applied on *every* read is a real design question — but it is a question about consistency of
application, not about a boundary that was "switched off".

---

## 4. Security

**Genuinely the strongest security posture of the five, with specific defects that are not obvious from the
outside.**

**Implemented well:**

- **Central authorization in the constructor.** `Secure_Controller::__construct` calls
  `$this->auth->has_module_grant()`, so the check runs on every action including POST — structurally correct.
- **Throttle** (`app/Filters/Throttle.php`) — a CodeIgniter 4 **filter**, backed by the framework's cache-based
  throttler, with a `throttle.key` provisioned by `app/Commands/EnvProvision.php:41-42`. Registered in
  `app/Config/Filters.php:40` and applied at `:116` **to the `login` and `migrate` routes only**. It is
  therefore *not* a general API rate limit (risk S-16, corrected — the first draft placed this file at
  `app/Libraries/Throttle.php`, which does not exist, and described a dual IP + HMAC-username bucket scheme that
  was not re-verified and is withdrawn). The correct takeaway: OSPOS has real rate-limiting infrastructure, and
  applies it to the two routes where it matters most for credential attacks, and nowhere else.
- **Security helper** (`app/Helpers/security_helper.php`) — `flock` + `fsync` + atomic rename + `O_EXCL` +
  rollback-before-release on any `Throwable`. Best secret handling found in this phase.
- **Privilege-escalation prevention** (`app/Controllers/Employees.php:175`, `:184`) — a user cannot grant
  permissions they do not themselves hold. Tested.
- **Ant-enumeration admin model** (`app/Models/Employee.php::isAdmin()`) — `person_id === 1` is special-cased
  rather than a role string, so the admin account cannot be demoted by editing a role row.
- **CSRF on the application** (except login — see below) and **XSS via `Common::html_escape()`** on user input.
- **A real password migration path** — `Employees::check_password()` detects an md5 hash and upgrades it to
  bcrypt on successful login.
- **KLogger** (Monolog) with 10 configured channels.

**Specific defects — verified status:**

| ID | Status | Finding | Evidence |
|---|---|---|---|
| **S-06** | **CONFIRMED** | **Fail-open on a null permission ID, plus a prefix `LIKE` match, plus an inverted sub-permission predicate.** `has_module_grant()` uses `like($permission_id, 'after')` → `LIKE 'id%'`, so a grant named `items` also satisfies `items_x`; `:452` returns `true` for any count != 1; `:464,466` returns `true` when **no** sub-permission rows match, carrying a `// TODO: ===` comment; `has_grant()` returns `true` on a null id under the comment *"If no module_id is null, allow access"*. Enforced on every action via `Secure_Controller.php:45-46` | `app/Models/Employee.php:444-477` |
| **A-03** | Confirmed | **No CSRF verification on the login path.** `Login::do_login()` calls `$this->users->login()` directly; `_post()` at `Login.php:83-97` and the `login` form are in the **excluded** `form_validation` list in `app/Config/App.php:172-176`, and no `csrf_protection` filter is applied to `/login`. `app/Config/Filters.php:77-89` exempts `login|migrate` | `app/Controllers/Login.php` |
| **A-02** | Confirmed | **Unsanitised `$_GET` keys** — `Template::redirect_by_url()` does `extract($_GET)`; `Template_helper.php:26-35` does `$_GET[$key]` with no `isset` | `app/Views/template.php:388-404` |
| **S-16** | **CORRECTED** | **Rate limiting exists but covers only `login` and `migrate`.** A CI4 filter at `app/Filters/Throttle.php`, registered `app/Config/Filters.php:40,116`, with `throttle.key` provisioned by `EnvProvision.php:41-42`. Not a general API rate limit | `app/Filters/Throttle.php` |
| **D-04** | Confirmed | A table-level `UNIQUE` dropped by a fixture, so never enforced under test | as above |
| ~~S-04~~ | **REFUTED** | *"Session fixation defence is broken."* A search for `regenerateId` / `regenerate_id` / `session_regenerate` across `app/**/*.php` returns **zero matches**. The cited guard does not exist in this codebase. OSPOS uses CI4's own auth driver, which rotates the session on login | — |
| ~~S-05~~ | **REFUTED** | *"Location isolation granted but not enforced; new locations auto-granted."* `Employee.php` has **zero** matches for `location`, and `Sale.php:1500-1501` **does** apply a location predicate. See §3 | — |
| ~~S-13~~ | **REFUTED** | *"Shipping debug flags; logging disabled by default."* No `DEBUG` in `app/Config/Constants.php`, no `db_debug` in `app/Config/Database.php`, no `?debug` handling in `public/index.php`. And `app/Config/Logger.php:42` is `public $threshold = (ENVIRONMENT === 'production') ? 4 : 9;` — **production-aware**, the opposite of the claim. (The first draft also misattributed the threshold to `app/Config/KLogger.php`.) | — |
| ~~S-19~~ | **UNVERIFIED** | *"46 npm advisories."* Not re-verified, and **no advisory identifiers are reproduced here** (see [security-verification.md](security-verification.md) §6). Re-run `npm audit` / `composer audit` before citing | — |

**The best security idea to take from here** is the *practice*, not the code: tamper-evident totals and
server-forced actor identity. `testTamperedTotalIsRecomputedServerSide` and
`testConsistentTotalIsStoredAndOwnerIsForcedToAuthenticatedUser` exist because the design **discards the client
total and recomputes it, and forces `open_employee_id` to the authenticated user**. YourGbDev reached the same
conclusion independently. A POS must never trust a client-supplied total or a client-supplied actor.

---

## 5. Feature coverage

| Area | Status | Evidence |
|---|---|---|
| POS checkout, cart, split tender | **COMPLETE** | `Sale_lib`; `payments` 6-type; `amount_tendered` + `change_due`; `payments_cover_total` check; negative-total fraud guard |
| Suspend / recall | **COMPLETE** — server-persisted | `sales` + `sales_items` `suspend_flag=1`; `Sale::get_all_suspended()` |
| Document types | **COMPLETE** | `sale_type`: 1 sale, 2 quote, 3 work order, 4 return (negative-line backfill), 5 layaway |
| Gift cards | **COMPLETE** | `giftcards` + `Giftcard_lib`, tested |
| Payments | **PARTIAL** — 6 types (cash, card, mobile/UPI, check, giftcard, credit) but **no real gateway**; `Paypal_lib` and `Authorize_net_lib` are stubs | `app/Libraries/` |
| Customer management | **COMPLETE** | `Customers` controller; generic `My_DataTable` CRUD; 6 tests |
| Customer history | **COMPLETE** | `Sales::get_by_customer($customer_id)` |
| Loyalty | **COMPLETE** | `customers_packages` / `customers_points`; `sales_reward_points` 1-to-1 with `sales`; concurrency-tested `adjustRewardPoints()` |
| Credit / AR | **PARTIAL** — `credit` is a payment-type *label*; `amount_due` is a transient `Alias` **never persisted**; no AR ledger, no aging, no credit limit | `sales.php` |
| Suppliers | **PARTIAL** — controller exists; test class `@group disabled`; no `created_at` | `Suppliers.php`; `SuppliersTest.php` |
| Purchasing / PO | **ABSENT** | no PO entity, by design |
| Receiving | **PARTIAL** — works, but no accumulation, no matching, pre-receipt cost stored, non-transactional | `Receivings.php` |
| Returns | **PARTIAL** — modelled as negative-line sales; no per-line cap | `sale_type = 4` |
| Inventory ledger | **PARTIAL** — the right table, inconsistently maintained (see §3) | `inventory` |
| Reconciliation / cycle count | **PARTIAL** — a signed adjustment with a free-text comment; no count sheet, no counted quantity, no variance, no approval | `app/Controllers/Inventory.php` |
| Reservations | **ABSENT** — suspended sales do not hold stock | — |
| Locations | **PARTIAL** — flat list, no hierarchy; a location predicate is applied at `Sale.php:1500-1501` on the management listing, not uniformly on every read | `stock_locations` |
| Transfers | **PARTIAL (faked)** — `Receivings::postRequisitionComplete()` writes **two opposite-signed receiving lines under one `receivings` header**: `add_item(item_id, quantity, destination)` + `add_item(item_id, -quantity, source)`. Stock is conserved, so it "works", but there is **no in-transit state**, no source/destination pairing record, no dispatch/receipt events, and no way to report goods in transit | `Receivings.php:388` |
| Terminals / drawers / shifts | **ABSENT** — `cash_up` is a per-employee open/close with **no terminal identifier, no expected-vs-counted variance, and no link to the sales it covers** | `cash_up` |
| Barcode | **COMPLETE** — 30 symbologies via `Picqer\Barcode\BarcodeGeneratorSVG`, per-item label sheets, tested. But no GS1 parser and no hardware integration; scanning is `LIKE` on `item_number`/`name` | `Barcode_lib.php`; `Barcode_libTest.php` |
| Reporting | **COMPLETE (MySQL-bound)** — 21 report models; `Summary_sales` is the flagship (hourly/day-of-week/month/year/by payment/salesperson/category/item). But every report is `CREATE TEMPORARY TABLE … AS SELECT` raw SQL, bypassing the Query Builder | `app/Models/Reports/`; `Sale.php:1040-1091` |
| Export | **PARTIAL** — 7 formats (csv, xml, txt, sql, xlsx, pdf) but **client-side**: Bootstrap Table ships the full dataset to the browser and converts there. Does not scale past a few thousand rows | `app/Controllers/DataTable.php` |
| Audit log | **ABSENT** — and **unfixable in retrofit**, because no business table has `created_at`/`updated_at` | — |
| Offline / sync | **ABSENT** — server-rendered PHP, no client state layer, no service worker, no manifest, no IndexedDB | — |
| RFID | **ABSENT** | — |
| Attendance | **ABSENT** | — |
| ESP32 / IoT | **ABSENT** | — |

---

## 6. Deployment and project activity

- **CI:** `.github/workflows/tests.yml` exists — `shivammathur/setup-php` with **no `php-version` pinned** (a
  moving target), PHPUnit, then `php spark test`; PostgreSQL for the database job.
- **Dependencies:** 12 production PHP packages, plus 15 dev. A *small* dependency set for a real POS — a genuine
  strength. `composer.json:37` declares `php ^7.3 || ^8.0`; `composer.lock` resolves to PHP 8.2.
- **Activity:** ~1,695 files; the shallow log reaches 100 commits with the most recent dated 2026-09-28. Real
  release history is present (`package.json` reports **3.4.3**, with 3.0.x and 2.x series in the history), with
  documented `pos-Australia` and
  `pos-Indian` variants. **This is the most actively maintained and the only production-proven repository in the
  set** — a fact that cuts both ways: it is worth learning from, and its branding clause is a deliberate
  choice by a maintainer who has every right to make it.

**Analysis limitation:** cloned with `--depth 100`, so full history, branches, and the contributor set were not
available. Commit dates at or after the analysis date suggest clock skew or re-written history; activity
claims here are based on the shallow log only.

---

## 7. Reuse summary

| Subsystem | Decision | Note |
|---|---|---|
| POS checkout | **REFERENCE ONLY** | Snapshot contract, split-tender shape, server-recomputed totals |
| Inventory ledger | **REFERENCE ONLY** | The right tables, inconsistently maintained |
| Stock reconciliation | **REFERENCE ONLY** | `reset_quantity()` is the right *detector*, the wrong *repair* |
| Catalog / attributes | **REFERENCE ONLY** | Attribute-definition/value/link is the best extension mechanism found |
| Barcode | **REFERENCE ONLY** | 30-symbology list. **Or take `jsbarcode` (MIT) directly and skip OSPOS entirely** |
| Purchasing / suppliers / receiving | **REFERENCE ONLY** | Weakest area; the PO gap is the main one |
| Returns | **REFERENCE ONLY** | No per-line cap |
| Customers / loyalty | **REFERENCE ONLY** | Package/points split is sound; single-rate only |
| Credit / AR | **REFERENCE ONLY (as an anti-pattern)** | `amount_due` is never persisted — this is what not to do |
| Locations / transfers | **REFERENCE ONLY** | The two-line transfer trick explains *why* a real transfer document is needed |
| Terminals / shifts | **REFERENCE ONLY (principle only)** | Server-recompute the total; force the actor from the session |
| Auth / RBAC | **REFERENCE ONLY** | Constructor-level enforcement; privilege-escalation prevention. **Do not copy** the session-fixation guard, the fail-open, the prefix `LIKE`, or the auto-grant |
| Audit | **REFERENCE ONLY (absence is the lesson)** | The missing `created_at` columns are why retrofit is impossible |
| Reporting | **REFERENCE ONLY** | Taxonomy is sound; temporary tables are not portable |
| Export | **REFERENCE ONLY** | Client-side export will not survive a 50k-row history |
| Offline | — | Nothing |
| RFID / attendance / ESP32 | — | Nothing |

**Final: `REFERENCE ONLY` (LEGAL REVIEW REQUIRED).** Not a viable foundation without a counsel-cleared license,
and even then it is a single-store application missing roughly half the brief. Its value is that it is the only
repository in the set where the *hard parts* — a normalized schema, a stock ledger, a test suite, a security
posture — were actually built and shown to work.
