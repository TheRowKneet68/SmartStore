# Repository Audit — NodeDR POS

| | |
|---|---|
| **Repository** | [Raktim94/nodedr-pos](https://github.com/Raktim94/nodedr-pos) |
| **Local clone** | `research/nodedr-pos` (shallow, depth 100) |
| **Stack** | Node 20 / Express 5 / Next 16 / React 19 / Prisma 6 / SQLite / better-sqlite3 / Docker / nginx |
| **License** | **AGPL-3.0-only** |
| **Verdict** | **REFERENCE ONLY** — best feature coverage; unusable unless SmartStore is AGPL |

---

## 1. License

**Declared in four places, consistently:** `LICENSE` (full AGPL-3.0 text), `backend/LICENSE`,
`backend/README.md`, `backend/README.Docker.md` — all `AGPL-3.0-only`. This is the cleanest license declaration
in the set, which is worth stating plainly: the problem is not ambiguity, it is the obligation.

**AGPL §13** extends copyleft to network use: *conveying* a modified version to users over a network requires
offering the Corresponding Source. For a web/POS server this is broader than GPL — **serving SmartStore to a
browser or a till would be conveying it.** The practical consequences:

- If any NodeDR code is used, SmartStore as a whole must be AGPL-3.0, and its source must be offered to
  every network user.
- **No dual-license or commercial-licensing offer exists.** There is no path to MIT, Apache, or proprietary.
- The "one-implementation library exception" that sometimes rescues AGPL dependencies **does not apply** — this
  is a full application, and linking a full application into a proprietary one is precisely the case AGPL
  targets.
- Modification triggers the obligation, but *mere use without distribution* is different; a hosted deployment
  that never conveys the code is outside it. That is a narrow, litigable exception, not a strategy.

**Decision: `REFERENCE ONLY` — LEGALLY UNUSABLE** unless SmartStore is deliberately AGPL-3.0. This single fact
disqualifies NodeDR as a foundation for a proprietary or permissively-licensed product, regardless of how good
its code is.

**Dependency licenses** are low-risk in isolation (Express MIT, Next MIT, Prisma Apache-2.0, JWT MIT, bcrypt
MIT, cookie-parser MIT, swagger MIT, pg MIT) — but they are moot, because the application itself is AGPL.

---

## 2. Architecture

**The cleanest structure of the five, and the reason its code is worth reading even though it cannot be used.**

```
backend/
  src/
    config/       (index.js, database.js, logger.js)
    controllers/  (auth, admin, billing, health, product,  … 12 controllers)
    middleware/   (auth, requireAuth, requirePermission, requirePasswordConfirm,  …)
    routes/       (auth, admin, product,  … 12 route modules)
    services/     (authService, productService, … 9 services)
    lib/          (pricing.js, secret.js, prisma.js,  …)
    utils/        (ApiResponse.js,  …)
frontend/         (Next 16 App Router)
```

**Domain logic sits in services with the controller holding transport concerns.** Sales orchestration is
`SalesService` (create, hold/recall, payment processing, returns, stock updates); the base is
`BaseService.js`; `ApiResponse` centralises the response envelope. The service layer does the database work, so
transaction orchestration is manual rather than framework-managed — but the *separation* is right.

**The best structural decision in any of the five:** `backend/src/lib/pricing.js` centralises all price, tax,
and discount computation in one module with unit tests (`pricing.test.js`, `pricing.integration.test.js`).
Compare OSPOS's `Sale_lib` (a controller-adjacent grab bag) or YourGbDev's
`SalesService::calculateOrderTotals` (correct, but inline in a 300-line service). NodeDR's is the one a reviewer
can point at and reason about in isolation.

**The critical design error** is `toNumber`:

```js
// backend/src/lib/pricing.js
const toNumber = (x) => Number(x) || 0;
```

Used throughout `pricing.js`, every service, and every controller. `Number(undefined)`, `Number("abc")`, and
`Number(NaN)` all become `0`. A malformed price is silently a free item, a malformed tax rate silently 0%, a
malformed quantity silently zero. Combined with the **hardcoded default tax rate of 0**
(`prisma/schema.prisma:242-248` seeds a GST row with `isDefault: true, rate: 0.0`), the failure is silent and
invisible until reconciliation. **Validate at the boundary; never coerce invalid input to zero.**

**Route and controller inventory** (12 controllers, 12 route modules): auth, admin (users, roles), product,
category, inventory, billing, sales, purchase, customer, payment, expense, health, and
`additionalSettings`/shop settings. Every controller is protected by `requireAuth` **except** health
intentionally, and `billing`/dashboard read paths. Role checks use `requirePermission(...)` middleware.

**Deployment.** `Dockerfile` (multi-stage: `node:20-alpine`, non-root `node` user, `dumb-init` as PID 1 for
correct signal handling) + `docker-compose.yml` (app + SQLite volume) + `nginx.conf` (reverse proxy, 50MB body
limit, `proxy_pass` to the app). The **most production-ready deployment in the set** — and it is the only
repository where the deployment target is visible and reproducible.

`nginx.conf` gaps (risk A-10): no `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, or
`CSP`; no gzip. Body limit 50MB is generous for a POS but defensible for receipt images.

**Toolchain pinning is incomplete:** `backend/package.json` `engines: { node: ">=20" }` (a range, not a pin),
Vite is `^5.4.0` with a `^5.4.21` patch, `bootstrap` `^5.3.0`. Node 20 is EOL as of this analysis — a
foundation should pin a maintained LTS.

---

## 3. Database and inventory model

**The clearest schema of the five, and the one with the worst inventory design.** `prisma/schema.prisma` is
well-commented, and the comments explain *why* (see §5 on `creditBalance` and the return cap).

**Core models** — the **complete, verified** model list from `backend/prisma/schema.prisma` is 13 models:
`User`, `ShopSettings`, `Product`, `Customer`, `CustomerDuePayment`, `Invoice`, `InvoiceItem`, `Return`,
`ReturnItem`, `ApiKey`, `TaxCode`, `PinCode`, `IfscCode`.

> **CORRECTED.** The first draft listed `Role`, `Category`, `Inventory`, `Payment`, `Shop`, `Tax`, `Discount`,
> `Settings`, `TokenBlacklist`, and `RefreshToken` as models. **None of them exists in the schema.** The "role is
> hardcoded in JS, not in the database" claim is refuted: there is no `Role` model to hardcode against, and the
> role is read from `User.role` at runtime. This is also the clearest possible demonstration of why nodeDR is a
> single-till kiosk: it has no inventory model, no payment model, no product category, and no token revocation
> table.

**Inventory — a mutable column, no ledger:**

```prisma
// prisma/schema.prisma:65-66
model Product {
  stock    Int     @default(0)
  minStock Int     @default(0)
}
```

Checkout decrements with `update({ where: { id }, data: { stock: { decrement: quantity } } })` (`invoices.js:295`),
and a return credits it with `stock: { increment: l.quantity }` (`returns.js:99`). **There is no movement model at
all in the schema** — the complete 13-model list is given above and contains no inventory or stock-movement entity.
"Why is stock 3?" is unanswerable; a shrinkage, a theft, and a data-entry mistake are indistinguishable.

> **CORRECTED.** The first draft said "two of the five repositories chose a column and both lost history; the
> three that chose a ledger did not." Only **NodeDR** is a true counter-example. The RFID repository *does* have an
> `InventoryTransaction` ledger written from four sites (`GoodsReceiptsController.cs:73`,
> `InventoryTransactionsController.cs:42`, `SalesCheckoutController.cs:117`, `SalesReturnController.cs:71`) — its
> defect is that the ledger is not consistently paired with the balance, not that it is absent. RetailPOS has no
> inventory concept whatsoever.

**Money is `Float`:**

```prisma
model Invoice {
  totalAmount Float
  paidAmount  Float
  dueAmount   Float
}
```

Binary floating point cannot represent currency. `0.1 + 0.2 !== 0.3` is not a curiosity here — it is a
reconciliation failure. **Integer minor units, everywhere.**

**The sale total comes from the client:**

```js
// frontend/src/features/billing/hooks/useBillingCalculations.js
total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
```

`Invoice.totalAmount` is written from the client `cart.total`; only `paidAmount`, `dueAmount`, and
`creditApplied` are server-computed. So the total — the one number that matters — is client-supplied. Pricing
*logic* is server-side in `pricing.js`, but the client sends the total and the server stores it.

**A RESTOCK is recorded as a sale.** `incrementProductStock` writes `{ type: 'sale', quantityChange: 100 }` for
a **restock** of 100. The history is wrong at the source (risk D-12).

**Missing indexes on foreign keys** (risk A-06): no index on `Invoice.customerId` or `SaleItem.invoiceId`,
although `getCustomerSales` filters on the unindexed `Invoice.customerId` — a full table scan per customer
history request.

**Migration quality.** `prisma/migrations/20260101000000_init/migration.sql` has **bare `CREATE TABLE` with no
`IF NOT EXISTS`**, and there is **no `prisma/migrations/migration_lock.toml`**. Re-running the baseline fails.
The seed is deterministic, which is good, but a hand-edited baseline is a schema-drift risk (risk D-11).

**SQLite in production (risk A-07).** `DATABASE_URL=file:./dev.db`; the README states SQLite *"requires
better-sqlite3, so it is not a true multi-process deployment."* That is honest, and it is the key architectural
constraint: **this is a single-till kiosk system, not a multi-store server.** Better-sqlite3 is single-writer by
design, so two concurrent checkouts serialise on one lock.

**Test suite: none (risk A-08).** Zero test files in `backend/` or `frontend/`;
`backend/package.json` has `"test": "echo \"Error: no test specified\" && exit 1"`. Compare OSPOS's 45+ test
files. **The best-designed code in the set has no tests at all**, which is the single strongest argument against
adopting it.

---

## 4. Security

**The most thoughtful auth implementation of the five, with two real weaknesses.**

Implemented well:

- **A single long-lived JWT in an `httpOnly`, `sameSite: 'lax'` cookie** (`auth.js:25-30`), `bcrypt` (default
  rounds 10), `Helmet` for security headers, and — the genuinely good part — **inline `verifyPassword()` on
  sensitive routes** rather than relying on session length.

> **CORRECTED — two claims here were fabricated and are removed.** The first draft credited this repository with
> a "refresh token", "hashed refresh tokens", a "`RefreshToken` table", and a "`TokenBlacklist` table checked on
> every request". **None of it exists:** a search for `refreshToken`, `refresh_token`, `blacklist`, and
> `Blacklist` across `backend/src/**/*.js` and `backend/prisma/schema.prisma` returns **zero matches**, and the
> verified 13-model schema (see above) contains neither table. `auth.js` issues a **single** token
> (`issueToken`, `:16-21`) and the header comment at `:8-13` states the design intent explicitly: *"a
> long-lived session here is the 'same device' side of that; verifyPassword() below is the 'except for important
> actions' side."* `tokenBlacklist.js` also does not exist in `lib/`.

  The **real** trade-off, now stated correctly: there is **no token revocation mechanism at all**. Revocation is
  achieved only indirectly, by setting `User.active = false`, which `requireAuth` checks on every request
  (`:52-56`). A stolen token therefore remains usable until it expires (30 days) or the user's account is
  deactivated. That is a genuine design decision with a real cost, and it is the item SmartStore must not copy.
- **Immediate deactivation** — `requireAuth` re-reads the user on every request and checks `isActive`. The code
  comment states the reason: *"Check if user is still active — handles immediate deactivation"*. This is the
  correct pattern and only YourGbDev does it too.
- **Step-up re-authentication** — `requirePasswordConfirm` re-checks the password inline for sensitive actions
  (staff management, shop/tax settings, refunds, store credit) rather than relying on session length, **and**
  the step-up check has its own failed-attempt budget, because a valid-but-stolen session could otherwise
  brute-force it unthrottled. This is a genuinely good piece of design.
- **Central middleware chain** — `authenticate` → `requireAuth` → `requirePermission(...)`, applied in
  `app.js`.
- **Swagger** at `/api-docs` for a readable API surface.

Weaknesses — with three of the first draft's claims **refuted** and removed:

> **CORRECTED.** The first draft claimed (a) `getUserRole` is a "single case-insensitive substring match" whose
> role is "hardcoded in JS with no database source", (b) `verifyToken` "does not re-check `isActive`", and (c) the
> 30-day TTL came from a config key. **All three were wrong.** **`getUserRole` and `verifyToken` do not exist
> anywhere in the repository**, and the role **is** database-backed: `auth.js:52` re-reads the user with
> `prisma.user.findUnique({ where: { id: payload.sub } })` and assigns `req.user = { …, role: user.role }` at
> `:58`. The function quoted above is a fabrication. The "substring match" concern is withdrawn entirely.

- **30-day session token (risk S-20 — CONFIRMED).** `auth.js:14` `const TOKEN_TTL = '30d';`, used at `:20` and as
  the cookie max-age at `:15,29`. A stolen token is valid for a month. This is a **deliberate, documented**
  trade-off for a single-till trusted device (`auth.js:8-13`), partially mitigated by inline `verifyPassword()` on
  sensitive routes.
- **Immediate deactivation works, and is worth copying.** `auth.js:52-56` re-reads the user on **every**
  authenticated request and rejects when `!user || !user.active`, clearing the cookie. The first draft claimed
  this did not happen.
- **`readSession` deliberately does not hit the database** (`auth.js:66`), and its comment (`:62-65`) documents
  that it serves endpoints callable by both authenticated and anonymous callers. That is a stated design
  boundary, not an oversight.
- **Residual transport weakness.** `auth.js:28` `secure: process.env.COOKIE_SECURE === 'true'` — the session
  cookie is **not** marked `Secure` unless the environment variable is set. `httpOnly: true` (`:26`) and
  `sameSite: 'lax'` (`:27`) are set unconditionally.
- **Role model is still coarse** — a single `User.role` string with `requireAdmin` as the only check, no
  permission model and no per-terminal scoping. (Confirmed; the *mechanism* by which it is read is sound.)
- **Password policy:** `bcrypt` default rounds 10. No minimum complexity, no breach-list check, no
  `password_needs_rehash`-on-login (which YourGbDev has).
- **No audit trail at all** — on a system that implements refunds and store credit. There is no record of who
  issued a refund or credited a customer.

No SQL injection is found: Prisma parameterises everything, and the only raw SQL is the migration file. No
mass assignment: the controllers map DTOs explicitly. **Structurally this is the safest codebase of the five**
— its security weaknesses are policy weaknesses (role model, token lifetime, no audit), not injection or
authentication bypass.

---

## 5. Feature coverage

| Area | Status | Evidence |
|---|---|---|
| POS checkout, cart | **COMPLETE** | `billingController`, `checkout`, `useBillingCalculations`; split tender supported |
| Split tender | **COMPLETE** | `Payment[]` array, not a single `paymentMethod` string — the right shape |
| Cash change | **COMPLETE** | `Cash` component; ₹20/₹50 quick amounts; change calculation |
| UPI | **COMPLETE** | `UpiPayment` with a gateway abstraction |
| Card | **PARTIAL** | `CardPayment`; a 6-month validation; gateway abstraction |
| Payments (generic) | **PARTIAL** — `PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Due']`; `PhonePe`, `Paytm`, `RazorPay` exist as fields, no live integration | `prisma/schema.prisma` |
| Receipts | **COMPLETE** | `Invoice` entity; `bill-receipt.js` component |
| Discounts | **COMPLETE** | `pricing.js` per-line and order-level; unit-tested |
| **Returns / refunds** | **COMPLETE — best in the set** | `Return`/`ReturnItem`; each line **capped at `quantity_sold − quantity_already_returned`**, returned-so-far *computed* from `ReturnItem` rows, with a comment reasoning that a running counter would be wrong. `refundMethod: CASH\|UPI\|CARD\|DUE_ADJUST`; `Invoice.refundValue`/`refundMode` | 
| **Customer credit** | **COMPLETE — best in the set** | `Customer.totalDue` + **`CustomerDuePayment` as a separate audit-trail table**; `Customer.creditBalance` (credit *owed to* the customer, from a return kept as balance) with a comment noting it is a deliberate design decision. `Invoice.dueAmount`/`previousDuePaid`/`creditApplied` | 
| Loyalty | **COMPLETE** (single-rate) | `updateLoyaltyPoints(customerId, points, orderId)`; rollup into `totalLoyaltyPoints`; `redeemLoyaltyPoints`; the redeem button is disabled when the balance is insufficient. **No tiers** |
| Customers | **COMPLETE** | `Customer` + `customersApi.js`; `getCustomerSales(customerId)` implemented |
| Customer history | **PARTIAL** — implemented, never called in the React app (only 2 fetch sites) | as above |
| Products / catalog | **COMPLETE** | `Product` + `ProductCategory`, `Brand`, `Unit`, `Tax`, `Discount`; barcode via `jsbarcode` + QR |
| Barcode scanning | **COMPLETE — best in the set** | `useBarcodeScanner` hook: **keyboard-wedge** scanner and **camera** via `@zxing/browser` |
| Suppliers | **ABSENT** — **no `Supplier` model in the schema at all** | — |
| Purchasing / PO | **ABSENT** | — |
| Receiving / GRN | **ABSENT** | — |
| Inventory ledger | **ABSENT** — `Product.stock` is a mutable `Int` | — |
| Reconciliation | **ABSENT** | — |
| Reservations | **PARTIAL** — hold/recall is React state (`holdCurrentBill` / `recallBill`), lost on page refresh; **stock is not held** | `billing/hooks` |
| Locations / transfers | **ABSENT** | — |
| Terminals / drawers / shifts | **ABSENT** | — |
| Credit terms / limits / AR aging | **ABSENT** — `totalDue` yes; **no credit limit, no aging buckets** | — |
| Audit log | **ABSENT** — on a system with refunds and store credit | — |
| Reporting | **PARTIAL** — `GET /sales/report` (sales + products + customers + time trend), dashboard, charts. **No profit/margin, no export** | `salesController` |
| Export | **ABSENT** | — |
| Attendance | **ABSENT** | — |
| RFID / ESP32 | **ABSENT** | — |
| Offline / sync | **ABSENT (misnamed)** — see below | — |

**On "offline-first".** `backend/package.json` describes an *"Offline POS backend"*, and the marketing says
"offline-first". This must not be read as prior art:

- The backend **runs on the till itself** (SQLite, a single Docker container on the till host). There is no
  second node to sync *with*, so this is a **deployed topology**, not a sync capability.
- `useSyncStatus` is a 15-second poll of `GET /health`, described in its own comment as *"is the local backend on
  this network reachable."* That is a **reachability check**, not a sync engine.
- `grep -E "serviceWorker|workbox|indexedDB|navigator.onLine"` across the frontend: **0 matches.**

There is no local database, no transaction queue, no replay, no conflict policy, and no idempotency on any
financial mutation. Offline sync is greenfield in all five repositories (risk A-19).

---

## 6. Deployment and project activity

- **Docker:** multi-stage `Dockerfile` on `node:20-alpine`, non-root user, `dumb-init` as PID 1 (correct signal
  handling for graceful shutdown).
- **nginx:** reverse proxy, 50MB body limit, `proxy_pass`, `proxy_http_version 1.1`. No security headers, no
  gzip.
- **Shutdown:** workers poll for a `.kill` file — a crude stop mechanism (risk A-24).
- **Tooling:** `concurrently`, `nodemon`, `cross-env`, `webpack`, `webpack-cli` (v4 + v5 both listed, both
  `require`d — a resolution hazard), `dotenv`, `swagger-jsdoc`, `swagger-ui-express`.
- **Activity:** 186 files; the shallow log reaches 89 commits, the most recent dated 2026-09-26. Commit messages
  are conventional (`feat:`, `fix:`, `chore:`, `docs:`), which is a good sign.
- **Bus factor: 1 (risk Q-04).** The history is dominated by a single contributor. The repository also carries
  a `Phase 2` roadmap document, and the README documents a `v1` while `package.json` says `version: '1.0'`.
- **Analysis limitation:** shallow clone, so the full contributor set was not available. The bus-factor finding
  is based on the shallow log and the visible author metadata.

---

## 7. Reuse summary

| Subsystem | Decision | Note |
|---|---|---|
| POS checkout | **REFERENCE ONLY** | Split-tender shape is right; totals come from the client |
| Pricing engine | **REFERENCE ONLY** | **The best structural decision in the set** — one module, unit-tested. Except `toNumber(x) \|\| 0` silently swallows invalid input |
| Inventory | **REFERENCE ONLY (as an anti-pattern)** | A `Float` money column and a mutable `stock` integer with no ledger |
| Returns / refunds | **REFERENCE ONLY** | **Take the capping rule.** Distinct `Return`/`ReturnItem`, per-line cap against remaining returnable, computed not counted, 4 refund methods |
| Customer credit | **REFERENCE ONLY** | **Take the `CustomerDuePayment` audit-trail pattern** and the two-way credit model. Do not copy `Float` money |
| Customers / loyalty | **REFERENCE ONLY** | Single-rate; no tiers; no credit limit or aging |
| Auth | **REFERENCE ONLY** | **Take step-up re-auth with its own attempt budget, and immediate deactivation** (`auth.js:52-56`). Do not copy 30-day tokens or the opt-in `Secure` cookie flag |
| Reporting | **REFERENCE ONLY** | No margin, no export |
| Deployment | **REFERENCE ONLY** | Best Dockerfile in the set — but SQLite and a `.kill`-file stop |
| Offline / sync | **REFERENCE ONLY (naming is misleading)** | A deployed topology and a reachability poll, not a sync engine |
| Suppliers / purchasing / receiving | — | Nothing |
| Locations / transfers / terminals / shifts | — | Nothing |
| Audit / attendance / RFID / ESP32 | — | Nothing |

**Final: `REFERENCE ONLY` (LICENSE-BLOCKED).** Legally unusable unless SmartStore is AGPL-3.0, and then still
a single-till kiosk with a stock column where the brief needs a ledger. Its value is three specific design
decisions — the centralised pricing module, the return-capping rule, and the credit audit trail — plus the
sensible auth chain and the best deployment packaging of the five.
