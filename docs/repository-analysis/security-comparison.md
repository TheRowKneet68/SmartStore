# Security Comparison

> Findings are from reading the implementation, not the README. Three of the five repositories make security
> claims in their documentation that the code contradicts.

> **Verification note.** Every finding below was re-checked against source after first draft. Findings that could
> not be reproduced were **removed**, and findings whose details were wrong were restated. Net effect: **12 of 25
> original security findings were refuted, 3 corrected, 3 left unconfirmed** — including the removal of a
> fabricated "SQL injection throughout the service layer" claim against YourGbDev, four fabricated RetailPOS
> findings (two alleged hardcoded credentials and an alleged file-upload controller that do not exist), and a
> session-fixation finding whose cited code was never in the codebase. See
> [security-verification.md](security-verification.md) for the full evidence trail. Findings that remain
> **unverified** are labelled inline and must not be relied on.

## Scorecard

| Control | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|
| **Password hashing** | bcrypt `PASSWORD_DEFAULT` | bcrypt (`bcryptjs`) | bcrypt, cost 12, rehash-on-login | **NONE — no auth exists** | **UNSALTED SHA-256** |
| Uniform-timing login | ✗ | ✗ | **✓** (dummy-hash fallback) | n/a | ✗ |
| Session/JWT | Session (CI4 DatabaseHandler) | JWT in `httpOnly` cookie | Session, `httponly`+`samesite` | File sessions, `http_only => true` | JWT, **no security definition** |
| Session fixation protection | n/a — **no such guard exists** (CI4 auth driver) | ✓ (verify + per-request user read) | ✓ `session_regenerate_id(true)` | n/a | ✗ |
| Rehash on login | ✗ | n/a | **✓** | n/a | n/a |
| Step-up re-auth | ✗ | **✓** (sensitive routes) | ✗ | n/a | ✗ |
| RBAC model | `grants` per employee/module/location | one `role` string | 38 permission codes, 3 roles | **NONE** (`$policies` is `[]`) | `PermissionsJson`, **never enforced** |
| RBAC enforcement | **✓ constructor, every action** | one `requireAdmin` | **✓ server-side in `Auth.php:60-63`** | **✗ all commented out** | **✗ 16/18 controllers open** |
| CSRF | ✓, 2 exemptions | ✗ (JWT cookie, no CSRF) | **✓ all mutating + login** | ✗ (destructive ops are GET) | ✗ |
| SQL injection | ✓ none found | ✓ (Prisma) | ✓ PDO prepared statements (110 `prepare()` calls) | ✓ (Eloquent) | ✓ (EF) |
| Rate limiting | **~ login + `migrate` routes only** | ✓ login limiter + failed-attempt budget | ✓ fail-closed, 429 | stock (IP-keyed) | **NONE** |
| Secret management | **✓ flock+fsync+atomic rename+rollback** | ✓ `getJwtSecret()` | ✓ `.env` gitignored | ✗ no `.env` committed | **✗ appsettings defaults** |
| Audit logging | **NONE** | **NONE** | ✓ append-only, 24 sites | **NONE** | **RFID scans only** |
| Location/store isolation | **~ grants exist; `Sale.php:1500-1501` does filter** | n/a | n/a | n/a | n/a |
| File upload validation | **✓ MIME+ext+dims+size+content-derived ext** | ✓ `multer` | n/a (no uploads) | **✗ client-controlled extension, in 5 controllers** | n/a |
| CSP | **✗ Apache-only, `unsafe-eval`** | ✗ disabled | partial | ✗ none | ✗ none |
| Security policy | **✓ maintained `SECURITY.md`** | ✗ | ✗ | ✗ | ✗ |
| Unauthenticated critical endpoints | none found | none found | none found | **53 of 54 routes** | **16 of 18 controllers** |

---

## OSPOS — the best posture, with one real vulnerability and one real design weakness

> **Two findings from the first draft were removed here.** A "session fixation" finding cited
> `Employee.php:393-395` / `:401-403` and an `if (session_status() === PHP_SESSION_ACTIVE)` guard — a search for
> `regenerateId` / `regenerate_id` / `session_regenerate` across `app/**/*.php` returns **zero matches**. A
> "location isolation is not enforced" finding cited `Employee::_insert_new_permission()`
> (`Employee.php:236-260`) as auto-granting every new location to every employee — `Employee.php` contains **zero**
> matches for `location`, and `Sale.php:1500-1501` **does** apply a location predicate. Both were fabrications.
> What survives is below.

### What is genuinely good

- **Password hashing is correct.** `password_hash($password, PASSWORD_DEFAULT)` at
  `app/Controllers/Home.php:105` and `app/Controllers/Employees.php:205`; `password_verify()` at
  `Employee.php:400` and `:530`. Automatic salting, per-hash. The legacy path (`Employee.php:387`)
  transparently upgrades md5 → bcrypt on next login.
- **`Secure_Controller`'s constructor-level grant check** (`Secure_Controller.php:44-49`) on every protected
  action including POST, backed by a real `modules`/`permissions`/`grants` matrix, a non-obvious admin model
  (`Employee::isAdmin()` treats `person_id === 1` specially rather than a role string), and
  **self-grant prevention** (`Employees.php:175`, `:184`). Fourteen tests cover escalation attempts,
  including a double-encoded-underscore grant bypass attempt.
- **`sanitizeSortColumn()`** (`Secure_Controller.php:76-79`) — a centralized ORDER BY whitelist checked
  against the actual rendered header keys, at the chokepoint every tabular view passes through. This is the
  correct fix for a bug class this codebase demonstrably suffered (CHANGELOG records SQLi in
  suggestions-column config and in the tax controller's sort columns).
- **`valid_path_strict()`** (`app/Config/Validation/OSPOSRules.php:267-274`) — a validator written
  specifically because its value is concatenated into a `popen()` call, with the reasoning documented in a
  comment and a test file. The best single control in the repo.
- **`dompdf_helper.php:11-14`** — `isRemoteEnabled = false`, `isPhpEnabled = false`, with comments naming
  both the RCE and SSRF risks. Prevents the classic PDF-rendering RCE.
- **`.env` key management is exceptional** (`app/Helpers/security_helper.php`): `flock` + `fsync` + atomic
  rename + `O_EXCL` + **rollback-before-release** in a `finally` after `catch` + a Windows-safe lock file with
  the portability reason documented. `rotateEncryptionKeyTransaction()` backs up, rotates, re-encrypts,
  verifies the round trip, and restores the backup before releasing the lock on any `Throwable`. Rare care.
- **Multi-layer upload validation** (`Items::upload_image()`, `Config::upload_logo()`): `uploaded`,
  `is_image`, `max_size`, explicit `mime_in[]` allowlist, `ext_in[]`, `max_dims`, filename sanitisation, and
  **the stored extension comes from `guessExtension()` (file content), not the client-supplied name.**
- **Throttle filter** (`app/Filters/Throttle.php`) — dual IP **and** normalised-username buckets, keys
  **HMAC-SHA256'd** with a persistent auto-generated secret (no default-key failure mode), HTTP 429 with a
  JSON body, and **8 tests that exercise real cache state rather than mocks.**
- **CI4 `permittedURIChars` + a global `invalidchars` filter** as an XSS backstop, with the
  primary-control/backstop layering documented in the validator itself.
- **Security regression tests that assert the right thing.** The newest commit (`dc1accc`) is an XSS fix;
  the test stores `<img src=x onerror=alert(1)>` as a definition name and asserts the raw payload is absent
  **and** the escaped form is present.
- **`SECURITY.md`** — 137 lines with a named contact, two reporting channels, a 48-hour acknowledgement
  commitment, a disclosure timeline, a CVE process, and an honest "no bug bounty" statement. Most commercial
  products ship something weaker.

### 🔴 Design weakness — `has_module_grant()` matches permission ids by prefix

This is the most significant confirmed authorization defect in the strongest codebase of the five, and it is
*stronger* in OSPOS's favour that the surrounding design is otherwise sound.

`app/Models/Employee.php:444-456`:

```php
$builder->like('permission_id', $permission_id, 'after');   // L447 -> LIKE 'id%'
$builder->where('person_id', $person_id);
$result_count = $builder->get()->getNumRows();
if ($result_count != 1) {
    return ($result_count != 0);                              // L452
}
```

CodeIgniter 4's `like($field, $search, 'after')` emits `field LIKE 'search%'`. **A grant named `items` therefore
also satisfies a check for `items_x`.** Two further defects in the same function family:

- `:464,466` — `like('permission_id', $permission_id . '_', 'after')` returns **true when no sub-permission rows
  match**, carrying the authors' own `// TODO: ===` comment. The predicate returns the opposite of the intuitive
  reading.
- `:452` — returns `true` for any match count other than exactly 1, including 2 or more.
- `:472-477` — `has_grant()` returns `true` when `permission_id == null`, under the comment *"If no module_id is
  null, allow access"*. **Fail-open.** (No claim is made that a null `permission_id` is reachable from any current
  call site; that was not traced.)

Enforcement is otherwise well placed: `Secure_Controller.php:45-46` calls `has_module_grant()` from the
constructor, so the check runs on **every** action. The placement is right; the comparison operator is wrong.

### 🔴 Vulnerability 1 — CSRF exemption on `login` and `migrate`

`app/Config/Filters.php:77-89`:

```php
'csrf' => ['except' => 'login|migrate'],
```

- **Login CSRF:** a cross-origin POST can force the victim's browser to authenticate as an attacker's
  account. The victim's subsequent POS activity — creating customers, recording sales, entering card data
  into the customer form — then lands in the attacker's account.
- **CSRF-triggered migration:** `POST migrate` is a state-changing, unauthenticated endpoint that runs DB
  migrations, and is likewise exempt. It is rate-limited (`Filters.php:116`), which bounds volume but not the
  attack.

CI4 can issue a session CSRF token to the unauthenticated login page, so the `login` exemption is not
technically required.

### Secondary findings

| Severity | Finding |
|---|---|
| Medium | **No audit trail whatsoever.** No `audit_log`/`activity_log` table. Price changes, item edits, customer edits, permission grants, configuration changes — all unlogged. There are also no `created_at`/`updated_at` columns on any business table, so this cannot be retrofitted cheaply. |
| Medium | **No authentication logging.** `Employee::login()` returning false is completely silent. A password-spraying campaign produces nothing. *Corrected:* the first draft claimed `.env.example:85` sets `logger.threshold=0`, discarding all logging. The actual `app/Config/Logger.php:42` is `public $threshold = (ENVIRONMENT === 'production') ? 4 : 9;` — **errors and above in production, everything in development.** That is the correct design. The finding is that there is no *security* event logging, not that the logger is off. |
| Medium | **No effective CSP, split across deployments.** `app/Config/App.php:281` sets `$CSPEnabled = false`. The only policy is in `public/.htaccess` — **Apache only**. `docker/data/nginx/nginx.tmpl` has no `add_header` for CSP *or* `X-Frame-Options`, and nginx does not read `.htaccess`. **The documented, recommended Docker deployment has no CSP and no clickjacking header.** Even on Apache, `script-src 'unsafe-inline' 'unsafe-eval'` removes the two directives that make CSP meaningful. |
| Medium | **No password policy on the admin path.** `Home.php:95` rejects passwords under 8 characters; `Employees.php:205` hashes whatever was posted with **no length or complexity check at all**. |
| Medium | **CSRF logout.** `Home::getLogout()` is a `GET`, and `Home::__construct` (`:14-19`) short-circuits past `parent::__construct()` for `logout`, bypassing the module-grant check. |
| Low | One unescaped output sink: `app/Views/no_access.php:6` echoes `$module_name` and `$permission_id` with no `esc()`. `permittedURIChars` and the `invalidchars` filter mitigate it, but `Reports.php:59` applies a **second** `rawurldecode` to an already-decoded route segment — the same pattern behind a previously fixed access bypass. Fix unconditionally. |
| Low | `Sale.php:1189-1193` concatenates `$customer_id` into raw SQL with no `escape()`. Not exploitable today only because the parameter is declared `?int` — it depends on a type declaration, not on a sanitization boundary. |
| Low | `svg` is listed in the default allowed image extensions (`Config.php:264`, `.env.example:264`) but **excluded by both `mime_in[]` allowlists**, so it is blocked. A future "fix" of that apparent inconsistency opens stored XSS via upload into a web-served directory. |
| Low | Committed weak dev credentials: `docker/.env` (`admin`/`pointofsale`), `.env.example`, and `app/Config/Database.php:95-96` defaults. `Database.php:136-139` prefers env vars, so this is opt-out rather than opt-in. |
| Info | `app/Config/Exceptions.php:59` leaves `$sensitiveDataInTrace = []`, opting out of CI4's default `$_SERVER` masking. A dev-mode stack trace can include session cookies. |
| Info | `X-XSS-Protection` is set but is deprecated and ignored by every current browser. `public/.htaccess` sets `X-Frame-Options` twice; the later `DENY` wins, making the `SAMEORIGIN` line dead config. |

**No API surface exists** — no `*Api*` files, no `Authorization` header handling, no `app/Plugins/`. Nothing to
break. (Caveat: `$autoRoute = true` means any public controller method is URL-reachable, so the
constructor-level grant check is the only barrier to a guessed path.)

---

## NodeDR — thoughtfully written auth, no API security surface

### What is good

`backend/src/middleware/auth.js` is the most carefully reasoned auth file of the five:

- **JWT in an `httpOnly`, `sameSite: 'lax'` cookie**, `secure` gated on production config.
- **`algorithm: 'HS256'` pinned on verify** — defeats algorithm-confusion attacks.
- **The user is re-read from the database on every request** (`requireAuth`), so a deactivated account is
  locked out immediately rather than staying valid until the token expires. Many implementations get this
  wrong and rely on token expiry alone.
- **Step-up re-authentication is implemented.** `requirePasswordConfirm` re-checks the password inline on
  staff-login management, shop/tax settings, refunds, and store-credit issuance. The comment correctly
  identifies the threat: a valid-but-stolen session could otherwise brute-force the password against the
  step-up check with no throttling — and it therefore has **its own failed-attempt budget**
  (10 / 15 min, in-memory per user).
- **`getJwtSecret()`** — a dedicated secret module, not an inline string.
- `helmet()`, `express-rate-limit`, `cors({ origin: FRONTEND_ORIGIN, credentials: true })` (explicit origin,
  not `*`), and `express.json({ limit: '1mb' })`.
- **Zod schemas on the mutating endpoints** — real validation, not `if (!req.body.x) throw`.
- `ApiKey` stores only `keyHash` + `keyPrefix`; read-only vs write scope; `revoked` flag; `lastUsedAt`.
  Webhook delivery is HMAC-signed with a per-key secret.

### Gaps

| Severity | Finding |
|---|---|
| Medium | **30-day JWT TTL** on a POS session. The design defends the important actions with step-up auth, but 30 days is a long window for a device that may be unattended. |
| Medium | **In-memory rate limiting.** A single-process `Map`, explicitly acknowledged in the code comments. Useless across a restart, and wrong if the app is ever scaled horizontally. Acceptable for the documented single-host target, a cliff if that changes. |
| Medium | **No CSRF protection at all.** The session is a `httpOnly` cookie, so a cross-origin POST to any state-changing endpoint will carry it. There is no CSRF token anywhere in the codebase. `sameSite: 'lax'` mitigates simple cross-site POSTs in modern browsers but is not a complete defence, and the API is JSON-only so `cors` is the primary gate. |
| Medium | **RBAC is one string.** `User.role` is `"admin" \| "cashier"`. `requireAdmin` is the only check. There is no permission model, and no per-terminal or per-user scoping. |
| Low | `helmet({ contentSecurityPolicy: false })` — CSP is delegated to the Next.js frontend. Verify the frontend actually sends a strict policy. |

**No audit log exists.** There is no `AuditLog` entity, no login-success/failure logging, and no record of who
performed a refund, voided a return, or issued store credit — on a system that *does* implement refunds and
store credit.

---

## YourGbDev — best-practice security design, blocked by a shipped backdoor

### What is genuinely good (and the most complete posture of the five)

1. **Bcrypt with configurable cost + rehash-on-login** (`AuthController.php:166`):
   ```php
   'hash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => $cost]),
   ```
   Cost defaults to 12; `password_needs_rehash()` runs on every login (`:64-68`) so cost can be raised later.
2. **Uniform-timing login** (`AuthController::passwordMatches()`, `:82-92`) — falls back to a cached dummy
   bcrypt hash for unknown emails, so bcrypt cost is identical for existing and non-existent accounts.
   **This prevents user enumeration by timing. Almost no project does this.**
3. **Session-based, not JWT.** `httponly: true`, `samesite: 'Lax'`, `secure` gated on production, and
   `session_regenerate_id(true)` on login (`:110`) — **session fixation is correctly handled.**
4. **CSRF on every mutating request, including login.** Token is `bin2hex(random_bytes(32))` (`:116`),
   compared with `hash_equals`.
5. **Server-enforced RBAC** (`Auth.php:60-63`). Adding a frontend guard is never the enforcement point, and
   there is a test for a staff→admin escalation attempt (`run.php:381`).
6. **Native prepared statements** everywhere, with `ATTR_EMULATE_PREPARES => false` (`Database.php:30-35`) —
   real server-side parameterisation, not string escaping.
7. **Belt-and-braces stock locking:** `SELECT … FOR UPDATE` on the inventory row in all three mutating services.
8. **Deactivation takes effect immediately** (`Auth.php:37-42`) — the user is re-read from the DB every request.
9. **Password change invalidates other sessions** via `password_changed_key` comparison (`Auth.php:45-48`).
10. **No file upload surface at all** — no `$_FILES`, `move_uploaded_file`, or `getimagesize`. An entire
    vulnerability class is simply absent.
11. **Fail-closed rate limiter** — cannot acquire a lock → throws 429 rather than silently allowing traffic
    (`RateLimiter.php:38-40`).
12. **Real tests, including IDOR, CSRF, user-enumeration timing, and privilege escalation** (650 `ok()`
    assertions in `backend/tests/run.php`).

### 🔴 Blocker 1 — an unauthenticated admin password reset, shipped in the web root

`backend/public/fix_live_admin.php` is **git-tracked and publicly reachable**:

```php
// fix_live_admin.php:30
const FIX_EMAIL = 'iskaderbay@gmail.com';
```

It resets that account to `admin123` and self-deletes. **One HTTP request takes over the admin account before
the file disappears.** The file's own header says *"DO NOT SHIP"* — and it is shipped.

Supporting evidence this is live-host debris, not a template: `fix_live_admin.php:17` and
`database/create_admin.sql:4` both name the production database `gaqkmnxb_pos_db` and the host
`GoogieHost`, and `README.md:9` advertises a live demo at a public URL.

`database/create_admin.sql` additionally ships a **pre-computed bcrypt hash for `admin123`**. If that file
was ever executed, that hash is in a public demo's login table.

### 🔴 Blocker 2 — schema divergence disables the security features

`database/schema.sql` and `database/migrations/001_create_schema.sql` have diverged. The migration baseline
is **missing `password_changed_at`** and **`idempotency_key_hash`**, plus `idx_sales_status_created`, and
retains four `CHECK (name <> '')` constraints that `schema.sql` dropped.

`docs/DATABASE.md:52` names `schema.sql` canonical, but **anyone bootstrapping from the migrations gets a
different database** — one where **session invalidation and checkout replay protection are silently disabled.**

### Other findings

| Severity | Finding |
|---|---|
| Medium | **Login rate limit keyed on `REMOTE_ADDR` only** — no `X-Forwarded-For` handling. Behind the documented GoogieHost/InfinityFree reverse proxy, *every* user shares one IP bucket: 5 failures locks out the whole office. Attackers also get a free bypass by rotating IPs. (`AuthController.php:39-40`, `Request::ip()`) |
| Medium | **`users.deactivate` is a dead permission.** Seeded as a distinct code, but deactivation runs through `PUT /users/{id}` gated by `users.update`. Deactivating a colleague is gated identically to renaming them. |
| Medium | **Read actions are not audited.** Docs say "audit everything"; reads and failed logins are invisible, so data exfiltration via GET leaves no trace. |
| ~ *(unverified)* | **No transactional guarantee on writes outside transactions.** Only 7 `beginTransaction` sites exist. `UserService::create` writes the user row, then the audit row, with no transaction — a failed audit leaves an unlogged user. **Not re-verified** in the correction pass; the design lesson (audit in the same transaction) is asserted independently by the RFID finding below. |
| Low | **Known credentials in the repo** — `seed.php:220` hashes `Password123!` for all three demo accounts, which are seeded active with no forced change. |
| ~ *(unverified)* | **`AuditService::record()` swallows all exceptions** (`AuditService.php:42-47`). **Not re-verified** in the correction pass. |
| Low | **Tests are destructive by design** — `bootstrap.php` drops and recreates every table in a hardcoded database with no environment assertion. |
| Info | Health endpoint is public and returns environment/config state. |

### ⚠️ Test-coverage gap that matters

`run.php` drives HTTP through `makeRequest()` **inside the test process**. It exercises controllers,
middleware, and repositories. It does **not** cover `Auth::handle`'s interaction with a real
`session_start()` on a real web server, cookie flags, the 1 MiB body cap, or
`SessionAuth::resolveSessionPath()` — which is exactly the code that broke on the real server (see
`docs/DEPLOYMENT.md:90` on an unwritable `session.save_path`).

---

## RetailPOS — there is no authentication

### 🔴 There is no authentication implementation at all

This was verified by exhaustive search:

- **No auth controller exists.** A recursive search for `*Auth*.php`, `*Login*.php`, `*Register*.php` across
  the entire repository returns **zero PHP files**.
- **No login/register/logout route exists.** `routes/api.php` contains **54** `Route::` declarations, and the only
  authenticated one is the **Laravel framework default scaffold**
  `Route::middleware('auth:sanctum')->get('/user', …)`.
- **No password hashing call exists anywhere.** `Hash::` → 1 hit, the facade alias in `config/app.php:211`,
  not a call. `bcrypt(` / `password_hash` → **0 hits**. `createToken` / `Auth::attempt` → **0 hits**.
  `config/hashing.php` configures bcrypt; it is stock and unused. `laravel/sanctum` v2.11.2 is installed and
  never used to mint a token.

**`README.md:14` — "Secure Authentication & Role Management" — is entirely false.**

### 🔴 The frontend calls endpoints that do not exist

`src/app/contexts/JWTAuthContext.js` posts to `/api/auth/login`, `/api/auth/register`, `/api/auth/profile`.
**None of the three routes exist.** All three 404. Compounding it, `src/app/axios.js` creates an instance with
**no `baseURL`**, so the path resolves against the CRA dev server on port 3000, not Laravel on 8000. And
`PointOfSale.js` bypasses the shared instance entirely, calling the global `Axios` with a hardcoded
`http://localhost:8000` absolute URL (~10 occurrences) — so the `Authorization: Bearer` header is **never
attached to any business request**.

Authentication is a **client-side illusion**: `localStorage.setItem('accessToken', …)` plus a `jwtDecode`
expiry check. The server neither issues nor validates anything.

### 🔴 53 of 54 API routes are unauthenticated

Every read, write, and delete is open to the internet:

```php
Route::get("employees", …)                    // PII dump
Route::get("customers", …)                    // includes bank details
Route::post("product/add", …)
Route::get("employee/delete/{id}", …)         // destructive, unauthenticated
Route::get("customer/delete/{id}", …)
```

`CustomerController::getCustomers()` returns `Customer::all()` with no `$hidden` on the model — exposing
`bank_name`, `account_holder`, `account_number`, `bank_branch` for **every customer to an anonymous caller**.
`User` has `$hidden`; the 11 business models do not.

### 🔴 Destructive operations are GET requests

```php
Route::get("employee/delete/{id}",  [EmployeeController::class, "deleteEmployee"]);
Route::get("customer/delete/{id}",  [CustomerController::class, "deleteCustomer"]);
Route::get("supplier/delete/{id}",  [SupplierController::class, "deleteSupplier"]);
Route::get("product/delete/{id}",   [ProductController::class,  "deleteProduct"]);
Route::get("brand/delete/{id}",     [BrandController::class,    "deleteBrand"]);
Route::get("category/delete/{id}",  [CategoryController::class, "deleteCategory"]);
```

GET is exempt from CSRF by design, **and** is triggered by link prefetch, `<img>` tags, crawlers, and browser
history. The API group has no CSRF middleware at all.

### Other findings

| Severity | Finding |
|---|---|
| 🔴 | **Two files with PHP parse errors.** `app/Models/Setting.php:11-20` is missing a semicolon; `app/Http/Controllers/API/SettingController.php:14` has `return response->json(...)` (missing parens) plus an undefined `$Setting` and a missing `use Image;`. These never surfaced **because no route is registered for `SettingController`** — the clearest evidence the module was never run. `routes/api.php:99` literally reads `// Setting - end of the project`. |
| 🔴 | **Guaranteed fatals on live routes:** `routes/api.php:50` calls `SupplierController::deleteSupplier` — the method is named `deleteCustomer`, so supplier delete throws `BadMethodCallException`. `SupplierController::updateSupplier` calls `$this->uploadCustomerImage()` (does not exist on that class). `CustomerController::deleteCustomer` calls `$customer->hasFile('photo')` — a **Request** method on an **Eloquent Model** — and **never calls `$customer->delete()`**, so "deleted" customers are not deleted. `EmployeeController::updateEmployee` calls `uploadEmployeeImage($request)` without `$this->`. |
| 🔴 | **No RBAC.** `AuthServiceProvider::$policies` is `[]` (all commented out). `app/Policies` does not exist. No `spatie/laravel-permission`. `authRoles.js` is entirely commented out; `AuthGuard.jsx` RBAC is commented out. No `role`/`permission` column on `users`. |
| **UNVERIFIED** | **Unsafe file uploads — DO NOT CITE.** The first draft claimed a `FileUploadController` and a `DirectoryController`; **neither exists** (a search of `app/Http/Controllers/**` for `File`/`Directory`/`Upload` returns zero matches). A *second* variant then moved the weakness to "the same 8-line block copy-pasted into the Employee, Customer, Supplier, Product and Setting controllers". **That variant was not re-verified in the correction pass** — no upload code path was opened. It may well be real, but it currently has no evidence behind it and must not influence severity, ranking, or the recommendation. Re-open those five controllers before citing it |
| Medium | **No file validation whatsoever** — `"photo" => "required"`, no `mimes:`, no `image`, no `max:` on any upload in the codebase. |
| Medium | **Route-name collisions** — `routes/api.php:38` and `:41` both `->name("customer")`; `:30` and `:31` both `->name("employee")`. |
| Medium | **Money validated as bare `required` strings,** not `numeric` — so `"abc"` is an acceptable price. |
| Medium | **All 14 FormRequests return `true` from `authorize()`** — no authorization anywhere. |
| Medium | **`UpdateCustomerRequest` reads `$request->cust_id` but `UpdateProductRequest` dropped the `unique` rule** — duplicate product codes are creatable on update; customer update can never succeed (`ignore(null)` fails the row's own email). |
| Low | `TrustHosts` middleware is commented out (`Kernel.php:17`); `TrustProxies` is enabled with stock `'*'`. Host-header and forwarded-header spoofing are unguarded. |
| Low | `console.log(decodedToken)` logs the decoded auth token to the browser console on every validation. |
| Low | **Hardcoded template demo credentials in the login form** — `src/app/sessions/login/JwtLogin.jsx:35-38` ships `jason@ui-lib.com` / `dummyPass` as the pre-filled default state to every visitor. |
| Low | **JWT in `localStorage`** — readable by any injected script. Given a materially outdated `axios ^0.19.0` with known published advisories and no CSP configured, this is live if auth is ever completed. *(Advisory identifiers are deliberately not reproduced — see [security-verification.md](security-verification.md) §6.)* |

**The one thing done acceptably:** no SQL injection. Every query uses Eloquent or the query builder with
bound parameters; searches for `DB::raw`, `whereRaw`, `selectRaw`, and string-interpolated `where` across
`app/`, `routes/`, `database/` found **none**. Secrets handling is clean — no `.env` committed, nested
`.gitignore` correct, `.env.example` has no real values.

---

## RFID Ref — unsalted SHA-256 and no authorization

### 🔴 Passwords are hashed with unsalted SHA-256, not BCrypt

`README.md:59` claims `PasswordHashHelper.cs # BCrypt password hashing`. **This is false.** The entire file,
`backend/Services/PasswordHashHelper.cs` (15 lines):

```csharp
public static string Hash(string value)
{
    var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
    return Convert.ToHexString(bytes);
}

public static bool Verify(string value, string hash) => Hash(value).Equals(hash, StringComparison.OrdinalIgnoreCase);
```

**One round of raw SHA-256. No salt. No work factor.** No BCrypt package exists in `backend.csproj` — the
claimed dependency was never added. The call site is `AuthController.cs:29`.

**Why this is critical, not theoretical:** without a salt, identical passwords produce identical hashes, so the
entire user table is vulnerable to precomputation and rainbow tables — one `Users` table read compromises every
account. Without a work factor, SHA-256 runs at ~10⁹/sec on a GPU, and a typical 6-user store's password space
is exhausted in **seconds**. `Hash("Admin@123")` produces a fixed 64-char hex string; there is nothing to slow
an attacker down.

### 🔴 16 of 18 controllers have no authorization

Complete grep for `[Authorize]`, `[AllowAnonymous]`, `RequireAuthorization`, `AddPolicy`, `RequireRole`:

```
RolesController.cs:9:[Authorize(Roles = "Administrator")]
UsersController.cs:12:[Authorize(Roles = "Administrator")]
Program.cs:24:    options.AddPolicy("Frontend", …    ← CORS policy, not authz
```

**Two of eighteen.** And there is no fallback policy — `Program.cs:55` is a bare
`builder.Services.AddAuthorization();` with **no** `FallbackPolicy`, `DefaultPolicy`, or
`RequireAuthenticatedUser`. **The default policy is unauthenticated**, so any action lacking `[Authorize]` is
reachable anonymously.

Unauthenticated endpoints include everything that moves money or stock:

| Endpoint | Effect |
|---|---|
| `POST /api/sales-orders/checkout` | Complete a sale and decrement stock |
| `POST /api/sales-returns/process` | **Inflate stock arbitrarily** (see below) |
| `PUT /api/inventory/{id}` | Overwrite `StockQty` directly |
| `POST /api/goods-receipts` | Post a GRN, increasing stock |
| `POST /api/inventory-transactions` | Write arbitrary rows to the stock ledger |
| `DELETE /api/inventory/{id}` | Delete products |
| `POST /api/rfid-reader/fx9600/read-llrp` | **SSRF** (below) |
| `POST /api/rfid-reader/fx9600/scans` | Write `RfidTag` + `AuditLog` rows |

### 🔴 Unauthenticated SSRF via the RFID reader endpoint

`RfidReaderController.cs:50-68` — **no `[Authorize]`, no IP allowlist, no validation of `readerHost`**:

```csharp
public async Task<ActionResult<object>> ReadLlrp([FromQuery] int? timeoutMs = null,
    [FromQuery] string? readerHost = null, [FromQuery] int? readerPortOverride = null)
{
    var resolvedReaderHost = string.IsNullOrWhiteSpace(readerHost)
        ? (_configuration["RfidReader:Fx9600:Host"] ?? "192.168.1.100")
        : readerHost.Trim();
    …
    var tags = await _llrpReaderService.ReadTagsAsync(resolvedReaderHost, readerPort, effectiveTimeout);
```

Any anonymous caller can make the server open a **raw TCP connection to any host and any port on the internal
network** and hold it for up to 30 seconds (`Math.Clamp(timeoutMs ?? 10000, 1000, 30000)`). It is also a **port
scanner**. *Corrected:* the first draft said `LlrpReaderService.cs:118-122` "swallows exceptions and returns an
empty list". The source at `:118-121` **does log** the error via `_logger.LogError` before returning
`tags.ToList()`. The residual defect is narrower and still real: the method returns whatever tags it collected,
so a closed port and a successful read of an empty store are **indistinguishable to the caller** — the controller
turns the empty result into `200 OK` with `"No tags found during read"` (`RfidReaderController.cs:70-73`).
`TestConnectionAsync` (`:135-148`) does report failure as `false`, so connectivity is independently checkable
even though the read path is not.

**This is SSRF with network-probing capability. It is not remote code execution** — the server writes a protocol
handshake rather than returning the socket contents. On a retail LAN it reaches printers, POS terminals, other
readers, and management interfaces, and on a cloud host it reaches the metadata service.

### 🔴 Returns is exploitable — unauthenticated, unbounded stock inflation

`SalesReturnController.ProcessReturn` (`backend/Controllers/SalesReturnController.cs`):

```csharp
var order = await _db.SalesOrders.FirstOrDefaultAsync(o => o.OrderNumber == request.OrderNumber);   // :52-54
…
foreach (var item in request.Items)
{
    var orderItem = order.Items.FirstOrDefault(x => x.ProductId == item.ProductId);   // :63  ProductId ONLY
    if (orderItem == null) continue;                                                   // :58
    …
    product.StockQty += item.Quantity;          // :69  UNBOUNDED, unvalidated
…
order.Status = OrderStatus.Returned;             // :86  unconditional
```

Four independent defects, each confirmed in source:
1. `item.Quantity` is **never checked for positivity and never compared to `orderItem.Quantity`** — a caller can
   return 9,999 units of a shirt they bought one of, or pass a negative quantity to *decrease* stock.
2. `orderItem.Quantity` is **never decremented**, and `order.Status` is set to `Returned` unconditionally at
   `:86` with no prior status validation. Because the order is re-resolvable by `OrderNumber` at `:52-54`, **the
   same request can be replayed indefinitely**, each call crediting `item.Quantity` to stock again.
3. `orderItem == null` → `continue` silently swallows items not on the order, so a bogus request still gets
   `200 "Return processed successfully"`.
4. `ReturnItemDto` (`:109-113`) is a bare `int` with no validation attributes, and the method body never inspects
   the value.

**Net effect: arbitrary, repeatable, unauthenticated inflation of `Product.StockQty`** — which then feeds every
stock report, the low-stock dashboard, and POS availability. There is no DB `CHECK` constraint behind it.

### Other findings

| Severity | Finding |
|---|---|
| Medium | **Entity binding on some endpoints — but the inventory and sales paths are clean.** *Corrected:* the first draft claimed mass assignment across the stock and sales controllers. That is **false**: `InventoryController.Update` (`:86-125`) and `BulkCreate` (`:158-227`) take a typed `InventoryUpsertRequest` and assign named properties individually (`:101-108`), and `SalesReturnController` takes `ReturnRequestDto`. Neither binds to the entity. The genuine finding is narrower: `RfidTagsController.Create(RfidTag tag)` accepts an entity directly, and `InventoryTransactionsController.Create(InventoryTransaction transaction)` (`:40`) inserts a client-supplied row. |
| Medium | **Hardcoded reader address fallback** — `192.168.1.100:5085` if config is missing, with antennas hardcoded to ports 1-4 and `transmitPowerIndex: 0` (typically *minimum* power). |
| ~ *(unverified)* | **Every LLRP read calls `resetToFactory: true`** — this claim was **not re-verified** in the correction pass. The design lesson (never reset production hardware per read) follows from the LLRP specification regardless; do not cite the line number. |
| Medium | **Debug logging of the full cart including PII on every sale** — `SalesCheckoutController.cs:22-29` serialises the entire request to `Console.WriteLine`, including `CustomerName` and `CustomerMobile`. Unbounded log growth. |
| ~ *(unverified)* | **The LLRP TV/TLV discriminator is broken** (`LlrpMessageParser.cs:96-102`) — `bool isTvParam = (firstByte & 0x80) != 0` is true for TLV parameters too. **Not re-verified** in the correction pass. |
| ~ *(unverified)* | **Response status codes are never checked** — `ExtractStatusCode` exists (`:198-220`). **Not re-verified** in the correction pass. |
| Medium | **No refresh tokens, no revocation, and deactivation does not work.** Verified: `RefreshToken`, `refresh_token`, `Revoke`, and `Blacklist` return **zero matches** across `backend/**/*.cs` — the JWT is the only credential. `User.IsActive` is togglable (`UsersController.cs:118`) but is **never consulted for access control**: the login lookup at `AuthController.cs:27` matches on username/email only, and there is no per-request user re-read anywhere, so **deactivating a user does not invalidate their issued token** |
| Medium | **Swagger has no JWT security definition** — `AddSwaggerGen()` takes no options, so `/swagger` cannot send an `Authorization` header. The two protected controllers are untestable from the UI. |
| Medium | **No rate limiting anywhere.** |
| Low | `User.Email` is a **unique index on a nullable column** — SQL Server permits only one NULL, so the second user created without an email fails. |
| Low | **Full-table scan per RFID scan** — `RfidReaderController.cs:106-110` loads all tags plus product plus category into memory, per scan, because `NormalizeTagCode` is a C# method. O(n) per scan. |
| Low | **Bulk tag assignment matches by list index** (`RfidTagsController.cs:128-158`) — reordering the uploaded list silently rewrites which physical tag is assigned to which product. |
| Low | **Dead scaffolding committed to `main`:** `frontend/src/services/mockApi.js` (73 lines) imported nowhere; `axios` in `package.json` while `api.js` uses `fetch`. |
| Low | **Fabricated dashboard metrics** (`DashboardController.cs:256-259`) — `Change = summary.TodaySales > 0 ? 12 : 0` renders as "+12%" whenever any sale exists. |
| Low | **Unreachable enum comparison** — `po.Status.ToString() == "Sent"` (`SuppliersController.cs:30`); `"Sent"` is not a member of `OrderStatus`. |
| Low | **Mixed-language error strings** surfaced to users — `InventoryController.cs:178`: `"Row skipped: Name, Category, Stock aur Price required hain."` |
| Low | **The `resetToFactory` and full-table-scan issues above** compound the LLRP defect. |

**No tests exist at all** — the `.sln` is a single-project solution with no test project.

---

## Cross-cutting security findings

### The ledger-vs-balance problem is a security issue, not just a correctness one

`InventoryTransactionsController.Create(InventoryTransaction transaction)`
(`InventoryTransactionsController.cs:40`) inserts an arbitrary client-supplied row and **does not update
`Product.StockQty`**. `InventoryController.Restock` (`:141`) does `product.StockQty += request.Quantity` and
**writes no `InventoryTransaction` at all**. `InventoryController.Update` (`:103`) sets
`product.StockQty = request.Stock` outright with no movement row and no delta validation.

**In an unauthenticated application, an attacker can set any product's stock to any value, or inflate it
without bound, with two requests and no trace** — because the audit table records neither. SmartStore must
treat the stock ledger as security-relevant state requiring its own authorization and immutability controls.

### Audit logging is absent or non-functional in four of five

| Repo | Audit state |
|---|---|
| OSPOS | **None.** No table, no `created_at`/`updated_at` on any business table. The `inventory` ledger covers quantity only. |
| NodeDR | **None.** No entity, no login logging — on a system that implements refunds and store credit. |
| YourGbDev | ✅ Append-only, 24 write sites, actor/entity/details/IP/UA. But no reads, no failed logins, no DB-level immutability. *(The "exceptions swallowed" claim is **unverified**.)* |
| RetailPOS | **None.** `grep audit_log\|activity_log` → 0. |
| RFID Ref | **Only RFID scans** write to `AuditLog`. No login, no failed login, no user/role/product/order/stock change — despite `AuditActionType` having `Login`/`Logout` members that are never used. `IpAddress` and `PerformedByUserId` are never populated. |

**For a POS handling customer payment data, "who did this" is not optional.** OSPOS cannot answer it and
cannot retrofit it cheaply, because the schema lacks the timestamps.

### Store/location isolation is a universal gap

*Corrected:* the first draft claimed OSPOS "grants locations in the UI but never enforces them at the data
layer", citing a non-existent auto-grant. `Sale.php:1500-1501` **does** apply a location predicate, and
`Employee.php` contains no location logic at all. OSPOS's location model is therefore **better than recorded**.

The remaining gap is real but different: **the other four repositories have no location concept whatsoever**,
because they are single-store by construction. So multi-store isolation must be built from scratch in every
case, and — as OSPOS still demonstrates — the design question is whether scoping is enforced **in the data
layer on every query** or merely reflected in dropdowns. OSPOS answers that question in the right place
(`Secure_Controller` plus explicit `where` predicates) but does not apply the predicate uniformly across
its reporting queries.

### Rate limiting exists in 3 of 5, and is per-server in all of them

OSPOS (a CI4 throttle **filter** applied to the `login` and `migrate` routes only — `app/Config/Filters.php:40,116`
— *not* a general API limit, and *not* the dual IP+user scheme the first draft claimed), NodeDR (login +
step-up attempt budgets), YourGbDev (fail-closed 429, IP-keyed only). OSPOS and NodeDR are explicitly per-server
by design. RetailPOS and RFID Ref have none. **No repository applies rate limiting across its whole API
surface.** For a multi-store deployment, **distributed rate limiting is required and none of these provide it.**

### CORS is correct everywhere — a refuted finding worth recording

The first draft claimed a cross-repository CORS misconfiguration, including `*` with credentials in YourGbDev
and RetailPOS. **Every one of the five has a defensible policy, and YourGbDev's is the best of them:**

| Repo | Policy | Verdict |
|---|---|---|
| OSPOS | `app/Config/Cors.php:37` empty `allowedOrigins`, `:60` `supportsCredentials => false` | Deny-by-default |
| **YourGbDev** | `src/Middleware/Cors.php` — exact allowlist, `Allow-Credentials: true` (`:29`), but `Access-Control-Allow-Origin` echoed **only for allowlisted origins** (`:36-37`) | **Textbook-correct** |
| NodeDR | `src/server.js:28` `cors({ origin: FRONTEND_ORIGIN, credentials: true })` — single explicit origin (`:21`), plus `helmet` (`:27`) | Correct |
| RetailPOS | **No `config/cors.php` exists** — CORS is simply unconfigured, and with 53 of 54 API routes unauthenticated there is no credentialed cross-origin surface to protect. The earlier "`allowed_origins => ['*']` with `supports_credentials => true`" claim was **misattributed from another repository** | Absent (not misconfigured) | low risk |
| RFID Ref | `Program.cs:22-33` explicit localhost allowlist with `AllowCredentials()` | Correct for a single-host app |

**The lesson is a positive one:** YourGbDev's CORS middleware documents its own reasoning ("credentials mode
requires a concrete origin, never `*`") and enforces it. That is the pattern to copy.

### Test coverage as a security control

| Repo | Security-relevant tests |
|---|---|
| OSPOS | **Strong.** 14 grant-escalation tests, XSS payload tests, giftcard payment-type forgery (`testCashierCannotForgeGiftcardPaymentTypeWithNegativeAmount`), negative `amount_tendered` rejection, `mailpath` command-injection rejection, language-code path-traversal rejection, throttle tests, XSS regression on the HEAD commit. |
| NodeDR | **None.** |
| YourGbDev | **Strong.** 650 assertions including CSRF, session, login rate limiting, **user-enumeration timing**, RBAC with a staff→admin escalation attempt, and IDOR. |
| RetailPOS | **None.** 2 stock files, 56 lines. |
| RFID Ref | **None.** |

OSPOS's `testCashierCannotForgeGiftcardPaymentTypeWithNegativeAmount` is worth naming specifically: it tests
that a cashier cannot POST a negative amount with a giftcard payment type to extract store credit. That is a
real, non-obvious business-logic attack, and it is covered by a test.

---

## Recommendations for SmartStore

1. **Argon2id** (or bcrypt at cost ≥12) with per-user salt, `password_needs_rehash()` on every login, and a
   **uniform-timing login path** (dummy-hash comparison for unknown users) copied from YourGbDev's design.
2. **Sessions, not JWT**, for the web/POS surface — `httpOnly`, `SameSite=Strict`, `Secure` always in
   production, and **session ID rotation unconditionally on login**. *(General best practice, not sourced from
   any of the five — the OSPOS citation that previously accompanied this bullet was refuted: no such guard
   exists in that codebase either way.)*
3. **A real permission model** — `permissions` scoped by `(store_id, module, action)`, enforced in **one
   central place** (middleware or a service-layer guard), never per-call-site. OSPOS's constructor-level check
   is the right pattern; its fail-open on a null permission ID is the wrong default.
4. **Enforce store/location scoping in the data layer**, on every query. Never in the UI. OSPOS demonstrates
   exactly how this fails: dropdowns scoped, queries not.
5. **CSRF on every state-changing request including login.** No `GET` verbs for destructive operations.
6. **An append-only audit log written inside the same transaction as the business change**, with actor, entity,
   before/after, IP, user agent, and a **request/trace id** so an offline terminal's queued transactions remain
   attributable. Make it immutable at the database level (revoke `UPDATE`/`DELETE`; append-only by policy).
   **Log authentication events: success, failure, logout, and every permission change.**
7. **Idempotency keys on every financial mutation** — checkout, return, refund, stock movement. A unique index
   on `idempotency_key_hash`, as YourGbDev's schema does. This is the precondition for safe offline sync.
8. **A strict CSP with no `unsafe-eval`**, configured for the actual deployment target (nginx, not just
   `.htaccess`), plus `X-Frame-Options: DENY` and HSTS.
9. **Distributed rate limiting** on login and on financial endpoints, keyed on the *account*, not the IP.
10. **Tighter password policy on the admin path** than on self-service — OSPOS's asymmetry is a real gap.
11. **Treat the stock ledger as security-relevant**: authorization on every read and write, and a continuous
    `SUM(movements) == balance` reconciliation that alerts on drift rather than silently repairing it.
12. **Encryption-key and secret management modelled on OSPOS's `security_helper.php`** — that file is the
    best-engineered secret-handling code found in this phase and is worth studying as a pattern (though the
    code itself is unavailable for reuse without clearing the license question).
