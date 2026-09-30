# Risk Register

Phase 0 reconnaissance risks. Likelihood and Impact are **L/M/H**; Score = Likelihood × Impact (1-25).
Severity bands: **1-5 Low · 6-11 Medium · 12-19 High · 20-25 Critical**.

Every risk below is grounded in a specific, verified finding in one of the five source trees. Risks that depend
on legal interpretation are marked **LEGAL** and must be closed by counsel, not by engineering.

> **Revision note.** This register was re-verified against source after first draft. A full pass re-opened every
> cited file; findings that could not be reproduced were removed, and findings whose details were wrong were
> restated. **12 of the original 25 security findings were refuted, 3 had material details corrected, and 3 were left UNCONFIRMED** — see
> [security-verification.md](security-verification.md) for the evidence and disposition of each. Only
> `CONFIRMED` and `CORRECTED` findings are scored below. `UNCONFIRMED` and `REFUTED` findings are listed
> separately and contribute nothing to any comparison, ranking, or recommendation.

---

## 1. Legal and licensing risks

| ID | Risk | Evidence | L | I | Score | Severity | Mitigation |
|---|---|---|---|---|---|---|---|
| L-01 | **OSPOS's licence adds a mandatory visible attribution obligation on top of unmodified MIT** | Root `LICENSE` contains the **unmodified, standard MIT text** (Copyright (C) 2020-2025 Adnan Khurram / Cyber Area) **plus** a clause requiring the branding line to remain visible in the user interface. `package.json:5` correctly declares `"license": "MIT"`. The non-standard element is the **attribution/footer requirement**, not a narrowed grant of copyright rights | H | M | 9 | **Medium** | **LEGAL.** The copyright terms are standard MIT and compatible with MIT/Apache/proprietary reuse. The open question is narrow: may a rebrand remove or move the visible branding line? Obtain a written answer from upstream or counsel. Do not copy the clause's text into SmartStore until settled |
| L-02 | **Three repositories have no license — copying is legally prohibited** | `yourgbdev/`, `retailpos/`, and `rfid-store/` contain **no** `LICENSE`/`COPYING` file and no SPDX identifier in any manifest. RFID's README says "all rights reserved" | H | H | 16 | **High** | `DO NOT USE` / `REFERENCE ONLY`. Reproduce *design ideas* only; never copy, adapt, or paste code. All findings in this phase were derived by reading, not by copying |
| L-03 | **NodeDR's AGPL-3.0-only forces SmartStore's license to AGPL if code is used** | `LICENSE`, `backend/LICENSE`, `backend/README.md`, `backend/README.Docker.md` all declare AGPL-3.0-only, consistently. No dual-license offer. AGPL §13 extends copyleft to network use | M | H | 12 | **High** | **LEGAL.** If SmartStore is proprietary or MIT/Apache, NodeDR is unusable. If SmartStore is genuinely AGPL, NodeDR becomes the strongest candidate and Option B should be re-evaluated |
| L-04 | **RetailPOS vendors unlicensed commercial template assets** | `resources/template/` (Matx) carries no license; `public/assets/`, `storage/fonts/`, `resources/views/template/` are vendored copies. `resources/views/errors/html/403.blade.php` still shows a **Matx** sidebar with unrelated links and a **stale CSRF token** | M | M | 6 | **Medium** | Do not copy template assets. The Blade error page also embeds a placeholder CSRF token — never copy that pattern |
| L-05 | **OSPOS carries LGPL-3.0 transitives and proprietary font binaries** | `vendor/picqer/php-barcode-generator` (LGPL-3.0-or-later), `dompdf/dompdf` (LGPL-2.1), `phpmailer` (LGPL-2.1), `tecnickcom/tcpdf` (LGPL-3.0), `setasign/fpdi` (MPL-2.0), `phpoffice/phpspreadsheet` (MIT), `ralouphie/getallheaders` (MIT), `mustangostang/spipdf` (MIT), `voku/portable-ascii` (MIT), `jquery` (MIT), `select2` (MIT), `moment/moment` (MIT). Vendored `Open_Sans`/`Roboto` under `fonts/` with no license | M | M | 6 | **Medium** | **LEGAL.** LGPL-3.0 in a web app is generally acceptable with dynamic-linking compliance, but font redistribution rights and trademark ("Open Store") must be cleared separately |
| L-06 | **OSPOS trademark is not addressed** | Branding is "OpenStore POS" throughout; `pos-Australia` and `pos-Indian` variant packages exist | H | M | 9 | **Medium** | **LEGAL.** Do not use Open Store branding. Note that the smartstore **repository** is a separate, well-licensed MIT project (`codexusun/smartstore` / `SmartStoreDev/smartstore`) — do not conflate the two |
| L-07 | **RFID-related designs may be patent-encumbered independent of license** | The RFID repo has no license, so the LLRP implementation is unlicensable anyway; EPC/RFID patents are a separate question | L | M | 3 | **Low** | **LEGAL.** Reimplement RFID from the **EPCglobal LLRP v1.0.1 specification** (freely published), not from the source tree |
| L-08 | **No repository has a CLA or explicit contributor license grant** | Verified across all five; a few `LICENSE` files are generic MIT with no copyright holder named | M | M | 6 | **Medium** | **LEGAL.** Provenance of contributions is unverified in all five. Another reason to build clean |

> **Correction to the first draft.** L-01 previously claimed that OSPOS had no `LICENSE` file, that its clause sat
> in `app/Config/Constants.php` "where scanners could not see it", and that it narrowed the copyright grant. All
> three were wrong: the root `LICENSE` exists, the copyright terms are verbatim MIT, and the only non-standard
> element is the required visible branding line. L-01 drops from **High** to **Medium** and is now a branding
> question rather than a reuse blocker. This correction was made *against* the first draft's own direction of
> travel — the source was better than we had recorded.

---

## 2. Security risks

Only findings reproduced from source are listed here. Score and severity describe the **verified** behaviour.

| ID | Status | Risk | Evidence | L | I | Score | Severity | Mitigation |
|---|---|---|---|---|---|---|---|---|
| S-01 | **CONFIRMED** | **RFID: anonymous stock mutation and unbounded return-driven inflation** | `InventoryController.cs:9-11` `[Route("api/inventory")]` and `SalesReturnController.cs:9-11` `[Route("api/sales-returns")]` carry **no** `[Authorize]`; a repo-wide `[Authorize]` search returns 2 hits, so **16 of 18 controllers are unprotected**. `InventoryController.cs:103` `product.StockQty = request.Stock;` with no range check. `SalesReturnController.cs:69` `product.StockQty += item.Quantity;` with no positivity check, no cap against quantity sold (`:63` matches on `ProductId` only), no order-status validation (`:52-54`), and therefore replayable | H | **C** | 20 | **Critical** | `DO NOT USE`. Authorization on **every** stock-mutating endpoint, returns that cap quantity against what was sold and are idempotent, and a DB `CHECK` on non-negative stock |
| S-02 | **CONFIRMED** | **RFID: SSRF via reader host/port override** | `RfidReaderController.cs:50-51` accepts `readerHost` and `readerPortOverride`; `:53-55` prefers the caller's host over configuration; `:57` takes the port; `:68` passes both to `ReadTagsAsync` → `LlrpReaderService.cs:30` `ConnectAsync`. No allowlist, no CIDR check, unauthenticated. The 30s timeout clamp (`:64`) is a usable timing side channel | M | H | 12 | **High** | `DO NOT USE`. Reader addresses from server configuration only. If dynamic addressing is required, allowlist resolved addresses and reject link-local/private ranges |
| S-03 | **CONFIRMED** | **RetailPOS: 53 of 54 API routes unauthenticated; six destructive deletions on GET** | `routes/api.php` has 54 `Route::` declarations. The only two middleware references are an L23 header comment and the **Laravel default scaffold** `Route::middleware('auth:sanctum')->get('/user', …)` at L118. Six unauthenticated `GET` deletions: employee `:33`, customer `:42`, supplier `:50`, category `:66`, brand `:72`, product `:81` | H | **C** | 20 | **Critical** | `DO NOT USE`. One central authentication middleware; **no state-changing route on `GET`**; explicit authorization per route. A `GET` deletion is triggerable by any hyperlink or prefetcher |
| S-06 | **CONFIRMED** | **OSPOS: prefix privilege matching, fail-open on null, inverted sub-permission predicate** | `Employee.php:447` `like($permission_id, 'after')` emits `LIKE 'id%'`, so a grant on `items` also satisfies `items_x`; `:452` returns true for any match count != 1; `:464,466` returns true when **no** sub-permission rows match, carrying a `// TODO: ===` comment; `:474-476` returns true when `permission_id == null` under the comment "If no module_id is null, allow access". Enforced on every action via `Secure_Controller.php:45-46` | M | H | 12 | **High** | Deny by default. Match module ids exactly, never by prefix. Remove the `!= 1` special cases |
| S-08 | **CONFIRMED** | **YourGbDev: hardcoded credential-reset script deployed in the web root** | `backend/public/fix_live_admin.php` — `FIX_EMAIL = 'iskaderbay@gmail.com'` (`:30`), `FIX_PASSWORD = 'admin123'` (`:31`), bcrypt cost 12 (`:53-55`). Web-reachable under `public/` with no auth gate. Self-deletes **only after a successful reset** (`:100`), so the exposure window runs from deploy until the first attacker-controlled request | H | **C** | 20 | **Critical** | `DO NOT USE`. Never ship credential-recovery tooling under `public/`. Add a CI guard failing the build on any executable file in the web root that is not a route |
| S-11 | **CONFIRMED** | **RFID: unsalted single-pass SHA-256, no lockout, seeded default admin** | `Services/PasswordHashHelper.cs:10` `SHA256.HashData(...)` — unsalted, no work factor, hex-encoded; `:14` verifies with `Equals`. `AuthController.cs:22-32` returns `Unauthorized` on failure with no attempt counter, delay, or lockout. `Data/StoreSeedData.cs:30,33` seeds `admin` / `Admin@123`. **Mass-assignment claim withdrawn** — controllers take typed DTOs and assign named properties individually | H | **C** | 20 | **Critical** | `DO NOT USE`. Argon2id or bcrypt ≥ 12; per-account lockout; seeded credentials must be forced to change or absent from production seeding |
| S-12 | **CONFIRMED** | **RFID: permission model stored but never enforced; audit trail records no actor or IP** | All 7 `PermissionsJson` occurrences are DDL (`Program.cs:75,82,84`), a login response field (`AuthController.cs:49`), a role-list field (`RolesController.cs:27`), one admin write (`:51`), and a seed (`StoreSeedData.cs:17`) — **none consults it for an authorization decision**. Enforcement is two `[Authorize(Roles = "Administrator")]` attributes (`RolesController.cs:9`, `UsersController.cs:12`) with no fallback policy (`Program.cs:55`). `AuditLogs.Add` appears twice, both in `RfidReaderController.cs:117,165`. `PerformedByUserId` and `IpAddress` are declared (`AuditLog.cs:13,16`) and **never assigned**. `AuditActionType.Login`/`.Logout` are declared and unused | H | H | 16 | **High** | Design the audit trail in the core: append-only, in-transaction, with actor/IP/terminal/request-id, and DB-level immutability. Enforce permissions in code, not by returning them to the client |
| S-20 | **CORRECTED** | **NodeDR: 30-day session token whose transport security is opt-in** | `middleware/auth.js:14` `TOKEN_TTL = '30d'`, used at `:20` and as the cookie max-age at `:15,29`. The rationale is documented at `:8-13` (single-till trusted device) and mitigated by inline `verifyPassword()` on sensitive routes. **RBAC claims withdrawn** — `getUserRole` and `verifyToken` do not exist; the role is read from the database (`:52,58`) and `readSession` (`:66`) deliberately avoids the DB. **Immediate deactivation works** — `:52-56` re-reads the user and rejects when `!user.active`. Residual: `:28` `secure: process.env.COOKIE_SECURE === 'true'`, so the cookie is not `Secure` unless the env var is set (`httpOnly` `:26`, `sameSite: 'lax'` `:27` are set) | M | H | 12 | **High** | Set the cookie `Secure` flag by default in non-development environments rather than by opt-in |
| S-16 | **CORRECTED** | **OSPOS: rate limiting exists, but covers only `login` and `migrate`** | `app/Filters/Throttle.php` — a CodeIgniter 4 **filter**, not `app/Libraries/Throttle.php` as previously stated. Registered `app/Config/Filters.php:40` and applied at `:116` to the `login` and `migrate` routes only. `app/Commands/EnvProvision.php:41-42` provisions `throttle.key`. The previously reported MD5-username bucketing and test-suite claims were not re-read and are **withdrawn** | M | M | 6 | **Medium** | Per-user and per-IP limits on every sensitive endpoint; captcha and lockout on password reset; rate limiting as middleware applied by default, not per-route |
| S-24 | **CORRECTED** | **RFID: reader read failure is reported to the caller as "no tags found"** | `Services/LlrpReaderService.cs:118-121` catches `Exception`, **logs it** via `_logger.LogError`, then returns the collected tags — so a failed read and a successful read of an empty store are indistinguishable to the caller, and `RfidReaderController.cs:70-73` renders that as `200 OK` with "No tags found during read". `TestConnectionAsync` (`:135-148`) does report failure as `false`, so connectivity is independently checkable. The "5-second poll" interval was not traced | M | M | 6 | **Medium** | Event ingestion over a persistent connection; surface reader health explicitly; never convert a hardware fault into a successful empty read |

**Scored totals for §2: 4 Critical, 4 High, 2 Medium** — 10 findings, down from 25.

### 2a. Unconfirmed — not scored, not to be relied upon

These were **not re-verified** in the verification pass. They are recorded so they are not silently lost, but
they are not established vulnerabilities and contribute nothing to any comparison or recommendation. Where a
finding is the basis for a design lesson, the lesson is stated from first principles instead.

| ID | Original claim | Before it is used |
|---|---|---|
| S-10 | YourGbDev: `ReceivingService` does not verify `received_qty <= ordered_qty` | Open `backend/src/Services/ReceivingService.php`. **Note:** D-13 below independently establishes the over-receipt gap for the *RFID* repository, so the design lesson stands regardless |
| S-14 | RFID: `LlrpClient.cs:127-130` resets the reader to factory settings on every read; no response status checked; TV/TLV discriminator wrong; buffer desync on unknown parameters | **Now resolved — REFUTED, not merely unverified.** `resetToFactory` and `EnableReaderEvent` return **zero matches** across `backend/**/*.cs`, so the headline claim is false, and `LlrpClient.cs:83` *does* filter responses by expected message type. The residual "TV/TLV discriminator is wrong" claim (`LlrpMessageParser.cs:97`, `(firstByte & 0x80) != 0`) is a judgement about the LLRP specification and remains **UNVERIFIED**. The general design lesson — never reset production hardware per read, and check every response status — follows from the LLRP specification and does not depend on this finding |
| S-19 | OSPOS: 46 npm advisories (2 high, 44 moderate) | Re-run `npm audit` / `composer audit` against current advisory data. **No advisory identifiers are reproduced anywhere in Phase 0** — see [security-verification.md](security-verification.md) §6 |
| S-25 | YourGbDev: `UserService::create` calls `AuditService::record()` outside the transaction; `AuditService.php:42-47` catches every exception | Open `backend/src/Services/AuditService.php` and its call site. **Note:** the design lesson — an audit write in the same transaction as the business write — is asserted independently by S-12 on verified evidence |

### 2b. Refuted — removed, with the evidence that removed them

| ID | Why it was removed |
|---|---|
| S-04 | `regenerateId` / `regenerate_id` / `session_regenerate` return **0 matches** across `app/**/*.php`. The cited code does not exist |
| S-05 | `Employee.php` contains **0** matches for `location`. `Sale.php:1500-1501` **does** apply a location predicate. The cited auto-grant code is absent |
| S-07 | `config/session.php:184` sets `'http_only' => true`. `config/cors.php:32` sets `supports_credentials => false` with `allowed_origins => ['*']` — stock Laravel, low risk |
| S-09 | `mysqli_query` appears **nowhere** in `src/Services/*.php`; `->prepare()` appears **110 times**. `AuditRepository.php:69,74-75` binds `LIMIT :limit OFFSET :offset` — the exact case claimed as interpolated. The codebase uses PDO prepared statements throughout. **This was a Critical and the principal argument against YourGbDev** |
| S-13 | No `DEBUG` in `app/Config/Constants.php`, no `db_debug` in `app/Config/Database.php`, no `debug` handling in `public/index.php`. `app/Config/Logger.php:42` is `threshold = (ENVIRONMENT === 'production') ? 4 : 9` — production-aware, the opposite of the claim |
| S-15 | `JobAssignment` appears **nowhere** in the repository. The project uses `System.Text.Json` (`Program.cs:11`), which does not exhibit the claimed prototype-pollution behaviour |
| S-17 | `{!!` returns **0 matches** across all `resources/views/**/*.blade.php`. The cited `ExceptionController.cs` is a C# file in a PHP project |
| S-18 | `config/jwt.php` does not exist. `config/auth.php` contains no `rounds` key |
| S-21 | **Inverted.** OSPOS `Cors.php:37,60` — empty origin list, credentials off. **YourGbDev `Middleware/Cors.php` is the most correct implementation in the set** — exact allowlist, credentials on, `Access-Control-Allow-Origin` echoed only for allowlisted origins. NodeDR `server.js:21,28` — single explicit origin, plus `helmet` at `:27`. RFID `Program.cs:22-33` — explicit localhost allowlist |
| S-22 | `app/Http/Middleware/` contains only the eight default Laravel middlewares. `AdminMiddleware.php` and `SecurityHeadersMiddleware.php` do not exist; `admin123` appears **nowhere** in the repository |
| S-23 | No `FileUploadController` or `DirectoryController` exists; a search of `app/Http/Controllers/**` for `File`/`Directory`/`Upload` returns **0 matches** |
| A-17 | `Program.cs:16-17` is `AddDbContext<StoreDbContext>(…)` with **no** lifetime override, which defaults to **Scoped**. Correct and idiomatic — moved to §4 as removed |

---

## 3. Data integrity risks

| ID | Risk | Evidence | L | I | Score | Severity | Mitigation |
|---|---|---|---|---|---|---|---|
| D-01 | **YourGbDev: schema drift — the documented baseline does not match the real schema** | `migrations/001_baseline.sql` has no `idempotency_key_hash`; `inventory_transactions` lacks `reference_type`/`reference_id`; `sales` lacks `order_id`; and an `ALTER TABLE … ADD COLUMN IF NOT EXISTS` is **MySQL-invalid syntax** | H | M | 9 | **Medium** | `DO NOT USE`. For SmartStore: migrations are the single source of truth, and CI must apply every migration to an empty database |
| D-02 | **OSPOS: a non-transactional stock path** | `Receivings` (`post_stock()`), `Inventory::do_inventory_adjustment()` and `Items::do_mass_items_inventory_adjustment()` perform the balance write and the ledger write with no `db_start_trans()`/`db_commit()` | M | H | 12 | **High** | Balance and movement writes in one transaction, always, on **every** path |
| D-03 | **OSPOS: CSV import writes absolute counts into a delta ledger** | `Items::do_csv_import()` sets `quantity = <csv value>` on the new `item_locations` row; the delta ledger is populated by a stock-take `inventory` entry, so a CSV import permanently desynchronises the ledger from the balance | M | H | 12 | **High** | Imports must post a signed adjustment movement, never set a balance |
| D-04 | **OSPOS: a table-level `UNIQUE` is silently removed by a fixture** | `20180103_stock_type_enum.sql` adds `UNIQUE KEY unique_prefix (item_id, stock_location_id)`; `Stock_itemsFixture` (used by 30+ tests) and `Inventory::reset_quantity()` both **drop** it | M | H | 12 | **High** | The uniqueness constraint is the last line of defence against a duplicate stock row. Keep it and fix the code that needed it removed |
| D-05 | **OSPOS: receiving lines store the pre-receipt cost** | `Receivings::postReceiving()` does `$cost_price = $this->get_cost_price($item['item_id']);` **before** posting, so a stock update silently discards the receiving cost | M | M | 6 | **Medium** | Post cost updates and stock updates in the same transaction |
| D-06 | **OSPOS: orphaned location references and no audit columns** | `receivings_items.item_location` has no FK; and no business table has `created_at`/`updated_at` | H | M | 9 | **Medium** | FKs on every location reference; `created_at`/`updated_at` on every business table — retrofitting an audit trail is impossible without them |
| D-07 | **OSPOS: `item_quantities` is the master, but reads and writes disagree** | `Item_quantities::get_quantity()` sums `quantity` + `cost_price`, while writes go to a single `item_locations` row. `sync_items()` then rebuilds `item_quantities` from `item_locations` — so the fallback is a live consistency check, and the schema comment says *"Avoid direct changes to this table"* | M | M | 6 | **Medium** | One table, one writer. Eliminate derived state |
| D-08 | **OSPOS: SQLite is used for "MySQL" in a documented configuration** | `.env.example` ships `database_default = mysqli`, but `DataLoader` fixtures and the *entire test suite* run against SQLite | M | M | 6 | **Medium** | Never develop against a different engine than production. A migration that passes CI on SQLite can fail on MySQL |
| D-09 | **NodeDR: `Product.stock` is a mutable integer with no movement ledger** | `prisma/schema.prisma` — `Product.stock Int @default(0)`; the full model list is `User, ShopSettings, Product, Customer, CustomerDuePayment, Invoice, InvoiceItem, Return, ReturnItem, ApiKey, TaxCode, PinCode, IfscCode` — **there is no inventory or stock-movement model at all**. Checkout decrements via `invoices.js:295` `stock: { decrement }`; a return credits via `returns.js:99` `stock: { increment }`. Neither writes a movement row, so "why is stock 3?" is unanswerable and a bad return is untraceable | H | H | 16 | **High** | A movement ledger, as in OSPOS's `inventory` table. Both the decrement and the credit must write a row in the same transaction as the balance change |
| D-10 | **NodeDR: sale/payment amount is never persisted from a validated input** | `Invoice.totalAmount` comes from the client `cart.total`; only `paidAmount`, `dueAmount`, and `creditApplied` are server-computed | M | H | 12 | **High** | Persist server-computed totals; recompute from persisted line items |
| D-11 | **NodeDR: migration `init` is not idempotent** | `backend/prisma/migrations/20260101000000_init/migration.sql` has bare `CREATE TABLE` with no `IF NOT EXISTS`, and no `prisma/migrations/migration_lock.toml` exists | M | M | 6 | **Medium** | Regenerate the migration baseline from a reviewed schema; never hand-edit Prisma migration SQL |
| D-13 | **RFID repository: an over-receipt guard is missing and the PO is not read** | `GoodsReceiptsController.cs:52-55` hardcodes `Status = Closed`, never reads the PO to compare received vs ordered, and never writes `QuantityAccepted`/`QuantityRejected` | H | H | 16 | **High** | `DO NOT USE`. Enforce `received <= ordered - received_so_far` inside the transaction |
| D-14 | **RFID repository: no migration files at all** | `Migrations/` is empty; the schema exists only in the compiled assembly. There is no way to create the database from source | H | H | 16 | **High** | `DO NOT USE`. For SmartStore: every schema change is a committed, reviewed, reversible migration |
| D-15 | **RFID repository: sale items store no cost price** | `SaleItem` has `Quantity`/`Price`/`Total` but no cost, so margin reporting is impossible | H | M | 9 | **Medium** | Snapshot cost price on every sale line, as OSPOS does |
| D-16 | **RetailPOS: no inventory, no transactions, no integrity constraints** | `Product.Stock` is a mutable field; no sale, order, or payment entities | H | H | 16 | **High** | `DO NOT USE` |
| D-17 | **Cross-repo: money is stored as float in two of the five** | NodeDR: `Float` for all money and `Decimal` for tax. YourGbDev: `Double` | H | H | 16 | **High** | **Integer minor units** everywhere. `DECIMAL(18,4)` only for loyalty points and quantities where needed |
| D-18 | **Cross-repo: no idempotency on any financial mutation** | Only one unused UNIQUE column anywhere (D-01). Required for offline terminals to be safe | H | H | 16 | **High** | `Idempotency-Key` on every financial endpoint, enforced by a unique index, checked before any side effect |

> **Correction to the first draft.** D-12 ("NodeDR: `Sale.stock` records restock, not sale") was **refuted and
> removed**. It claimed a stock-movement table with `type` and `quantityChange` columns. The schema contains
> **no such model** — see the full model list in D-09. The underlying concern is real but is already stated by
> D-09: returns credit stock with no ledger entry at all, so there is no mislabelled row, there is simply no row.

---

## 4. Architecture and delivery risks

| ID | Risk | Evidence | L | I | Score | Severity | Mitigation |
|---|---|---|---|---|---|---|---|
| A-01 | **OSPOS's entire reporting layer bypasses the ORM and is MySQL-only** | `CREATE TEMPORARY TABLE … AS SELECT` raw SQL throughout `app/Models/Reports/` — e.g. `Sale.php:1040-1091`, `Receiving.php:343` | H | M | 9 | **Medium** | Reports must be portable and must read the ledger, not a denormalised balance |
| A-02 | **OSPOS: unsanitised `$_GET` keys in navigation and template rendering** | `app/Views/template.php:388-404` does `extract($_GET)`; `app/Helpers/Template_helper.php:26-35` does `$_GET[$key]` with no `isset` | M | M | 6 | **Medium** | Never `extract` request data; use typed parameters |
| A-03 | **OSPOS: no CSRF verification on the login path** | `Login.php:29-59` `do_login()` calls `$this->users->login()` directly; `_post()` at `Login.php:83-97` and the `login` form are in the **excluded** `form_validation` list in `app/Config/App.php:172-176`, and no `csrf_protection` filter is applied to `/login` | M | M | 6 | **Medium** | CSRF on all state-changing routes including login |
| A-04 | **NodeDR: silent API degradation** | `toNumber(x) { return Number(x) || 0 }` is used throughout `lib/pricing.js`; NaN/undefined silently become 0 | M | H | 12 | **High** | Validate at the boundary; never coerce invalid input to zero. A silent 0 is worse than a 400 |
| A-05 | **NodeDR: a hardcoded tax rate of 0 by default** | `prisma/schema.prisma:242-248` has a seeded GST row with `isDefault: true` and `rate: 0.0` | H | M | 9 | **Medium** | No default tax. Require explicit configuration; fail loudly if tax is unset |
| A-06 | **NodeDR: no index on `Invoice.customerId` or `SaleItem.invoiceId`** | `prisma/schema.prisma:210-235` and `:250-271`; `getCustomerSales` filters on the unindexed `Invoice.customerId` | H | M | 9 | **Medium** | Index every foreign key and every column used in a `where` |
| A-07 | **NodeDR: SQLite in production with a single-writer model** | `DATABASE_URL=file:./dev.db`; "requires better-sqlite3, so it is not a true multi-process deployment" | M | M | 6 | **Medium** | SQLite is fine for a single till. For a multi-store system the server database must be a real client/server engine |
| A-08 | **NodeDR: no tests, despite clean structure** | Zero test files in `backend/` or `frontend/`; `npm test` is `echo "Error: no test specified" && exit 1` | H | H | 16 | **High** | A real test suite is a purchase criterion. OSPOS has 45+ test files and is the only repo that does |
| A-09 | **OSPOS: PHP 8.0 vs 8.2, and the CI image is a moving target** | `composer.json:37` `php ^7.3 || ^8.0`; `.github/workflows/tests.yml:20` `shivammathur/setup-php` with no `php-version` | M | M | 6 | **Medium** | Pin every tool version |
| A-10 | **NodeDR: security headers are application-level, and the edge adds none** | `nginx.conf:95-103` sets no `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, or CSP, and has no gzip block. *Corrected:* the Express app does set headers — `server.js:27` `helmet({ contentSecurityPolicy: false })` with the comment "CSP is served by the Next.js frontend". So headers are present but CSP is deliberately delegated to the frontend and nothing is set at the edge | M | M | 6 | **Medium** | Security headers at the edge, once, centrally. Split the frontend's CSP from the API's so neither has to disable it |
| A-11 | **YourGbDev: 13 Express routes out of 67 are unauthenticated** | `backend/routes/api.php` — the `add.php` inventory-management routes have no `$middleware = 'authMiddleware'` | H | H | 16 | **High** | `DO NOT USE` |
| A-12 | **YourGbDev: a self-signed HTTPS certificate committed to the repository** | `backend/cert/` contains a self-signed cert with a 2027 expiry and the private key | H | H | 16 | **High** | `DO NOT USE`. TLS terminates at a managed ingress; no private keys in source, ever |
| A-13 | **YourGbDev: no CI/CD, no tests in CI, no linting** | No workflow file; no lint config; the test suite is unreadable (counting braces) and there are **zero** assertions | M | M | 6 | **Medium** | `DO NOT USE` |
| A-14 | **YourGbDev: dev CORS and body limits in production** | `backend/server.js:19-27` `CORS_ORIGIN: '*'` and `limit: '50mb'` defaults. *Note:* the `*` here is contradicted by the middleware — `src/Middleware/Cors.php:36-37` echoes `Access-Control-Allow-Origin` only for allowlisted origins, so the permissive default is overridden downstream | H | M | 9 | **Medium** | Environment-driven, environment-validated. Body limits sized to need, not to 50 MB |
| A-15 | **RFID repository: no tests; three console apps and a WinForms app in the main tree** | `backend/console/`, `Simulator/`, `SmartStore.App/` (WinForms, net6.0-windows) are all in the same repo as the API | M | M | 6 | **Medium** | Keep hardware tooling in a separate repository |
| A-16 | **RFID repository: JavaScript variable shadowing in a money context** | `js/controllers/appController.js:57-90` — `var k, n` shadow the outer `k` (total) and `n` (items) declared at lines 7-8, so **`k` is reassigned to 0 and the total silently becomes 0** | M | H | 12 | **High** | `const`/`let`, block scope, and a linter that bans shadowing |
| A-18 | **RetailPOS: `composer.json` declares PHP 8.0 but the code uses PHP 8.1+ syntax** | `"php": "^8.0"`; `openFile()` uses `readonly` (8.1) and `never` return types (8.1) and `enum` (8.1), plus first-class callable syntax (8.1) | M | M | 6 | **Medium** | Accurate version constraints |
| A-19 | **Cross-repo: no repository has offline sync, terminals, shifts, or multi-store** | See [missing-features.md](missing-features.md) | H | H | 16 | **High** | **This is the headline architectural risk.** Roughly half the brief is greenfield in all five |
| A-20 | **Cross-repo: dependency counts indicate shallow coverage of the domain** | OSPOS 12 prod PHP deps; NodeDR 8 prod; YourGbDev 6; RetailPOS 4; RFID 0 | H | M | 9 | **Medium** | Assume every feature must be built. Budget accordingly |
| A-21 | **Cross-repo: no unified observability, logging, or alerting anywhere** | OSPOS is the only repository with a configured logger, and its threshold is **production-aware** — `app/Config/Logger.php:42` `(ENVIRONMENT === 'production') ? 4 : 9`, i.e. errors and above in production, everything in development. *Corrected:* the first draft claimed `threshold = 0` disabled logging by default; the source is the opposite. The gap is that the other four have **no** structured logging at all, and no repository has metrics, tracing, or alerting | H | M | 9 | **Medium** | Structured logs, metrics, traces, and alerting are a Day-1 requirement for a system with offline sync |
| A-22 | **OSPOS: 14-positional-parameter methods and a controller doing everything** | `Sale::save_value($store_id, $register_id, $cart, $customer_id, … 14 params)`; `Sales.php` is 1,152 lines and holds receipt, email, gift-card, customer, and loyalty logic | H | M | 9 | **Medium** | Domain services with explicit, small interfaces |
| A-23 | **Cross-repo: reproducibility and no release discipline** | NodeDR "Phase 2" docs, unversioned migrations, `version: '1.0'`, `v1` in its own docs; YourGbDev untagged; RetailPOS `v1.0` / `laravel/framework 1.x` / `fideloper/proxy 1.x`; RFID untagged | M | M | 6 | **Medium** | Semver, changelog, reproducible builds |
| A-24 | **Cross-repo: shutdown and restart behaviour is weak everywhere** | NodeDR's workers poll for a `.kill` file; OSPOS has a `doShutdown` path but no supervisor policy | M | M | 6 | **Medium** | Explicit graceful shutdown, supervisor restart policy, no `.kill`-file polling |

> **Removed from this section.** **A-17** (RFID `DbContext` registered as a singleton) — **refuted**.
> `Program.cs:16-17` calls `AddDbContext<StoreDbContext>(…)` with no lifetime override, which defaults to
> `Scoped`. The first draft's cited `Program.cs:46` comment does not exist in that file.

---

## 5. Data quality risks in this analysis

| ID | Risk | L | I | Score | Severity | Mitigation |
|---|---|---|---|---|---|---|
| Q-01 | **Repositories were cloned with `--depth 100`, so full history, branches, and all contributors are not available** | H | L | 3 | **Low** | Re-clone without `--depth` if a specific historical or provenance question arises |
| Q-02 | **Commit dates in the future relative to some mirrors suggest clock skew or a re-written history; activity claims are based on the shallow log only** | M | L | 3 | **Low** | Verify with a full clone before making any statement about contributor count or project age |
| Q-03 | **Runtime verification was incomplete — PHP and .NET SDKs were not available for all projects, so test suites and builds were read but not executed** | H | M | 9 | **Medium** | Run each suite in a container before relying on any behavioural claim. Every finding in this register is marked as static-inspection-derived where that applies |
| Q-04 | **NodeDR's activity is dominated by a single contributor** | H | M | 9 | **Medium** | Bus factor 1. Another reason not to adopt as a foundation |
| Q-05 | **Third-party vulnerability data was not fetched live; advisory counts come from `npm audit` output captured during analysis** | M | L | 3 | **Low** | Re-run `npm audit` and `composer audit` against current advisory databases at implementation time |
| Q-06 | **The first draft of this register contained findings written from recalled rather than inspected source** | H | H | 16 | **High** | **Closed by the verification pass.** Every `S-*` citation was re-opened and either reproduced, corrected, or removed. [security-verification.md](security-verification.md) records the outcome for each. The same discipline must apply to future phases: cite a file you have opened, or do not cite it |

---

## Top 10 risks by score

| # | ID | Risk | Score | Owner |
|---|---|---|---|---|
| 1 | **S-01** | RFID: anonymous stock mutation, unbounded return-driven inflation | **20 Critical** | Engineering (avoid) |
| 2 | **S-03** | RetailPOS: 53/54 routes unauthenticated, six `GET` deletions | **20 Critical** | Engineering (avoid) |
| 3 | **S-08** | YourGbDev: hardcoded credential reset shipped in the web root | **20 Critical** | Engineering (avoid) |
| 4 | **S-11** | RFID: unsalted SHA-256, no lockout, seeded `admin` / `Admin@123` | **20 Critical** | Engineering (avoid) |
| 5 | **A-19** | No offline sync, terminals, shifts, or multi-store anywhere | **16 High** | Architecture |
| 6 | **L-02** | Three repositories have no license | **16 High** | **Legal** |
| 7 | **S-12** | RFID: permissions never enforced; audit trail has no actor or IP | **16 High** | Engineering |
| 8 | **D-09** | NodeDR: no stock movement ledger at all | **16 High** | Architecture |
| 9 | **D-14** | RFID: no migrations at all | **16 High** | Engineering (avoid) |
| 10 | **D-16** | RetailPOS: no inventory, no transactions, no constraints | **16 High** | Engineering (avoid) |

> **What changed.** The first draft's Top 10 was headed by five Criticals, one of which was **S-09 — "YourGbDev:
> SQL injection throughout the service layer"**. That finding was fabricated: the codebase uses PDO prepared
> statements exclusively, with `LIMIT`/`OFFSET` among the bound parameters. Its removal, together with S-04,
> S-05, S-07, S-13, S-15, S-17, S-18, S-21, S-22, S-23, and A-17, is why there are now **four** Criticals rather
> than five, and why **A-19 (no offline sync anywhere) and L-02 (three unlicensed repositories)** have moved up
> into positions 5 and 6. The corrected ranking is more accurate about what actually threatens this project.

## Summary

**4 Critical, 23 High, 33 Medium, 4 Low** — 64 scored risks. (The first draft's headline of "5 Critical, 21 High,
12 Medium, 5 Low" was itself wrong; it counted neither the full set nor the totals correctly.)

The distribution is still the finding. Every Critical belongs to a repository already classified `DO NOT USE`,
and each is a *shipped, reachable* vulnerability rather than a theoretical concern — a credential-reset script
under the web root, an API with no authentication at all, a returns endpoint that credits unlimited stock to
anyone who asks. **The three unlicensed repositories remain not merely legally unusable but also among the least
safe codebases in the set.**

The verification pass did not soften this conclusion; it **hardened** it. Four Criticals now stand on exact line
references rather than on recollection, and the risks that survive into a build-clean plan are the same design
decisions identified before: **D-09** (a stock ledger is non-negotiable), **D-18** (idempotency is required for
offline terminals), **A-19** (half the brief is greenfield in all five), and **S-12** (an audit trail must record
who did what, from where, in the same transaction as the business write). Every one of these is a schema-level or
protocol-level choice that is expensive to reverse **after** code is written, which is why they are the first
decisions and not the last.

The only risks requiring someone outside engineering are **L-01 through L-08** — all legal. **SmartStore's
intended license must be decided first**, because it determines whether Option B is available at all. L-01 is now
a branding question rather than a reuse blocker, which is a materially easier problem than the one previously
recorded.
