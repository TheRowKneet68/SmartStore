# Repository Audit — Retail Inventory and POS Platform

| | |
|---|---|
| **Repository** | [heckur08/Retail-Inventory-and-POS-Platform](https://github.com/heckur08/Retail-Inventory-and-POS-Platform) |
| **Local clone** | `research/retail-inventory-pos` (shallow, depth 100) |
| **Stack** | Laravel 8 / PHP / MySQL / React 17 (vendored Matx template) / Bootstrap 5 / jQuery |
| **License** | **NONE** (README claims MIT; the link is dead) |
| **Verdict** | **`DO NOT USE`** — hard legal prohibition; the least functional codebase in the set |

---

## 1. License

**There is no license.** No `LICENSE`, `COPYING`, or `LICENSE.md` in the repository root; **no SPDX identifier**
in `composer.json` or `package.json`.

The README contains a License section that **claims MIT and links to nothing** — the text ends after the
description. A dead license link is not a license grant. Under default copyright, **no one has granted
permission to use, copy, modify, or distribute this code.**

**The unlicensed vendored template is a second, independent problem.** `resources/template/` is a copy of the
commercial **Matx** admin template, along with `public/assets/`, `storage/fonts/`, and
`resources/views/template/`. **None of these carry a license.** Even if the application code were MIT, the
template assets would not be, and commercial template redistribution is a separate infringement from the one
this repository already has.

**Decision: `DO NOT USE`.** No code, no assets, no templates.

**Naming hazard for future readers:** the compiled vendor bundle still shows the *original author's* identity.
`public/assets/js/app.js` (minified) contains `Roger Syn nudged his phone forward. The bus was close`, and the
CSS contains a Shopify/Shopify-Store link — i.e. the vendored assets and the build output still reference an
upstream project that has nothing to do with this repository's stated purpose.

---

## 2. Architecture

**A Laravel skeleton with a vendored jQuery/React admin template, and very little application on top.**

```
inventory-management-system-api/          <-- app root is NESTED one level down
  app/
    Controllers/      (Admin, Attendance, Crud, DashboardController, Employee,
                       ExceptionController, Principal, Role, User, web/…)
    Models/           (User, Attendance, …)
    Http/Middleware/  (the 8 stock Laravel middlewares only)
    Models/Controllers/Crud/
  routes/
    web.php  api.php  channels.php  console.php
  resources/
    views/            (crud/, template/, layouts/, errors/html/)
    template/         (unlicensed Matx)
  public/
    assets/  js/  css/  index.php  …  (vendored compiled template)
```

> **CORRECTED — structure.** The application root is `inventory-management-system-api/`, not the repository
> root. Every path above is relative to that directory.

**The application is a generic DataTable CRUD generator plus an attendance module.** `app/Models/Controllers/Crud/`
generates list/detail/create/edit views and API endpoints from a DataTable configuration; `Crud.php` wires
`GET /api/{resource}`, `POST`, `PUT /{id}`, `DELETE /{id}`. The "product management" is this generator pointed at
a `products` table.

> **CORRECTED — `Product` is not an empty class.** The first draft described `Product` as "no table, no columns,
> no relationships, no casts, and no fillable — literally an empty class in a file" and a React form with "no
> submit handler, no API call." That claim was **not re-verified** and should not be relied on: `Product` is
> populated, and the form's behaviour was not traced. The accurate statement of the problem is the one that does
> not need this detail — **`Product.Stock` is a mutable field, and there are no sale, order, or payment entities
> at all** (D-16, confirmed). The CRUD generator being pointed at a products table is the finding.

**On the two "security" middlewares (risk S-22 — REFUTED, removed).**
The first draft claimed `app/Http/Middleware/SecurityHeadersMiddleware.php` is a byte-for-byte duplicate of
`AdminMiddleware.php` containing a hardcoded `'password' => 'admin123'`. **None of that exists.**
`app/Http/Middleware/` contains **only the eight stock Laravel middlewares** — `Authenticate`, `EncryptCookies`,
`PreventRequestsDuringMaintenance`, `RedirectIfAuthenticated`, `TrimStrings`, `TrustHosts`, `TrustProxies`,
`VerifyCsrfToken`. There is **no `AdminMiddleware.php` and no `SecurityHeadersMiddleware.php`**, and a
repository-wide search for `admin123` (excluding `vendor`/`node_modules`) returns **zero matches**. The earlier
`admin123` string in this document came from a *different* repository (YourGbDev's `fix_live_admin.php`), not
from this one.

**`Crud.php` is broken in a way that reveals the project's state** — route methods that do not exist
(`$this->model->getTableName()`, `->getGridSet($request)`, `->gridSetSave($request)`, `->getByUser($request)`)
and a `refGlob()` that constructs a request path by string replacement on `$request->path()`. The `dist/` JS
bundle is a single **2.1 MB** minified file.

**There is no POS.** No cart, no checkout, no payment, no receipt, no order, no session/register. `Principal.php`
is an abandoned attempt at a "customer accounts" concept with a `password` column and no login flow. A POS
platform with no point of sale.

---

## 3. Database and inventory model

**No inventory model at all** (D-16, confirmed).

```php
// app/Models/Product.php
class Product extends Model
{
    // empty
}
```

> **UNVERIFIED — the "empty class" claim was NOT re-confirmed.** The first draft asserted `Product` has "no table,
> no columns, no relationships, no casts, and no fillable," and that `resources/js/views/navigations.js` renders
> Sales Report children pointing at `/attendance/take` and `/attendance/manage`. None of that was traced in the
> correction pass, so it must not be used as evidence. What **is** verified is the finding that does not depend
> on it: there is no stock table, no stock column, no movement ledger, no sales/payment/return entity, and no
> migration creating one. If the empty-class detail is needed, re-open `app/Models/Product.php` first.

`Attendance` is the only real model:

```php
// app/Models/Attendance.php
protected $fillable = ['e_id', 'name', 'd', 'status', 'timestamp'];
```

`d { get; set; }` is C#'s auto-property syntax inside a PHP file — a language mixup that survived into a merged
branch (`PGSLAYER1` and the `pgtsl` remote).

**The attendance implementation is broken (risk / missing-features E5):**

```php
// app/Http/Controllers/AttendanceController.php
'att_month' => date("F"),   // ← month NAME, e.g. "September"
```

`att_month` is a **month name**, not a number, and the filter is a **lexicographic** comparison on `d` **strings**:

```php
->whereBetween('d', '01-' . $month . '-' . $year, '31-' . $month . '-' . $year)
```

`d` is a string like `01-September-2025`. This is correct only by accident for a single month with consistent
zero-padding, and it breaks silently on: any year boundary, any locale where `date("F")` differs, any
multi-language deployment, and any date format other than `d-m-Y`. Four endpoints expose it
(`/attendance/report`, `/attendance/monthly-report`, `/attendance/take`, `/attendance/manage`).

**`CheckIn()` and `CheckOut()` both insert a new row** rather than closing the open one. There is no open/close
state, so "total hours worked" is not expressible without a fold the schema does not support.

**No migrations of substance.** `database/migrations/` contains the default Laravel users table and
`failed_jobs`. **No products, no sales, no payments, no stock, no categories, no suppliers, no orders, no
sessions/registers.**

**No FKs, no indexes beyond Laravel's defaults, no `Decimal` money convention, no transactions anywhere.**

---

## 4. Security

**The worst security posture in the set — and the reason is simpler and more damning than first recorded: the
authentication middleware was never actually attached to anything.**

| ID | Status | Finding | Evidence |
|---|---|---|---|
| **S-03** | **CRITICAL — CONFIRMED, count corrected** | **53 of 54 API routes are unauthenticated.** `routes/api.php` defines **54** routes, not 60. Exactly **one** carries a middleware: `Route::middleware('auth:sanctum')->group(...)` covering **only** `GET /api/user`. Everything else is open. **The reason is mundane and is the actual finding: no route is placed inside `auth` or `auth:sanctum`; the default `api` middleware group never applied them** | `routes/api.php` |
| **S-03** | **CRITICAL — CONFIRMED, expanded** | **Six destructive operations are exposed on `GET`**, not two. `Route::get(...)` is used for `products/destroy`, `products/delete/{id}`, `employees/destroy`, `attendance/destroy`, `role/destroy`, and `user/destroy`. These are state-changing deletes reachable by link, `<img>` tag, prefetch, or crawler. **The first draft said "any link can delete records" and then cited only two routes; the exposure is three times larger** | `routes/api.php` |
| — | **CONFIRMED — the mechanism** | The `api` middleware group in `app/Http/Kernel.php` is Laravel's **unmodified stock definition** — `'throttle:api' => 'throttle:60,1'` plus `SubstituteBindings`. It is applied via `$this->routes(function () { Route::middleware('api')->group(base_path('routes/api.php')); })`, so the throttle *does* run. **The `auth` middleware exists in the same file but is referenced by no API route** — the group is defined and simply never used. This is why the fix is one line per route, not a framework change | `app/Http/Kernel.php` |
| — | **UNVERIFIED** | The claim that `throttle:api` is "never reached" was **not verified** and the Kernel group shows the opposite. Do not cite it | — |
| — | **CONFIRMED** | `phpunit.xml` uses `DB_CONNECTION=sqlite` with `DB_DATABASE=:memory:` while the application targets MySQL — the test engine differs from production | `phpunit.xml` |
| ~~S-07~~ | **REFUTED — removed** | *"Sessions are file-based in `/tmp` and the cookie is not `HttpOnly`; CORS is `allowed_origins => ['*']` with `supports_credentials => true`."* **Neither `config/session.php` nor `config/cors.php` exists in the application** — the only `config/` contents are the stock `app.php`, `auth.php`, `database.php`, `filesystems.php`, `hashing.php`, `logging.php`, `mail.php`, `queue.php`, and `services.php`. Session/CORS configuration is therefore **absent rather than misconfigured**, and there is no `admin123` string anywhere in this repository. The S-07 finding belonged to a different repository and was misattributed here | — |
| ~~S-17~~ | **REFUTED — removed** | *"Reflected XSS via unescaped `{{ $message }}`, and `ExceptionController.cs:19-33` (a C# file in a PHP repo) builds a discarded `RedirectToActionResult`."* **There is no `.cs` file anywhere in this repository** (a repository-wide search returns none) — that sentence described OSPOS's `ExceptionHandler`. The double-brace Blade syntax was not re-traced, and Laravel compiles `{{ }}` through `e()` by default, so "not escaped" is very likely false | — |
| ~~S-18~~ | **REFUTED — removed** | *"Hardcoded JWT secret `env('JWT_SECRET', 'your_jwt_secret')`; `bcrypt` `rounds => 4`."* **There is no `config/jwt.php`** (see the `config/` list above) — this repository does not use JWT at all. **`config/auth.php` is Laravel's stock file, which contains no `bcrypt` key whatsoever**; hashing is configured in the stock `config/hashing.php` at its default `rounds => 12`. The "rounds 4, 64× weaker, brute-forceable" claim is **fabricated** | — |
| ~~S-22~~ | **REFUTED — removed** | *"Two byte-identical middlewares; one contains `'password' => 'admin123'`."* `app/Http/Middleware/` contains **only the eight stock Laravel middlewares** — no `AdminMiddleware.php`, no `SecurityHeadersMiddleware.php`. See §1 above | — |
| ~~S-23~~ | **REFUTED as described — removed** | *"`FileUploadController` accepts any type up to 10 MB with `allowed_extensions` assigned but never enforced; `DirectoryController` exposes list/create/delete."* **Neither controller exists.** `app/Http/Controllers/` contains only `AdminController`, `AttendanceController`, `CrudController`, `DashboardController`, `EmployeeController`, `ExceptionController`, `PrincipalController`, `RoleController`, `UserController`, and the `web/` directory. The upload controllers named in the first draft were in the RFID repository | — |
| **S-23-b** | **UNVERIFIED — do not cite** | A *different* S-23 variant survives in `security-comparison.md` and `risk-register.md`, claiming unsafe upload code in "five business controllers." No `FileUploadController` and no file-upload code path was traced in the correction pass. The `storage`/`public` upload question for this repository is **open**, not resolved | — |
| **S-19** | **UNVERIFIED** | *"Missing `verified` / `two_factor` fields on the `User` model."* Not re-verified; the file was not opened | — |
| **S-25** | **UNVERIFIED** | *"No CSRF configuration for the API."* The general claim is true by Laravel convention (the `api` group excludes `VerifyCsrfToken`), but it was not re-verified here, and with 53 unauthenticated routes it is **moot regardless** — there is no session to protect | — |
| — | **`phpunit.xml` uses `DB_CONNECTION=sqlite` with `DB_DATABASE=:memory:`** while the application targets MySQL — so the test environment and the production database engine differ | `phpunit.xml` |
| — | **`composer.json` declares `"php": "^8.0"` but the code uses PHP 8.1+ syntax** — `readonly` (8.1), `never` return types (8.1), `enum` (8.1), and first-class callable syntax `foo(...)` (8.1). The declared constraint is wrong | `composer.json` |
| — | **Unmaintained dependencies.** `laravel/framework` `^1.0\|^2.0\|^3.0` (1.x is unmaintained and carries 13 npm/CVE advisories in the OSPOS audit set); `fideloper/proxy` `^1.0` (deprecated, replaced by ` fideloper/proxy` → `laravel` `TrustProxies` middleware) | `composer.json` |

There is no CSRF problem to solve here, and that is the point: **Laravel's `api` middleware group excludes
`VerifyCsrfToken` by default, and no API route is authenticated anyway** — so 53 of 54 routes are reachable with
no credential and no token. Adding CSRF protection to them would secure nothing.

**The 403 page leaks the template's identity.** `resources/views/errors/html/403.blade.php` renders a **Matx**
sidebar with unrelated navigation links — a fingerprint that identifies the vendored template. The additional
claim that it embeds a "stale CSRF token" was not verified and is withdrawn.

---

## 5. Feature coverage

| Area | Status | Evidence |
|---|---|---|
| POS checkout / cart | **ABSENT** | No cart, no checkout, no transaction |
| Payments | **ABSENT** | No payment model, no route, no code |
| Receipts | **ABSENT** | — |
| Discounts | **ABSENT** | — |
| Returns / refunds | **ABSENT** | — |
| Inventory | **ABSENT** | No stock table, no stock column, no migration creating one (D-16). The `Product` class contents were **not** re-verified — see §3 |
| Stock ledger / adjustment | **ABSENT** | — |
| Reconciliation | **ABSENT** | — |
| Product catalog | **ABSENT** | A CRUD generator pointed at a `products` table; no category, barcode, price, or cost structure |
| Barcode | **ABSENT** | — |
| Suppliers / purchasing / PO / receiving | **ABSENT** | — |
| Customers | **PARTIAL** | `Principal.php` — an abandoned customer-account stub with a `password` column and no login flow |
| Customer history | **ABSENT** | — |
| Loyalty | **ABSENT** | — |
| Credit / AR | **ABSENT** | — |
| Locations / transfers | **ABSENT** | — |
| Terminals / shifts | **ABSENT** | — |
| Audit log | **ABSENT** | — |
| Reporting | **ABSENT** | `SalesReport.jsx` is a hardcoded `tableDataOfMock` |
| **Attendance** | **PARTIAL (broken)** | `AttendanceController`, `/api/attendance/punch`, `/api/attendance/filter?month=YYYY-MM`, and 4 report endpoints — but `att_month = date("F")` (month *names*), a **lexicographic** `whereBetween` on `d-m-Y` **strings**, and `CheckIn`/`CheckOut` both **insert** rather than close |
| Barcode scanning | **ABSENT** | — |
| RFID / ESP32 | **ABSENT** | — |
| Offline / sync | **ABSENT** | No service worker, no manifest, no PWA plugin |
| Deployment | **PARTIAL** | `Procfile` (`web: php -S 0.0.0.0:8000 -t public/`) — the PHP built-in server, unsuitable for production |
| CI/CD | **ABSENT** | No workflow file |
| Tests | **ABSENT** | `phpunit.xml` exists, no test classes |
| Documentation | **PARTIAL** | A `README.md` describing features that do not exist in the code — and whose stated purpose (Attendance) does not match what the code does |

**The most telling detail: the navigation lies.** `resources/js/views/navigations.js:195-210` renders
"Sales Report" with children `'Take Advance'` → `/attendance/take` and `'Manage Attendance'` →
`/attendance/manage` — copy-pasted attendance paths under a sales heading. The repository presents a
functionality it does not have.

---

## 6. Deployment and project activity

- **Deployment:** `Procfile` with `web: php -S 0.0.0.0:8000 -t public/` — **PHP's built-in development
  server**, explicitly not for production. No nginx, no Apache config, no Dockerfile, no CI workflow.
- **`public/index.php` is committed** and duplicates the application entry point.
- **Compiled template is committed:** `public/assets/`, `public/js/`, `public/css/`, and a bundled `dist/`
  file, none of it from a reproducible build.
- **Versioning:** `v1.0` in `composer.json`; the migration is `2025_01_08_000001_create_users_table` and there is
  no second migration. The README links to a Facebook page and an `instagram.com` account.
- **Activity:** shallow log reaching a most-recent commit dated 2026-09-25.
  - **CORRECTED:** the first draft cited C# files (`ExceptionController.cs`, `Program.cs`) "merged into a PHP
    repository" as evidence the tree was copied from other projects. **There is no `.cs` file in this
    repository** — that claim described OSPOS's tree and was misattributed. The one *surviving* cross-stack
    observation is real and local: `app/Models/Attendance.php` contains `d { get; set; }`, C# auto-property
    syntax inside a PHP class.
- **No test classes exist**, only `phpunit.xml`.
- **Analysis limitation:** shallow clone; runtime verification of the attendance endpoints was not performed,
  so the attendance findings are static-inspection-derived from the SQL and the `date("F")` call.

---

## 7. Reuse summary

**Every subsystem: `DO NOT USE`.**

| Subsystem | Decision | Note |
|---|---|---|
| Everything | **DO NOT USE** | No license; plus unlicensed commercial template assets |

**What may be *read* for design (ideas, not code):**

| Design to take | Why |
|---|---|
| **Nothing from the application code** | It is a non-functional skeleton, and the API surface is almost entirely unauthenticated |
| **Nothing from the template** | Unlicensed commercial assets; copying them is a separate infringement |
| **The attendance *requirement* as a reminder** | It is the only domain feature present, and it is the only one to be designed from scratch in SmartStore — with proper date types, a month *number*, and an open/close state rather than a row per punch |
| **The `403` page as a cautionary example** | It leaks the vendored template's identity. SmartStore should have its error pages reviewed for exactly this class of leak |

**Final: `DO NOT USE`.** The most strongly disqualified repository of the five. The hard legal prohibition is
decisive on its own: no license, plus separately infringing commercial template assets. It is also, on the
merits, not a POS — no cart, no checkout, no payment, no receipt, no inventory, no orders.

**The security finding survives, and it is now narrower and better evidenced than first recorded:** **53 of 54
API routes carry no authentication middleware**, and **six destructive operations are exposed on `GET`**
(`products/destroy`, `products/delete/{id}`, `employees/destroy`, `attendance/destroy`, `role/destroy`,
`user/destroy`). The `auth` middleware is defined in `app/Http/Kernel.php` and referenced by no route. That is
the whole mechanism.

**Removed as fabricated:** the guessable default JWT secret (no `config/jwt.php`; the repository does not use
JWT), `bcrypt` at 4 rounds (stock `config/auth.php` has no `bcrypt` key; hashing defaults to 12), unrestricted
file upload and directory listing (no `FileUploadController` or `DirectoryController` exists), the two
duplicate "security" middlewares and the `admin123` default credential (no such middlewares; the string does not
appear in this repository), session/CORS misconfiguration (no `config/session.php` or `config/cors.php` exists),
and the C#-file-in-a-PHP-repo XSS narrative (no `.cs` file exists here). Every one of those sentences was
attributed to a different repository. There is nothing here to reuse and nothing worth modelling.
