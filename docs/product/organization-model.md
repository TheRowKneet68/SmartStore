# SmartStore — Organization Model

**Phase 1 — Product & Domain Specification.**

Owner of: `Organization`, `Store`, `Warehouse`, `StorageLocation`, `PosTerminal`, `CashDrawer`, and the global vs
store-specific split. Conventions are defined once in [product-overview.md](product-overview.md) §3 and are not
restated here.

---

## 1. The hierarchy

```
Organization                                  (tenant boundary — one per customer)
├── Employees                                 (all people, across all stores)
│   ├── UserAccount                           (optional login credential)
│   ├── EmployeeStoreAccess                   (which stores, which scope, when)
│   ├── EmployeeRoleAssignment                (which role, where)
│   └── AttendanceEvent / Shift
├── Customers                                 (global to the organization)
├── Suppliers                                 (global to the organization)
├── Roles                                     (global definitions; scoped at assignment)
├── Devices                                   (assigned to a store or warehouse)
├── Catalog                                   (global: Product, Variant, Category, Brand, Unit)
│
├── Stores                                    (sell; may also hold stock)
│   ├── Settings (per store)                  (tax mode, receipt format, FEFO policy, negative-stock policy)
│   ├── Warehouses
│   │   └── StorageLocations                  (the leaves that actually hold stock)
│   ├── PosTerminals
│   │   └── CashDrawers
│   └── PriceLists                            (store-level prices)
│
└── Central Warehouses                        (optional; hold stock, do not sell)
    └── StorageLocations
```

**Relationship summary**

| Parent | Child | Cardinality | Key rule |
|---|---|---|---|
| Organization | Store | 1:N | At least one. v1 operates exactly one, the model allows many |
| Organization | Employee | 1:N | An employee with no store access can still exist (e.g. HQ accountant) |
| Organization | Customer | 1:N | Global; not store-scoped |
| Organization | Supplier | 1:N | Global; not store-scoped |
| Store | Warehouse | 1:N | A warehouse is store-attached **or** central; never both |
| Warehouse | StorageLocation | 1:N | At least one per warehouse; the default location is required |
| Store | PosTerminal | 1:N | A terminal belongs to exactly one store, always |
| PosTerminal | CashDrawer | 1:0..1 | v1: zero or one. v2 may need more for multi-drawer |
| StorageLocation | StockItem | 1:N | Stock exists only at a location, never "at a store" |
| Employee | EmployeeStoreAccess | 1:N | Dates optional; absent end date means open-ended |
| Employee | EmployeeRoleAssignment | 1:N | Scope is organization-wide or a specific store |

---

## 2. Organization

The **tenant boundary**. Every entity in SmartStore belongs to exactly one organization, and no query may cross
that boundary.

`Organization` holds:

- Identity: legal name, trading name, registration/tax identifier
- **Locale settings**: currency code, time zone, date format, number format, language
- **Business date policy**: the time zone whose calendar day is the "business date" (§3.2 of the overview)
- Default tax configuration and receipt template set
- Approval thresholds (per organization; overridable per store — see [approval-workflows.md](approval-workflows.md))
- Reason-code lists
- Data-retention and backup policy

### 2.1 Organization invariants

| ID | Rule |
|---|---|
| ORG-01 | The organization currency is immutable once any financial document exists. Changing it requires a new organization or a migration with a documented conversion |
| ORG-02 | The business time zone is immutable once financial documents exist |
| ORG-03 | An organization with financial history can be deactivated but **never deleted** |
| ORG-04 | At least one store must exist before any sale can be recorded |
| ORG-05 | Deleting a store is impossible while it holds stock, has open shifts, or appears in any document. It is deactivated, and its stock must first be transferred out or adjusted to zero with reason |

---

## 3. Store

A **Store** is a point of sale. It has its own customers-facing identity, its own tax behaviour, its own prices,
its own terminals, and — optionally — its own warehouses.

`Store` holds:

- Code, name, address, contact details
- Time zone (may differ from the organization's; reports group by business date in the *store's* zone)
- **Tax mode**: prices are tax-inclusive or tax-exclusive. This is a store-level commercial fact, not a
  preference
- **Negative stock policy** — `Allow` or `Block` (§3). This is the single most consequential store setting
- **FEFO policy** — `Strict`, `Advisory`, or `Off`, and the near-expiry warning window in days
- **Expiry blocking** — whether expired stock is saleable
- **Return disposition default** — `Sellable` or `Quarantine` on receipt of a customer return
- Receipt and invoice templates
- Store-scoped price lists
- Feature switches

### 3.1 Store settings that change money

These are **not** cosmetic. Changing one invalidates historical interpretation, so each is either immutable or
takes effect prospectively with an explicit effective date:

| Setting | Change behaviour | Why |
|---|---|---|
| Tax mode (inclusive/exclusive) | **Immutable** once any sale exists. Changing it reinterprets every historic price | Historic totals must remain reproducible |
| Negative stock policy | Prospective only | Must not retroactively make past sales invalid |
| FEFO policy | Prospective only | Past allocations are recorded facts |
| Expiry blocking | Prospective only | Same |
| Receipt template | Prospective only | Past receipts are stored as issued |
| Currency | **Immutable** | Overview §3.1 |

**Requirement.** Every store setting that can change the meaning of money or stock must record an effective
timestamp, and every financial document must record the settings snapshot it was computed under. Otherwise a
report run next year cannot reproduce last year's margin. This is REQ-AU-06.

### 3.2 The negative stock policy — the most consequential decision in this document

Retail reality: **customers do not wait while stock is checked.** Blocking a sale because the system believes
stock is zero loses the sale and insults the customer. But a system that silently permits unbounded negative
stock cannot be trusted for valuation.

SmartStore resolves this with an explicit, per-store, prospectively-applied policy, and — critically — with the
guarantee that **negative stock is always recorded, never hidden**:

| Policy | Behaviour | Consequence |
|---|---|---|
| `AllowNegative` (**v1 default**) | Sale completes; balance goes negative; movement is written; a `NEGATIVE_STOCK` notification fires at severity Warning; the location appears on the negative-stock report | Revenue is preserved; the anomaly is tracked and must be resolved by adjustment or receipt |
| `BlockNegative` | Sale is refused with a clear message naming the item, its available quantity, and the action to take | Stock accuracy is guaranteed; sale is lost. Suited to warehouses, not to a sales floor |

**Both policies write the same ledger.** The difference is only whether the transaction is allowed to complete.
This is what makes the setting safely changeable: no historical data is reinterpreted.

**Decision (recorded as CON-07 in the review):** v1 default is `AllowNegative` for stores, and `BlockNegative`
for warehouses. Rationale: a warehouse sells to stores, not to walk-in customers, so blocking is free there;
a store sells to a person standing in front of the counter, so blocking is not.

`AllowNegative` does **not** waive BI-05 (a sale may create a negative balance — that is a policy decision) nor
BI-03 (the movement is still written). It waives nothing about integrity.

---

## 4. Warehouse

A **Warehouse** holds stock. It is either **store-attached** (belongs to one store) or **central** (belongs to
the organization, not to a store, and serves multiple stores). A warehouse is never both.

Central warehouses exist to serve v2 multi-store transfers. v1 operates a single store, and may use either kind.
The model supports both from day one so that enabling multi-store is a configuration act, not a migration.

`Warehouse` holds: code, name, type (`StoreAttached` | `Central`), owning store (if store-attached), address,
and whether it participates in FEFO and expiry blocking (normally yes).

### 4.1 Receiving dock vs sales floor

A warehouse may declare itself a **receiving location**: stock received into a `Receipts` location is *received
but not saleable*, and is moved to a `Sellable` location by an internal movement before it can be sold.

This supports the case where goods must be inspected, counted, or quarantined on arrival. It is a **SHOULD**, and
when the store uses a single default location the two-step flow collapses to one.

**RULE WH-01.** A sale line may only draw from a location where `IsSellable = true`. This is enforced at the
boundary, not by convention.

**RULE WH-02.** A central warehouse always defaults to `IsSellable = false` for its `Receipts` location, and
never allows a negative balance.

---

## 5. StorageLocation

**The leaf of the hierarchy. Stock exists only at a location.** There is no such thing as stock "at a store" or
"at a warehouse" — there is only stock at a location inside one.

`StorageLocation` holds: code, name, location type, `IsSellable`, and flags for `IsQuarantine`,
`IsDamaged`, `IsExpiredHold`.

Standard location types (organizations may add more):

| Type | Purpose | Sellable | Notes |
|---|---|---|---|
| `Default` | The main sellable location | Yes | One per warehouse, required |
| `Receiving` | Goods-receipt staging | No | Moves to `Default` on put-away |
| `Quarantine` | Held pending inspection; holds customer returns by default | No | Released by an inspection decision |
| `Damaged` | Write-off bin | No | Terminal for `DAMAGE` and `EXPIRY` movements |
| `ReturnsPending` | Customer returns awaiting disposition | No | Releases to `Default` or `Damaged` |
| `Transit` | In-transit between locations in the same organization | No | Only reachable by transfer movements |

**RULE WH-03.** A location's `IsSellable` can be turned off at any time; it cannot be deleted while it holds a
non-zero balance or any movement.

**RULE WH-04.** `Quarantine` and `Damaged` stock is **never** automatically merged into sellable stock. Release
is a discrete, permissioned, audited decision that writes its own movement. This is the fix for the risk of
returned goods silently re-entering sellable stock.

---

## 6. POS Terminal

A `PosTerminal` is a **registered** endpoint: a specific physical till running the POS client, bound to exactly
one store, with an identity the server recognises.

`PosTerminal` holds: device identity, store, a human label ("Till 1 — Front"), the operating mode
(`Standard` | `Training` | `Maintenance`), the store's tax and receipt defaults it inherits, the last-seen
heartbeat, and **whether it may operate offline** and its offline expiry window.

`PosTerminal` is a subtype of `Device` in the hardware model — it is a device with the `PosTerminal` capability.
It is listed separately here because it carries business identity, not just connectivity.

**RULE PT-01.** Every sale records the terminal that created it. A sale with no terminal attribution is invalid
and cannot be posted. This makes cashier performance, drawer reconciliation, and sync attribution answerable.

**RULE PT-02.** A terminal may only transact for its own store. A terminal cannot be reassigned to another store
while it has open shifts or un-synced transactions.

**RULE PT-03.** A terminal in `Training` mode may not complete a real sale, may not move stock, and may not
tender payment. It is excluded from all financial and inventory reports. Training mode exists so staff can learn
without polluting the ledger — it must be visibly unmistakable in the UI and is itself audited when enabled.

**RULE PT-04.** A terminal that has not sent a heartbeat within its configured interval is treated as
`Offline` by the server, is flagged on the dashboard, and raises a notification. It is **not** disabled — the
store's power may simply be off overnight.

---

## 7. Cash Drawer

A `CashDrawer` is the physical cash container at a terminal. v1 allows zero or one per terminal; the model
supports many.

`CashDrawer` holds: label, terminal, store, denomination breakdown for opening counts, and a **current open
shift reference**. Its own rules — opening float, cash in/out, closing, variance — are in
[cash-management.md](cash-management.md).

`CashDrawer` is also a device subtype (it has a connection and a health state) because a smart drawer reports
open/close events.

**RULE CD-01.** A drawer may have **at most one open shift at a time**. This is enforced by a uniqueness
constraint, not by a check-then-act, because two cashiers opening the same drawer simultaneously is a real event
in a busy store and must fail deterministically.

---

## 8. Global vs store-specific — the complete split

This table is normative. Getting this wrong is how multi-store systems leak data across tenants.

### 8.1 Organization-global (no `StoreId`)

| Entity | Note |
|---|---|
| `Organization` | The tenant |
| `Employee`, `UserAccount` | A person is global; their *access* is per store |
| `Customer`, `CustomerAddress` | A customer shops at any store in the organization |
| `Supplier`, `SupplierContact` | A supplier serves the whole organization |
| `Role`, `Permission` | Defined once, assigned per store |
| `Product`, `ProductVariant`, `Category`, `Brand` | **One catalog for the whole organization** |
| `Unit`, `UnitConversion` | Global |
| `ProductBarcode` | Global — a barcode identifies a variant, not a store's copy of it |
| `TaxCategory` | Global; `TaxRate` is global with jurisdiction and effective dates |
| `DiscountRule`, `Coupon` | Global definition, may be restricted to specific stores |
| `SupplierProduct` | Global |
| `Central Warehouse` and its `StorageLocation`s | Global, reachable from all stores |
| `ReasonCode` | Global, optionally store-restricted |
| `AuditEntry` | Global within the organization, and **queryable only with an explicit store filter or organization-wide permission** |

### 8.2 Store-specific (mandatory non-null `StoreId`)

| Entity | Note |
|---|---|
| `Store`, `StoreAttached Warehouse` | |
| `StorageLocation` | Of a store-attached warehouse |
| `PosTerminal`, `CashDrawer` | |
| `PriceList` (store-level) | |
| `StockItem`, `StockBalance`, `InventoryMovement` | **Stock is always store-attributed**, even for a central warehouse — the store is the *reason* the movement happened |
| `StockBatch` | Attributed to the store that received it |
| `Sale`, `SaleLine`, `Payment`, `Refund` | |
| `CustomerReturn`, `CustomerReturnLine` | |
| `PurchaseOrder`, `GoodsReceipt`, `PurchaseInvoice`, `PurchaseReturn` | The **supplier** is global, the *transaction* is not |
| `SupplierLedgerEntry` | Scoped to the store that transacted; the supplier balance for a store is a projection over those |
| `StockTransfer` | Has an origin store and a destination store |
| `StockCount`, `StockAdjustment` | |
| `Shift` (operating), `CashTransaction` | |
| `Device` assigned for store operation | |
| `DocumentNumberSequence` | Per store, per document type |
| `Notification` (routing preferences) | The *rule* is global; the *delivery* is per store |

### 8.3 The awkward one: `SupplierLedgerEntry`

A supplier's balance is a single number the supplier cares about, but the transactions behind it belong to
different stores. The model resolves this by giving each ledger entry a `StoreId`, and defining the supplier
balance in two ways:

- **Organization balance** — sum over all stores. What you owe the supplier overall.
- **Store balance** — sum for one store. What one store's cost centre owes.

Both are projections of the same entries. Neither is stored as a mutable total. This is the same
projection-not-a-field decision as stock, applied to payables.

**CON-08 (recorded in the review):** v1 defaults the supplier balance view to the **organization** figure,
because that is the number used to pay an invoice, but both are always available and the report states which
scope it is showing. Silently showing a store-scoped balance next to a supplier's name would be a
misrepresentation.

---

## 9. Multi-store readiness without multi-store complexity

Principle 13 requires a single store initially but a model that does not prevent multi-store. The mechanisms:

1. **`StoreId` is non-null from day one** (overview §3.9). No retrofit migration.
2. **A single "default" store** is created at onboarding, and the operator never has to think about it. The
   column exists and is populated; that is the entire cost.
3. **Scope is enforced by a server-applied predicate**, so it is already correct for one store and stays correct
   for many (BI-13).
4. **No cross-store joins in v1 features.** Reports are store-scoped by default with an organization-wide view
   requiring an explicit permission.
5. **Central warehouse support exists but is unused** until enabled.
6. **Document numbers are allocated per store**, so a second store can use the same sequence numbers.

What is explicitly **not** built in v1, and would be a Phase 2+ feature: inter-store pricing, inter-store
customer credit, consolidated reporting with allocation, and cross-store transfer approval chains. The data
model supports them; the workflows do not exist.

---

## 10. Store scoping enforcement — the actual mechanism

This is a security control, so it is specified as a mechanism, not an intention.

**RULE MS-01 (see also BI-13).** Every request resolves the caller's permitted store set `S` from
`EmployeeStoreAccess` × `EmployeeRoleAssignment`, intersected with the store named in the request (if any).

**RULE MS-02.** Any query for a store-scoped entity is constrained to `S` by the data-access layer, **before**
pagination, filtering, sorting, or aggregation. Applying the scope after aggregation is a data leak.

**RULE MS-03.** The scope predicate is applied from the authenticated session. A request body, query string, or
header that names a `StoreId`, `WarehouseId`, or `LocationId` is used only to **narrow** within `S`. A value
outside `S` yields `403 Forbidden` — never an empty result set, and never a silent redirect to the caller's
home store, because both responses teach the client the wrong thing.

**RULE MS-04.** `403` is returned for a store the caller may not access, and `404` for an entity that does not
exist at all. A `403` on an entity that exists in a store the caller cannot see does confirm the entity's
existence; where existence itself is sensitive, the endpoint returns `404`. This is recorded as an open
decision in the review (§10) because it is a genuine trade-off, not an oversight.

**RULE MS-05.** An employee with no store access can sign in and sees an empty workspace with an explanatory
message — not a permission error, and not an option to pick a store. Picking a store is a role assignment
decision, made by someone else.

**Cross-store reads that ARE permitted:** organization-wide reports require an explicit permission
(`Report.OrganizationWide`) and are visibly marked as organization-wide in the UI so a store manager does not
mistake a chain-wide number for their own store's.

---

## 11. What is deliberately not modelled

| Not modelled | Why |
|---|---|
| Legal entity / subsidiary hierarchy | v1 is one legal entity per organization. A holding company is modeled as a separate organization. Revisit if a real customer needs it |
| `Region` / geographic grouping of stores | No retail workflow in scope requires it; it can be added as a simple attribute without a migration |
| Franchise relationships | Out of scope — a franchisee is a separate organization with its own SmartStore |
| Multi-currency per store | Overview §3.1: the field exists, conversion does not |
| Store opening hours / trading calendar | **Should** be added before production; noted in the review as an open decision because it affects the business-date boundary |
| Cost centres / departments on stock | A `Department` entity exists descriptively; costing by department is out of scope |
