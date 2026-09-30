# SmartStore — Product Overview

**Phase 1 — Product & Domain Specification. Authoritative. No implementation.**

This document is the **anchor for the whole Phase 1 specification**. Where any other Phase 1 document could be
read in two ways, this one decides. Cross-cutting conventions (money, quantity, rounding, naming, identifiers,
store scoping) are defined **here and only here**; domain documents reference them rather than restating them.

**Phase 0 basis.** [Foundation recommendation](../repository-analysis/foundation-recommendation.md) concluded
**Option C — build clean**, with the five surveyed repositories used as a map of what has been solved and, more
usefully, of what has been got wrong. Phase 1 requirements that exist because a surveyed repository got them
wrong are marked **[P0:&lt;finding-id&gt;]** so the provenance is traceable. The most load-bearing of these are:

| Phase 0 finding | What it was | What Phase 1 does about it |
|---|---|---|
| **D-09** | A surveyed system kept stock as a bare mutable integer with no movement history, so "why is stock 3?" was unanswerable | **Balance is a projection of an append-only ledger. Never directly editable.** See [business-invariants.md](../domain/business-invariants.md) BI-02, BI-03 |
| **D-17** | Two surveyed systems stored money in `Float` / `Double` | **Money is exact decimal, rounded at one documented point.** BI-01 |
| **D-02, D-03** | A surveyed system adjusted stock without writing a movement, and imported stock by CSV without validation | **Every balance write is paired with a movement write in one transaction; imports are dry-run-first and validated.** BI-03, IV-31 |
| **D-13** | A surveyed system did not verify `received <= ordered` | **Over-receipt is bounded by a tolerance and otherwise requires approval.** §8 procurement |
| **D-16** | A surveyed "retail" system had no inventory concept at all | Inventory is a **first-class domain**, not a field on a product |
| **S-01** | A surveyed system allowed anonymous, unbounded, **replayable** returns that inflated stock with no ledger | **Return quantity is bounded by the original sale line, atomically; returns always write a movement.** BI-06, RR-04 |
| **S-06** | A surveyed system used prefix matching and failed open on permissions | **Permissions are exact-key, default-deny, enforced server-side.** BI-12 |
| **S-12** | A surveyed system's "audit log" never recorded actor or IP | **Audit records are mandatory, append-only, and complete.** §20 audit |
| **A-21** | A surveyed system logged the full cart including PII on every sale | **No PII in logs.** CU-35 |
| **L-01…L-08** | Three of five repositories had no licence; one was MIT plus a branding clause | **No source is copied.** SmartStore is clean-room; only ideas are taken |

---

## 1. What SmartStore is

SmartStore is a **production-grade retail operating platform** for supermarkets, grocery, convenience,
electronics, clothing, hardware, and pharmacies where legally appropriate.

It is **not** an ERP. It does not do payroll, manufacturing, general-ledger accounting, CRM automation, or
supply-chain planning. It does the retail operating core exceptionally well: **stock truth, sale truth, money
truth, and an audit trail that survives scrutiny.** See [PHASE-1-REVIEW.md](PHASE-1-REVIEW.md) §9 for the full
out-of-scope list.

The single sentence that defines the product:

> **SmartStore is the system of record for what a store has, what it sold, who did it, and what it is owed —
> and it must still be answerable after the network, a device, or a member of staff fails.**

That sentence is the reason for the offline design, the ledger, the audit log, and the device abstraction. Every
major decision below traces back to it.

---

## 2. Product principles, and how each is made real

A principle that no document, requirement, or invariant enforces is a slogan. Each principle below names the
**enforcement mechanism**, which is what actually makes it true.

| # | Principle | Enforcement mechanism | Where |
|---|---|---|---|
| 1 | Financial and inventory data must be auditable | Append-only movement ledger + immutable finalized documents + audit log; no `UPDATE`/`DELETE` on finalized rows | BI-01…BI-08, [audit-domain.md](audit-domain.md) |
| 2 | Inventory has a movement/ledger model, not an editable quantity | `StockBalance` is a **derived projection** of `InventoryMovement`; a balance row is never the object of a business edit | BI-02, BI-03 |
| 3 | Every important business operation is traceable | Every document carries actor, store, terminal, shift, timestamp; every state change writes an audit row | §20 audit |
| 4 | Permissions enforced server-side | Default-deny permission check at the application boundary on **every** request; no client-supplied role or scope | BI-12, [actors-and-roles.md](actors-and-roles.md) |
| 5 | Store/warehouse boundaries enforced server-side | Store scope is a **server-applied predicate**, never a client-supplied filter; a client that asks for another store's data is refused | BI-13, [multi-store-domain.md](multi-store-domain.md) |
| 6 | POS operates during network outage | Local edge agent owns hardware, prices, and a durable transaction queue; sales complete locally and reconcile | [offline-pos-domain.md](offline-pos-domain.md) |
| 7 | Offline sync creates no duplicate sales and no inventory corruption | Client-generated idempotency key with a server-side unique constraint; replay returns the original result | BI-28, OF-06 |
| 8 | Money avoids floating-point errors | Exact decimal throughout; one documented rounding point; **P0: D-17** | BI-01 |
| 9 | Important operations are transactional | Each business operation is one database transaction containing **all** of its writes: document header, lines, ledger movements, audit, notification | BI-04 |
| 10 | Destructive operations protected and auditable | No hard delete of transactional data; archive instead; privileged operations require an explicit permission and record a mandatory reason | BI-09, BI-10 |
| 11 | RFID is authentication, never authorization | **RFID → credential → employee → permission check → permitted action.** A tag read alone grants nothing | BI-16, [rfid-domain.md](rfid-domain.md) |
| 12 | Hardware behind an abstraction | Domain issues **domain commands** ("read tags", "print receipt", "open drawer", "read weight"); manufacturer drivers sit behind `Device`/`DeviceType`/`Connection` | BI-17, [hardware-domain.md](hardware-domain.md) |
| 13 | Single store initially, multi-store not prevented | `StoreId` is a **required** foreign key on every store-scoped row from day one, even with one store | BI-13, [organization-model.md](organization-model.md) |
| 14 | Understandable to non-technical staff | Domain terms in the UI match the words staff use; no accounting jargon without a plain-language gloss | [ux-requirements.md](ux-requirements.md) |
| 15 | UI separates operations from configuration | Two distinct application shells with separate navigation, separate permission sets, separate navigation entry points | [ux-requirements.md](ux-requirements.md) §2 |

---

## 3. Canonical conventions

**This section is the single source of truth. Domain documents reference it; they do not restate it. If a domain
document appears to contradict it, this document wins and the domain document is a defect.**

### 3.1 Money

- Money is an **exact decimal**. Binary floating point is forbidden anywhere money is computed or stored.
  **[P0: D-17 — two surveyed systems used `Float`/`Double` and therefore could not reconcile their own totals.]**
- Every monetary amount carries an explicit **currency code**. Multi-currency is *modelled* (the field exists on
  every amount-bearing entity) but **SHOULD** operate in a single currency per organization in v1. Conversion is
  **OUT OF SCOPE** for v1.
- Amounts are stored with the scale their currency requires. The system records a currency's minor-unit exponent
  rather than assuming 2, so zero-decimal and three-decimal currencies are representable.
- **Rounding is deterministic and applied at exactly one documented point per document type.** The rule is
  stated per document in the owning domain document; the governing rule is BI-01.
- The **rounding mode is half-up** unless a document type explicitly states otherwise. No document type does.
- Arithmetic invariants: line amounts are computed at full precision and rounded **once**; a document total is the
  sum of its rounded line amounts; a document total is never recomputed from unrounded intermediates. This makes
  the sum-of-lines identity hold exactly and keeps reports reproducible.

### 3.2 Quantity

- A quantity carries its **unit of measure**. Bare numbers are never accepted by any interface.
- **Stock quantity is always stored in the product's base unit.** All entry — purchase, sale, return, transfer,
  adjustment, count — is converted to base units **before** it is written. This is what makes the ledger
  deterministic and unit changes non-destructive. See §5 of [product-domain.md](product-domain.md).
- **Countable** products (pieces, packets, boxes) use integer quantities. **Measurable** products (kg, g, l, ml)
  use decimal quantities with a scale appropriate to the unit.
- Rounding of measured quantities (for example a scale reading of 1.2347 kg) is **half-up to the unit's
  configured scale** and the applied rounding is recorded on the line. Configured per unit, default 3 decimals
  for kg, 0 for pieces.
- A quantity may never be negative on an *entry* line. Negative effects are produced by movement **direction**
  and movement type, never by a signed quantity. This is BI-05 and removes an entire class of sign bugs.

### 3.3 Time

- All timestamps are stored in UTC with a monotonic server clock. Rendering to local time is a presentation
  concern.
- A **business date** is a separate, explicitly-stored calendar date in the store's configured time zone. Reports,
  shift reconciliation, and accounting periods use the business date; technical timestamps use UTC. "End of day"
  is a business-date boundary, not a UTC one.
- Hardware and edge agents submit events with their own observation timestamp **and** the server's receipt
  timestamp. Both are stored; the server's is authoritative for ordering, the device's is authoritative for what
  the operator saw. See [rfid-domain.md](rfid-domain.md) §7.

### 3.4 Identifiers

- Every entity has a surrogate primary key that is **opaque and non-derivable**. No sequential IDs are exposed to
  clients, and no entity type is inferable from an ID.
- Documents (sales, orders, receipts) additionally carry a **human-readable document number** scoped per store and
  per document type, formatted `PREFIX-YYYYMM-NNNNNN`, allocated by the server inside the transaction that
  creates the document. Document numbers are **never reused**, including after cancellation.
- Synchronisable entities additionally carry a **`ClientOperationId`** (a client-generated UUID) used for
  idempotency. See [offline-pos-domain.md](offline-pos-domain.md) §6.

### 3.5 Money-in-motion vs money-on-account

Two distinct concepts that must never be conflated:

- **Payment** — money physically tendered against a document, now.
- **Credit / payable** — a balance owed, settled later.

A credit sale creates an **AR document plus a customer ledger entry**, and a **zero-value** payment. It is never
represented as a payment of the full amount. This is the resolution of the "customer credit vs payment"
contradiction; see [PHASE-1-REVIEW.md](PHASE-1-REVIEW.md) §8.

### 3.6 Deletion

- There is **no hard delete** on any entity that has ever appeared in a financial or inventory document.
- Deletion is expressed as a status change to `Archived`, and archival is itself a permissioned, audited,
  reason-bearing operation.
- The only entities that may be hard-deleted are those that provably have no dependent rows and no audit
  relevance: draft document lines never submitted, unused unit conversions, and device configuration drafts.
- Correcting a finalized document is done by a **compensating document**, never by editing. See BI-08.

### 3.7 Status and state naming

- Lifecycle states are a **closed, enumerated set** per entity. Every transition is listed in
  [state-machines.md](state-machines.md) with its actor, guard, and approver. An unlisted transition is a bug.
- A state name is a past participle or a noun, never an imperative, and never encodes a negative
  (`NotApproved` is not a state; `PendingApproval` and `Rejected` are).
- Any entity holding a lifecycle state also holds the timestamps of entry into its current state and the actor
  that caused it.

### 3.8 Reason codes

Operations that change money or stock beyond an ordinary sale require a **reason**, chosen from a
**server-defined, per-organization reason-code list**. Free text is allowed **in addition to**, never instead of, a
reason code. Reason codes drive reporting and analytics; free text carries the nuance. A missing reason code is
rejected at the boundary, not warned about.

### 3.9 Store scoping

- Every store-scoped entity carries `StoreId` as a **non-null** foreign key. `StoreId` is absent — not null —
  only for organization-global entities, which are enumerated in [organization-model.md](organization-model.md) §5.
- A request never supplies a store scope. The server derives the caller's permitted store set from their
  employment and role assignments and **intersects** it with the target store. A request naming a store outside
  that set is refused with `403`, never silently redirected or filtered. BI-13.

### 3.10 Idempotency

Any operation that may be retried carries an idempotency key, and the server enforces uniqueness on it:

| Operation | Key | On duplicate |
|---|---|---|
| Offline transaction sync | `ClientOperationId` (terminal-generated UUID) | Return the **original** result, do not re-apply |
| Payment gateway callback | Provider transaction reference | Return success, record once |
| Hardware event (RFID, scale) | Device-generated event UUID | Discard, record as duplicate in device log |
| Manual document submission | Client-generated UUID per form instance | Return the original document |
| Import job | Job UUID | Return the original job result |

BI-28.

### 3.11 Document line immutability

A finalized document's header and lines are immutable. The only permitted mutation of a finalized document is
the addition of linked **compensating** documents (a return against a sale, a credit note against an invoice, a
reversal against a movement). Computed remaining quantities (`ReturnedQuantity`, `RefundableAmount`,
`ReceivedQuantity`, `PaidAmount`) are maintained as **denormalized counters on the parent line**, updated inside
the same transaction as the compensating document, because a report that must sum a ledger to answer "how much is
still returnable" is not an acceptable POS query path. The invariant these counters protect is BI-06.

---

## 4. Canonical core model

The complete entity inventory, with the document that owns each entity's rules. **This is the authoritative list;
if an entity appears in a domain document but not here, that is a defect to be reported.**

### 4.1 Organization and access

| Entity | Owning document | Notes |
|---|---|---|
| `Organization` | [organization-model.md](organization-model.md) | The tenant boundary. Every other entity belongs to exactly one |
| `Store` | [organization-model.md](organization-model.md) | Operates POS, holds stock, has its own settings |
| `Warehouse` | [organization-model.md](organization-model.md) | May be store-attached or a central warehouse |
| `StorageLocation` | [organization-model.md](organization-model.md) | The leaf that actually holds stock |
| `PosTerminal` | [cash-management.md](cash-management.md) | A registered device bound to one store |
| `CashDrawer` | [cash-management.md](cash-management.md) | Physical drawer; may be absent for a terminal without one |
| `Employee` | [employee-domain.md](employee-domain.md) | A person. Not a login |
| `UserAccount` | [employee-domain.md](employee-domain.md) | The login credential; optional per employee |
| `Role` | [actors-and-roles.md](actors-and-roles.md) | Named permission set, optionally store-scoped |
| `Permission` | [actors-and-roles.md](actors-and-roles.md) | Atomic, exact-match, default-deny key |
| `EmployeeStoreAccess` | [employee-domain.md](employee-domain.md) | Which stores, which scope, from-when to-when |
| `EmployeeRoleAssignment` | [employee-domain.md](employee-domain.md) | Which role, scoped to a store or the whole organization |
| `Department`, `Position` | [employee-domain.md](employee-domain.md) | Descriptive; drive nothing security-relevant |
| `Shift` (planned) | [employee-domain.md](employee-domain.md) | Rostered working period |
| `AttendanceEvent` | [employee-domain.md](employee-domain.md) | An actual punch, RFID or manual |
| `AttendanceException` | [employee-domain.md](employee-domain.md) | Missing punch, late, early, wrong reader |
| `LeaveRequest` | [employee-domain.md](employee-domain.md) | **SHOULD** in v1 |
| `ApprovalRequest` | [approval-workflows.md](approval-workflows.md) | A pending gate on a state transition |

### 4.2 Catalog

| Entity | Owning document | Notes |
|---|---|---|
| `Product` | [product-domain.md](product-domain.md) | The **SPU**. Never directly stockable |
| `ProductVariant` | [product-domain.md](product-domain.md) | The **SKU**. The unit of stock, price, and barcode |
| `Category` | [product-domain.md](product-domain.md) | Self-referencing tree, single parent |
| `Brand` | [product-domain.md](product-domain.md) | Optional |
| `ProductBarcode` | [product-domain.md](product-domain.md) | **1:N per variant** — one variant, many barcodes |
| `Unit` | [product-domain.md](product-domain.md) | Piece, kg, g, l, ml, box, packet, custom |
| `UnitConversion` | [product-domain.md](product-domain.md) | Factor between units; used for entry, never for storage |
| `ProductImage` | [product-domain.md](product-domain.md) | Ordered, one primary |
| `PriceList` / `PriceListEntry` | [product-domain.md](product-domain.md) | Per store and/or customer group |
| `ProductCost` | [product-domain.md](product-domain.md) | The **standard** cost; actual cost is per batch |
| `TaxCategory`, `TaxRate` | [product-domain.md](product-domain.md) | Rate with effective dates and jurisdiction |
| `DiscountRule` | [product-domain.md](product-domain.md) | Order-level and line-level |
| `Coupon` | [product-domain.md](product-domain.md) | **COULD** in v1 |
| `SupplierProduct` | [procurement-domain.md](procurement-domain.md) | Supplier's reference and lead time per variant |

### 4.3 Inventory

| Entity | Owning document | Notes |
|---|---|---|
| `StockItem` | [inventory-domain.md](inventory-domain.md) | The stockable identity: variant at a location |
| `StockBalance` | [inventory-domain.md](inventory-domain.md) | **Derived projection.** Never directly edited |
| `InventoryMovement` | [inventory-domain.md](inventory-domain.md) | **The ledger. Append-only.** The source of truth |
| `InventoryTransaction` | [inventory-domain.md](inventory-domain.md) | Business intent: the reason a group of movements exists |
| `StockBatch` | [batch-expiry-fefo.md](batch-expiry-fefo.md) | Batch, dates, cost, remaining quantity |
| `StockCount`, `StockCountLine` | [inventory-domain.md](inventory-domain.md) | Cycle counting with variance |
| `StockAdjustment` | [inventory-domain.md](inventory-domain.md) | Increase/decrease with mandatory reason |
| `StockTransfer`, `StockTransferLine` | [inventory-domain.md](inventory-domain.md) | Dispatch/receive in transit |
| `StockReservation` | [inventory-domain.md](inventory-domain.md) | Soft hold, expires |
| `StockReceipt`, `StockIssue` | [inventory-domain.md](inventory-domain.md) | Generic inbound/outbound; the specialised flows are purchasing and sales |

### 4.4 Sales

| Entity | Owning document | Notes |
|---|---|---|
| `Sale` | [sales-pos-domain.md](sales-pos-domain.md) | One customer transaction |
| `SaleLine` | [sales-pos-domain.md](sales-pos-domain.md) | Carries `ReturnedQuantity` and refundable counters |
| `Payment` | [payment-domain.md](payment-domain.md) | One tender against a sale |
| `CustomerReturn`, `CustomerReturnLine` | [returns-refunds-domain.md](returns-refunds-domain.md) | Bounded by the original sale lines |
| `Refund` | [returns-refunds-domain.md](returns-refunds-domain.md) | Money out; bounded by refundable amount |
| `SuspendedSale` | [sales-pos-domain.md](sales-pos-domain.md) | A parked cart. **Reserves no stock** — see [inventory-domain.md](inventory-domain.md) §11 / IV-49 |
| `PriceOverride` | [sales-pos-domain.md](sales-pos-domain.md) | Records who changed a price and why |
| `CashTransaction` | [cash-management.md](cash-management.md) | Drawer in/out within a shift |

### 4.5 Purchasing

| Entity | Owning document | Notes |
|---|---|---|
| `Supplier`, `SupplierContact` | [supplier-domain.md](supplier-domain.md) | |
| `SupplierLedgerEntry` | [supplier-domain.md](supplier-domain.md) | Balance is a projection of this |
| `PurchaseRequisition` | [procurement-domain.md](procurement-domain.md) | Request |
| `PurchaseOrder`, `PurchaseOrderLine` | [procurement-domain.md](procurement-domain.md) | Carries `ReceivedQuantity` counter |
| `GoodsReceipt`, `GoodsReceiptLine` | [procurement-domain.md](procurement-domain.md) | The GRN; creates stock |
| `PurchaseInvoice` | [procurement-domain.md](procurement-domain.md) | The bill; creates a payable |
| `PurchaseReturn`, `PurchaseReturnLine` | [procurement-domain.md](procurement-domain.md) | Stock out to supplier |
| `SupplierPayment` | [supplier-domain.md](supplier-domain.md) | Money out |

### 4.6 Customers and loyalty

| Entity | Owning document | Notes |
|---|---|---|
| `Customer` | [customer-domain.md](customer-domain.md) | Walk-in is a customer record, not a null |
| `CustomerAddress` | [customer-domain.md](customer-domain.md) | 1:N |
| `CustomerAccount` | [customer-domain.md](customer-domain.md) | The credit facility; optional |
| `CustomerLedgerEntry` | [customer-domain.md](customer-domain.md) | Charge, payment, credit note. Balance is a projection |
| `LoyaltyAccount` | [customer-domain.md](customer-domain.md) | Points balance |
| `LoyaltyTransaction` | [customer-domain.md](customer-domain.md) | Earn and redeem entries |

### 4.7 Hardware and RFID

| Entity | Owning document | Notes |
|---|---|---|
| `Device` | [hardware-domain.md](hardware-domain.md) | A registered physical unit |
| `DeviceType` | [hardware-domain.md](hardware-domain.md) | Capability contract |
| `DeviceConnection` | [hardware-domain.md](hardware-domain.md) | How it reaches SmartStore |
| `RfidReader` | [rfid-domain.md](rfid-domain.md) | A `Device` with reader capability |
| `RfidTag` | [rfid-domain.md](rfid-domain.md) | A registered tag |
| `RfidCredential` | [rfid-domain.md](rfid-domain.md) | A tag bound to an employee, with lifecycle |
| `RfidEvent` | [rfid-domain.md](rfid-domain.md) | An observed read. **Never carries authorization** |
| `AuthenticationEvent` | [rfid-domain.md](rfid-domain.md) | Outcome of resolving a credential |
| `AttendanceEvent` | [employee-domain.md](employee-domain.md) | A punch, from RFID or manual |
| `DeviceEvent` | [hardware-domain.md](hardware-domain.md) | Health, connectivity, firmware, errors |

### 4.8 Cross-cutting

| Entity | Owning document | Notes |
|---|---|---|
| `AuditEntry` | [audit-domain.md](audit-domain.md) | Append-only. Complete actor/context |
| `Notification`, `NotificationRule`, `NotificationDelivery` | [notification-domain.md](notification-domain.md) | |
| `ImportJob`, `ImportRowResult` | [product-domain.md](product-domain.md) §9 | Dry-run first |
| `SyncSession`, `SyncConflict` | [offline-pos-domain.md](offline-pos-domain.md) | |
| `ReasonCode` | This document §3.8 | Per organization |
| `DocumentNumberSequence` | This document §3.4 | Per store, per document type |
| `IdempotencyRecord` | This document §3.10 | Unique on the key |

---

## 5. Phase 1 document index

| Document | Owns |
|---|---|
| [product-overview.md](product-overview.md) | **Anchor.** Conventions, principles, core model, scope |
| [actors-and-roles.md](actors-and-roles.md) | 17 actors, permission catalogue, role templates |
| [organization-model.md](organization-model.md) | Tenant → store → warehouse → location → terminal → drawer; global vs store-specific |
| [product-domain.md](product-domain.md) | Product, variant, barcode, unit, price, tax, discount, import |
| [inventory-domain.md](inventory-domain.md) | Ledger, movement types, balance derivation, count, adjustment, transfer, reservation |
| [batch-expiry-fefo.md](batch-expiry-fefo.md) | Batch, dates, cost, FEFO, override, quarantine, blocking |
| [procurement-domain.md](procurement-domain.md) | Requisition → PO → GRN → invoice → payment, three-way match, tolerances |
| [sales-pos-domain.md](sales-pos-domain.md) | Cart → completed sale, discounts, tax, scanning, weighted goods, suspend/void |
| [returns-refunds-domain.md](returns-refunds-domain.md) | Return eligibility, disposition, refund bounds, exchange, store credit |
| [customer-domain.md](customer-domain.md) | Customer, account, credit, ledger, loyalty |
| [supplier-domain.md](supplier-domain.md) | Supplier, contacts, catalogue, ledger, balance |
| [employee-domain.md](employee-domain.md) | Employee, account, store access, shift, attendance, leave, status |
| [rfid-domain.md](rfid-domain.md) | Tag, credential lifecycle, reader, events, anti-duplication, offline |
| [hardware-domain.md](hardware-domain.md) | Device abstraction, capabilities, connection, failure behaviour, firmware |
| [offline-pos-domain.md](offline-pos-domain.md) | Edge agent, caches, queue, sync, idempotency, conflict resolution |
| [multi-store-domain.md](multi-store-domain.md) | Scope enforcement, cross-store roles, transfers, central warehouse |
| [cash-management.md](cash-management.md) | Drawer, shift, opening/closing, variance |
| [payment-domain.md](payment-domain.md) | Payment, method, provider abstraction, refunds, credit vs tender |
| [audit-domain.md](audit-domain.md) | What is audited, entry shape, immutability, backup and recovery |
| [reporting-domain.md](reporting-domain.md) | Report catalogue, reproducibility, read-only projections |
| [notification-domain.md](notification-domain.md) | Events, severity, routing, escalation, delivery |
| [approval-workflows.md](approval-workflows.md) | Which operations need approval, configurable thresholds |
| [state-machines.md](state-machines.md) | 14 state machines, transitions, actors, guards, irreversibility |
| [edge-cases.md](edge-cases.md) | 22 specified behaviours plus the ones found in review |
| [ux-requirements.md](ux-requirements.md) | Personas' UX principles, terminology, accessibility |
| [requirements-traceability.md](requirements-traceability.md) | Master requirement table with acceptance criteria |
| [../domain/business-invariants.md](../domain/business-invariants.md) | **The rules that must never be violated** |
| [PHASE-1-REVIEW.md](PHASE-1-REVIEW.md) | Validation, contradictions, unresolved decisions, open questions |

---

## 6. Scope boundary for v1

**IN SCOPE** — everything in [requirements-traceability.md](requirements-traceability.md) marked MUST or SHOULD.

**OUT OF SCOPE / FUTURE** — deliberately excluded, with the reason, in
[PHASE-1-REVIEW.md](PHASE-1-REVIEW.md) §9. Summary:

- Full HR payroll and payroll tax
- Manufacturing, bill of materials, production orders
- General-ledger / double-entry accounting beyond tax and payables summary
- CRM automation, campaign engines, tiered loyalty programme design
- Project management
- Advanced supply-chain planning: forecasting, optimisation, replenishment algorithms
- **Online storefront / e-commerce** — SmartStore is the *operating* platform; a web shop is a separate product
- Regulated pharmacy specifics: prescriptions, controlled-substance registers, DEA/Schedule-II style records.
  Batch, expiry, and FEFO — which pharmacy needs — **are** in scope. The rest waits on a jurisdiction.
- Multi-currency conversion (the field exists; conversion does not)
- Loyalty tiers, points expiry campaigns, referral programmes
- Self-service customer portal

**A note on "Digital Billing".** SmartStore's digital billing means **computerised receipts, invoices, and
customer/supplier statements produced in place of paper**, and is in scope. It does not mean a web storefront.

---

## 7. What this phase deliberately does not decide

These are deliberately left open, and each is listed in [PHASE-1-REVIEW.md](PHASE-1-REVIEW.md) §10 with the
decision it blocks:

1. Technology stack, language, framework, database engine
2. Whether the edge agent is a process, a service, or an appliance
3. Payment provider(s) and card-present vs card-not-present posture
4. Barcode symbologies and GS1 element strings in detail
5. Whether tax is computed or consumed from an external engine
6. Attachment/blob storage technology
7. Currency and jurisdiction defaults
8. Whether loyalty accrues on gross or net (a business decision, not a technical one) — **decided: net of discount,
   excluding tax (D-11, `CU-25`)**
9. Local regulatory requirements per jurisdiction

**The domain model in this specification is deliberately independent of all nine.** If Phase 2 reveals a
technology that cannot express one of these models cleanly, that is a signal to revisit the model — with the
rationale recorded — not to compromise the model.
