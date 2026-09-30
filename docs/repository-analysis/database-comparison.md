# Database Comparison

## The central question: how is inventory represented?

This is the single most consequential schema decision in a retail platform, so it is answered first, with
evidence, for all five.

### The two possible models

| Model | What it means |
|---|---|
| **`product.quantity`** | A mutable integer/decimal column on the product row. Stock is *state*. |
| **Stock ledger** | An append-only table of signed movements. Stock is either a *derived* value or a cached total that is reconcilable against the ledger. |

### Verdict per repository

| Repo | Model | Evidence | Consequence |
|---|---|---|---|
| **OSPOS** | **Ledger + per-location balance** | `ospos_inventory(trans_items, trans_user, trans_date, trans_comment, trans_location, trans_inventory)` + `ospos_item_quantities(item_id, location_id, quantity)` composite PK | **Best of the five.** Only repo with per-location stock. But: no FK from ledger to source document (`trans_comment` is a string convention: `'POS '.$id`, `'RECV '.$id`), so distinguishing a sale from a receipt requires string-parsing the comment. And the CSV importer writes an *absolute* count into the delta ledger, desynchronising them permanently. |
| **NodeDR** | **`Product.stock Int`** | `prisma/schema.prisma`: `stock Int @default(0)` | No movement table. There is no way to answer "why is this number what it is." Webhook consumers are told the new level but not the reason. |
| **YourGbDev** | **Ledger (the only internally consistent one)** | `inventory(product_id, quantity)` + `inventory_movements`; all 4 mutation sites pair both in one transaction | **Correct by construction.** `CHECK (quantity >= 0)`, `SELECT … FOR UPDATE` at all 3 sites. But `migrations/001_create_schema.sql` and `schema.sql` have diverged, and the migration baseline is missing `idempotency_key_hash` and `password_changed_at`. |
| **RetailPOS** | **Neither — no inventory at all** | `create_products_table.php` has **no `quantity`, no `stock`, no `unit`, no `reorder_level`** | The system does not track stock. `PointOfSale.js` has a `+`/`-` stepper, but that is `react-use-cart`'s in-browser cart quantity, not inventory. Nothing is ever decremented because nothing exists to decrement. |
| **RFID Ref** | **`Product.StockQty` + a decorative ledger** | `Product.StockQty` (authoritative) + `InventoryTransaction` (`Quantity` always positive, direction implied by `TransactionType`, `BalanceAfter` a stale snapshot) | **The worst pattern found.** You cannot `SUM(Quantity)` to get a balance. `InventoryTransactionsController.Create` inserts a client-supplied row *without updating* `StockQty`, and `InventoryController.Restock` / `Create` / `BulkCreate` set `StockQty` directly with *no* movement record. The ledger and the balance desynchronise permanently, in both directions. |

### Consequence summary

- **SmartStore must implement a stock ledger.** No repository provides a correct one *and* the surrounding
  features (batch, locations, transfers, reconciliation). The closest correct implementation
  (YourGbDev's `inventory` + `inventory_movements`) is **unlicensable**.
- **The balance must be derivable from the ledger**, and a nightly/continuous reconciliation job must prove
  `SUM(movements) == balance`. No repository has such a job. OSPOS's `Inventory::reset_quantity()` is the
  only reconciliation primitive anywhere, and it is a manual repair tool that *overwrites* the balance with
  `-1 * SUM(trans_inventory)` — which is precisely the function that produces wrong values when the CSV
  importer has desynchronised the ledger.
- **Movements need a typed discriminator and a real FK to the source document.** OSPOS's
  string-convention `trans_comment` is a known anti-pattern: a receipt and a sale are distinguished by
  `preg_match('/(RECV|KIT)/', …)`.

---

## Full schema comparison

### OSPOS — 43 tables, MySQL

**Catalog & parties**

| Table | PK | Notes |
|---|---|---|
| `people` | `person_id` | Base supertype for customers, employees, suppliers |
| `customers` | `person_id`→people | `account_number` UNIQUE, `discount`, `points`, `sales_tax_code_id`, `deleted` |
| `employees` | `person_id`→people | `username` UNIQUE, bcrypt `password`, `hash_version` |
| `suppliers` | `person_id`→people | `account_number` UNIQUE, `category`, `tax_id` |
| `items` | `item_id` | `supplier_id`→suppliers, `cost_price`, `unit_price`, `reorder_level`, `is_serialized`, `stock_type`, `tax_category_id`, `qty_per_pack`, `hsn_code`, `custom1..10` |
| `item_quantities` | **`(item_id, location_id)`** | The entire stock-on-hand store |
| `inventory` | `trans_id` | Append-only movement ledger, 6 indexes |
| `item_kits` / `item_kit_items` | | Bundles. `item_kit_items` PK includes `quantity` → same component cannot appear twice |
| `attribute_definitions` / `_values` / `_links` | | Generic extension mechanism; `definition_fk` self-FK for dropdowns; links to item **or** sale **or** receiving |
| `stock_locations` | `location_id` | The only location dimension in any repo |

**Sales**

`sales` (`invoice_number` UNIQUE, `quote_number`, `work_order_number`, `sale_type`, `sale_status`),
`sales_items` (`(sale_id,item_id,line)` PK; **`item_cost_price`**, `item_unit_price`, `discount`, `discount_type`,
`item_location`→stock_locations, `serialnumber`), `sales_items_taxes` (`item_tax_amount`, `percent`),
`sales_taxes` (header-level `sale_tax_basis`, `sale_tax_amount`, `tax_group`), `sales_payments`
(**`payment_id` PK → 1-to-many, split tender**; `cash_refund`, `cash_adjustment`), `sales_reward_points`.

**Receiving** — `receivings` (`reference` varchar(32), indexed but **not unique**), `receivings_items`
(`receiving_quantity`, `item_cost_price`, `item_location` — **no FK** to stock_locations, unlike `sales_items`).

**Tax** — `tax_categories`, `tax_codes`, `tax_jurisdictions` (`tax_group` UNIQUE), `tax_rates`. Most complete
tax model of the five.

**Access** — `modules`, `permissions` (**`location_id`→stock_locations — grants are per-location**),
`grants` (`(permission_id, person_id)` composite PK, CASCADE).

**Other** — `giftcards`, `dinner_tables`, `cash_up`, `expenses`, `expense_categories`, `customers_packages`,
`customers_points`, `app_config` (flat KV, every value `varchar(500)`), `sessions`.

### Design strengths

- **Full price/cost/tax snapshot on every sale line.** `item_cost_price` and `item_unit_price` are frozen at
  sale time; tax is snapshotted separately. This is what makes historical margin reporting possible — the
  only repository that gets this right.
- **Per-location grants** in the schema itself (`permissions.location_id`), not bolted on.
- **43 tables with real FKs and 6 well-chosen indexes on the ledger.**

### Design defects

| Defect | Evidence | Consequence |
|---|---|---|
| **No `created_at`/`updated_at` on any business table** | Only `sale_time`, `receiving_time`, `trans_date`, `payment_time` | **No audit trail is possible.** This is why OSPOS has no audit log — the columns do not exist. |
| CSV import writes absolute counts into a delta ledger | `Items.php:1378-1381` | `SUM(trans_inventory)` ≠ `item_quantities.quantity` permanently |
| No transaction on item adjustment | `Items.php:938-972`; `grep transStart` in `Items.php` → no matches | Ledger/balance desync on failure |
| Receiving line cost stores pre-receipt cost | `Receiving.php:147` writes `$cur_item_info->cost_price` (old) *before* line 158 recomputes the average | **Receiving profit reporting is systematically understated** for any cost-changing receipt |
| `item_quantities` declares the wrong primary key | `Item_quantity.php`: `$primaryKey = 'item_id'`, real key is `(item_id, location_id)` | `Model::find()/update()/delete()` would operate on `item_id` alone. Harmless today only because every method builds its own `where()` pair. |
| `INSUFFICIENT_STOCK` is unreachable | `changeQuantity()` has no floor guard; the sentinel can only fire on a DB error | The real oversell guard is advisory and client-side (`Sale_lib::out_of_stock()`), with no server-side re-check at commit. Two cashiers on the last unit both pass it. |
| `line` is `int(3)` in both line-item PKs | — | Hard ceiling of 999 lines per document |
| `references` are not unique | `receivings.reference`, `quote_number`, `work_order_number` (only `invoice_number` is UNIQUE) | Duplicate supplier invoice numbers silently accepted |
| `softDeletes` disabled everywhere | `Model::$useSoftDeletes = false` in all models | `deleted` is filtered by hand, inconsistently |
| A suspicious unique index constrains nothing | `items_uq1 (supplier_id, item_id, deleted, item_type)` — `item_id` is already unique | Wasted index |
| Money is `DECIMAL(15,2)` but points are `float` | `customers_packages.points_percent`, `sales_reward_points.earned/used` | Float points lose precision in a loyalty ledger |
| Reports require MySQL | `CREATE TEMPORARY TABLE … AS SELECT` in `Sale`/`Receiving` | Reports are not portable |

### NodeDR — 15 models, SQLite

`User`, `ShopSettings`, `Product`, `Customer`, `CustomerDuePayment`, `Invoice`, `InvoiceItem`, `Return`,
`ReturnItem`, `ApiKey`, `TaxCode`, `PinCode`, `IfscCode`. **No `Supplier`. No `PurchaseOrder`. No
`GoodsReceipt`. No location. No batch.**

**Well-judged modelling decisions:**

- **Money is `Float`.** This is wrong for a POS, and it is the most consequential schema error in the repo.
  Floating-point currency accumulates error. `Invoice.totalAmount` as a `Float` cannot be trusted for
  reconciliation. (SQLite's `better-sqlite3` supports integer minor units; they were not used.)
- **`CustomerDuePayment` as a separate audit trail** rather than just decrementing `Customer.totalDue` — the
  schema comment explicitly reasons about this. Correct instinct.
- **Returned quantity is computed from `ReturnItem` rows, not stored as a running counter** — the schema
  comment reasons about matching the `CustomerDuePayment` pattern. Correct instinct, and it makes
  double-return structurally impossible.
- `ApiKey` stores `keyHash` + `keyPrefix` only, never the plaintext. Same reasoning as a password.
- `TaxCode` / `PinCode` / `IfscCode` are deliberately separated as admin-imported reference data with
  `@@unique([type, code])`.

**Absent:** batch, expiry, locations, suppliers, purchase orders, stock ledger, terminals, shifts, audit.

### YourGbDev — 17 tables + `schema_migrations`, MySQL

`roles`, `permissions`, `role_permissions`, `users`, `categories`, `products`, `inventory`,
`inventory_movements`, `suppliers`, `purchase_orders`, `purchase_items`, `customers`, `sales`, `sale_items`,
`payments`, `settings`, `audit_logs`.

**The best integrity constraints of the five:**

| Constraint | Purpose |
|---|---|
| `CHECK (quantity >= 0)` on `inventory` | Stock cannot go negative, at the engine level |
| `CHECK (name <> '')` on roles/categories/customers/suppliers/products | No blank names (in `schema.sql`; **dropped** in `migrations/001`) |
| FK `ON DELETE RESTRICT` on `sale_items`/`purchase_items` | Sale history cannot be destroyed by deleting a product |
| UNIQUE on `products.sku` | Required |
| UNIQUE nullable `products.barcode` | Multiple blanks allowed, no duplicates |
| `ENUM` status columns | Constrained state machines |
| `DECIMAL(12,2)` for money | Correct |
| UNIQUE `sales.idempotency_key_hash` | **Checkout replay protection** — the only idempotency mechanism in any repo |
| `uq_suppliers_name` | No duplicate suppliers |
| `audit_logs` — actor, entity, details, IP, user agent | The only real audit design in the five |

**The blocker:** `schema.sql` and `migrations/001_create_schema.sql` have **diverged**. The migration
baseline is missing `password_changed_at`, `idempotency_key_hash`, and `idx_sales_status_created`, and has
four `CHECK (name <> '')` constraints that `schema.sql` dropped. `docs/DATABASE.md:52` names `schema.sql`
canonical. **Anyone bootstrapping from the migrations gets a different database — one where session
invalidation and checkout replay protection are silently disabled.**

### RetailPOS — 15 tables, MySQL. Structurally unsound.

4 stock Laravel tables + 11 authored: `employees`, `customers`, `suppliers`, `advanced_salaries`, `salaries`,
`products`, `expenses`, `attendances`, `categories`, `settings`, `brands`.

**No `orders`, `order_details`, `sales`, `sale_items`, `payments`, `carts`, or `receipts` table.** No sale is
ever recorded. No revenue exists. `README.md:62-63` documents `/api/orders` — a module that does not exist
in either the routes or the schema.

Systemic schema failures, all verified in the migration files:

| Failure | Evidence |
|---|---|
| **Every monetary value is `string()`** | `buying_price`, `price`, `exp_amount`, `salary`, `advance_salary`, `paid_amount`, `account_number`. `ExpenseController` does `->sum('exp_amount')` over a `varchar`. |
| **Every date is `string()`** | `buy_date`, `expire_date`, `date`, `month`, `year`, `att_date`, `edit_date`, `att_month`, `att_year`, `salary_month`, `salary_year`. `date("F")` month **names** are used, so `ExpenseController` and `SalaryController` are **broken across the December→January boundary**. |
| **`whereBetween` on `d-m-Y` strings is a lexicographic compare** | `ExpenseController::getExpenseInRange` — `'02-01-2026' > '31-12-2025'` is false, so any range spanning a month boundary silently returns wrong or zero results. |
| **Zero foreign keys** across all 11 authored tables | `cat_id`, `sup_id`, `employee_id`, `brand_id` are bare `integer`s with no `->references()`, no `onDelete()` |
| **No indexes** on any foreign key | Full scans on every join |
| **Guaranteed runtime SQL errors** | `SaveProductRequest` requires `brand_id`; `ProductController::saveProduct` writes `$product->brand_id = $request->sup_id` (assigning the **supplier** id); `getProduct` joins on `products.brand_id`. **`The products table has no brand_id column.`** Creating, viewing, and POS brand filtering all fail. |
| `expire_date` is a dead string column | Written and displayed, **never read by any query, comparison, or filter**. No near-expiry report exists. |
| `attendances` has no FK and string dates | `att_month` is `date("F")` → `"September"` |

### RFID Ref — 15 entities, SQL Server. No migrations.

`ProductCategory`, `Product`, `Supplier`, `Customer`, `PurchaseOrder`, `PurchaseOrderItem`,
`GoodsReceipt`, `GoodsReceiptItem`, `SalesOrder`, `SalesOrderItem`, `RfidTag`, `InventoryTransaction`,
`Role`, `User`, `AuditLog` + 4 enums.

**Present and reasonable:**

- `GoodsReceiptItem` has **`QuantityReceived`, `QuantityAccepted`, `QuantityRejected`** — the right columns
  for a GRN, and better than any other repository has.
- `ReceiptStatus { Open, Partial, Closed, Rejected }` — the right state machine.
- `SalesOrderItem` and `PurchaseOrderItem` snapshot `UnitPrice`/`UnitCost`.
- `Customer.LoyaltyPoints` exists.
- `AuditLog` has `EntityName`, `EntityId`, `ActionType`, `BeforeData`, `AfterData`, `PerformedByUserId`,
  `PerformedAt`, `IpAddress`.

**Why none of it works:**

| Defect | Evidence |
|---|---|
| `ReceiptStatus.Partial` is never used | `GoodsReceiptsController.cs:52` hardcodes `Status = ReceiptStatus.Closed` |
| `QuantityAccepted`/`QuantityRejected` are never written | Same file; the columns are vestigial |
| **No over-receipt guard** | `product.StockQty += item.QuantityReceived` (`GoodsReceiptsController.cs:64`) against a `PurchaseOrderId` validated only for existence (lines 41-42). You can receive any quantity of any product against any PO. |
| `InventoryTransactionType.Transfer = 3` has zero implementation | The only `Transfer` reference in the entire repository. No `Store`, no `Warehouse`, no `Location`, no from/to field on any DTO. |
| `Customer.LoyaltyPoints` is a dead column | Its single occurrence in the whole repo. Never read, written, earned, or redeemed. |
| `AuditLog` is written only by RFID scans | `AuditLogs.Add` appears in `RfidReaderController` only. `IpAddress` and `PerformedByUserId` are never populated, despite `AuditActionType` having `Login`/`Logout` members that are never used. |
| Two conflicting tag-storage designs | `Product.RfidTagCode` (`IsUnique(false)`) **and** `RfidTag.ProductId` (many per product) both exist, and nothing keeps them consistent. |
| `User.Email` is a unique index on a **nullable** column | SQL Server permits only one NULL in a unique index → **the second user created without an email fails** |
| Inconsistent decimal precision | `QuantityAccepted` is `HasPrecision(18,2)` (a quantity, as decimal) while `QuantityReceived`/`Rejected` are `int` |
| **No migrations at all** | `EnsureCreated()` + hand-rolled `ALTER TABLE` in a `try/catch` that continues on failure |
| `RfidTagsController` bulk assign matches **by list index** | `existingTags.ElementAtOrDefault(i)` (`RfidTagsController.cs:128-158`) — reordering the uploaded list silently rewrites which physical tag is assigned to which product. |
| `AuditLog` is used as the scan feed | `GetRecentScans` (`RfidReaderController.cs:191-220`) re-reads the audit table and deserialises `AfterData` JSON back into DTOs |

---

## Cross-cutting: what no repository does

| Capability | Status across all five |
|---|---|
| Batch / lot / expiry entity | **ABSENT** |
| FEFO allocation | **ABSENT** |
| FIFO/LIFO cost layers | **ABSENT** (OSPOS has weighted average only) |
| Serialised inventory master | **ABSENT** (OSPOS has a `varchar(30)` free-text field) |
| Multi-store / multi-warehouse | **ABSENT** |
| Stock transfer document | **ABSENT** (OSPOS fakes it with two opposite receiving lines; RFID has an enum member) |
| Stock reconciliation / cycle count | **ABSENT** |
| Stock reservation | **ABSENT** |
| POS terminal / register | **ABSENT** |
| Shift / cash drawer session | **ABSENT** |
| Supplier balances / payables | **ABSENT** |
| Purchase order ↔ receipt matching | **ABSENT** |
| User-action audit trail | **ABSENT** (only YourGbDev has one, and it is unlicensable) |
| Backup / restore | **ABSENT** |
| Idempotency key | **ABSENT** (only YourGbDev has one, and it is unlicensable) |

## Recommendation for the SmartStore schema

Build it from scratch. Six decisions from the evidence above, none of which any candidate gets right:

1. **`stock_movements` as the source of truth, append-only**, with a typed `movement_type` enum
   (`RECEIPT`, `SALE`, `RETURN`, `TRANSFER_OUT`, `TRANSFER_IN`, `ADJUSTMENT`, `COUNT_VARIANCE`, `WASTAGE`)
   and a real nullable FK pair to the source document. OSPOS's string-comment convention and RFID's
   type-implied-direction are both anti-patterns.
2. **`stock_balances` as a cached, reconcilable projection** keyed `(item_id, location_id, batch_id)`. A
   scheduled job must prove `SUM(movements) == balance` and alert on drift. OSPOS's `reset_quantity()`
   overwriting the balance with `-1 * SUM(...)` is the right idea in the wrong place — it should be a
   detector, never a repair.
3. **Money as integer minor units or `DECIMAL(19,4)` — never `float`.** NodeDR uses `Float` for every
   monetary column. RetailPOS uses `varchar`. OSPOS's `DECIMAL(15,2)` is the only acceptable answer
   observed, and its `float` loyalty points show what happens when the discipline lapses.
4. **Every table gets `created_at` / `updated_at` / `created_by` / `updated_by`.** OSPOS has none on any
   business table, which is *why* it has no audit log. Retrofitting an audit trail onto a schema without
   those columns is close to a rewrite.
5. **Every foreign key is declared, with a deliberate `ON DELETE` behaviour.** `RESTRICT` on any table
   referenced by a financial document (YourGbDev's `sale_items` pattern), `CASCADE` only for pure
   associative tables.
6. **Batch is a first-class entity from day one**, not a column on the product: `batches(id, item_id,
   batch_no, expiry_date, received_at, cost_per_unit, supplier_id, grn_line_id)` with
   `UNIQUE(item_id, batch_no)`. FEFO then becomes a single indexed query — `ORDER BY expiry_date ASC
   NULLS LAST` — rather than a retrofit across a movement ledger.
