# Architecture Comparison

## Stack summary

| Layer | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|
| Language | PHP 8.2 | Node (CommonJS) | PHP 8.2 | PHP 7.3/8.0 | C# (.NET 10) |
| Framework | CodeIgniter 4.7.4 | Express 5.2 | **None** (hand-rolled) | Laravel 8.61 (**EOL**) | ASP.NET Core 10 |
| Frontend | jQuery + Bootstrap Table | Next.js 16 + React 19 + TS 6 | React 19 + Vite 8 + TS 6 | React 17 + CRA 4 + Material-UI v4 | React 18 + Vite 5 |
| Database | MySQL 5.7/8 + Query Builder | **SQLite** + Prisma 7 | MySQL 8 + **raw PDO** | MySQL + Eloquent | **SQL Server** + EF Core 10 |
| Migrations | CI4 migrations, 46 files + 30 SQL scripts | Prisma, 13 migrations | Custom runner + `schema_migrations` | Laravel, 15 files | **None** — `EnsureCreated()` + hand-rolled `ALTER TABLE` |
| API | **None** (no REST layer) | REST + Zod validation | REST + middleware | REST (Laravel) | REST + Swagger |
| Deploy | Docker ×4 + nginx + Apache | Docker + CasaOS + Debian + Windows MSIX | Manual PHP server | **None** | **None** |
| Total source | ~9.8 MB / 1,695 files | ~5.1 MB / 186 files | ~1.0 MB / 173 files | 47.7 MB (39 MB is vendored template) | ~0.4 MB (39 MB is two committed `.vsix`) |

---

## OSPOS — layered, tested, and quietly eroded

**Genuine structure.** `app/` separates `Controllers/`, `Models/`, `Views/`, `Libraries/`, `Database/`,
`Helpers/`, `Config/`, `Events/`, `Filters/`, `Commands/`. Controllers are thin; business logic lives in
models and libraries. The `Secure_Controller` base class enforces a module grant in its constructor, which
is the structurally correct place.

**The central control is right.** Every protected controller calls `parent::__construct('<module_id>')`, and
the check runs on every action including POST. This matters more than usual because
`app/Config/Routing.php:97` sets `$autoRoute = true` — any public controller method is reachable by URL
guess, and this constructor is the only thing between a guessed path and an ungranted action.

**Where it erodes.** The layering is undermined by four accumulated problems, each verified in code:

1. **Business logic leaks into views and config.** Reporting is raw `CREATE TEMPORARY TABLE … AS SELECT`
   against MySQL (`Sale.php:1040`, `Receiving.php`), which bypasses the Query Builder entirely and makes
   reports non-portable off MySQL. `app/Config/OSPOS::$settings` is a flat KV store where **every value is a
   `varchar(500)` string** — booleans and numbers are stringly-typed throughout the application.
2. **Transaction discipline is inconsistent.** `Sale::save_value()` and `Sale::delete()` are correctly
   transactional. `Items::postSaveInventory()` has **no transaction at all** (`grep transStart|transComplete
   in Items.php` → no matches), so a failure between the ledger insert and the balance write desynchronises
   them permanently. The CSV importer writes an **absolute** count into `item_quantities.quantity` and the
   *same absolute value* into `inventory.trans_inventory` as if it were a delta, so `SUM(trans_inventory)`
   stops matching the balance.
3. **Fine-grained authorization is per-call-site, not centralised.** `sales_delete`, `sales_change_price`,
   `reports_sales`, `employees`, `messages` are each checked by hand at individual call sites. Coverage
   depends on someone remembering. `Item::has_grant()` fail-opens on a null permission ID
   (`Employee.php:474-476`: *"If no module_id is null, allow access"*), and `has_module_grant()` uses a
   **prefix** LIKE match, so a grant named `items` also satisfies a check for `items_x`.
4. **Non-atomic stock writes on the receiving path.** `Receiving::save_value()` uses
   `get_item_quantity()` then `save_value()` — read-modify-write with no locking. Two concurrent receipts at
   one location can drop a delivery. The atomic upsert exists (`Item_quantity::changeQuantity`) and is used
   correctly on the sale and delete paths, but not on the path that matters most for warehouse throughput.

**Extensibility: good.** `attributes` gives a real generic extension mechanism (definitions, values, and
snapshots onto sale/receiving documents). `item_kits` gives bundles. Config is fully data-driven with ~150
keys. Localisation covers ~50 language trees. This is the most extensible codebase of the five.

**Verdict:** the best-engineered architecture here, with a correctness tail that a clean implementation
would not inherit.

---

## NodeDR — single-purpose and honestly scoped

**Deliberately minimal, and the code says so.** `backend/src/` is `server.js` + `lib/` (9 files) +
`middleware/` (2) + `routes/` (10). No services, no repositories, no ORM abstraction beyond Prisma. Routes
call Prisma directly inside `$transaction` blocks (5 of them). This is honest for a single-till kiosk —
the code's own comments repeatedly acknowledge the constraint ("single-till, physically-trusted device").

**Where the design is genuinely good.** `middleware/auth.js` is the most thoughtfully written auth file of
the five:

- JWT in an `httpOnly` cookie, `sameSite: 'lax'`, `secure` gated on production.
- **The user is re-read from the database on every request** (`requireAuth`) so a deactivated account is
  locked out immediately rather than staying valid until the token expires.
- **Step-up re-authentication.** Sensitive routes (staff logins, shop/tax settings, refunds, store credit)
  re-check the password inline via `requirePasswordConfirm` rather than relying on session length. There is
  a failed-attempt budget on that check too, because — as the comment correctly notes — a valid-but-stolen
  session could otherwise brute-force the password against it with no throttling.
- `algorithm: 'HS256'` pinned on verify, defeating algorithm-confusion attacks.

`lib/pricing.js` centralises price/tax/discount computation rather than scattering it through the checkout
controller — a good instinct that OSPOS lacks.

**Where it is too narrow for SmartStore.** The architecture has no room for the requirements:

- **No `Supplier` model, no `PurchaseOrder`, no `GoodsReceipt`.** Not "unimplemented" — *absent from the
  Prisma schema*. `prisma/schema.prisma` contains 15 models and purchasing is not among them.
- **Stock is `Product.stock Int`.** There is no movement table, so there is no way to answer "why is this
  number what it is." The schema is 240 lines and the audit trail stops at `InvoiceItem`.
- **SQLite** is a defensible choice for one till and a disqualifying one for multi-store.
- **RBAC is one string.** `User.role` is `"admin" | "cashier"`. There is no permission model to extend.
- **The `useSyncStatus` hook is a `/health` poll.** The "offline-first" description in the README is
  accurate only in the sense that there is no cloud — the till *is* the server. There is no client-side
  queue, no IndexedDB, no service worker. Grep for `serviceWorker|workbox|indexedDB|navigator.onLine` across
  the frontend: **0 matches**.

**Verdict:** the cleanest small codebase, and correctly scoped to a problem an order of magnitude simpler
than SmartStore's.

---

## YourGbDev — layered, hand-rolled, and the README overstates it

**Two real architecture claims, both verified — with two nuances.**

`backend/src/Kernel.php` genuinely orchestrates: security headers → CORS → `SessionAuth::start()` →
`Router::dispatch()` → `Csrf::handle()` → `Auth::handle()` → controller → `HttpException` handler.
`Auth.php:60-63` enforces the route permission server-side, so the frontend genuinely cannot bypass
authorization. Layering is real: controllers → services → repositories → PDO.

**The two nuances that matter:**

1. **"Middleware pipeline" is a sequential script, not a pipeline.** `Kernel.php` calls each middleware as a
   static function in fixed order. There is no queue, no priority, no per-route pipeline. Adding a route-scoped
   concern means editing `Kernel`, not adding a class.
2. **`App.php` is a service locator, not DI.** Controllers call `$this->app->productService()` lazily, and
   every controller does `?->user()` and null-checks — repeating the authentication check the middleware
   already guaranteed. Functional, but a static analyzer will not catch wiring mistakes.

**Genuinely good decisions, rarer than they should be:**

- **No framework, no Composer, no vendor directory.** Zero backend dependencies. Every line of behaviour is
  auditable. `declare(strict_types=1)` everywhere.
- **Native prepared statements.** `Database.php:30-35` sets `ATTR_EMULATE_PREPARES => false` — real
  server-side parameterisation, not string escaping pretending to be it.
- **The right database model for the stated problem.** Stock is *not* a column on `products`; it lives in a
  one-to-one `inventory(product_id, quantity)` table, and **all four** stock-mutating call sites pair
  `updateQuantity()` with `insertMovement()` inside one transaction:
  ```
  InventoryService.php:65-66        (adjustment)
  PurchaseOrderService.php:131-132  (receipt)
  SalesService.php:141-142          (checkout)
  SalesService.php:233-234          (void / restock)
  ```
  `CHECK (quantity >= 0)` on inventory. `SELECT … FOR UPDATE` on the stock row in all three services.
  This is the **only** repository of the five whose stock model is internally consistent by construction.

**The failure that voids all of it:** `backend/public/fix_live_admin.php` is git-tracked and publicly
reachable. It hardcodes `const FIX_EMAIL = 'iskaderbay@gmail.com';`, resets that account to `admin123`, and
self-deletes. Its own header says *"DO NOT SHIP"* — and it is shipped. `README.md:9` advertises a live demo.
One HTTP request is full admin compromise.

**Also disqualifying:** `schema.sql` and `migrations/001_create_schema.sql` have diverged — the migration
baseline is missing `password_changed_at` and `idempotency_key_hash`, which are precisely the columns that
make session invalidation and checkout replay protection work.

**Verdict:** the best *inventory data model* of the five, wrapped in an unlicensable repository with a
shipped backdoor and a schema-drift blocker.

---

## RetailPOS — a Laravel skeleton with bolted-on controllers

**This is not a layered application.** Verified by directory existence: `app/Policies` ✗, `app/Services` ✗,
`app/Resources` ✗, `app/Repositories` ✗, `app/Jobs` ✗, `app/Events` ✗, `app/Observers` ✗. Only `app/Exceptions`
exists (stock).

The skeleton is a genuine, unmodified `laravel/laravel` v8 install — `composer.json` still says
`name: laravel/laravel`, `description: "The Laravel Framework."`, `keywords: ["framework","laravel"]`.
Everything the author added lives in `app/Http/Controllers/API/` (**11 controllers, 766 lines**),
`app/Models/` (12 models, 222 lines), and 11 new migrations.

**Every controller is the same eight lines:**

```php
// validate → new Model() → assign ~10 properties → ->save() → response()->json()
```

Five near-identical copies of the same `uploadXImage()` block differ only in a directory string. Method names
prove copy-paste rather than design: `SupplierController::deleteCustomer`, `SupplierController::updateSupplier`
calling `$this->uploadCustomerImage(...)`, `EmployeeController::updateEmployee` calling `uploadEmployeeImage($request)`
without `$this->`.

**Zero Eloquent relationships** are defined on any of the 12 models. Models are `$fillable` and nothing else —
no casts, no accessors, no scopes, no `$table`, no observers. Five controllers bypass Eloquent entirely via
raw `DB::table()`.

**The README is materially false about the stack.** It claims *"Frontend: Blade, JavaScript, jQuery,
Bootstrap"*. Reality: `resources/views/` contains **exactly one file** (`welcome.blade.php`, the stock page);
`routes/web.php` is 18 lines returning it. There is no jQuery and no Bootstrap anywhere. The real frontend is
a separate React 17 SPA built on the vendored Matx template — 169 files, 16,260 lines, the great majority
untouched template chrome.

**Verdict:** not a foundation under any circumstances. It is also not a useful reference, because there is
nothing in the design to reference.

---

## RFID Ref — thin controllers over a real protocol implementation

**18 controllers, 1,941 lines, 3,715 lines of backend C# total.** The frontend (179 KB of JSX in 10 files) is
larger than the backend.

**`StoreDbContext` is used directly from all 18 controllers.** There is no service layer, no repository, no
unit-of-work. The only two registered abstractions in the entire application are `JwtTokenService` and
`ILlrpReaderService` (`Program.cs:19-20`), and the first is only consumed by `AuthController`.

**Business rules live in HTTP handlers.** `SalesCheckoutController.Checkout` is 140 lines of pricing, discount,
tax, stock-decrement and ledger logic inside an MVC action (`SalesCheckoutController.cs:19-160`). The same
for `SalesReturnController.ProcessReturn` (lines 45-93) and `GoodsReceiptsController.Create` (lines 36-100).
None of it is unit-testable, reusable, or reachable outside HTTP.

**Mass-assignment throughout.** `_db.Entry(x).State = EntityState.Modified` binds whole entity graphs from
request bodies, bypassing the DTO layer (`ProductsController.cs:60-61`, `SuppliersController.cs:74-75`). Six
endpoints bind raw entities with no DTO at all: `ProductsController.Create(Product product)`,
`CustomersController.Create(Customer customer)`, `RfidTagsController.Create(RfidTag tag)`, and three more.
`RfidTagsController.Create` is the worst — a client can POST a raw `RfidTag` including `ProductId`,
`IsAssigned`, `IsActive`, `LastSeenAt` with zero validation.

**The migration story is a hard blocker.** **Zero EF Core migrations.** Schema comes from
`db.Database.EnsureCreated()` (`Program.cs:73`), which only works when the database does not yet exist.
Subsequent drift is patched by raw ADO.NET at startup (`Program.cs:76-91`) wrapped in a `try/catch` that
prints `"Schema update skipped/failed"` and continues:

```csharp
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[Roles]') AND name = 'PermissionsJson')
BEGIN ALTER TABLE [Roles] ADD [PermissionsJson] NVARCHAR(MAX) NULL; END
```

That patches exactly one column and will silently fail on any other drift. **A schema change has no defined
rollback path.** The README's instruction to run `dotnet ef database update` does nothing useful with no
migrations.

**The RFID layer is the one genuinely competent subsystem** — see [repository-rfid-store.md](repository-rfid-store.md)
for the full analysis. It is real LLRP (835 lines: 10-byte header framing, TLV parameters, ROSpec building,
tag-report parsing for EPC-96/RSSI/timestamps), a real TCP socket to a Zebra FX9600 on port 5085, correct
partial-read handling, and a write-lock semaphore. It is also almost entirely unusable as shipped, for the
reasons in [security-comparison.md](security-comparison.md).

**Code smells, with evidence:** full-table-scan-then-filter for tag lookup (`RfidReaderController.cs:106-110`
loads all tags plus product plus category into memory, per scan, because `NormalizeTagCode` is a C# method);
debug `Console.WriteLine` of the entire cart including customer name and mobile on **every sale**
(`SalesCheckoutController.cs:22-29`); fabricated dashboard metrics (`DashboardController.cs:256-259` — `Change
= summary.TodaySales > 0 ? 12 : 0` renders as "+12%" whenever any sale exists); an unreachable enum
comparison against `"Sent"`, which is not a member of `OrderStatus` (`SuppliersController.cs:30`); a leftover
`namespace RfidTracker.Infrastructure.Llrp;` in a project called `backend`; and Hindi/English error strings
surfaced to users (`InventoryController.cs:178`).

**Verdict:** one competent subsystem (LLRP) inside an application with no layering, no migrations, and no
authorization.

---

## Architecture verdict

| Criterion | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|
| Layering | **Good** | Fair (scoped correctly) | Fair (hand-rolled, service locator) | **None** | **None** |
| Transaction discipline | **Mixed** (correct on sales, absent on adjustments) | Good on 5 paths | **Good** (all 4 stock paths) | None | None |
| Extensibility | **Good** (attributes, kits, config, i18n) | Low | Low | None | Low |
| Schema evolvability | **Good** (46 migrations) | **Good** (13 Prisma migrations) | **Broken** (divergent baselines) | Fair | **None** |
| API surface | None | Good | Good | Fair | Fair |
| Suitability as a base | Good design, wrong scope | Wrong scope | **Unlicensable** | **Unusable** | **Unlicensable** |

**No repository's architecture should be inherited wholesale.** OSPOS is the only one whose *design* is worth
studying; its scope is single-store and its correctness tail would not be inherited by accident. NodeDR and
YourGbDev are competently built for problems an order of magnitude smaller than SmartStore's. The other two
are not viable.
