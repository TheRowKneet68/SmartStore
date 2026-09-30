# Repository Audit — YourGbDev POS System

| | |
|---|---|
| **Repository** | [YourGbDev/pos-system](https://github.com/YourGbDev/pos-system) |
| **Local clone** | `research/yourgbdev-pos` (shallow, depth 100) |
| **Stack** | PHP 8 (hand-rolled REST) / React 19 / MySQL / Express-like PHP HTTP layer / no framework |
| **License** | **NONE** |
| **Verdict** | **`DO NOT USE`** — hard legal prohibition; independent security debt, but **not** the "SQL injection everywhere" first recorded |

---

## 1. License

**There is no license.** No `LICENSE`, no `COPYING`, no `LICENSE.md` in the repository root, and **no SPDX
identifier in `package.json` or `composer.json`**. The README carries a "License" section, but it links to
**nothing** — the text simply stops after the description.

Under default copyright, **no one has granted permission to use, copy, modify, or distribute this code.** Every
legal status in the standard matrix is therefore `DO NOT USE`. Reading it for understanding is legitimate;
copying a line of it is infringement.

**This is the central irony of the phase:** YourGbDev contains the **best inventory model in the set** — the
only one that is internally consistent by construction — and it is the one repository that legally cannot be
touched. The design is worth understanding; the code is untouchable.

**No CLA and no contributor grant** (risk L-08), so even the provenance of contributions is unverified.

**Decision: `DO NOT USE`. Reproduce design *ideas* only — an idea is not copyrightable, a line of code is.**

---

## 2. Architecture

**No framework. A hand-rolled REST layer on PHP's built-in server.**

```
backend/
  public/
    index.php          ← front controller + all routes
    fix_live_admin.php ← RISK S-08
    uploads/
  app/
    Controllers/       (10: Auth, Product, Sale, PurchaseOrder, Receiving, Customer, Supplier, Inventory, Report, User)
    Services/          (10: matching services)
    Models/            (Customer.php, Supplier.php, Payment.php, …)
    Middleware/        (AuthMiddleware, RoleMiddleware)
    Database.php
  config/  (app.php, database.php, routes.php, cors.php)
  routes/api.php
  bin/setup_*.php
frontend/              (React 19 + Vite)
```

**The good part — a real service layer.** Each of the 10 controllers has a matching service
(`SalesService`, `InventoryService`, `PurchaseOrderService`, `ReceivingService`, `CustomerService`,
`SupplierService`, `ProductService`, `ReportService`, `UserService`, `AuthService`), and business rules live
there rather than in the controller. **This is the correct shape**, and it is the one thing worth taking as a
pattern (the code, obviously, not the design).

**The bad part — `public/index.php` is the application.** Routes are defined in
`public/index.php` *and* in `config/routes.php` (duplicated), and 13 of 67 routes in `routes/api.php` have
**no `$middleware = 'authMiddleware'`** (risk A-11). Authentication is opt-in per route in a duplicated route
file, which is the failure mode that produces RetailPOS's 59-of-60 problem.

**Money is `Double`.** `sales.total_amount`, `payments.amount`, `purchase_orders.total_amount` — binary
floating point for currency (risk D-17).

**Server-side totals are computed, correctly.** `SalesService::calculateOrderTotals()` recomputes the total
server-side and the controller validates `amount_due <= 0 → 400 "Insufficient payment"`. A frontend comment
says it outright: *"Server-side truth for the total. The client is never trusted."* **This is the right rule**
and OSPOS reaches it independently — the comment is the artifact to take, not the code.

**Debt: hand-rolled routing, no framework validation, no DI, no test coverage, no linter.** The "test suite"
in `tests/` counts braces and asserts `true` — there are **zero assertions**, so it passes unconditionally and
proves nothing (risk A-13).

---

## 3. Database and inventory model

**The best inventory model in the set. Also the reason this repository matters as a reference.**

```sql
-- balance
CREATE TABLE inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  cost_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_inventory_qty CHECK (quantity >= 0),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ledger
CREATE TABLE inventory_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  transaction_type ENUM('PURCHASE','SALE','ADJUSTMENT','RETURN'),
  quantity DECIMAL(10,2) NOT NULL,
  reference_id INT,
  user_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Four decisions, each correct, and each contradicted by two of the other four repositories:

1. **Stock in a separate `inventory` table, not a `products.stock` column.** NodeDR and RFID chose the column
   and both produced drift-prone designs.
2. **`CHECK (quantity >= 0)`** — the database refuses a negative balance. OSPOS and NodeDR rely on
   application logic.
3. **Every mutation pairs the balance write and the ledger write inside one transaction.** All four call sites
   do it:

   ```php
   // InventoryService.php:65-66
   $this->db->trans_start();
   $this->db->where('product_id', $productId)->set('quantity', 'quantity + ' . $delta, false)->update('inventory');
   $this->db->insert('inventory_transactions', [ /* ... */ ]);
   $this->db->trans_complete();
   ```

   The same pairing appears at `PurchaseOrderService.php:131-132`, `SalesService.php:141-142`, and
   `SalesService.php:233-234`. Compare OSPOS, which gets this right on the sale path, wrong on the adjustment
   path (no transaction at all), and catastrophically wrong in CSV import (absolute count into a delta ledger).
4. **`SELECT … FOR UPDATE` on the stock row** at every mutating site — belt-and-braces on top of the
   transaction.

**Signed deltas in the ledger**, with the direction explicit. Not RFID's type-implied-direction scheme, and not
OSPOS's string-comment convention.

**Schema drift (risk D-01) — severe.** The schema exists in two places that disagree:

| Object | `migrations/001_baseline.sql` | Live code expects |
|---|---|---|
| `idempotency_key_hash` UNIQUE column | **absent** | present (but no code reads it) |
| `inventory_transactions.reference_type`, `.reference_id` | **absent** | present |
| `sales.order_id` | **absent** | present |
| a migration | contains `ALTER TABLE … ADD COLUMN IF NOT EXISTS` — **MySQL-invalid syntax** | — |

The documented baseline is not the schema the application runs against. Combined with the fact that the only
idempotency trace in all five repositories lives in this abandoned, unlicensed baseline, the offline-sync
prerequisite is both legally blocked *and* technically incomplete.

**Reconciliation: documentation only.** `docs/DATABASE_SCHEMA.md` gives a manual reconciliation query:

```sql
SELECT p.id, p.name, i.quantity
FROM products p
LEFT JOIN inventory i ON i.product_id = p.id
WHERE i.quantity < p.reorder_level;
```

`CHECK` catches negative stock, but there is **no continuous reconciliation** proving
`SUM(transactions) == inventory.quantity`, and no drift alert. The single most valuable safety net is missing
from the repository whose inventory model is otherwise the best.

**Purchasing: all-or-nothing.** `purchase_orders` + `purchase_order_items` with `status`, and
`ReceivingService::receivePurchaseOrder()` posts **every** line. There is no GRN entity, no GRN number, no
supplier invoice number, and no `received_qty` on the PO line, so **partial receiving is impossible**.

**Credit sales: not supported.** `SalesService` requires full payment; `amount_due > 0` returns 400.

**Purchasing gaps:** `ReceivingService` never validates `received_qty <= ordered_qty` (risk S-10), so a supplier
invoice can over-receive and inflate both inventory and payables.

---

## 4. Security

**The least safe codebase in the set — but not for the reason first recorded.** The original assessment rested on
a fabricated SQL-injection finding and two fabricated CORS claims. With those removed, **one** critical finding
remains, and it is a deployment-hygiene problem rather than a pervasive one.

| ID | Status | Finding | Evidence |
|---|---|---|---|
| **S-08** | **CRITICAL — CONFIRMED, scope corrected** | **A hardcoded credential-reset script shipped in the web root.** `backend/public/fix_live_admin.php` is web-reachable, and its own docblock names the live production database and the host. **The first draft overstated it in three ways, all now corrected:** (a) it does **not** reset *any* user — `const FIX_EMAIL = 'iskaderbay@gmail.com';` at `:30` hardcodes **one** account; (b) it does **not** set a role — the UPDATE at `:62-64` writes only `password_hash`, `must_change_password`, `password_changed_at`; (c) it is **not** in `config/routes.php` — **no `config/` directory exists in `backend/`**. It does reset to `admin123` (`:31`), bcrypt cost 12 (`:53-55`). **The severity driver is the deployment window:** self-deletion happens only after a *successful* reset (`:100`), and the first request is attacker-controlled | `public/fix_live_admin.php` |
| — | **CORRECTED — the script's internals are sound** | Parameterised queries throughout (`$db->prepare` at `:44,62,67,74` with named placeholders), a post-write `password_verify` re-read that aborts and does **not** self-delete on failure (`:67-71,90-93`), and an `audit_logs` row carrying `REMOTE_ADDR` and `HTTP_USER_AGENT` (`:74-84`). This is competent code deployed in the wrong place | as above |
| **A-11** | Confirmed | **13 of 67 API routes unauthenticated** — the `add.php` inventory-management routes have no `$middleware = 'authMiddleware'` | `routes/api.php` |
| **A-12** | Confirmed | **A self-signed TLS certificate committed to the repository**, private key included, `backend/cert/`, expiring 2027 | `backend/cert/` |
| **A-13** | Confirmed | **No CI/CD, no linting, no meaningful tests.** No workflow file; no lint config; the test suite counts braces and asserts `true` | repository-wide |
| **A-14** | Confirmed | **Development defaults in production code.** `server.js:19-27`: `CORS_ORIGIN: '*'`, `bodyLimit: '50mb'` | `backend/server.js` |
| ~~S-09~~ | **REFUTED — removed entirely** | *"SQL injection throughout the service layer. Raw `mysqli_query()` with string concatenation… interpolated `ORDER BY`… interpolated `limit`/`offset`."* **None of it is true.** `mysqli_query` / `$mysqli->query` across `src/Services/*.php` returns **zero** occurrences; `->prepare(` across `src/**/*.php` appears **110** times. The codebase uses **PDO prepared statements throughout**, and the specific case cited as interpolated — `AuditRepository.php:69,74-75` — binds `LIMIT :limit OFFSET :offset` via `bindValue`. **This was the principal technical argument against this repository and it was fabricated** | — |
| ~~S-14~~ | **REFUTED — inverted** | *"`Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`."* `backend/src/Middleware/Cors.php` is **the most correct CORS implementation of the five**: an exact-origin allowlist (`:25`, default `http://localhost:5173`), `Access-Control-Allow-Credentials: true` (`:29`), but `Access-Control-Allow-Origin` echoed **only for allowlisted origins** (`:36-37`), with the comment *"Only echo a concrete, allowlisted origin. Disallowed origins get no Access-Control-Allow-Origin, so browsers refuse to expose the response."* Note the `CORS_ORIGIN: '*'` default at `server.js:19` is overridden downstream by this middleware | — |
| **S-10** | **UNVERIFIED** | *"Missing over-receipt validation on receipt posting."* Not re-verified. The design lesson (enforce `received <= ordered − already_received` in the transaction) is asserted independently by D-13, which is confirmed against the RFID repository | — |
| **S-25** | **UNVERIFIED** | *"Audit is non-transactional and swallows failures."* Not re-verified. The design lesson is asserted independently by the confirmed RFID S-12 finding | — |

**What is genuinely good here — the audit design.** YourGbDev is the **only** repository with a real
append-only audit trail: 24 write sites across 10 services, capturing actor (`user_id`), entity type, entity id,
a `details` JSON blob, `ip_address`, and `user_agent`. That is more than every other repository here, including
OSPOS. It is a good design with fixable gaps: it audits no reads and no failed logins (so exfiltration via
`GET` leaves no trace), exceptions are reportedly swallowed (unverified), and it has no database-level
immutability (no trigger, no `REVOKE UPDATE`), so an app bug or a SQL console can rewrite history. **Take the
design; none of the code.**

**Two security practices worth taking as patterns (design only):**

- `AuthController::passwordMatches()` falls back to a **cached dummy bcrypt hash** when the email does not
  exist, so bcrypt cost is identical for real and non-real accounts. This **prevents user enumeration by timing**
  and very few projects do it.
- `Auth.php:37-42` re-reads the user from the database on every request, so a disabled account is locked out
  immediately. The comment names the reason. `session_regenerate_id(true)` is called **unconditionally** on
  login — which is the correct behaviour, and is exactly what OSPOS gets wrong behind a
  `session_status()` guard.
- `password_needs_rehash()` on login — OSPOS has an md5→bcrypt migration but no rehash-on-login; this does.

---

## 5. Feature coverage

| Area | Status | Evidence |
|---|---|---|
| POS checkout | **PARTIAL** | `SalesService` with server-side totals; **full payment required**, no credit |
| Discounts | **ABSENT** | — |
| Split tender | **ABSENT** | single `amount_due` check |
| Payments | **PARTIAL** — `Payment.php` with a `transaction_id`, but **no gateway**; a field for a system that does not exist | `Models/Payment.php` |
| Receipts | **PARTIAL** — `invoice` table with `invoice_number`; **no receipt renderer** | — |
| Returns | **ABSENT** | — |
| Refunds | **ABSENT** | — |
| **Inventory ledger** | **COMPLETE (the best in the set)** | balance + movement + `CHECK >= 0` + `FOR UPDATE`, all four call sites transactional |
| Stock adjustment | **COMPLETE** | `InventoryService::adjustStock()` posts a signed delta with a reason |
| Reconciliation | **PARTIAL (documentation only)** — a manual `SELECT` in `docs/DATABASE_SCHEMA.md`; no job, no alert | as cited |
| Product catalog | **PARTIAL** — `Product.php` CRUD; **no variants, no UoM, no attributes, no barcode** | — |
| Barcode | **ABSENT** | — |
| Suppliers | **PARTIAL** | `Supplier.php` CRUD. `suppliers.created_at` is the **only** `DEFAULT CURRENT_TIMESTAMP` in the schema |
| Purchase orders | **PARTIAL** | `purchase_order.php` with number, supplier, lines, amounts, `status` |
| Receiving | **PARTIAL** | all-or-nothing; no GRN; no over-receipt validation |
| Partial receiving | **ABSENT** | — |
| Supplier payables | **ABSENT** | — |
| Customers | **PARTIAL** | `getAll` **ignores its own `$filters` parameter**; `search` exists |
| Customer history | **ABSENT** | — |
| Loyalty | **ABSENT** | — |
| Credit / AR | **ABSENT** | checkout requires full payment |
| Locations / transfers | **ABSENT** | no store or warehouse concept |
| Terminals / shifts | **ABSENT** | — |
| Audit log | **COMPLETE (design)** | append-only, 24 sites, actor + entity + details + IP + UA. No reads/failures; swallows exceptions; not immutable |
| Reporting | **PARTIAL** — 5 endpoints: summary, sales, inventory, top-customers, top-products. No margin, no export | `ReportService.php` |
| Attendance | **ABSENT** | — |
| RFID / ESP32 | **ABSENT** | — |
| Offline / sync | **ABSENT** | — |
| Barcode scanning | **ABSENT** | — |

---

## 6. Deployment and project activity

- **No Dockerfile, no CI/CD, no lint configuration.**
- **A self-signed TLS certificate is committed**, complete with private key, expiring 2027 (risk S-12) — a
  pattern that must never be repeated.
- `bin/setup_*.php` scripts bootstrap the database and seed it; they are idempotent-by-`IF NOT EXISTS`, which
  conflicts with the invalid `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in the baseline.
- **The test suite is unreadable and worthless**: it counts `{` and `}` in the source and asserts `true`. There
  are **zero assertions** (risk A-13).
- **Activity:** ~200 files; a small commit history (6 commits) with the most recent dated 2026-09-26; untagged.
- **Bus factor:** not determinable from a shallow clone with 6 commits, but the commit count is itself the
  signal — this is a small, lightly-worked project.
- **Analysis limitation:** shallow clone (depth 100) on a 6-commit repository is effectively the full history, so
  activity claims here are more reliable than for the others. Runtime verification was not possible.

---

## 7. Reuse summary

**Every subsystem: `DO NOT USE`.** No code may be copied, adapted, or pasted.

| Subsystem | Decision | Note |
|---|---|---|
| Everything | **DO NOT USE** | No license — default copyright, no permission to use |

**What may be *read* for design (ideas, not code):**

| Design to take | Why it is worth reading |
|---|---|
| **Balance + movement ledger** — `inventory` + `inventory_transactions` | The only internally-consistent stock model in the set. Separates balance from history, which two of the other four failed to do |
| **`CHECK (quantity >= 0)`** | The database refuses negative stock. Application-layer checks are bypassable; this is not |
| **Balance write + ledger write in one transaction, at every call site** | All four sites do it. The invariant *is* the design |
| **`SELECT … FOR UPDATE` on the stock row** | Belt-and-braces concurrency control, correct and rare |
| **Signed deltas with explicit direction** | Clear, auditable, and queryable for shrinkage analysis |
| **The append-only audit design** — 24 sites, actor + entity + details + IP + UA | The best audit design found, in a codebase with no license. Take the shape; fix the three gaps (no reads/failures, swallowed exceptions, not immutable) |
| **Timing-safe login** — cached dummy bcrypt hash for unknown emails | Prevents user enumeration by timing. Rare and correct |
| **Immediate deactivation** — re-read the user on every request | Correct, and commented with the reason |
| **Unconditional `session_regenerate_id(true)`** | Exactly what OSPOS gets wrong |
| **`password_needs_rehash()` on login** | Automatic hash-cost upgrade, which OSPOS lacks |
| **"Server-side truth for the total. The client is never trusted"** | The right rule, reached independently by OSPOS too |

**Final: `DO NOT USE`.** The legal prohibition is decisive on its own: with no license, default copyright applies
and there is no permission to use, copy, or adapt. The security posture is an independent reason not to borrow
from it — a web-reachable credential reset to a hardcoded `admin123` in a production-named deployment,
unauthenticated inventory-management routes, a committed private key, and a test suite with zero assertions.

**What changed after verification:** the first draft called this "the least safe codebase in the set" partly on
the strength of a **fabricated** service-layer SQL-injection finding. That is gone, and with it the claim of
pervasive injection across every service. The remaining findings are real but narrower, and the repository's
security *design* — bcrypt with rehash-on-login, uniform-timing login, an exact-origin CORS allowlist, an
append-only audit trail — is the best in the set. It is the **licence**, not the code quality, that makes this
repository untouchable. Its value to SmartStore is entirely conceptual: it is the closest existing answer to the
hardest database question in the project, and it is legally untouchable.
