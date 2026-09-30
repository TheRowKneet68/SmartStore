# Feature Matrix

Classification is strict. **COMPLETE** means the capability exists, works, and survives inspection of the
implementation. A controller, route, or view file with a matching name is never sufficient.

Legend: **C** = COMPLETE · **P** = PARTIAL · **A** = ABSENT · **?** = UNKNOWN

---

## Product & Catalog

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Products (CRUD) | C | C | C | P (brand_id column missing → SQL error) | C | — |
| Categories | C | C | C | C | C | — |
| Brands | C | C | C | C | P (free-text string) | — |
| Variants / options | A | A | A | A | P (loose Size/TargetGender strings) | — |
| SKU | P (`item_number` uniqueness dropped in 3.2.0) | C (`sku` unique, optional) | C (unique, required) | P (free-text `product_code`) | C | — |
| Units of measure | P (`qty_per_pack` scalar, no UOM table) | P (`unit` UQC code, no conversion) | A | A | A | — |
| Product images | C (validated upload) | A | A | P (client-controlled extension) | A | — |
| Pricing | C (price + cost + tax category) | C (purchase/selling/tax/discount) | C | P (money as `varchar`) | C | — |
| Item kits / bundles | C | A | A | A | A | — |
| Custom attributes | C (definitions + values + document snapshot) | A | A | A | A | — |
| Barcode generation | C (30 symbologies, label sheets) | C (jsbarcode + QR) | A | A | A | — |
| Barcode lookup at POS | C (suggest APIs by item_number/name) | C (ZXing + camera scanner + keyboard wedge) | P (column + endpoint, no scanner) | A | A (RFID only) | — |
| Multiple barcodes / GS1 parsing | A | A | A | A | A | — |

## Inventory

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Stock on hand | C (`item_quantities` per location) | P (`Product.stock` integer) | C (separate `inventory` table) | **A — no stock field at all** | P (`Product.StockQty` integer) | — |
| Movement ledger | C (`inventory` table, signed deltas) | **A** | C (`inventory_movements`, all 4 write paths paired) | A | **P — decorative** (write-only log, drifts) | — |
| Stock locations | C (`stock_locations`) | A | A | A (free-text `product_garage`) | A | — |
| Manual adjustment | P (no transaction → ledger desync risk) | C | C (row-locked, audited) | A | P (add-only; `Update` overwrites) | — |
| **Stock reconciliation** | **A** (manual signed delta only, no count sheet) | **A** | **A** (documented as a manual SUM query, no workflow) | A | A | — |
| Stock reservation | P (suspended sales hold no stock) | A | A | A | A | — |
| Negative inventory policy | C (allowed, documented, tested) | C (configurable `allowNegativeStock`) | C (`CHECK quantity >= 0`) | n/a | P (unguarded) | — |
| Low-stock alerts | C | C | A | A | C (threshold) | — |
| Concurrency safety | P (atomic upsert on sale, read-modify-write on receipt/adjust) | P (5 `$transaction` sites) | C (`SELECT … FOR UPDATE` at all 3 sites) | n/a | A | — |

## Batch / Expiry

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Batch / lot numbers | **A** | **A** | **A** | **A** | **A** | — |
| Expiry dates | **A** | **A** | **A** | **A** (`expire_date` varchar, never read by any query) | **A** | — |
| Batch-level stock | A | A | A | A | A | — |
| Batch-level cost | A | A | A | A | A | — |
| **FEFO allocation** | **A** | **A** | **A** | **A** | **A** | — |
| FIFO cost layers | A (weighted moving average only) | A | A | A | A | — |
| Serial numbers | P (flag + `varchar(30)` free-text on the line; no serial master) | A | A | A | A | — |

**Zero of five repositories implement batch, expiry, or FEFO.** This is a greenfield area with no prior art
to reuse.

## Purchasing & Suppliers

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Suppliers | C | **A** | C | C (contact master only) | C | — |
| Purchase orders | **A** | **A** | C | **A** | C | — |
| Goods receiving | C | **A** | P (PO receipt, all-or-nothing) | **A** | C | — |
| GRN document | C (`receivings`, supplier reference) | A | A | A | C (`GoodsReceipt` + items) | — |
| Partial receiving | **A** | A | **A** | A | **A** (enum + columns exist, status hardcoded `Closed`) | — |
| Purchase invoices | C (`receivings.reference`, non-unique) | A | A | A | A | — |
| Over-receipt guard | A | A | A | A | **A** (can receive any qty against any PO) | — |
| Supplier returns / vendor credit | **A** | A | A | A | A | — |
| Cost basis tracking | C (weighted average, but `receivings_items.item_cost_price` stores pre-receipt cost → profit under-reported) | A (purchasing absent) | A | A | C (`UnitCost` on PO item) | — |
| Supplier balances / payables | **A** | A | A | A | A | — |

## POS

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Cart | C (session-held, suspend/recall) | C (client cart + server reprice) | C | P (`react-use-cart`, in-browser only) | C | — |
| Barcode scanning | C | C (ZXing camera + wedge + USB) | **A** (data field, no scanner code) | A | A (RFID instead) | — |
| Checkout | C | C | C | **A — Checkout button has no `onClick` handler** | C (140-line controller action) | — |
| Discounts | C (item, group, sale-level; amount + percent) | C (manual + standing product discount) | P (one order-level %, server-clamped) | P (computed, never applied to total) | P (hardcoded 5% at ≥3 items) | — |
| Tax | C (US-style: categories, codes, jurisdictions, cascade, rounding) | P (per-product rate, hardcoded default) | P (per-product rate + inclusive/exclusive mode) | P (client-computed, never applied) | **P — hardcoded 5%, no config** | — |
| Payments | C (7 types, split tender, 1-to-many `sales_payments`) | P (one `paymentMethod` string, no split) | P (one method per sale) | A | **P — one string, no payment entity** | — |
| Cash / change | C (server-computed, `cash_refund`) | C (client-computed only) | C (server-computed) | A | **P — client-computed only** | — |
| Receipts | C (invoice/quote/work-order/return templates) | C (ESC/POS USB + browser print + PDF) | C | A | P (`window.print()` only) | — |
| Void / cancel | C (permission-gated, stock reversal, tested) | A | C (permission-gated, restocks, audited) | A | A | — |
| **Returns** | C (return document type, negative lines) | C (capped at qty sold − qty returned, computed from rows) | **A — no route, no table, no service** | A | **P — unbounded, exploitable** | — |
| **Refunds** | C (cash refund + return mode) | C (CASH/UPI/CARD/DUE_ADJUST) | **A** | A | **A — restocks, computes no refund amount** | — |
| Held / suspended sales | C (server-persisted) | P (React state, lost on refresh) | A | A | P (React state) | — |
| Split tender | C | A | A | A | A | — |
| Receipt numbering | C (`invoice_number` UNIQUE) | C | C | A | C | — |

## Customers, Credit, Loyalty

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Customer profiles | C | C | C | C (leaks bank details unauthenticated) | C (2 endpoints only) | — |
| Purchase history | C (sales by customer, reports) | P (no per-customer endpoint) | P (counters only, no route) | A | P (returns lookup only) | — |
| Loyalty / rewards | C (packages, points, concurrency-tested) | C (points earned/redeemed per invoice) | **A** | A | **A** (`LoyaltyPoints` column never read or written) | — |
| **Customer credit / due** | **A** (`credit` is only a payment-type label; `amount_due` is a transient computed alias) | **C** (`totalDue` + `CustomerDuePayment` audit trail + `creditBalance`) | **A** (checkout requires full payment) | A | A | — |
| AR payments | A | P (due payments only) | A | A | A | — |
| Gift cards | C (concurrency-tested decrement) | A | A | A | A | — |

## Retail Operations

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Stores | **A** | A (single implicit shop) | A | A | A (single implicit store) | — |
| Warehouses | **A** | A | A | A | A | — |
| Stock transfers | P (two opposite receiving lines — no in-transit, no from/to record) | A | A | A | A (enum member `Transfer`, zero implementation) | — |
| POS terminals | **A** | A | A | A | A | — |
| Cash drawers | **A** | A | A | A | A | — |
| Shift management | **A** (cash-up is per-employee, no terminal/shift/variance) | A | A | A | A | — |
| Multi-location stock | C (only repo with it) | A | A | A | A | — |

**Zero of five repositories model stores, warehouses, POS terminals, or shifts.**

## Employees, Access, Audit

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Employees | C (`employees` on `people`) | P (`User` = login only) | P (`User` = login only) | C (`employees` table) | P (`User` = login only) | — |
| Roles | C (`modules`/`permissions`/`grants`) | P (single `role` string, admin/cashier) | C (3 seeded roles, 38 permission codes) | **A** (`$policies` is `[]`, `app/Policies` does not exist) | P (`Role` CRUD) | — |
| RBAC enforcement | C (constructor-level on every action, 14 escalation tests) | P (one `requireAdmin` check) | C (server-enforced in `Auth.php:60-63`, staff→admin test) | **A — `authRoles.js` entirely commented out** | **A — `PermissionsJson` stored, never enforced; 16/18 controllers have no `[Authorize]`** | — |
| Permission granularity | C (per-employee, per-module, per-location) | P | P (38 codes, flat) | A | **A** | — |
| **Audit log** | **A** (no audit table; only the quantity-only `inventory` ledger) | **A** (no audit entity) | C (append-only, 24 write sites, actor/entity/details/IP/UA) | **A** | **A** (`AuditLog` written only by RFID scans) | — |
| Authentication events logged | **A** | A | **A** (reads and failed logins not audited) | A | A | — |
| Attendance | A | A | A | C (only repo with it) | **A** | — |

## RFID & Hardware

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| RFID tags on products | A | A | A | A | C | — |
| LLRP protocol implementation | A | A | A | A | **C** (835 lines, real TLV/ROSpec/tag parsing) | — |
| Reader connection | A | A | A | A | C (TCP to Zebra FX9600:5085) | — |
| **RFID authentication (badge → login)** | A | A | A | A | **A — no badge field on `User`, no EPC in `AuthController`** | — |
| **RFID attendance (tap in/out)** | A | A | A | A | **A — no attendance entity, no clock-in/out** | — |
| Reader as live stream | A | A | A | A | **A — no WebSocket/SSE; "real-time" is a 5s poll of the audit table** | — |
| USB / ESC-POS printing | A | C (raw ESC/POS to USB) | A | A | A | — |
| Label printing | C (barcode label sheets) | C (barcode download panel) | A | A | A | — |

**The RFID repository is a product-tagging POS. It contains no RFID authentication and no RFID attendance.**
Its `RealTimeScans.jsx` labels a scan `readerName: 'Login bridge'` but the value is typed into a text input by a human.

## Offline & Synchronization

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Offline POS | **A** | **A** — "offline-first" means LAN-local server, not disconnected client (0 service workers, 0 IndexedDB) | **A** | A | A | — |
| Local storage | n/a | SQLite on the till host | A | A | A | — |
| Transaction queue | A | A | A | A | A | — |
| Sync engine | A | A (`useSyncStatus` polls `/health`) | A | A | A | — |
| Idempotency | A | **A** | C (`idempotency_key_hash` UNIQUE — but the migration baseline dropped the column) | A | A | — |
| Conflict resolution | A | A | A | A | A | — |
| Retries | A | A | A | A | A | — |

**No repository has offline POS.** NodeDR's naming is misleading: its backend runs on the till itself, so the
cloud is absent rather than disconnected. There is no client-side queue, no conflict resolution, and no
idempotency anywhere except one column in one repo.

## Reporting, Import/Export, Backup

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Sales reports | C (21 report models, tested) | P (dashboard + charts) | C (5 report endpoints) | **A** ("Sales Report" nav points at attendance pages) | P (6 endpoints) | — |
| Inventory reports | C | P | C | A | P | — |
| Purchase reports | C | A | C | A | P | — |
| Profit / margin | C (cost snapshot on every sale line) | A | A | A | **A** | — |
| Tax reports | C (tested) | A | A | A | A | — |
| Customer / employee reports | C | A | A | A | A | — |
| Stock movement reports | C | A | C (ledger queryable) | A | P | — |
| CSV import | C (items, customers — 52 tests) | C (HSN/PIN/IFSC reference data) | **A** | A | A | — |
| Export | C (7 formats, client-side) | A | **A** | A | P (client-side xlsx) | — |
| **Backup / restore** | **A** | **A** | **A** (operator-run `mysqldump` doc only) | A | **A** | — |
| Notifications | C (SMS + email) | A | A | A | A | — |

## Testing & Operations

| Requirement | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref | SmartStore |
|---|---|---|---|---|---|---|
| Test count | **~150 assertions across 31 classes** | **0** | 650 `ok()` assertions in 1 file | 2 stock files, 56 lines, 0% coverage | **0** | — |
| Business-logic coverage | C | A | P | A | A | — |
| Concurrency tests | C (real 2-process race harness) | A | A | A | A | — |
| CI | C | ? | **A** | A | A | — |
| Docker | C (3 compose files + nginx) | C (+ CasaOS, Debian, Windows MSIX) | P | **A** | A | — |
| Contributors | 26+ over 12 years | 1 | 1 | 1 | 1 | — |
| Commits | 100+ (shallow clone), active | 89, ~6 weeks | **6** | **2** | **3** | — |
| Security policy | C (maintained `SECURITY.md`) | A | A | A | A | — |

---

## Capability totals

Counted from the tables above. "Score" is a completeness indicator only — **it is explicitly not a
recommendation criterion**, per the brief.

| Repository | COMPLETE | PARTIAL | ABSENT | Of 78 assessed |
|---|---|---|---|---|
| OSPOS | 43 | 12 | 23 | 55% |
| NodeDR | 18 | 20 | 40 | 23% |
| YourGbDev | 17 | 16 | 45 | 22% |
| RetailPOS | 8 | 12 | 58 | 10% |
| RFID Ref | 15 | 18 | 45 | 19% |

## The decisive gaps

Every one of these is required by SmartStore and is **absent from all five repositories**:

1. Batch numbers, expiry dates, FEFO allocation
2. Stock reconciliation (count sheet, variance approval)
3. Multi-store / multi-warehouse with transfers
4. POS terminals, cash drawers, shift management
5. Offline POS with transaction queue and conflict resolution
6. RFID authentication and RFID attendance
7. ESP32 / IoT device management
8. Customer credit terms and AR
9. Purchase orders with partial receiving
10. Purchase order matching and over-receipt guards
11. Backup and restore
12. Account receivable and supplier payables
13. A written audit trail of user actions
14. Stock cost layers (FIFO/LIFO) for margin accuracy
