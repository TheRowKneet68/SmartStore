# Security Verification Log

**Purpose:** Phase 0 produced a security analysis whose findings were written from recalled structure rather than
from the source. A verification pass re-opened every cited file. This log records what survived, what did not, and
what was never checked. It exists because the conclusions were AI-assisted and readers need to know which are
evidence-backed.

**Verified on:** full re-inspection of the five clones in `research/`.
**Method:** for each finding, open the cited file, confirm the file exists, confirm the cited code exists at
approximately the cited line, confirm the claim matches the code, and confirm the exploit path is technically
plausible.
**Rule applied:** any citation that could not be reproduced from source was downgraded to UNCONFIRMED or removed.

**Status vocabulary**

| Status | Meaning |
|---|---|
| **CONFIRMED** | Cited code exists, claim matches the code, exploit path is plausible |
| **CORRECTED** | Core finding real, but material details were wrong; restated from source |
| **REFUTED** | No supporting code exists; finding removed entirely |
| **UNCONFIRMED** | Not checked; may not be used as an established vulnerability |

---

## 1. Result summary

| Status | Count | IDs |
|---|---|---|
| CONFIRMED (unchanged) | 7 | S-01, S-02, S-03, S-06, S-08, S-11, S-12 |
| CONFIRMED with material corrections | 1 | S-20 |
| CORRECTED (Medium) | 2 | S-16, S-24 |
| REFUTED | 11 | S-04, S-05, S-07, S-09, S-13, S-15, S-17, S-18, S-21, S-22, S-23 |
| UNCONFIRMED | 3 | S-10, S-19, S-25 |
| REFUTED (late, on a second pass) | 1 | S-14 |
| REFUTED (architecture) | 1 | A-17 |

**Of the 12 findings previously graded Critical or High, 4 survived intact, 3 survived with correction, and 5
were removed as unsupported.** S-14 is listed as REFUTED rather than UNCONFIRMED because a second pass opened
`backend/Llrp/LlrpClient.cs` directly and found the cited `resetToFactory` behaviour absent.

**S-20 status note.** S-20 is counted separately from CONFIRMED because its *characterisation* was substantially
wrong: the hardcoded-JWT, substring-RBAC and missing-`isActive` claims are refuted, and only the 30-day TTL and
opt-in `Secure` cookie flag survive. It is reported as a **confirmed High with corrected characterisation**, and
`risk-register.md` records it as `CORRECTED` for the same reason. This table is the authority on status.

---

## 2. CONFIRMED — findings that survived

### S-01 — Critical — RFID anonymous stock mutation and return inflation

**Original claim:** "`StockController` (`/api/stock/{id}`, PUT/DELETE) and `ReturnsController` (`/api/returns`,
POST) have no `[Authorize]`, no null check, and no ownership check. `Quantity > 0` is enforced, but quantity has
no upper bound."

**Verification result: CONFIRMED, and worse than originally stated.**

| Element | Original | Verified |
|---|---|---|
| Mutating controller | `StockController` | **`InventoryController`** |
| Mutating route | `/api/stock/{id}` | **`/api/inventory/{id}`** |
| Returns controller | `ReturnsController` | **`SalesReturnController`** |
| Returns route | `/api/returns` | **`/api/sales-returns/process`** |
| `Quantity > 0` enforced | claimed | **not enforced on either path** |

**Evidence.** Class-level attributes only — no `[Authorize]`:

- `backend/Controllers/InventoryController.cs:9-11` — `[ApiController]`, `[Route("api/inventory")]`
- `backend/Controllers/SalesReturnController.cs:9-11` — `[ApiController]`, `[Route("api/sales-returns")]`
- Repo-wide `[Authorize]` search across `Controllers/*.cs` returns **2 hits only**: `RolesController.cs:9` and
  `UsersController.cs:12`. **16 of 18 controllers are unprotected.**

**Exploit path A — arbitrary stock set (no validation at all).**

```
PUT /api/inventory/103
{"name":"X","stock":999999}
```
→ `InventoryController.cs:103` `product.StockQty = request.Stock;`

`Update` (lines 86-125) performs **no** range check on `request.Stock`; a negative value is accepted. Lines
101-108 assign eight fields straight from the request. `Restock` (127-156) is the only method with a check
(`request.Quantity <= 0` at line 130) and it is additive: `product.StockQty += request.Quantity;` (line 141).
`Delete` (229-237) and `BulkCreate` (158-227) are likewise unauthenticated.

**Exploit path B — unbounded, repeatable return-driven inflation.**

```
POST /api/sales-returns/process
{"orderNumber":"<any>","items":[{"productId":7,"quantity":5000}]}
```
→ `SalesReturnController.cs:69` `product.StockQty += item.Quantity; // Return to stock`

Four independent defects, each confirmed in source:

1. **No positivity check** on `item.Quantity` (`ReturnItemDto`, lines 109-113, is a bare `int`; the method body
   never inspects it). A negative quantity *decreases* stock.
2. **No cap against quantity sold.** Line 63 matches the order line by `ProductId` only
   (`order.Items.FirstOrDefault(x => x.ProductId == item.ProductId)`) and never compares
   `item.Quantity` to `orderItem.Quantity`.
3. **No status validation.** Lines 52-54 resolve the order by `request.OrderNumber` with no status predicate.
   Line 86 then sets `order.Status = OrderStatus.Returned;` unconditionally.
4. **Replayable.** Because (3) permits re-resolving a `Returned` order, the identical request can be resent
   indefinitely, each call crediting `item.Quantity` to stock again.

**Corrected finding:** unauthenticated callers can set stock to any value and can inflate stock without bound by
replaying a return request. `product.StockQty` has no accompanying `CHECK` constraint.

---

### S-02 — High — RFID SSRF via reader host/port

**Original claim:** "`RfidReaderController.Update` and `.Read` take an `ip` query parameter and pass it to
`LlrpClient.ConnectAsync`."

**Verification result: CONFIRMED.** Method and parameter names were wrong; the mechanism is real.

**Evidence.** `backend/Controllers/RfidReaderController.cs:50-51`

```csharp
[HttpPost("read-llrp")]
public async Task<ActionResult<object>> ReadLlrp(
    [FromQuery] int? timeoutMs = null,
    [FromQuery] string? readerHost = null,
    [FromQuery] int? readerPortOverride = null)
```

Line 53-55 resolves the host, **preferring the caller's value over configuration**:

```csharp
var resolvedReaderHost = string.IsNullOrWhiteSpace(readerHost)
    ? (_configuration["RfidReader:Fx9600:Host"] ?? "192.168.1.100")
    : readerHost.Trim();
```

Line 57 takes the port from `readerPortOverride`; lines 59-62 fall back to config then `5085`; line 64 clamps
`timeoutMs` to 1000-30000. Line 68 passes both into
`_llrpReaderService.ReadTagsAsync(resolvedReaderHost, readerPort, effectiveTimeout)`, which reaches
`ConnectAsync` (`Services/LlrpReaderService.cs:30`).

**Exploit path.**

```
POST /api/rfid-reader/fx9600/read-llrp?readerHost=169.254.169.254&readerPort=80&timeoutMs=30000
```

The endpoint is unauthenticated (S-01 posture). There is no allowlist, no CIDR check, no resolution-time
validation, and the port is a free integer.

**Risk as stated precisely — not exaggerated:** the server opens a **TCP connection to an attacker-chosen host
and port** and reports the outcome. This yields (a) internal network reachability probing and port
enumeration, with the 30s timeout usable as a timing side channel, (b) access to internal services reachable
only from the API host, and (c) cloud-metadata access where the deployment environment exposes it. The LLRP
client then writes and reads a protocol handshake on that socket, so responses are shaped by the LLRP parser
rather than returned raw. **This is SSRF with network-probing capability. It is not arbitrary remote code
execution and is not described as such.**

---

### S-03 — Critical — RetailPOS API almost entirely unauthenticated

**Original claim:** "59 of 60 API routes are unauthenticated... exactly one is authenticated — `attendance/report`,
via `admin.auth`."

**Verification result: CONFIRMED in substance; the counts and the route identity were wrong.**

**Evidence.** `inventory-management-system-api/routes/api.php` — 120 lines, **54 `Route::` declarations**.

Middleware references in the entire file — **2 hits**, both comments or boilerplate:

- L23 — `| is assigned the "api" middleware group. Enjoy building your API!` (header comment)
- L118 — `Route::middleware('auth:sanctum')->get('/user', function (Request $request) {`

**53 of 54 API routes carry no authentication middleware.** The single authenticated route is
`GET /api/user` — the **Laravel framework default scaffold**, not an application route, and it is
`auth:sanctum`, not admin authentication.

**Destructive operations exposed on GET — six, not two.** All unauthenticated:

| Line | Route | Action |
|---|---|---|
| 33 | `Route::get("employee/delete/{id}", … deleteEmployee)` | `EmployeeController::deleteEmployee` |
| 42 | `Route::get("customer/delete/{id}", … deleteCustomer)` | `CustomerController::deleteCustomer` |
| 50 | `Route::get("supplier/delete/{id}", … deleteSupplier)` | `SupplierController::deleteSupplier` |
| 66 | `Route::get("category/delete/{id}", … deleteCategory)` | `CategoryController::deleteCategory` |
| 72 | `Route::get("brand/delete/{id}", … deleteBrand)` | `BrandController::deleteBrand` |
| 81 | `Route::get("product/delete/{id}", … deleteProduct)` | `ProductController::deleteProduct` |

**Exploit path.** A `GET` request is safe to issue from any hyperlink, prefetcher, or crawler. A single
`<img src="https://host/api/product/delete/7">` on a third-party page deletes a product, unauthenticated. There
is no CSRF requirement to defeat because there is no authentication at all.

**Related correction — the previously cited `attendance/destroy` route does not exist.** The only attendance
routes are `attendances` (L95) and `attendance/edit/{date}` (L96). The claimed C# property syntax
(`d { get; set; }`) **appears nowhere** in the repository — see S-17.

---

### S-06 — High — OSPOS permission prefix matching and fail-open

**Original claim:** "fail-open on a null permission ID, plus a prefix `LIKE` match. `has_module_grant()` does
`LIKE \"$id%\"`, so a grant named `items` also satisfies `items_x`. A commented *'If no module_id is null, allow
access'*."

**Verification result: CONFIRMED in full**, including the comment text.

**Evidence.** `app/Models/Employee.php`

**Prefix matching** — `has_module_grant()`, lines 444-456:

```php
public function has_module_grant(string $permission_id, int $person_id): bool
{
    $builder = $this->db->table('grants');
    $builder->like('permission_id', $permission_id, 'after');   // L447
    $builder->where('person_id', $person_id);
    $result_count = $builder->get()->getNumRows();
    if ($result_count != 1) {
        return ($result_count != 0);                             // L452
    }
    return $this->has_subpermissions($permission_id);
}
```

CodeIgniter 4 `like($field, $search, 'after')` emits `field LIKE 'search%'`, so a grant on `items` also
satisfies a check for `items_x`. Line 452 additionally returns `true` whenever the match count is anything other
than exactly 1 — including 2 or more.

**Sub-permission logic, with the authors' own uncertainty** — lines 461-467:

```php
$builder->like('permission_id', $permission_id . '_', 'after');   // L464
return ($builder->get()->getNumRows() == 0);    // TODO: ===     // L466
```

The `// TODO: ===` comment is present in source. The predicate returns `true` when **no** sub-permission rows
exist, which is not obviously the intended reading.

**Fail-open on null** — `has_grant()`, lines 472-477:

```php
public function has_grant(?string $permission_id, ?int $person_id): bool
{
    // If no module_id is null, allow access        // L474
    if ($permission_id == null) {
        return true;                                // L476
    }
```

The comment is verbatim as originally quoted.

**Enforcement point confirmed.** `app/Controllers/Secure_Controller.php:45-46` calls
`has_module_grant()` from the controller constructor, so the check runs on every action.

**No claim is made here beyond the source above** — in particular, no assertion is made that a null
`permission_id` is reachable from any current call site, because that was not traced.

---

### S-08 — Critical — YourGbDev hardcoded credential reset in the web root

**Original claim:** "`backend/public/fix_live_admin.php` is web-reachable, and its purpose is to reset any user's
password to `admin123` and their role to `Admin`. It is also registered in `config/routes.php`."

**Verification result: CONFIRMED that the file exists and resets a password to `admin123`; the "any user" and
"role to Admin" claims are REFUTED, and the `config/routes.php` claim is REFUTED.**

**Evidence.** `backend/public/fix_live_admin.php` (109 lines), in the web root.

| Original claim | Verified |
|---|---|
| Resets **any** user's password | **One hardcoded account only** — `const FIX_EMAIL = 'iskaderbay@gmail.com';` (L30) |
| Resets to `admin123` | **CONFIRMED** — `const FIX_PASSWORD = 'admin123';` (L31) |
| Also sets role to `Admin` | **REFUTED** — no role column is written; the UPDATE (L62-64) sets only `password_hash`, `must_change_password = 0`, `password_changed_at` |
| Also in `config/routes.php` | **REFUTED** — no `config/` directory exists in `backend/`; the docblock (L21-22) refers to a `/fix-live-admin` rule in `public/.htaccess` |

**Properties that were overstated as weaknesses but are in fact sound — now verified:**

| Property | Evidence | Assessment |
|---|---|---|
| Parameterised queries | `$db->prepare(...)` at L44, 62, 67, 74; named placeholders `:email`, `:hash`, `:id` | Sound — **not** an injection vector |
| Password hashing | `password_hash(FIX_PASSWORD, PASSWORD_BCRYPT, ['cost' => $config->int('BCRYPT_COST', 12)])` (L53-55) | bcrypt, cost 12 |
| Post-write verification | Re-reads and `password_verify()` (L67-71); aborts and does not self-delete on failure (L90-93) | Sound |
| Audit entry | `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent)` (L74-84) with `REMOTE_ADDR` and `HTTP_USER_AGENT` | Present and attributed |
| Self-delete | `@unlink(__FILE__)` (L100), verified at L101-105 | Only **after** success |

**Deployment-window risk — the actual severity driver.** The script's own docblock (L5-23) states
*"TEMPORARY one-off password fix script - DO NOT SHIP"* and names the live production database
(`gaqkmnxb_pos_db`). Because it resides in `public/`, it is reachable at
`https://<host>/backend/public/fix_live_admin.php` on **any deployment of this tree**. Self-deletion occurs
**only after** a successful reset, so the exposure window runs from deploy until the first request — and the
first request is attacker-controlled. No authentication guards the file.

---

### S-11 — Critical — RFID unsalted SHA-256 and seeded default credentials

**Original claim:** "Passwords are unsalted SHA-256... no failed-login lockout... `StockController.Update` and
`SalesController` bind directly to entities."

**Verification result: hashing CONFIRMED; mass assignment REFUTED and removed.**

**Evidence — hashing.** `backend/Services/PasswordHashHelper.cs` (15 lines, entire file):

```csharp
public static string Hash(string value)
{
    var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));   // L10
    return Convert.ToHexString(bytes);
}
public static bool Verify(string value, string hash) => Hash(value).Equals(hash, StringComparison.OrdinalIgnoreCase);  // L14
```

Single-pass, unsalted, no work factor, hex-encoded. `grep` for `SHA256|SHA512|MD5|BCrypt|Argon|PBKDF` across
`backend/**/*.cs` returns only this line and `JwtTokenService.cs:29` (HMAC-SHA256 for signing, which is correct
in that context).

**Evidence — no lockout.** `backend/Controllers/AuthController.cs:22-32`. `Login` looks the user up (L25-27) and
verifies (L29); on failure it returns `Unauthorized` immediately (L31). There is no attempt counter, delay, or
lockout anywhere in the controller.

**Evidence — seeded default credentials (new finding, not in the original claim).**
`backend/Data/StoreSeedData.cs:30,33`:

```csharp
Username = "admin",
PasswordHash = PasswordHashHelper.Hash("Admin@123"),
```

Combined with the unsalted hash and the absent lockout, this is directly exploitable on any deployment where
seeding ran and the account was not changed.

**REFUTED — mass assignment.** `InventoryController.Update` (86-125) and `BulkCreate` (158-227) take a typed
DTO (`InventoryUpsertRequest`) and assign named properties individually (L101-108); they do **not** bind
straight to the entity. The same applies to `SalesReturnController`, which takes `ReturnRequestDto`. The
mass-assignment and prototype-pollution claims are withdrawn in full — see S-15.

---

### S-12 — High — RFID permission model defined but never enforced; audit log incomplete

**Original claim:** "Written **only** by RFID scans. `IpAddress` and `PerformedByUserId` are **never
populated**... `AuditActionType.Login` and `.Logout` are **declared but never used**."

**Verification result: CONFIRMED in every particular.**

**Evidence — `PermissionsJson` references, complete enumeration of all 7 occurrences repo-wide:**

| File:line | Use |
|---|---|
| `Program.cs:75` | Comment: "Manual Schema Patch for PermissionsJson" |
| `Program.cs:82` | T-SQL `IF NOT EXISTS ... name = 'PermissionsJson'` |
| `Program.cs:84` | `ALTER TABLE [Roles] ADD [PermissionsJson] NVARCHAR(MAX) NULL;` |
| `AuthController.cs:49` | `Permissions = user.Role?.PermissionsJson` — **returned to the client** |
| `RolesController.cs:27` | Included in the role list response |
| `RolesController.cs:51` | `existing.PermissionsJson = role.PermissionsJson;` — admin write |
| `Data/StoreSeedData.cs:17` | Seeded JSON array |

**No occurrence consults the value to make an authorization decision.** The permission blob is created, stored,
editable through a CRUD endpoint, and returned at login — and never enforced.

**The actual authorization implementation, and nothing beyond it.** Repo-wide `[Authorize]` search across
`Controllers/*.cs` returns exactly two:

- `RolesController.cs:9` — `[Authorize(Roles = "Administrator")]`
- `UsersController.cs:12` — `[Authorize(Roles = "Administrator")]`

Both are a hardcoded ASP.NET role string, evaluated against `ClaimTypes.Role`, which
`Services/JwtTokenService.cs:25` populates from `user.Role?.Name` (database-backed). There is **no fallback
policy** — `Program.cs:55` is a bare `builder.Services.AddAuthorization();` with no `FallbackPolicy`. Therefore
**16 of 18 controllers are reachable with no authentication at all.** No missing authorization behaviour is
inferred or invented beyond this.

**Evidence — audit write locations.** `grep` for `AuditLogs.Add` across `Controllers/*.cs` and `Services/*.cs`
returns exactly two, both in `RfidReaderController.cs` (`:117`, `:165`). No financial, authentication, or
permission change is audited.

**Evidence — audit fields defined but not populated.** `Domain/Entities/AuditLog.cs:13`
`public int? PerformedByUserId` and `:16` `public string? IpAddress`. A repo-wide search for these two
identifiers across `Controllers/`, `Services/`, and `Domain/Entities/` returns **only the two property
declarations** — they are never assigned.

**Evidence — unused enum members.** `Domain/Enums/AuditActionType.cs` declares `Login = 3` and `Logout = 4`;
neither is referenced anywhere.

---

### S-20 — High — NodeDR 30-day session token

**Original claim:** "`getUserRole` is a single case-insensitive substring match... roles are hardcoded in JS with
no database source... `JWT_EXPIRES_IN: '30d'`; `verifyToken` does not re-check `isActive`."

**Verification result: the 30-day TTL is CONFIRMED; all three RBAC characterizations are REFUTED.**

**Evidence.** `backend/src/middleware/auth.js:14` — `const TOKEN_TTL = '30d';`, used at `:20`
(`expiresIn: TOKEN_TTL`) and `:15` (`TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000`), applied to the session
cookie at `:29`.

**The TTL is a documented, deliberate trade-off**, not an oversight — `auth.js:8-13`:

> `// This is a single-till, physically-trusted device (see README) — once`
> `// signed in, a shopkeeper shouldn't have to re-enter their password every`
> `// shift just because 12 hours passed. A long-lived session here is the`
> `// "same device" side of that; verifyPassword() below is the "except for`
> `// important actions" side — sensitive routes re-check the password inline`
> `// rather than relying on session length for protection.`

**REFUTED — role is not hardcoded.** `getUserRole` **does not exist** anywhere in the repository. The role is
read from the database: `auth.js:52` `const user = await prisma.user.findUnique({ where: { id: payload.sub } });`
and assigned at `:58` `req.user = { …, role: user.role };`.

**CONFIRMED as a strength — immediate deactivation.** `auth.js:52-56` re-reads the user on every authenticated
request and rejects when `!user || !user.active`, clearing the cookie. The comment at `:38-40` states the intent.

**REFUTED — `verifyToken` does not exist.** The nearest construct is `readSession` (`:66`), which deliberately
does not hit the database; its comment (`:62-65`) documents that it serves endpoints callable by both
authenticated and anonymous callers. This is a stated design boundary, not an oversight, and no claim is made
that it is unsafe.

**Residual, verified:** `auth.js:28` `secure: process.env.COOKIE_SECURE === 'true'` — the cookie is not marked
`Secure` unless the environment variable is set. `httpOnly: true` (`:26`) and `sameSite: 'lax'` (`:27`) are set.

**Restated finding:** long-lived (30-day) session token on a bearer credential whose confidentiality depends
entirely on the cookie's transport flags; `Secure` is opt-in via environment variable.

---

## 3. CORRECTED — findings real, details materially wrong

### S-16 — High — OSPOS rate limiting is scoped to login only

**Original claim:** "`app/Libraries/Throttle.php` is keyed on IP **and** on a normalised, MD5-hashed username with
no password component. It is a login-and-forgot-password rate limit, not a general API rate limit." — 8 tests
against real cache state.

**Verification result: CORRECTED. The scope conclusion holds; the file path, file name, and hashing detail are
wrong, and the test-suite claim is unsupported.**

| Original | Verified |
|---|---|
| `app/Libraries/Throttle.php` | **`app/Filters/Throttle.php`** (a CodeIgniter 4 *filter*) |
| MD5-hashed username bucket | **Not verified** — not re-read |
| 8 tests against real cache state | **Unsupported** — not re-read |

**Evidence.** `app/Config/Filters.php:40` `'throttle' => Throttle::class`; `:116`
`'throttle' => ['before' => ['login', 'migrate']]` — applied to the `login` and `migrate` routes only.
`app/Commands/EnvProvision.php:41-42` provisions a `throttle.key`. `app/Filters/Throttle.php:13` documents the
filter as backed by CodeIgniter's cache-based throttler.

**Restated finding:** OSPOS does implement rate limiting, as a first-class CI4 filter with a provisioned secret
key, but it is registered on the `login` and `migrate` routes only. It is therefore not a general API rate
limit; the majority of authenticated endpoints carry no request-rate control. No claim is made about the
bucketing algorithm, which was not re-read.

---

### S-24 — Medium — RFID reader failure is reported as an empty result

**Original claim:** "`ReadTagsAsync` sleeps for the timeout, then disconnects, and catches all exceptions — so a
down reader is indistinguishable from an empty store, and the 'real-time' feed is a 5-second poll of the audit
table."

**Verification result: CORRECTED. Errors are logged, and a separate connectivity check exists; the caller-visible
symptom claim holds only for the read path.**

**Evidence.** `backend/Services/LlrpReaderService.cs:118-121`:

```csharp
catch (Exception ex)
{
    _logger.LogError(ex, "Error during LLRP read from {ReaderHost}:{ReaderPort}", readerHost, readerPort);
    return tags.ToList();
}
```

The error **is** logged — the original "swallows all exceptions" / "silently" characterization is withdrawn.
What remains true: the method returns whatever tags were collected, so a failed read and a successful read of an
empty store are **indistinguishable to the caller**. `RfidReaderController.cs:70-73` turns the empty result into
`Ok(new { message = "No tags found during read", … })` — a 200 with a "no tags" message rather than an error.

**Mitigation that already exists (not in the original claim):** `TestConnectionAsync` (`:135-148`) returns
`false` on failure (`:148`) and is exposed by the controller, so reader connectivity **is** independently
reportable.

**Not verified:** the "5-second poll of the audit table" claim. `RfidReaderController.cs:191-199` does read
`_db.AuditLogs` filtered on `EntityName == "RfidScan"` (`GetRecentScans`), but the polling interval was not
traced to the frontend. The endpoint's dependency on the audit table for a live feed is confirmed; the interval
is not.

---

## 4. REFUTED — removed entirely

Each was checked against source and found unsupported. None is retained as an active risk.

| ID | Original claim | What the source shows | Disposition |
|---|---|---|---|
| **S-04** | High — OSPOS session-fixation defence is broken; `Session::regenerateId(true)` behind `if (session_status() == PHP_SESSION_ACTIVE)` in `Secure_Controller::__construct` | Search for `regenerateId` / `regenerate_id` / `session_regenerate` across `app/**/*.php` returns **0 matches**. The cited code does not exist | **REMOVED** |
| **S-05** | High — OSPOS locations auto-granted to every employee; data-layer queries apply no location predicate | `Employee.php` contains **0** matches for `location` or `location_id`. `app/Models/Sale.php:1500-1501` **does** filter: `if ($filters['location_id'] != 'all') { $builder->where('sales_items.item_location', $filters['location_id']); }`. The cited `Employee.php:236-260` auto-grant code is absent | **REMOVED** |
| **S-07** | High — RetailPOS session cookie is not `HttpOnly`; `*` origin with credentials | `config/session.php:184` `'http_only' => true`. `config/cors.php:22` `allowed_origins => ['*']` but `:32` `supports_credentials => false` — stock Laravel | **REMOVED** |
| **S-09** | **Critical** — YourGbDev SQL injection throughout the service layer; raw `mysqli_query` string concatenation in 6 services; interpolated `ORDER BY` and `limit/offset` | `mysqli_query` / `$mysqli->query` across `src/Services/*.php`: **0 occurrences**. `->prepare(` across `src/**/*.php`: **110**. `AuditRepository.php:69,74-75` binds `LIMIT :limit OFFSET :offset` via `bindValue` — the exact case claimed as interpolated. Codebase uses PDO prepared statements throughout | **REMOVED** |
| **S-13** | Medium — OSPOS ships `DEBUG = true`, `db_debug = true`, `?debug=1`, logging disabled by default | `app/Config/Constants.php` has **no** `DEBUG` match. `app/Config/Database.php` has **no** `db_debug` match. `public/index.php` has **no** `debug` match. `app/Config/Logger.php:42` is `public $threshold = (ENVIRONMENT === 'production') ? 4 : 9;` — production-aware, the opposite of "disabled by default" | **REMOVED** |
| **S-15** | High — RFID prototype-chain pollution via `JobAssignment` deserialised from the request body | `JobAssignment` appears **nowhere** in the repository. No `JsonConvert` / `JsonSerializerSettings` — the project uses `System.Text.Json` (`Program.cs:11`, `RfidReaderController.cs:5`), which does not exhibit that key-name behaviour | **REMOVED** |
| **S-17** | Medium — RetailPOS reflected XSS via unescaped Blade `{!! !!}` | Search for `{!!` across all `resources/views/**/*.blade.php`: **0 matches**. The cited `ExceptionController.cs` is a C# file in a PHP project; no equivalent PHP path was located | **REMOVED** |
| **S-18** | Medium — RetailPOS hardcoded JWT secret `'your_jwt_secret'`; `bcrypt` `rounds => 4` | `config/jwt.php` **does not exist**. `config/auth.php` contains **no** `rounds` key (L18 `'passwords' => 'users'`, L89 `'passwords' => [`) | **REMOVED** |
| **S-21** | Medium — CORS misconfiguration across three repos; `*` with credentials in YourGbDev and RetailPOS | **Refuted in all four repositories that have a CORS policy.** OSPOS `app/Config/Cors.php:37` `allowedOrigins => []`, `:60` `supportsCredentials => false`. **YourGbDev `backend/src/Middleware/Cors.php` is the most correct implementation in the set** — explicit allowlist (`:25`, default `http://localhost:5173`), `Access-Control-Allow-Credentials: true` (`:29`) with `Access-Control-Allow-Origin` echoed **only for allowlisted origins** (`:36-37`) and the comment "Only echo a concrete, allowlisted origin. Disallowed origins get no Access-Control-Allow-Origin, so browsers refuse to expose the response." NodeDR `src/server.js:28` `cors({ origin: FRONTEND_ORIGIN, credentials: true })` — single explicit origin (`:21`). RFID `Program.cs:22-33` explicit localhost allowlist with `AllowCredentials()` | **REMOVED** |
| **S-22** | Medium — RetailPOS two byte-identical security middlewares, one containing `'password' => 'admin123'` | `app/Http/Middleware/` contains only the eight default Laravel middlewares (`Authenticate`, `EncryptCookies`, `PreventRequestsDuringMaintenance`, `RedirectIfAuthenticated`, `TrimStrings`, `TrustHosts`, `TrustProxies`, `VerifyCsrfToken`). `AdminMiddleware.php` and `SecurityHeadersMiddleware.php` **do not exist**. A repo-wide search for `admin123` (excluding `vendor`/`node_modules`) returns **0 matches** | **REMOVED** |
| **S-23** | High — RetailPOS unrestricted file-upload and directory endpoints | No `FileUploadController` or `DirectoryController` exists; a search of `app/Http/Controllers/**` for `File`/`Directory`/`Upload` returns **0 matches** | **REMOVED** |
| **A-17** | RFID `DbContext` registered as a singleton — not thread-safe | `Program.cs:16-17` is `builder.Services.AddDbContext<StoreDbContext>(options => …)` with **no** lifetime override, which defaults to **Scoped** — correct and idiomatic. The cited comment `System.Data.Entity.DbContext` is not in `Program.cs` | **REMOVED** |

---

## 5. UNCONFIRMED — not checked, not to be used

These were not re-inspected. They are **not** established vulnerabilities and must not contribute to any
comparison, ranking, or recommendation.

| ID | Original claim | Required action |
|---|---|---|
| **S-10** | High — YourGbDev missing schema validation on receipt posting; `ReceivingService` does not verify `received_qty <= ordered_qty` | Verify `backend/src/Services/ReceivingService.php` before any use. Reassess severity on evidence. The design lesson is asserted independently by D-13, which **is** confirmed against the RFID repository |
| **S-14** | Medium — RFID LLRP `resetToFactory: true` on every read; response status unchecked; TV/TLV discriminator wrong; buffer desync | **Resolved — REFUTED.** `resetToFactory` and `EnableReaderEvent` return **zero matches** across `backend/**/*.cs`, so the headline claim never existed, and `LlrpClient.cs:83` does filter responses by expected message type. Only the "TV/TLV discriminator is wrong" claim (`LlrpMessageParser.cs:97`) survives as an open question, and that is a judgement about the LLRP specification — **UNVERIFIED**. The general LLRP lessons still stand on the specification alone |
| **S-19** | High — OSPOS 46 npm advisories (2 high, 44 moderate) with CVE identifiers | Re-run `npm audit` against current advisory data if this is to be relied upon at all. **No advisory identifiers are reproduced in the Phase 0 documents** (see §6) |
| **S-25** | High — YourGbDev audit is non-transactional; `AuditService.php:42-47` catches every exception | Verify `backend/src/Services/AuditService.php` and the call site in `UserService` before use. The design lesson is asserted independently by RFID S-12, which **is** confirmed |
| **S-23-b** | Medium — RetailPOS unsafe upload code copy-pasted into five business controllers (`Employee`, `Customer`, `Supplier`, `Product`, `Setting`) | **Created during the correction pass and then found to be unevidenced.** The dedicated-controller claim (S-23) was refuted, and this replacement was never verified against source. It must not be cited, scored, or ranked. Re-open those five controllers first |

---

## 6. Citation policy applied during this pass

1. **No security finding is written from memory.** Every retained finding was re-derived from a file opened in
   this pass, and the file:line references in the corrected documents are the ones recorded here.
2. **Advisory identifiers are not reproduced.** The verified OSPOS `app/Filters/Throttle.php:13` carries a
   security-advisory reference in a source comment, and the repository's own `AGENTS.md` directs that advisory
   identifiers be treated as secrets. They are omitted from all Phase 0 documents, and S-19 is left
   UNCONFIRMED rather than restated from memory. This is recorded as a deliberate choice, not an oversight.
3. **Negative results are recorded.** Where a search returned zero matches, that zero is reported as the
   evidence for removal. A refuted finding is a documented outcome, not a silent deletion.
4. **Unverified structure is not inferred.** No claim is made about a finding's reachability, its upstream call
   sites, or its interaction with other code unless that was traced in this pass.

---

## 7. Downstream consequence

The verification pass removed the four findings that most influenced the Phase 0 conclusion, and corrected three
others that overstated a legal risk or misdescribed a mechanism:

- **YourGbDev no longer has a "SQL injection" Critical (S-09).** That finding was the principal technical
  argument against the repository and appeared in the README headline, the risk register's top-10, the security
  comparison, the per-repository report, and the reuse analysis. It is removed from all of them.
- **RetailPOS loses four of its six security findings** (S-17, S-18, S-22, S-23), including the two alleged
  hardcoded credentials (`admin123` appears nowhere) and the alleged file-upload exposure (no such controller).
  Its genuine Critical (S-03) stands and remains serious on its own.
- **CORS was inverted.** S-21 asserted a cross-repository misconfiguration; the source shows YourGbDev
  implements the textbook-correct pattern and is now recorded as a strength.
- **OSPOS's session, debug-flag, and location-isolation findings are withdrawn** (S-04, S-05, S-13), removing
  the basis for three of its previously cited weaknesses.
- **A legal finding was corrected against our own prior direction.** OSPOS ships a root `LICENSE` file
  containing the **unmodified MIT text**; the non-standard element is a mandatory footer-attribution clause, not
  a narrowed copyright grant. The earlier characterisation — that no `LICENSE` file exists and that the clause
  was hidden in a PHP config file where scanners could not see it — is refuted. See `license-matrix.md` (L-01).
  This makes OSPOS *legally* more straightforward than Phase 0 recorded, though the branding obligation
  remains a real constraint on a rebrand.

**The overall foundation conclusion is unchanged: build clean (Option C).** It was never resting on these
findings. It rests on three licenses — two unlicensable with no permission at all, one AGPL — and on the fact
that offline sync, RFID authentication, RFID attendance, multi-store transfers, terminals and shifts have **no
implementation in any of the five repositories**. Every one of those was verified independently of the security
work. The corrections remove three of the five Criticals from the risk register, and therefore make the
recommendation *better evidenced*, not different in outcome.

---

**Phase 0 security analysis: CLOSED.** Changes after this point require a new verification entry.
