# Missing Features Analysis

Coverage of every requirement in the SmartStore brief, across all five candidates. SmartStore's target state is
shown as the **required design position** so that "ABSENT" is measured against something, not against nothing.

Status key: **COMPLETE** · **PARTIAL** · **ABSENT** · **UNKNOWN**

---

## Summary counts

| Area | Requirements | Best available | No repo at all |
|---|---|---|---|
| A. Customer & loyalty | 8 | 2 COMPLETE, 3 PARTIAL | 3 |
| B. Credit & due | 4 | 0 COMPLETE, 1 PARTIAL | 3 |
| C. Suppliers & purchasing | 5 | 1 PARTIAL, 4 ABSENT | 3 |
| D. RFID | 6 | 1 PARTIAL, 5 ABSENT | 4 |
| E. Attendance | 5 | 1 PARTIAL, 4 ABSENT | 3 |
| F. Reporting | 7 | 0 COMPLETE, 3 PARTIAL | 2 |
| G. Offline & sync | 4 | 0 COMPLETE, 4 ABSENT | 4 |
| H. Payments & receipts | 5 | 2 PARTIAL | 1 |
| **Total** | **44** | **6 COMPLETE · 17 PARTIAL · 21 ABSENT** | |

**No repository is COMPLETE for any of the seven requirement areas.** NodeDR covers the most requirements at
least partially (24 of 44) and is the only one with a full-stack deployment, real payment flows, customer credit,
and returns — and it is AGPL. RFID Ref is the only one with hardware, and it is unlicensed.

---

## A. Customer & loyalty

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| A1 | Customer CRUD | **COMPLETE** — `app/Controllers/Customers.php`, generic DataTable CRUD, 6 tests | **COMPLETE** — `prisma/Customer`, `customersApi.js` | **PARTIAL** — `Customer.php` has `getAll/list/search/getById/create/update/delete`, but `getAll` ignores its own `$filters` parameter | **PARTIAL** — `crud.js:63-77` CRUD table; page routes wired; the React form is disconnected (`Customer` renders a `MainCard` with no action prop) | **PARTIAL** — `Customer.cs` has CRUD properties only; no `CustomerController` exists in the 18-controller set |
| A2 | Customer history | **COMPLETE** — `Sales::get_by_customer($customer_id)`, one-rep customer view shows all their sales | **PARTIAL** — `customersApi.js` has `getCustomerSales(customerId)`; never called in the React app (only 2 fetch sites) | **ABSENT** | **ABSENT** | **ABSENT** |
| A3 | Loyalty earn | **COMPLETE** — `sales_reward_points` 1-to-1 with `sales`, concurrency-tested `adjustRewardPoints()` | **COMPLETE** — `updateLoyaltyPoints(customerId, points, orderId)`, rollup into `Customer.totalLoyaltyPoints` | **ABSENT** | **ABSENT** | **PARTIAL** — `Customer.LoyaltyPoints` is a **dead column**: one occurrence repo-wide, never read or written |
| A4 | Loyalty redeem | **COMPLETE** — `Reward_point_redeem_amount` on the sale, `module: ` includes items the rep had to pay cash for; `adjustRewardPoints()` adds the negative | **PARTIAL** — `redeemLoyaltyPoints` decrements, and the store disables the button when the balance is insufficient | **ABSENT** | **ABSENT** | **ABSENT** |
| A5 | Credit balance (owed **to** customer) | **ABSENT** — `amount_due` is a transient `Alias` never persisted; no credit-balance entity | **COMPLETE** — `Customer.creditBalance` = store credit owed to the customer, incremented by a return kept as balance, with a documented note that it is a *design decision* not standard practice | **ABSENT** | **ABSENT** | **ABSENT** |
| A6 | Loyalty tiering | **PARTIAL** — packages + points; `Customers::get_loyalty_options()` is a manual per-customer assignment, and `Customers_packages.points_earned` records points against the *point value*, so the assignment is effectively a flat number | **ABSENT** — a single earn-rate constant, no tiers | **ABSENT** | **ABSENT** | **ABSENT** |
| A7 | Customer statements | **ABSENT** | **PARTIAL** — `getCustomerSales(customerId)` exists, plus a `getCustomerBalance` → `/customers/:id/balance`; a due-payment list is hardcoded `mockPaymentData` | **ABSENT** | **ABSENT** | **ABSENT** |
| A8 | Purchase-history endpoint | **COMPLETE** — server-side, filtered by customer | **PARTIAL** — implemented, never surfaced | **ABSENT** | **ABSENT** | **ABSENT** |

**Notes.** A5 and A6 are the interesting gaps: only NodeDR models credit *to* the customer, and only OSPOS has
any loyalty programme structure. **No repository has tiered loyalty** — both implementations are single-rate.

---

## B. Credit & due

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| B1 | Credit sale (partial payment accepted) | **PARTIAL** — `credit` is a payment *type*, but `Receivings`/`Sales` still require a payment per tender line. A `credit` line is accepted and recorded, but there is no due-tracking follow-up | **COMPLETE** — full credit flow; `dueAmount` computed server-side, validated, and persisted | **ABSENT** — checkout requires full payment (`amount_due > 0` → 400 "Insufficient payment") | **ABSENT** | **ABSENT** |
| B2 | AR aging / due tracking | **ABSENT** — no customer-ledger entity; no aging report | **PARTIAL** — `totalDue` on the customer, but no aging buckets; oldest-first settlement is computed client-side in `handlePaymentSubmit.js` | **ABSENT** | **ABSENT** | **ABSENT** |
| B3 | Due-payment ledger / audit trail | **ABSENT** | **COMPLETE** — `CustomerDuePayment` as a **separate audit-trail table**, not a balance decrement, with `Amount`, `Date`, `SaleId`, `CollectedByUserId` | **ABSENT** | **ABSENT** | **ABSENT** |
| B4 | Credit limit | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |

**Notes.** B3 and B4 are the only two requirements in this area met by exactly one repository each, and both by
the AGPL one. **AR aging and credit limits are greenfield everywhere** — and they are the two things a
multi-store retail system cannot go without, because without a credit limit an over-limit customer can be
declined nowhere.

---

## C. Suppliers & purchasing

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| C1 | Supplier management | **PARTIAL** — `app/Controllers/Suppliers.php`, `Suppliers` extends `My_DataTable` and the test **skips the class entirely** (`@group disabled`); no `created_at` on the table | **ABSENT** — **no `Supplier` model in the schema at all** | **PARTIAL** — `Supplier.php` CRUD + the *only* `DEFAULT CURRENT_TIMESTAMP` in the schema (`suppliers.created_at`) | **ABSENT** | **PARTIAL** — `Supplier.cs` + `SuppliersController.cs` (create/update/delete), **but no route for reading suppliers** — the `api.php` entry is commented `// ->supplierApi->route('api/suppliers', 'supplierApi::index');` |
| C2 | Purchase orders | **ABSENT** — no PO entity anywhere. `Receivings` doubles as a receipt, with a comment noting "purchase order" was deliberately not split out | **ABSENT** | **PARTIAL** — `purchase_order.php` (PO number, supplier, line items, amounts, `status`), `purchaseOrderApi.js` | **ABSENT** | **PARTIAL** — `PurchaseOrder.cs` + `PurchaseOrderController.cs` (create, update, `GetItemsByPurchaseOrder`, `getAll` uses an **unfiltered** `ToListAsync`) |
| C3 | Goods receipt note | **PARTIAL** — `receivings` is the receipt but there is no *document separate from receiving*; `ref_no` is free text and a **not-null-but-unset** field in practice | **ABSENT** | **PARTIAL** — `createGRN` writes PO status/received-count fields directly; **no GRN entity**, no GRN number, no supplier invoice number | **ABSENT** | **COMPLETE (schema) / PARTIAL (code)** — `GoodsReceipt.cs` + `GoodsReceiptItem.cs` have exactly the right columns (`QuantityReceived/Accepted/Rejected`) and `ReceiptStatus { Open, Partial, Closed, Rejected }`, but `GoodsReceiptsController.cs:52` hardcodes `Status = Closed`, never writes Accepted/Rejected, and never compares received vs ordered. **No over-receipt guard** |
| C4 | Partial receiving | **PARTIAL** — a receiving line is one whole receipt; there is no received-vs-ordered state to accumulate against, and the whole receiving operation is non-transactional, so a mid-post failure leaves stock without a receipt | **ABSENT** | **ABSENT** — all-or-nothing: receiving a PO posts all its lines or errors | **ABSENT** | **ABSENT in effect** — the `receiving_status` field and the partial-receipt code path are vestigial: no receiving-status update exists, and every PO receipt sets `po.Status = Received` |
| C5 | Supplier balance / payables | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |

**Notes.** C3 is the closest call in this document: RFID Ref's GRN **data model is the right one** and its
implementation does not work. C4's absence is absolute — the only two repos with a PO entity (YourGbDev, RFID
Ref) both receive all-or-nothing, and OSPOS's implicit receiving has no accumulation logic. **Supplier
payables (C5) is absent in all five**, so the "suspended purchase order" pattern has no prior art.

---

## D. RFID

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| D1 | RFID hardware integration | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **COMPLETE (vendor-specific)** — `RfidReaderController`, `RfidTag`, `RealTimeScans`; Zebra FX9600 over LLRP, TCP 5085; 8 LLRP classes; 835 lines |
| D2 | RFID tag binding | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **PARTIAL** — `RfidTags` (`ProductId`, `Epc`); tag binding is a `Set` call with no idempotency and no uniqueness enforcement at the application layer |
| D3 | RFID authentication | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** — the auth path is `AuthController.Login(LoginRequest { Username, Password })` with **no EPC parameter**; the `user` variable holds a "staff" type with no badge field; `RealTimeScans.jsx` labels its scan `readerName: 'Login bridge'` but then has a human typing an EPC into a text input before clicking "Scan" |
| D4 | RFID attendance | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** — `grep -riE "attendance\|employee\|clockin\|clockout\|checkin\|timepunch"` across `backend/` and `frontend/src/` returns **0 matches**; `StoreDbContext` has 15 `DbSet<>` and none is attendance |
| D5 | RFID event streaming | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **PARTIAL** — the frontend **polls the audit table every 5 seconds**; there is no push, no reader-side service, and no queue. `ReadTagsAsync` sleeps for the timeout then disconnects |
| D6 | RFID reader abstraction | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** — `LlrpReaderService` is a concrete class hardcoding IP `192.168.1.100`, TCP 5085, antennas `1,2,3,4`, `transmitPowerIndex: 0`; a reader has no `IP` property, so `RfidReaderController.Update` is unreachable |

**Notes.** This is the largest single gap in the phase. The brief's two most distinctive RFID features —
**badge-tap authentication and tap-in/tap-out attendance — do not exist in the only repository that has RFID at
all.** D6 is architecturally load-bearing: because the reader is hardcoded and unreachable via the API, every
other RFID subsystem must be reimplemented behind an interface regardless of license.

---

## E. Attendance

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| E1 | Clock in / out | **ABSENT** | **ABSENT** | **ABSENT** | **PARTIAL** — `AttendanceController` (`/api/attendance/punch`), `EmployeeAttendance` with `d { get; set; }` + `status`; `CheckIn()` and `CheckOut()` both **insert a new row** rather than closing the open one | **ABSENT** |
| E2 | Attendance history | **ABSENT** | **ABSENT** | **ABSENT** | **PARTIAL** — `/api/attendance/filter?month=YYYY-MM` | **ABSENT** |
| E3 | Late / early tracking | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** — no late/early logic; `/attendance/take` and `/attendance/manage` are the same month-name/`d-m-Y`-string filter as E5 | **ABSENT** |
| E4 | Working-hours calculation | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |
| E5 | Report generation | **ABSENT** | **ABSENT** | **ABSENT** | **PARTIAL (documented) / ABSENT (working)** — `GET /attendance/report`, `GET /attendance/monthly-report`, `GET /attendance/take`, `GET /attendance/manage` all exist; the first two filter on `att_month = date("F")` (**month *names***) with a **lexicographic** `whereBetween` on `d-m-Y` **strings** |

**Notes.** Attendance exists in exactly one repository and it is broken in a way that only shows up in
production: `whereBetween("d", "01-" . $month . "-" . $year, "31-" . $month . "-" . $year)` compares strings, so
`"31-December-2025"` correctly sorts after `"01-December-2025"`, but the whole comparison is string-based —
any year or date-format inconsistency silently returns wrong rows, and the month *name* key breaks entirely
if the system locale or a multi-language deployment changes it. The deeper design flaw is E1: **inserting a row
per punch with no open/close state** means "total hours worked" is not expressible without a fold that the schema
does not support. Greenfield.

---

## F. Reporting

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| F1 | Sales reports | **COMPLETE** — 21 report models in `app/Models/Reports/`; `Summary_sales` is the flagship (hourly / day-of-week / month / year / payment-type / salesperson / category / item breakdown) | **PARTIAL** — `GET /sales/report` (sales + products + customers + time trend) and a dashboard | **PARTIAL** — `report.php` + `reportApi.js`; 5 endpoints: summary, sales, inventory, top-customers, top-products | **ABSENT** — `SalesReport.jsx` is a hardcoded `tableDataOfMock`; nav points "Sales Report" → `/attendance/take` and "Manage Attendance" → `/attendance/manage` (`navigations.js:195-210`, copy-paste) | **PARTIAL** — 6 endpoints (`getSalesReport`, `getMonthlySales`, `getTopProducts`, `getDashboardSummary`, `getPaymentReport`, `getCustomerReport`) but all read `paymentRecords` only — **no margin, no cost** |
| F2 | Inventory reports | **COMPLETE** — `Inventory_summary` ×3 (total value by category/brand/item), `Inventory_low_items`, `Inventory_items` | **PARTIAL** — `GET /inventory/reports` with an analytics view, plus 4 lightweight counts | **PARTIAL** — `getInventoryReport` (total product count, total inventory value, low stock, out of stock) | **ABSENT** | **ABSENT** — `RfidTags` are tag records, not inventory |
| F3 | Financial / P&L | **PARTIAL** — `Summary_profit` exists (gross from COGS, expenses) but `Expenses` is a single manual-entry table; no taxes/fees integration | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |
| F4 | Customer reports | **COMPLETE** — 10 `Summary_*` reports covering customers, invoices, sales by customer, items sold | **PARTIAL** — `getTopCustomers` | **PARTIAL** — `getTopCustomers` | **ABSENT** | **PARTIAL** — `getCustomerReport` (sales per customer) |
| F5 | Supplier reports | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |
| F6 | Export | **COMPLETE** — 7 formats (csv, xml, txt, sql, xlsx, pdf) — but **client-side**: Bootstrap Table ships the full dataset to the browser and converts there | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |
| F7 | Report export to Excel/CSV | **COMPLETE** (same as F6) | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |

**Notes.** F5 and F7's server-side story are the two report gaps that matter commercially. F1's completeness in
OSPOS is genuine but **MySQL-bound**: every report is `CREATE TEMPORARY TABLE … AS SELECT` raw SQL
(`Sale.php:1040`, `Receiving.php:343`), so the model layer's portability discipline is bypassed for reporting.
F6's client-side export will not survive a 50k-row sales history.

---

## G. Offline & sync

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| G1 | Offline POS mode | **ABSENT** — server-rendered PHP, no client state layer, no service worker, no manifest, no IndexedDB | **PARTIAL (naming only)** — `backend/package.json` describes an "Offline POS backend" and the marketing says "offline-first", but the backend **runs on the till itself** (SQLite, single container on the till host). There is no second node to sync with, so this is a *deployed topology*, not a sync capability. `useSyncStatus` is a 15-second poll of `GET /health`, described in its own comment as *"is the local backend on this network reachable"* | **ABSENT** | **ABSENT** — no service worker, no manifest, no PWA plugin | **ABSENT** |
| G2 | Client-side local database | **ABSENT** | **ABSENT** — `grep -E "serviceWorker\|workbox\|indexedDB\|navigator.onLine"` across the frontend: **0 matches** | **ABSENT** | **ABSENT** | **ABSENT** |
| G3 | Sync engine / conflict resolution | **ABSENT** | **ABSENT** — no queue, no replay, no conflict policy | **ABSENT** | **ABSENT** | **ABSENT** |
| G4 | Idempotency | **ABSENT** | **ABSENT** | **PARTIAL** — one `idempotency_key_hash` UNIQUE column in `migrations/001_baseline.sql`, **and it is dropped** from that repo's own later migration baseline. No code reads it | **ABSENT** | **ABSENT** |

**Notes.** **This is the widest gap in the entire phase: nothing exists.** G1 is worth reading carefully because
NodeDR's "offline-first" marketing claim could be mistaken for prior art during architecture work — it is not.
The only trace of idempotency anywhere is a single unlicensable column that its own repo abandoned.

**Downstream design consequences** (these must be settled before the schema is frozen):

1. **Idempotency keys on every financial mutation are a core prerequisite**, not a sync feature. A terminal that
   loses the response to a completed checkout and retries must not double-charge.
2. **Inventory conflict resolution is the hard case.** Two terminals selling the last unit while both are offline
   both succeed locally. The server needs a deterministic rule — and the choice is a *product* decision:
   allow the oversell and reconcile later, or reserve server-side.
3. **A monotonic per-device sequence and server-assigned identity/time** are needed so ordering and attribution
   survive sync.
4. **The audit trail must carry the originating terminal and a request id**, or synced transactions become
   unattributable — which is exactly the gap that makes OSPOS's lack of an audit table unfixable in retrofit.

---

## H. Payments & receipts

| # | Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|---|
| H1 | Cash | **COMPLETE** — `payments` 6-type, `amount_tendered` + `change_due` | **COMPLETE** — `Cash` component, ₹20/₹50 quick amounts, change calculation | **PARTIAL** — `Payment.php` with `transaction_id` | **ABSENT** | **PARTIAL** — `Payment` `Method` enum includes Cash |
| H2 | Card | **COMPLETE** — `cards` type, 6 brands in `Payments` | **PARTIAL** — `CardPayment` with a 6-month validation and a gateway abstraction | **ABSENT** | **ABSENT** | **PARTIAL** — `Card` enum value |
| H3 | UPI / mobile | **COMPLETE** — `mobile` type (covers UPI and mobile wallets) | **COMPLETE** — `UpiPayment` with gateway abstraction | **ABSENT** | **ABSENT** | **ABSENT** |
| H4 | Receipts | **COMPLETE** — `receipt_number` auto-increment, viewable, printable, per-employee font/page settings, dompdf PDF, 7 export formats | **COMPLETE** — `Invoice` entity, `bill-receipt.js` component | **PARTIAL** — `invoice` table with `invoice_number`, no receipt renderer | **ABSENT** | **PARTIAL** — `window.print()` with 80mm `@media print` CSS; weakest of the three |
| H5 | Discounts | **COMPLETE** — line-level `discount` + `discount_type` (percent/fixed), `sales_discounts` on the sale, `Summary_discounts` report | **COMPLETE** — `pricing.js` computes per-line discount and order-level discount, with unit tests | **ABSENT** | **ABSENT** | **ABSENT** |

**Notes.** H1-H3 and H5 are the two areas where a real POS is genuinely solved somewhere — and in both cases
it is the AGPL repository or the license-blocked one. Note that YourGbDev's `Payment` has a `transaction_id`
for a gateway that does not exist, and RetailPOS has no payment layer at all despite having a cart UI.

---

## Where the gaps concentrate

Four areas have **no prior art in any repository**, and three of them are in the brief's distinctive feature set:

1. **RFID authentication and RFID attendance** (D3, D4) — the only RFID repository has neither. Both greenfield.
2. **Offline POS and synchronization** (G1-G4) — nothing exists. This is the largest greenfield area.
3. **Multi-store / warehouse / transfers** — not in this section but the same story: `stock_locations` in OSPOS
   is a flat list with no type, no parent, and no address; OSPOS's "transfer" is one receiving document with two
   opposite-signed lines, producing no in-transit state; RFID Ref has an `InventoryTransactionType.Transfer = 3`
   enum member with **zero implementation**. `Employee.php:236-260` even auto-grants every new location to
   every employee, so isolation is not just unimplemented — it is actively disabled.
4. **Terminals, cash drawers, and shifts** — zero rows in every repository. OSPOS's `cash_up` is a per-employee
   open/close with no terminal identifier, no expected-vs-counted variance, and no link to the sales it covers.

The remaining gaps (supplier payables, credit limits, AR aging, working hours, late tracking, margin reporting,
server-side export) are conventional retail features that are simply out of scope for the kind of small-project
codebase these five repositories are. **They should be treated as normal greenfield engineering, not as
problems with a known answer that was found and rejected.**
