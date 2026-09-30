# Reuse Analysis

## Decision framework

Because three of five repositories have **no license at all**, and the two that are licensed carry obligations
that require counsel sign-off, **"REUSE DIRECTLY" is currently available for nothing.** The decisions below
therefore answer two separate questions:

1. **Legal** — may this code be used at all?
2. **Technical** — if it legally could be, should it be?

Where the legal answer is "no", the technical answer becomes *pattern to study* or *code to reimplement*, and is
stated as such.

| Decision | Meaning |
|---|---|
| **REUSE DIRECTLY** | Take the code as-is. Requires a cleared license. |
| **ADAPT** | Take the code and modify it. Requires a cleared license and a permissively-licensed dependency tree. |
| **REIMPLEMENT** | Do not take the code. Build the capability from scratch, optionally using the other repository as a design reference. |
| **REFERENCE ONLY** | Read it to understand an approach. No code, no derivative work. |
| **DO NOT USE** | Neither code nor design. Legally unusable, technically disqualified, or both. |

---

## Legal gate (applies to every decision below)

| Repo | Legal status | Effect on all reuse decisions |
|---|---|---|
| OSPOS | MIT + **nonstandard footer clause**, LGPL transitives, proprietary font binaries, unstated trademark | **LEGAL REVIEW REQUIRED** — cannot be a REUSE/ADAPT source until counsel clears the clause and the transitives |
| NodeDR | **AGPL-3.0-only**, declared consistently in 4 places | **LEGAL REVIEW REQUIRED** — if SmartStore is proprietary or MIT/Apache, AGPL §13 makes this unusable. Assumed unusable pending counsel. |
| YourGbDev | **NO LICENSE** | Hard prohibition on copying. `DO NOT USE`. |
| RetailPOS | **NO LICENSE** + unlicensed vendored commercial template | Hard prohibition on copying. `DO NOT USE`. |
| RFID Ref | **NO LICENSE** ("all rights reserved") | Hard prohibition on copying. `REFERENCE ONLY` — clean-room reimplementation of the *approach* only. |

**No decision below is REUSE DIRECTLY or ADAPT.** Every one is REIMPLEMENT, REFERENCE ONLY, or DO NOT USE.
That is a legal conclusion forced by the evidence, not a stylistic preference.

---

## POS (checkout, cart, payments, receipts, void)

### **REIMPLEMENT** — OSPOS and NodeDR are REFERENCE ONLY for design

**Why not reuse:** OSPOS is the strongest POS here (7 payment types, split tender, server-computed change,
suspend/recall, quote/work-order/return document types, invoice numbering) but has three disqualifying defects
in the checkout path: the `INSUFFICIENT_STOCK` sentinel is unreachable, so the real oversell guard is advisory
and client-side with no server-side re-check at commit; receiving-line costs store pre-receipt values; and
`receivings_items.item_location` has no FK. NodeDR is AGPL. Neither is a source of reusable code.

**What to take as design reference:**

- **OSPOS's `sales_items` snapshot contract** — `item_cost_price`, `item_unit_price`, `discount`,
  `discount_type`, `item_location`, `serialnumber` all frozen at sale time. This is the only repository that
  gets historical margin reporting right, and the snapshot must be designed in from day one because retrofitting
  it across a movement ledger is a rewrite.
- **OSPOS's `sales_payments` 1-to-many shape** with `payment_id` as the PK and `cash_refund` /
  `cash_adjustment` as separate columns. Split tender falls out of this shape for free. NodeDR's single
  `paymentMethod` string cannot represent a split sale.
- **OSPOS's server-side total recomputation** — `payments_cover_total` check plus a negative-total fraud guard,
  both tested. YourGbDev independently arrived at the same conclusion ("server-side truth… the client is never
  trusted"). Two independent implementations of the same rule is strong evidence it is the right rule.
- **NodeDR's centralised `lib/pricing.js`** — price/tax/discount computation in one module rather than inline
  in a controller. This is a better structure than OSPOS's `Sale_lib`, and it is the right shape.
- **NodeDR's returns capping rule** — a return line is capped at `quantity_sold − quantity_already_returned`,
  with the returned-so-far figure *computed* from `ReturnItem` rows rather than stored as a running counter
  (the schema comment reasons about this explicitly). This makes double-return structurally impossible and is
  strictly better than OSPOS's negative-line return model. RFID Ref's implementation of the same feature is
  exploitable and must not be used as a model.
- **OSPOS's suspend/recall as server-persisted state**, not React state. NodeDR's `holdCurrentBill` /
  `recallBill` is React state only and is lost on page refresh.

**What to avoid copying even as a pattern:** OSPOS's `Sale::save_value()` 14-positional-parameter signature,
and its client-side-only oversell guard.

---

## Inventory (stock, ledger, adjustment, reconciliation)

### **REIMPLEMENT** — YourGbDev's model is the target design; its code is `DO NOT USE`

**Why not reuse:** YourGbDev is the only repository whose stock model is internally consistent by construction,
and it has **no license**. That is the central irony of this phase: the single best answer to the hardest
database question in the project cannot be used.

**What to take as design reference (from an unlicensable repo — the *idea* is not copyrightable, the *code* is):**

- **Stock in a separate table, not a column on `products`.** `inventory(product_id, quantity)` with
  `CHECK (quantity >= 0)`. Two independent repositories chose this (YourGbDev, and OSPOS's
  `item_quantities`); the two that chose a column (NodeDR, RFID Ref) both produced drift-prone designs.
- **Every mutation pairs the balance write and the movement write inside one transaction.** All four of
  YourGbDev's call sites do this (`InventoryService.php:65-66`, `PurchaseOrderService.php:131-132`,
  `SalesService.php:141-142`, `SalesService.php:233-234`). OSPOS gets this right on the sale path and wrong on
  the adjustment path (no transaction at all) and catastrophically wrong in CSV import (absolute count into a
  delta ledger). This invariant is the whole design.
- **`SELECT … FOR UPDATE` on the stock row at every mutating site.** Belt-and-braces on top of the transaction.
- **Signed deltas in the movement table**, with the direction explicit. Not RFID Ref's
  type-implied-direction scheme, and not OSPOS's string-comment convention.

**What to add that no repository has:** a `stock_balances` cache with a **continuous reconciliation job** that
proves `SUM(movements) == balance` and alerts. OSPOS's `Inventory::reset_quantity()` is the right *detector*
and the wrong *repair* — it overwrites the balance, which is how the CSV-import corruption becomes permanent.

### **REIMPLEMENT** — stock reconciliation, cycle counting, reservation

**REIMPLEMENT from scratch. No repository has any of it.** OSPOS's adjustment is a signed delta with a free-text
comment — there is no count sheet, no counted-quantity concept, no variance, no approval. The only trace of
reconciliation anywhere is a documented manual `SUM()` query in an unlicensable repo's docs.

Reconciliation is not "adjust stock with a reason". It is: freeze a location → count lines with expected vs
counted → compute variance → require approval above a threshold → post an `ADJUSTMENT` or `COUNT_VARIANCE`
movement. None of that exists anywhere.

**Stock reservation:** OSPOS's suspended sales **do not hold stock**. A reserved-stock model is greenfield.

---

## Product Catalog, SKU, Barcode

### **REIMPLEMENT** — but OSPOS's barcode *library* is the one thing worth studying closely

**Product catalog / SKU:** `REIMPLEMENT`. None of the five models variants, and SmartStore needs them.
OSPOS's attribute system (`attribute_definitions` / `_values` / `_links`, with links to item **or** sale **or**
receiving) is the most extensible extension mechanism found and is a genuinely good idea — but the code is
license-blocked and the schema is MySQL-specific in places.

**Barcode:** `REIMPLEMENT`. OSPOS has the only serious implementation — `Barcode_lib` over
`Picqer\Barcode\BarcodeGeneratorSVG`, **30 symbologies** (C32…PHARMA2T), per-item label sheets via
`Items::getGenerateBarcodes()` → `barcodes/barcode_sheet`, tested by `Barcode_libTest`. NodeDR has
jsbarcode + QR + ZXing camera scanning + keyboard-wedge support. These are the two capabilities SmartStore
needs, and neither codebase may be used.

*Design references:* the symbology list from OSPOS; NodeDR's `useBarcodeScanner` hook pattern (keyboard wedge +
camera) since that is the part OSPOS lacks — OSPOS's scanning is `LIKE` matching on `item_number`/`name` with
no GS1 parser and no hardware integration.

**Note on a dependency, not a repository:** the barcode *library* itself is third-party (OSPOS uses
`picqer/php-barcode-generator` — **LGPL-3.0-or-later**; NodeDR uses `jsbarcode` — MIT). If SmartStore selects a
barcode library directly, that library's license governs it, not OSPOS's. This is worth knowing: the barcode
capability could be obtained **without touching either license-blocked repository** by depending on
`jsbarcode` or a permissively-licensed equivalent directly.

---

## Purchasing, Suppliers, Receiving

### **REIMPLEMENT** — split verdict by repository

| Repository | Purchasing capability | Decision |
|---|---|---|
| **OSPOS** | Suppliers ✅, receiving ✅, **purchase orders ❌**, partial receiving ❌, supplier returns ❌, PO↔receipt matching ❌, supplier payables ❌ | REFERENCE ONLY |
| **NodeDR** | **Nothing** — no `Supplier` model in the schema at all | — |
| **YourGbDev** | Suppliers ✅, POs ✅, receiving ✅ — but all-or-nothing, no GRN entity, no supplier invoice number, no per-line `received_qty` | `DO NOT USE` |
| **RetailPOS** | **Nothing** | `DO NOT USE` |
| **RFID Ref** | Suppliers ✅, POs ✅, GRN ✅ — but partial receiving is vestigial and there is **no over-receipt guard** | REFERENCE ONLY |

**Why reimplement:** the single most valuable schema in this group is RFID Ref's `GoodsReceiptItem`
(`QuantityReceived`, `QuantityAccepted`, `QuantityRejected`) with `ReceiptStatus { Open, Partial, Closed,
Rejected }`. **Those are exactly the right columns and the right state machine for a GRN — and the code that
populates them does not work.** `GoodsReceiptsController.cs:52` hardcodes `Status = ReceiptStatus.Closed`,
never writes `QuantityAccepted`/`QuantityRejected`, never compares received against ordered, and
unconditionally sets `po.Status = OrderStatus.Received`. Worse, `product.StockQty += item.QuantityReceived`
runs against a `PurchaseOrderId` validated only for existence — **you can receive any quantity of any product
against any purchase order.** An over-receipt guard is mandatory and is a one-line fix that was never written.

Take the **column set and the enum** as the design. Build the logic, the over-receipt guard, the PO↔receipt
matching, and the partial-receiving flow from scratch.

**Also greenfield:** supplier balances/payables (absent everywhere), supplier returns/vendor credit (absent
everywhere), three-way match (absent everywhere), landed-cost/freight allocation (absent everywhere).

---

## Returns & Refunds

### **REIMPLEMENT** — and take NodeDR's capping rule as the design

**Why reimplement:** all three implementations are defective in instructive ways, and the one repository with a
correct *model* is AGPL-blocked and the one with correct *columns* has an exploitable implementation.

- **OSPOS:** models a return as a sale document with negative-quantity lines (`sale_type = 4`, set by
  backfilling any sale with a negative line). It works and is transactional, but there is no per-line cap on how
  much can be returned, and it conflates "return" with "sale" at the document level.
- **NodeDR:** the best model — a distinct `Return`/`ReturnItem` pair, each line capped at
  `quantity_sold − quantity_already_returned`, with returned-so-far computed from the rows. Plus
  `refundMethod: CASH | UPI | CARD | DUE_ADJUST`, and `Invoice.refundValue` / `refundMode` on the sale. This
  is the design SmartStore should follow.
- **RFID Ref:** **exploitable.** Unauthenticated, unbounded, repeatable stock inflation. See
  [security-comparison.md](security-comparison.md).
- **YourGbDev / RetailPOS:** absent entirely.

**Design to adopt:** distinct return documents; per-line cap against remaining returnable quantity; explicit
refund tender and settlement mode; a `ReturnReason` enum; and a return that always posts a paired stock
movement inside one transaction.

---

## Customers, Credit, Loyalty

### **REIMPLEMENT** — NodeDR's credit design is the only correct one, and it is AGPL

**Customer credit / due — the one place NodeDR is genuinely the best.** `Customer.totalDue` plus a
**`CustomerDuePayment` table as a separate audit trail** rather than just decrementing a balance, plus
`Customer.creditBalance` for store credit owed *to* the customer (from a return kept as balance), plus
`Invoice.dueAmount` / `previousDuePaid` / `creditApplied` / `refundValue` / `refundMode` for settling old due
as part of a new bill. The schema comments reason explicitly about why each field exists.

Take the **field set and the audit-trail pattern.** Do not take the code (AGPL). Note also that NodeDR stores
money as `Float` — **do not copy that.** SmartStore needs integer minor units.

**Everywhere else, credit/AR is absent:** OSPOS has `credit` only as a *payment-type label* and an `amount_due`
that is a transient computed alias never persisted; YourGbDev requires full payment at checkout; RetailPOS and
RFID Ref have nothing. Credit terms, credit limits, AR aging, statements — all greenfield.

**Loyalty:** OSPOS (packages, `customers_points`, `sales_reward_points`, concurrency-tested
`adjustRewardPoints()`) and NodeDR (per-invoice earn/redeem) both have working implementations.
RFID Ref's `Customer.LoyaltyPoints` is a **dead column** — one occurrence in the whole repo, never read or
written. SmartStore needs a tiered scheme, which neither implements.

**Design to adopt:** OSPOS's `customers_packages` / `customers_points` split (tier definition separate from
point accrual) plus a `DECIMAL(18,4)` points ledger rather than OSPOS's `float`.

**Purchase history:** present in OSPOS (sales by customer, reports) and absent as a first-class feature
elsewhere. No repository exposes a per-customer purchase-history endpoint as a capability.

---

## Stores, Warehouses, Transfers

### **REIMPLEMENT** — this is 100% greenfield

| Repository | Stores | Warehouses | Transfers |
|---|---|---|---|
| OSPOS | ❌ | ❌ (`stock_locations` is a flat list, no type/parent/address) | **P — faked** |
| NodeDR | ❌ | ❌ | ❌ |
| YourGbDev | ❌ | ❌ | ❌ |
| RetailPOS | ❌ | ❌ | ❌ |
| RFID Ref | ❌ | ❌ | ❌ (`InventoryTransactionType.Transfer = 3` — **an enum member with zero implementation**) |

**OSPOS's transfer "implementation" is worth understanding precisely so it is not mistaken for prior art.**
`Receivings::postRequisitionComplete()` (`Receivings.php:388`) simulates a location-to-location move by
rewriting the cart as **two opposite-signed receiving lines under one `receivings` header**:

```php
$this->receiving_lib->add_item($item['item_id'],  $item['quantity'], $this->receiving_lib->get_stock_destination(), …);
$this->receiving_lib->add_item($item['item_id'], -$item['quantity'], $this->receiving_lib->get_stock_source(), …);
```

Stock is conserved, so it "works" — but it produces **no in-transit state**, **no source/destination pairing
record**, no dispatch/receipt events, and no way to report goods in transit. It also bypasses the
"cannot receive at the same location" check by comparing only source-vs-destination identity.

**SmartStore needs a real transfer document:** `transfers(id, from_location_id, to_location_id, status,
dispatched_at, received_at, …)` with `transfer_lines`, a `IN_TRANSIT` location or equivalent, and paired
`TRANSFER_OUT` / `TRANSFER_IN` movements. That is greenfield.

**Also note OSPOS's `permissions.location_id` auto-grant behaviour** (`Employee.php:236-260`): every newly
created location is auto-granted to every employee, and data-layer queries do not enforce the scoping. SmartStore
must not inherit either.

---

## POS Terminals, Cash Drawers, Shifts

### **REIMPLEMENT** — 100% greenfield, zero prior art

| Repository | Terminals | Cash drawers | Shifts |
|---|---|---|---|
| OSPOS | ❌ | ❌ | ❌ |
| NodeDR | ❌ | ❌ | ❌ |
| YourGbDev | ❌ | ❌ | ❌ |
| RetailPOS | ❌ | ❌ | ❌ |
| RFID Ref | ❌ | ❌ | ❌ |

**The closest thing anywhere is OSPOS's `cash_up` table, and it is not a shift system.** It is a per-employee
open/close record: `open_date`, `close_date`, `open_amount_cash`, `transfer_amount_cash`, `closed_amount_cash/
card/check/total/due`, `open_employee_id`, `close_employee_id`. There is **no terminal or drawer identifier**,
**no expected-vs-counted variance field**, **no shift concept**, and **no link from a cash-up to the sales it
covers** — so it cannot answer "was there a shortfall at close?".

What OSPOS *does* get right, and should be copied as a principle: the controller **discards the client total and
recomputes server-side**, forcing `open_employee_id` to the authenticated user. Two tests cover it
(`testTamperedTotalIsRecomputedServerSide`, `testConsistentTotalIsStoredAndOwnerIsForcedToAuthenticatedUser`).
**Never trust a client-supplied total or a client-supplied actor identity.**

**SmartStore needs:** `terminals` (bound to a store, with a device identity and a revocation state),
`shifts` / `cash_sessions` (opening float, expected by system, counted, variance, opened/closed by, timestamps,
and a required reason + manager approval for any variance), and **every sale bound to a `terminal_id` and
`shift_id`**. That last binding is what makes cash reconciliation possible at all, and nothing in any repository
has it.

---

## Authentication & RBAC

### **REIMPLEMENT** — take the best *idea* from each, none of the code

**All five are legal-blocked for code reuse.** OSPOS and NodeDR pending counsel; the other three are hard
prohibitions. But the *design* knowledge here is the most valuable in the whole phase, because each repository
demonstrates a different lesson.

| Design element | Best implementation | Why |
|---|---|---|
| **Uniform-timing login** | YourGbDev (`AuthController::passwordMatches()`) | Falls back to a cached dummy bcrypt hash for unknown emails, so bcrypt cost is identical for existing and non-existent accounts. **Prevents user enumeration by timing.** Almost no project does this. |
| **Immediate deactivation** | YourGbDev (`Auth.php:37-42`) **and** NodeDR (`requireAuth`) | Both re-read the user from the database on every request, so a disabled account is locked out immediately rather than at token expiry. NodeDR's comment names the reason. |
| **Step-up re-authentication** | NodeDR (`requirePasswordConfirm`) | Sensitive actions (staff management, shop/tax settings, refunds, store credit) re-check the password inline instead of relying on session length — **and** the step-up check has its own failed-attempt budget, because a valid-but-stolen session could otherwise brute-force it unthrottled. |
| **Central enforcement point** | OSPOS (`Secure_Controller::__construct`) | The grant check is in the constructor, so it runs on **every** action including POST. Structurally correct. |
| **Permission scoping in the schema** | OSPOS (`permissions.location_id`) | Grants are per-location in the schema, not bolted on. (But the *queries* don't enforce it — see below.) |
| **Privilege-escalation prevention** | OSPOS (`Employees.php:175`, `:184`) | A user cannot grant permissions they do not themselves hold. Tested. |
| **Session fixation defence** | YourGbDev (`session_regenerate_id(true)`) | NodeDR and OSPOS: OSPOS's is **broken** (guarded behind `session_status()`, which is false for CI4's `DatabaseHandler`). YourGbDev does it unconditionally. |
| **Password hash upgrade** | YourGbDev (`password_needs_rehash()` on login) | OSPOS has the md5→bcrypt migration path but no rehash-on-login. |
| **Anti-enumeration admin model** | OSPOS (`Employee::isAdmin()`) | `person_id === 1` is special-cased rather than a role string, so the admin account cannot be demoted by editing a role row. |
| **Secret management** | OSPOS (`security_helper.php`) | `flock` + `fsync` + atomic rename + `O_EXCL` + rollback-before-release on any `Throwable`. Best-engineered secret handling found in this phase. |
| **Rate limiting** | OSPOS (`Throttle.php`) | Dual IP **and** normalised-username buckets, keys HMAC-SHA256'd with an auto-generated persistent secret, HTTP 429, 8 tests against real cache state. |

**Three anti-patterns to avoid, each demonstrated:**
1. **OSPOS's fail-open on a null permission ID** (`Employee.php:474-476`, commented *"If no module_id is null,
   allow access"*) plus a **prefix LIKE match** in `has_module_grant()` so a grant named `items` also satisfies
   `items_x`.
2. **OSPOS's location scoping in the UI only.** `Stock_location` scopes the dropdowns; `Sale::create_temp_table()`,
   `get_all_suspended()`, and `get_sale()` apply **no location predicate**. The grant structure implies a
   boundary the queries do not enforce — and new locations are auto-granted to everyone.
3. **RFID Ref's stored-but-unenforced permissions.** `Role.PermissionsJson` exists, `RolesController` CRUD
   exists, and **nothing reads it** — 16 of 18 controllers have no `[Authorize]` and there is no fallback policy.

**SmartStore's design:** Argon2id or bcrypt cost ≥12; sessions not JWT for the web/POS surface; one central
authorization middleware; permissions scoped by `(store_id, module, action)`; **row-level store scoping enforced
in the data layer on every query**; explicit password policy on the admin path; and a real audit trail — none of
which is fully present in any repository.

---

## Audit Logging

### **REIMPLEMENT** — YourGbDev is the only design worth following, and it is `DO NOT USE`

| Repository | Audit state |
|---|---|
| **YourGbDev** | ✅ Append-only, 24 write sites across 10 services, actor + entity + details + IP + user agent. **No license.** |
| **OSPOS** | ❌ None. No table; and no `created_at`/`updated_at` on any business table, so it **cannot be retrofitted cheaply.** |
| **NodeDR** | ❌ None — on a system that implements refunds and store credit. |
| **RetailPOS** | ❌ None. |
| **RFID Ref** | ❌ `AuditLog` written only by RFID scans. `IpAddress` and `PerformedByUserId` never populated despite `AuditActionType` having unused `Login`/`Logout` members. |

**Why reimplement rather than adopt YourGbDev's schema:** its design is right but incomplete for SmartStore's
needs, and its three known defects need fixing anyway:

- **No reads and no failed logins are audited** — so data exfiltration via `GET` leaves no trace.
- **`AuditService::record()` swallows all exceptions** (`AuditService.php:42-47`) — a full audit table silently
  loses entries.
- **No database-level immutability** — no trigger, no `REVOKE UPDATE`. An app bug or a SQL console can rewrite history.

**SmartStore's design, each point driven by an observed failure:** write the audit row **inside the same
transaction** as the business change (so a failed audit cannot leave an unlogged write — the exact failure in
YourGbDev's non-transactional `UserService::create`); log **authentication success, failure, and logout** (the
capability OSPOS and NodeDR both lack and OSPOS additionally discards by default via
`logger.threshold=0`); log **permission and configuration changes** (the highest-value events to audit); add a
**request/trace id** so an offline terminal's queued transactions remain attributable; and enforce immutability
at the database level.

---

## Reporting

### **REIMPLEMENT** — OSPOS has the only substantial reporting implementation, and it is MySQL-bound

**OSPOS's reporting is the best here** — 21 report models across `app/Models/Reports/` (`Summary_*` ×10,
`Detailed_*`, `Specific_*`, `Inventory_*`), with real tests on `Summary_discounts` and `Summary_taxes`, and
7-format export. Its architecture is nonetheless wrong for reuse: reporting is
`CREATE TEMPORARY TABLE … AS SELECT` raw SQL (`Sale.php:1040`, `Receiving.php:343`), which **bypasses the Query
Builder entirely and makes reports non-portable off MySQL**.

**NodeDR** has dashboard + charts. **YourGbDev** has 5 report endpoints. **RetailPOS has no reporting at all** —
its "Sales Report" nav item's two children are copy-pasted attendance paths
(`navigations.js:195-210`: `'Take Advance'` → `/attendance/take`, `'Manage Attendance'` → `/attendance/manage`).
**RFID Ref** has 6 endpoints but no profit/margin.

**Design to adopt:** OSPOS's report *taxonomy* (summary vs detailed vs specific) is sound and worth mirroring.
**Design to avoid:** MySQL temporary tables. Reports must be portable and — more importantly — reports over
stock must read from the **ledger**, not from a denormalised balance, or they will disagree with the
reconciliation job.

**Note the export design lesson:** OSPOS's export is entirely client-side (Bootstrap Table ships the full dataset
to the browser and converts to csv/xml/txt/sql/xlsx/pdf). That does not scale past a few thousand rows and
moves the whole dataset to the client. **Design server-side export with a job queue and a download link.**

---

## Offline & Synchronization

### **REIMPLEMENT** — nothing exists. This is the largest greenfield area in the project.

**The finding that matters most:** **no repository has offline POS.** NodeDR's marketing says "offline-first"
and its `backend/package.json` description says "Offline POS backend" — but this is misleading and must not be
read as prior art.

- NodeDR's backend runs **on the till itself** (SQLite, single Docker container on the till host). There is no
  cloud to sync *with*, so there is no sync problem — rather than a sync solution. Its `useSyncStatus` hook is a
  15-second poll of `GET /health`, described in its own comment as *"is the local backend on this network
  reachable."* Grep for `serviceWorker|workbox|indexedDB|navigator.onLine` across the frontend: **0 matches.**
- The other four have nothing at all. Grep for `offline|serviceWorker|workbox|pwa`: 0 hits in RetailPOS and
  RFID Ref; no `manifest.json`, no `sw.js`, no PWA plugin in YourGbDev; OSPOS is a server-rendered PHP app with
  no client state layer.

**Every requirement in this area is unimplemented anywhere:**

| Requirement | Status across all five |
|---|---|
| Client-side local database | ABSENT |
| Transaction queue | ABSENT |
| Sync engine | ABSENT (NodeDR has a health poll) |
| **Idempotency** | One `idempotency_key_hash` UNIQUE column in YourGbDev — **unlicensable, and dropped from that repo's own migration baseline** |
| Retry / backoff | ABSENT |
| Conflict resolution | ABSENT |
| Device clock handling | ABSENT |
| Sync telemetry | ABSENT |

**This must be designed from first principles**, and it drives several upstream decisions:

1. **Idempotency keys on every financial mutation are a prerequisite, not a feature.** Without them, a retried
   checkout after a dropped response double-charges. Design this first, in the core, before any endpoint
   exists.
2. **A monotonic per-device sequence number** and a **server-side last-write-wins or explicit-conflict policy
   per entity type** must be decided up front. Inventory is the hard case: two terminals selling the last unit
   offline both succeed locally, and the server must have a deterministic resolution rule.
3. **Offline terminals need server-assigned identity and time** so that ordering and attribution survive.
4. **The audit trail must carry the originating terminal and request id**, otherwise a synced transaction is
   unattributable.
5. **Consider server-authoritative stock for the last unit.** A design where a terminal may sell beyond
   on-hand offline and the server reconciles later is a *different product* from one where it may not. This is a
   business decision with a hard technical consequence, and it must be made before the schema is frozen.

---

## RFID & Attendance

### **REFERENCE ONLY (clean-room) — the RFID repository is unlicensed, and its two headline features do not exist**

**The most important finding in this section:** the RFID repository is a **product-tagging POS**. It contains
**no RFID authentication and no RFID attendance**. The `user` variable holds a "staff" type with no badge
field; `AuthController.Login` takes exactly one input, `LoginRequest { Username, Password }`, with no EPC
parameter anywhere in the auth path. Searches for `Attendance`, `Employee`, `ClockIn`, `ClockOut`, `CheckIn`,
`TimePunch` return **zero** matches across `backend/` and `frontend/src/`. `StoreDbContext` has 15 `DbSet<>`
properties and none is attendance-related.

What *is* there: `RfidTags`, `RfidReaderController`, a tag→product lookup, and `RealTimeScans.jsx` — which
labels its scan `readerName: 'Login bridge'` and then has **a human typing an EPC into a text input** before
clicking "Scan".

**RFID is `REFERENCE ONLY`, and specifically:**
- **DO NOT COPY** the LLRP implementation (835 lines in `backend/Llrp/`). Unlicensed.
- **DO study, in a clean-room way,** *that* a real Zebra FX9600 speaks LLRP over TCP on port 5085, that the
  protocol is 10-byte header + TLV parameters with the quirk that parameter length includes the 4-byte
  type+length header, and that an inventory cycle is an `AddROSpec` (AISpec + InventoryParameterSpec +
  ROReportSpec + TagReportContentSelector) followed by `TagReportData` messages. That is protocol knowledge, and
  the EPCglobal LLRP v1.0.1 specification is the correct source for it — not an unlicensed repo.
- **DO copy nothing else.** The four protocol defects documented in
  [repository-rfid-store.md](repository-rfid-store.md) — the broken TV/TLV discriminator, the never-checked
  response status codes, `resetToFactory: true` on every read, and the one-byte desynchronisation on unknown
  parameters — are all reasons to reimplement from the specification rather than to salvage.

**RFID authentication** (badge tap to open a shift / approve a void) and **RFID attendance** (tap in / tap out)
are both **100% greenfield**. The design requirements are: a reader driver abstraction so
`LlrpReaderService` is an *interface* with a Zebra implementation (never a hardcoded `192.168.1.100` with
antennas on ports 1-4 at `transmitPowerIndex: 0`); **event ingestion over a persistent connection with a
background service**, not a request-scoped burst (`ReadTagsAsync` sleeps for the timeout then disconnects, and
swallows all exceptions so a down reader is indistinguishable from an empty store — which is why this repo's
"real-time" feed is a 5-second poll of the audit table); and **an unauthenticated SSRF primitive must not be
recreated** — the reader's address must come from configuration, never from a query parameter.

**Attendance:** also greenfield. The only repo with attendance is RetailPOS — and its implementation is
`att_month` = `date("F")` (month *names*) with a lexicographic `whereBetween` on `d-m-Y` **strings**, which is
**broken across the December→January boundary**. There is nothing to reference even ignoring the license.

---

## Hardware Abstraction

### **REIMPLEMENT** — two narrow, useful references, neither licensable

**Receipt printing.** OSPOS: `dompdf` PDF + Bootstrap Table print, 7 export formats, with per-employee
receipt font/page settings. NodeDR: **raw ESC/POS straight to USB** (`escposUsb.js`, `escposReceipt.js`,
`usb` package) with a paper-width setting and an `autoPrintMethod` of `browser` or `usb` — and its schema
comment explains exactly why: a headless kiosk Debian till where the browser print dialog has no configured
printer would hang the screen after every sale. **That is a real operational lesson worth taking**: a POS must
support direct ESC/POS as well as browser printing.

RFID Ref's receipt is `window.print()` with 80mm `@media print` CSS. Weakest of the three.

**Barcode scanners.** NodeDR has the best pattern: a `useBarcodeScanner` hook covering both a **keyboard-wedge**
scanner (the common case — a scanner is a keyboard that types fast) and a **camera** scanner via `@zxing/browser`.
OSPOS has suggestion APIs but no hardware integration at all; its scanning is `LIKE` on `item_number`/`name`.

**SmartStore's design:** a `PeripheralDriver` interface with implementations for ESC/POS printers, barcode
scanners (wedge + camera), RFID readers, scales, and (per the brief) **ESP32 devices** — with **no** ESP32 or
IoT device management in any repository. Nothing here may be copied; the *interface shape* is the takeaway.

---

## Summary table

| Subsystem | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore action |
|---|---|---|---|---|---|---|
| POS checkout | REFERENCE ONLY | REFERENCE ONLY | DO NOT USE | DO NOT USE | DO NOT USE | **REIMPLEMENT** |
| Inventory ledger | REFERENCE ONLY | **DO NOT USE** | DO NOT USE | — | **DO NOT USE** (a ledger exists, but is not paired with the balance writes) | **REIMPLEMENT** |
| Stock reconciliation | — | — | REFERENCE ONLY (docs) | — | — | **REIMPLEMENT** (greenfield) |
| Product catalog | REFERENCE ONLY | REFERENCE ONLY | DO NOT USE | DO NOT USE | DO NOT USE | **REIMPLEMENT** |
| Barcode | REFERENCE ONLY | REFERENCE ONLY | DO NOT USE | — | — | **REIMPLEMENT** (or depend on a library directly) |
| Purchasing | REFERENCE ONLY | — | DO NOT USE | — | REFERENCE ONLY | **REIMPLEMENT** |
| Suppliers | REFERENCE ONLY | — | DO NOT USE | DO NOT USE | REFERENCE ONLY | **REIMPLEMENT** |
| Receiving / GRN | REFERENCE ONLY | — | DO NOT USE | — | REFERENCE ONLY | **REIMPLEMENT** |
| Returns | REFERENCE ONLY | REFERENCE ONLY | — | — | DO NOT USE | **REIMPLEMENT** |
| Refunds | REFERENCE ONLY | REFERENCE ONLY | — | — | — | **REIMPLEMENT** |
| Customers | REFERENCE ONLY | REFERENCE ONLY | DO NOT USE | DO NOT USE | REFERENCE ONLY | **REIMPLEMENT** |
| Loyalty | REFERENCE ONLY | REFERENCE ONLY | — | — | — | **REIMPLEMENT** |
| Credit / AR | REFERENCE ONLY (design anti-pattern) | REFERENCE ONLY | — | — | — | **REIMPLEMENT** |
| Stores | REFERENCE ONLY | — | — | — | — | **REIMPLEMENT** (greenfield) |
| Warehouses | REFERENCE ONLY | — | — | — | — | **REIMPLEMENT** (greenfield) |
| Transfers | REFERENCE ONLY (faked) | — | — | — | — | **REIMPLEMENT** (greenfield) |
| Terminals | — | — | — | — | — | **REIMPLEMENT** (greenfield) |
| Cash drawers / shifts | REFERENCE ONLY (principle only) | — | — | — | — | **REIMPLEMENT** (greenfield) |
| Authentication | REFERENCE ONLY | REFERENCE ONLY | DO NOT USE | DO NOT USE | DO NOT USE | **REIMPLEMENT** |
| RBAC | REFERENCE ONLY | REFERENCE ONLY | DO NOT USE | DO NOT USE | DO NOT USE | **REIMPLEMENT** |
| Audit | REFERENCE ONLY (absence is instructive) | — | DO NOT USE | — | REFERENCE ONLY (absence) | **REIMPLEMENT** |
| Reporting | REFERENCE ONLY | REFERENCE ONLY | DO NOT USE | — | REFERENCE ONLY | **REIMPLEMENT** |
| Offline | — | REFERENCE ONLY (naming is misleading) | — | — | — | **REIMPLEMENT** (greenfield) |
| Synchronization | — | — | — | — | — | **REIMPLEMENT** (greenfield) |
| RFID | — | — | — | — | REFERENCE ONLY (clean-room) | **REIMPLEMENT** (greenfield for auth/attendance) |
| Attendance | — | — | — | REFERENCE ONLY (broken) | — | **REIMPLEMENT** (greenfield) |
| Hardware abstraction | REFERENCE ONLY | REFERENCE ONLY | — | — | REFERENCE ONLY | **REIMPLEMENT** (greenfield for ESP32) |

**REUSE DIRECTLY: 0 · ADAPT: 0 · REIMPLEMENT: 25 · REFERENCE ONLY: as design input only · DO NOT USE: 3 whole
repositories.**

---

## What this means

The honest summary of Phase 0: **the licensing situation eliminates code reuse entirely, and the architectural
gap would have made it a poor trade anyway.**

If counsel clears OSPOS's license and SmartStore is confirmed to be an aggressively-extended OSPOS fork, Option B
becomes arguable — OSPOS is the only repository with a real test suite, real security engineering, and a real
multi-location stock model. But it would still be a fork of a **single-store** application to add multi-store,
suppliers, purchasing, batches, FEFO, terminals, shifts, offline sync, credit, and audit — most of which have
no prior art anywhere in the five. The foundation would carry its correction debt forward and inherit OSPOS's
**unexploited** cookie-expiry defect, its **partial** location isolation (grants exist, but `Sale.php:1500-1501`
is the only filter point), and a schema with no `created_at` columns to build an audit log on.

> **CORRECTED.** The first draft said Option B would inherit "a session-fixation vulnerability, a broken
> location-isolation model". Both were refuted in the security verification pass. OSPOS sets
> `'http_only' => true` on the session cookie (so the classic cookie-riding fixation path is closed) and
> `supports_credentials => false` in CORS; location isolation is real but inconsistently applied, not absent.
> The qualifier matters: a licence-cleared OSPOS fork would be a **weaker** inheritance than this document first
> claimed, which slightly strengthens Option B — but not enough to change the recommendation, because Option B
> still requires counsel, still forks a single-store application, and still leaves the majority of the required
> features with no prior art.

**Recommendation: Option C. Build clean. Use these five repositories as a map of what has already been solved
and, more usefully, as a map of what has already been got wrong.**
