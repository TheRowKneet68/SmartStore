# SmartStore — Actors and Roles

**Phase 1 — Product & Domain Specification.**

Owner of: the actor catalogue, the permission catalogue, and the role templates. Enforcement rules are
normative and mirrored in [../domain/business-invariants.md](../domain/business-invariants.md) as BI-12.

---

## 1. Design rules for access control

These four rules are the whole access-control model. Everything else is a consequence.

| ID | Rule |
|---|---|
| AC-01 | **Default deny.** An authenticated employee with no role assignment has **no** permission. There is no implicit access, no "everyone can read products", and no fallback policy that grants anything |
| AC-02 | **Exact permission keys.** Permissions are opaque dotted strings matched for **equality**. No prefix, substring, or wildcard matching. **[P0: S-06 — a surveyed system used prefix matching and failed open on a null permission id, which inverted its own access rule]** |
| AC-03 | **Server-side, every request.** The check runs in the application layer on every request. There is no request that skips it, and a client-supplied role, permission, or store id is never trusted |
| AC-04 | **Least privilege by default.** No role template grants a permission unless a named retail responsibility requires it. "It might be useful later" is not a reason |

**Note on role inheritance.** SmartStore has **no** hierarchical or nested roles. `Assistant Manager` is not
"Manager minus X" — it is its own explicit permission set. Nested roles are a well-known source of
unintentional privilege escalation, and the operational cost of an explicit list is trivial next to that risk.

**Note on denial of service by configuration.** A role with zero permissions is valid (it is how you disable an
employee without deactivating their account) and produces an empty workspace, per MS-05.

---

## 2. Permission catalogue

The complete set of atomic permissions. Domains are grouped; the key is `<Domain>.<Resource>.<Action>`.

**Owner decision D-16 (2026-10-02).** Five keys were added, so the catalogue now holds 122:
- `Payment.Capture` and `Payment.Void` (§2.11);
- `Employee.Reactivate` (§2.8);
- `Refund.Pay` (§2.4);
- `Shift.Reopen` (§2.10).

The transitions that some existing keys now authorize are named in their rows. `Config.Roles` authorizes nothing.

### 2.1 Catalog and pricing

| Permission | Grants |
|---|---|
| `Product.View` | Read products, variants, categories, brands, images |
| `Product.Create` / `Product.Edit` | Create and amend catalog entries |
| `Product.Archive` | Move a product to Archived. Not a delete |
| `Product.Cost.View` | See standard cost, margin, and cost history. **Deliberately separate from `Product.View`** |
| `Price.View` / `Price.Edit` | Read and amend the store price list |
| `Price.Override` | Change a price at the till at sale time |
| `Price.BelowCost.Approve` | Approve a below-cost price change |
| `Tax.View` / `Tax.Edit` | Read and amend tax categories and rates |
| `Discount.View` / `Discount.Create` / `Discount.Edit` | Manage discount rules |
| `Discount.Apply` | Apply a discount at the till |
| `Discount.Large.Approve` | Approve a discount beyond the store threshold |
| `Import.Run` / `Import.Approve` | Execute and approve a bulk import |

### 2.2 Inventory

| Permission | Grants |
|---|---|
| `Inventory.View` | See stock, balances, and movements |
| `Inventory.Receive` | Receive stock from a supplier or transfer |
| `Inventory.Adjust` | Create a stock adjustment. Always requires a reason code |
| `Inventory.Adjust.Large.Approve` | Approve an adjustment beyond the store threshold |
| `Inventory.Count.Create` / `Inventory.Count.Post` | Create a count sheet; post its variances |
| `Inventory.Transfer.Create` | Raise a transfer |
| `Inventory.Transfer.Dispatch` / `Inventory.Transfer.Receive` | Ship and confirm receipt |
| `Inventory.Reservation.Manage` | Hold and release reserved stock |
| `Inventory.FEFO.Override` | Choose a non-FEFO batch. Always requires a reason |
| `Inventory.Ledger.View` | See the raw movement ledger. **Separate from `Inventory.View`** because it exposes cost and actor |

### 2.3 Purchasing

| Permission | Grants |
|---|---|
| `Purchase.View` | See requisitions, orders, receipts, invoices |
| `Purchase.Requisition.Create` / `.Submit` | Raise and submit a requisition |
| `Purchase.Order.Create` / `.Submit` / `.Approve` / `.Send` | Raise, approve, and issue a PO |
| `Purchase.Receive` | Post a goods receipt against a PO |
| `Purchase.Invoice.Record` | Record a supplier invoice |
| `Purchase.ThreeWayMatch.View` | See match results and discrepancies |
| `Purchase.Return.Create` / `.Approve` | Return goods to a supplier |
| `Purchase.Pay` | Record a payment to a supplier |

### 2.4 Sales and POS

| Permission | Grants |
|---|---|
| `Sale.View` | See sales, own store |
| `Sale.Create` | Ring up a sale and complete it. Also starts a card tender (state-machines §22.10, submit), and reads the receipt at the till (D-16) |
| `Sale.Discount` | Apply a permitted discount |
| `Sale.Suspend` / `Sale.Resume` | Park and resume a cart |
| `Sale.Void` | Void a sale that has not yet been finalized |
| `Sale.Void.Posted.Approve` | Approve voiding an already-finalized sale. **A compensating document is created, never a delete** |
| `Sale.Refund` | Issue a refund within the permitted amount. Also retries a failed refund and cancels an unpaid one (§22.7, D-16) |
| `Sale.Refund.Large.Approve` | Approve a refund beyond the store threshold |
| `Refund.Pay` | Submit an approved refund for payment, from the drawer or to the provider (§22.7, "submit to provider"). **Separate from `Sale.Refund`** (D-16) |
| `Sale.OfflineQueue.Manage` | Inspect and reconcile a terminal's offline queue |

### 2.5 Returns

| Permission | Grants |
|---|---|
| `Return.Create` | Accept a customer return against a sale, and cancel it before it posts (§22.7, D-16) |
| `Return.Approve` | Approve a return beyond the permitted value |
| `Return.Dispose` | Decide quarantine/damaged/sellable disposition |

### 2.6 Customers and credit

| Permission | Grants |
|---|---|
| `Customer.View` / `Customer.Create` / `Customer.Edit` | Manage customer records |
| `Customer.Credit.Grant` | Create or change a credit limit |
| `Customer.Credit.Approve` | Approve a credit limit above the store threshold |
| `Customer.Payment.Record` | Record a payment against a customer balance |
| `Customer.Loyalty.Adjust` | Manually add or remove loyalty points. Always requires a reason |
| `Customer.Statement.View` | See a customer statement |
| `Customer.DataExport` | Export customer data. **Separate permission because it is a privacy action** |

### 2.7 Suppliers

| Permission | Grants |
|---|---|
| `Supplier.View` / `Supplier.Create` / `Supplier.Edit` | Manage suppliers |
| `Supplier.Payment.Record` | Record a payment to a supplier |
| `Supplier.Credit.Adjust` | Apply a credit note or write-off |
| `Supplier.Balance.View` | See the payable balance |

### 2.8 Employees, roles, and attendance

| Permission | Grants |
|---|---|
| `Employee.View` / `Employee.Create` / `Employee.Edit` | Manage employee records. `Employee.Edit` also brings an employee back from leave (§22.9, D-16) |
| `Employee.Terminate` | Terminate employment. Irreversible |
| `Employee.Reactivate` | Restore a suspended employee's access (§22.9, `Suspended` → `Active`), with a reason, audited (`SM-50`). **Separate from `Employee.Edit`** (D-16) |
| `Employee.StoreAccess.Grant` | Give an employee access to a store. **A high-value grant** |
| `Employee.Password.Reset` | Reset another employee's password |
| `Role.View` / `Role.Create` / `Role.Edit` | Manage role definitions |
| `Role.Assign` | Give a role to an employee |
| `Attendance.View` | See attendance |
| `Attendance.Correct` | File a manual attendance correction |
| `Attendance.Correct.Approve` | Approve a correction. **Must not be held by the same person who filed it** — see EM-14 |
| `Shift.Manage` | Build and publish rosters |

### 2.9 RFID and hardware

| Permission | Grants |
|---|---|
| `Rfid.View` | See readers, tags, and events |
| `Rfid.Reader.Register` / `Rfid.Reader.Edit` | Manage readers |
| `Rfid.Credential.Issue` | Bind a tag to an employee |
| `Rfid.Credential.Revoke` | Revoke or report a tag lost |
| `Rfid.Event.View` | See raw read events |
| `Device.View` / `Device.Register` / `Device.Edit` / `Device.Disable` | Manage devices. `Device.Disable` also puts a disabled device back into service (§22.12, `HD-32`, D-16) |

### 2.10 Cash and shift

| Permission | Grants |
|---|---|
| `Shift.Open` / `Shift.Close` | Open and close a drawer shift |
| `Shift.Reopen` | Reopen a closed shift for investigation: always with a reason, audited, and on the reopened-shifts report (`CD-26`). **Separate from `Cash.Variance.Acknowledge`** (D-16) |
| `Cash.In` / `Cash.Out` | Pay money into or out of a drawer |
| `Cash.Out.Approve` | Approve a cash withdrawal beyond the store threshold |
| `Cash.Variance.Acknowledge` | Accept and explain a closing variance |
| `Cash.Count.View` | See counts and variance history |

### 2.11 Payments

| Permission | Grants |
|---|---|
| `Payment.View` | See payments and refunds |
| `Payment.Method.Configure` | Enable and configure payment methods |
| `Payment.Provider.Configure` | Configure a payment provider. **Highest-privilege operational permission** |
| `Payment.Capture` | Capture an authorized card payment: the funds are taken (§22.10). Not to be held with `Payment.Provider.Configure` (`SEP-06`) (D-16) |
| `Payment.Void` | Void a card authorization before capture (§22.10, `PY-13`). **Separate from `Sale.Void`** (D-16) |

### 2.12 Reporting and configuration

| Permission | Grants |
|---|---|
| `Report.View` | Run standard reports, own store |
| `Report.Financial` | See margin, cost, and financial reports. **Separate from `Report.View`** |
| `Report.OrganizationWide` | See all stores |
| `Report.Export` | Export report data to a file |
| `Audit.View` | Read audit entries |
| `Audit.View.Sensitive` | Read audit entries for security events: authentication, permission change, export |
| `Config.Store` | Change store settings |
| `Config.Organization` | Change organization settings, tax, reason codes, approval thresholds. Also warehouses and storage locations: create, rename, mark sellable (`WH-03`, D-16) |
| `Config.Roles` | Change role definitions and assignments. **Authorizes nothing** (D-16): roles are defined with `Role.Create`/`Role.Edit` and assigned with `Role.Assign` |
| `Config.Backup` / `Backup.Restore` | Manage backups. `Backup.Restore` is the most dangerous permission in the product — see AU-14 |
| `Config.NotificationRule` | Manage notification routing |

### 2.13 Permission-separation requirements

Some permission pairs must not be held by the same employee. This is segregation of duties, enforced when
assigning a role and **reported** as an advisory rather than a hard block, because a small store may have only
one manager.

| ID | Rule | Severity |
|---|---|---|
| SEP-01 | `Attendance.Correct` and `Attendance.Correct.Approve` should not be held together | Advisory. A correction filed by an approver **is** rejected at the boundary — the *role* may hold both, the *action* may not |
| SEP-02 | `Sale.Create` and `Sale.Void.Posted.Approve` should not be held together | Advisory |
| SEP-03 | `Config.Roles` and `Role.Assign` should not be held together | Advisory |
| SEP-04 | `Backup.Restore` should be held by at most one person, and not combined with routine POS roles | Advisory |
| SEP-05 | `Customer.Loyalty.Adjust` and `Sale.Create` should not be held together | Advisory. Prevents a cashier minting their own discount |
| SEP-06 | `Payment.Capture` and `Payment.Provider.Configure` should not be held together | Advisory. Stops one person redirecting captured funds |
| SEP-07 | `Purchase.Order.Create` and `Purchase.Order.Approve` should not be held together | Advisory |
| SEP-08 | `Inventory.Transfer.Create` and `Inventory.Transfer.Dispatch` should not be held together | Advisory. The creator must not also ship the goods |
| SEP-09 | `Audit.View` and `Audit.View.Sensitive` should not be held together | **Hard-blocked at the action** (AU-24) |
| SEP-10 | `Price.Edit` and `Price.BelowCost.Approve` should not be held together | Advisory |
| SEP-11 | `Purchase.Return.Create` and `Purchase.Return.Create.Approve` should not be held together | Advisory |
| SEP-12 | `Employee.Create` and `Employee.StoreAccess.Grant` should not be held together | Advisory. Prevents self-granted store reach |

**Advisory, not blocking, is a deliberate decision.** A hard block would prevent a two-person store from
operating at all. The compromise: allow the assignment, warn at the point of assignment, list all
segregation-of-duties conflicts in a standing report, and enforce the *action-level* separation that can be
enforced without making the store unstaffable (SEP-01 is hard-blocked at the action).

---

## 3. Actor catalogue

An **actor** is anyone or anything that interacts with SmartStore. For each: purpose, responsibilities, typical
actions, sensitive actions, data they should access, and data they should not access.

Actors 1–14 are human roles mapped to a role template in §4. Actors 15–18 are not roles: 15 and 16 are
external parties, 17 is a deferred human role, and 18 is a machine.

---

### 3.1 Platform Owner

**Not a SmartStore role.** The operator of the SaaS hosting platform across all customer organizations.

| | |
|---|---|
| **Purpose** | Run the platform: uptime, backups, incident response, tenant provisioning |
| **Responsibilities** | Infrastructure, per-tenant isolation, backup durability, data-subject requests routed to the right tenant, platform-wide monitoring |
| **Typical actions** | Provision a tenant, restore a tenant backup, rotate platform secrets, scale, investigate incidents |
| **Sensitive actions** | **Accessing tenant business data.** This is the single most dangerous capability in the business and is treated as an incident even when it is well-intentioned |
| **Should access** | Platform health, tenant metadata (name, plan, status), infrastructure telemetry. Support-ticket-scoped, time-boxed, audited break-glass access to tenant data |
| **Should not access** | Tenant financial and customer data by default. No ambient "read the database to debug" path |

**Design requirement AU-12.** Break-glass tenant access requires: an explicit support case reference, a stated
reason, a time limit, and a `AuditEntry` marked `BreakGlass` that the **tenant** can read. Access without all
four does not happen. A platform operator with standing read access to every tenant's sales and customer data
is not an operator of a retail system; it is a liability.

---

### 3.2 Organization Owner

The single accountable human at the customer. Legally responsible for the business.

| | |
|---|---|
| **Purpose** | Own the business and its data |
| **Responsibilities** | Appoint and remove staff with access, hold the highest approval authority, own the audit trail, own data retention and export |
| **Typical actions** | Assign roles, grant store access, approve large discounts/refunds/adjustments, configure thresholds, review audit, run organization-wide reports |
| **Sensitive actions** | Granting `Employee.StoreAccess.Grant`; granting roles; approving transactions above threshold; restoring backups; changing organization settings; exporting customer data |
| **Should access** | Everything in their own organization, including `Audit.View.Sensitive` and organization-wide financial reports |
| **Should not access** | Other organizations' data, absolutely. Platform infrastructure. Raw credentials |

**Decision.** The Organization Owner is **not** a superuser who bypasses checks. They hold the broadest *role*,
not an exemption from the permission model. They must still hold an explicit permission for every action. An
owner who bypasses the model is not accountable, and accountability is the product's core promise.

---

### 3.3 Super Administrator

Day-to-day technical administrator. Distinct from the Owner: the Owner decides *policy*, the Super Admin
*implements* it.

| | |
|---|---|
| **Purpose** | Configure and operate the system for the organization |
| **Responsibilities** | Manage stores, warehouses, locations, devices, users, roles (as configured), imports, backups |
| **Typical actions** | Create warehouses and locations, register terminals and devices, run imports, manage roles within their authority, restore a backup *with approval* |
| **Sensitive actions** | `Role.Assign`, `Employee.StoreAccess.Grant`, `Config.Roles`, `Backup.Restore`, `Device.Disable` |
| **Should access** | Configuration and reference data across the organization; audit |
| **Should not access** | Routine cashiering; nothing is *hidden* from them, but they hold **no transaction-approval** permissions by default |

**Decision (with a real trade-off).** Super Admin does **not** hold `Sale.Create`, `Discount.Large.Approve`,
`Sale.Refund.Large.Approve`, or `Cash.Variance.Acknowledge`. Keeping administration and transaction approval apart
means the person who configures the system is not the person who can quietly move money through it.

**The trade-off, stated honestly:** in a one-person store the Owner must also be the Super Admin, and may also
need transaction permissions. The system does not prevent that; it produces a **segregation-of-duties warning**
(§2.13) and lists the conflict in a report. We prefer a warning a small store can consciously accept over a
hard block that makes it unable to trade.

---

### 3.4 Store Manager

Accountable for one store's trading day.

| | |
|---|---|
| **Purpose** | Run the store: stock, staff, cash, service level |
| **Responsibilities** | Stock accuracy, receiving, transfers, staff scheduling and attendance, cash reconciliation, customer service escalations, day-end close |
| **Typical actions** | Approve discounts, refunds, adjustments and cash movements above cashier limits; receive deliveries; run stock counts; close the day; review their store's reports |
| **Sensitive actions** | `Discount.Large.Approve`, `Sale.Refund.Large.Approve`, `Inventory.Adjust.Large.Approve`, `Cash.Out.Approve`, `Cash.Variance.Acknowledge`, `Return.Approve`, `Purchase.Receive`, terminating staff at their store |
| **Should access** | Their store's sales, stock, cash, customers, staff attendance, and all reports for their store including financial |
| **Should not access** | Another store's operational data; **other employees' credentials**; supplier bank details beyond what payment requires; organization-wide settings |

**Decision.** The Store Manager is the store's **approval authority**. Most day-to-day friction in a retail
system is an approval queue, so this role is designed to be fast: it is the role that can clear the most
exceptions without escalating.

---

### 3.5 Assistant Manager

Store Manager's deputy. The role that exists so the store is not stuck when the manager is off.

| | |
|---|---|
| **Purpose** | Deputise for the Store Manager |
| **Responsibilities** | Day-to-day store operation; cover the manager's approval authority **within a defined limit** |
| **Typical actions** | The Store Manager's actions, up to the lower threshold; open/close shifts; approve returns and discounts within limit |
| **Sensitive actions** | Same *kinds* as Store Manager, with **lower monetary thresholds** |
| **Should access** | Their store's operational data |
| **Should not access** | Terminal/owner settings; organization settings; role assignment; backup |

**Decision (concrete and important).** Assistant Manager thresholds are configured **independently** of the
Store Manager's, not derived from them. A deputy who can approve everything the manager can is not a deputy, and
a threshold that is computed rather than configured drifts when the manager's threshold changes.

---

### 3.6 Inventory Manager

Owns stock truth for a store or a set of locations.

| | |
|---|---|
| **Purpose** | Make the stock figure correct and explainable |
| **Responsibilities** | Receiving, put-away, counts, cycle counting, adjustments, transfers, expiry and FEFO execution, dead-stock control |
| **Typical actions** | Receive against POs, post counts, raise adjustments with reasons, perform transfers, override FEFO with a reason, manage batch and expiry data |
| **Sensitive actions** | `Inventory.Adjust` (always reason-bearing), `Inventory.FEFO.Override`, `Inventory.Count.Post`, `Inventory.Transfer.Dispatch` |
| **Should access** | Stock, movements, batches, purchase and receiving data, the **inventory ledger** |
| **Should not access** | Customer payment data; other stores' stock; margin and margin reports beyond `Product.Cost.View` |

**Decision.** `Inventory.Ledger.View` is granted here deliberately. The inventory manager's job is
reconciliation; a role that cannot see the raw ledger cannot do it, and hiding cost from the person who
reconciles stock produces arguments instead of answers.

---

### 3.7 Warehouse Manager

Owns a warehouse: capacity, accuracy, flow.

| | |
|---|---|
| **Purpose** | Keep warehouse stock accurate and goods moving |
| **Responsibilities** | Inbound receiving and inspection, put-away, picking and dispatch, warehouse counts, transfer execution, quarantine release |
| **Typical actions** | Receive, put-away to sellable locations, count, dispatch transfers, approve quarantine release, handle damaged and expired write-offs |
| **Sensitive actions** | `Inventory.Transfer.Dispatch`, `Return.Dispose`, `Inventory.Adjust`, expiry write-offs |
| **Should access** | Warehouse stock, movements, batches, inbound and outbound documents |
| **Should not access** | Customer records; payment data; sales margins |

**Note.** Warehouses default to `BlockNegative` (organization-model §3.2). This role's authority over
adjustments is correspondingly more sensitive, because an adjustment in a blocked-negative warehouse is the only
way to create stock.

---

### 3.8 Procurement Officer

Owns buying and supplier relationships.

| | |
|---|---|
| **Purpose** | Get the right goods at the right price, from suppliers who deliver |
| **Responsibilities** | Requisitioning, supplier selection, purchase orders, receiving discrepancies, supplier performance, price and lead time data |
| **Typical actions** | Raise requisitions, draft and submit POs, record supplier invoices, review the three-way match, raise supplier returns |
| **Sensitive actions** | `Purchase.Order.Submit` (commits money), `Purchase.Return.Create`, supplier price changes |
| **Should access** | Purchase documents, supplier records and balances, product cost, stock for purchasing decisions |
| **Should not access** | Individual employee records; customer PII beyond "a customer bought this"; cashier performance; attendance |

**Decision.** The Procurement Officer can **commit the organization to spend** but cannot **approve their own
requisition** where policy requires approval, and cannot make a payment (`Purchase.Pay` is normally the
Accountant's). Committing and disbursing are separate, deliberately.

---

### 3.9 Senior Cashier

Experienced cashier with a higher limit and some supervisory duties.

| | |
|---|---|
| **Purpose** | Ring sales accurately and handle the exceptions a cashier normally escalates |
| **Responsibilities** | Accurate till operation, resolving payment failures, handling small returns, opening/closing the drawer, first-line customer service |
| **Typical actions** | Complete sales, apply small discounts, take returns within limit, suspend and resume carts, void an unfinalized sale, open/close the drawer |
| **Sensitive actions** | `Return.Create` within limit, `Sale.Void` (unfinalized only), `Shift.Open`/`Shift.Close`, `Cash.In`/`Cash.Out` within limit |
| **Should access** | Own transactions, own shift, product and price data, customer records for their transactions |
| **Should not access** | `Discount.Large.Approve`, `Sale.Refund.Large.Approve`, `Cash.Variance.Acknowledge`, cost and margin, stock adjustments, other cashiers' activity beyond reconciliation needs, `Audit.View` |

**Decision.** A Senior Cashier can **void an unfinalized sale** but not void a posted one — that requires
`Sale.Void.Posted.Approve`, which is a manager permission. The distinction is in the permission, not in the UI
hiding a button, and it is enforced server-side.

---

### 3.10 Cashier

The highest-volume role, and the most important to get right.

| | |
|---|---|
| **Purpose** | Serve customers accurately and quickly |
| **Responsibilities** | Sale completion, payment handling, receipt issuance, basic customer lookup, drawer accuracy |
| **Typical actions** | Scan and search products, enter quantities and weights, apply permitted discounts, take payment in all supported methods, suspend and resume own carts, issue small refunds per policy, lookup a customer |
| **Sensitive actions** | `Sale.Create`, `Payment` capture, `Return.Create` within a low limit, `Cash.In`/`Cash.Out` within a low limit |
| **Should access** | Products, prices, promotions, tax rules, customer records **needed to serve the counter** (name, loyalty balance, standing credit, masked contact), own shift and own transactions |
| **Should not access** | **Cost, margin, and supplier price** (not needed, and commercially sensitive); other employees' data; other cashiers' transaction detail; stock adjustment; audit log; organization and store settings; any customer's purchase history beyond the current transaction; full customer contact details where masked suffices |

**Design requirement UX-14.** A Cashier's product search must not display cost, and the API that backs it must
not return cost. This is enforced by permission-filtered response shaping, not by hiding a column — a cashier
who can read cost can walk to any competitor.

**Decision.** Cashiers **can** see a customer's loyalty balance and credit standing, because refusing service
without that information is not workable. They **cannot** see the customer's purchase history, other balances, or
full contact details. This is a narrow, deliberate exception to store-scoped customer data.

---

### 3.11 Accountant

Owns the money: payables, receivables, tax, and the reconciliation of cash.

| | |
|---|---|
| **Purpose** | Ensure the money in the system matches the money in the world |
| **Responsibilities** | Supplier payments, customer payment recording, tax reporting inputs, cash variance review, period close support, supplier and customer statements |
| **Typical actions** | Record supplier payments, record customer payments, review supplier balances and customer AR, review cash variance, export financial reports, assist with period close |
| **Sensitive actions** | `Purchase.Pay`, `Supplier.Credit.Adjust`, `Customer.Payment.Record`, `Customer.Credit.Grant` (proposed), `Report.Financial`, `Report.Export` |
| **Should access** | All financial data organization-wide: sales, costs, margins, payables, receivables, tax, cash, **the audit log for financial events** |
| **Should not access** | Employee medical or leave detail; customer identity documents; RFID raw events; device credentials. Financial transparency, not personal privacy |

**Decision.** `Report.Financial` and `Report.Export` are separate permissions. An accountant who may read
margins does not automatically get to extract the whole dataset to a file, because export is a
data-exfiltration path. The export action is itself audited with row counts.

---

### 3.12 Auditor

Read-only, cross-cutting, and independent of the operating roles.

| | |
|---|---|
| **Purpose** | Verify that what the system records is complete, accurate, and has not been tampered with |
| **Responsibilities** | Test controls, trace transactions end to end, review audit entries, report findings |
| **Typical actions** | Read all documents, read the audit log, trace a sale to its movement, payment, and drawer impact, run and export reports, sample transactions |
| **Sensitive actions** | None that change data — **by design**. The Auditor holds no write permission of any kind |
| **Should access** | Read access to all transactional and configuration data, full audit log including sensitive events, and the **movement ledger** |
| **Should not access** | Anything writable. No ability to correct a record — corrections are made by the operating role, and the Auditor's finding is the report |

**Decision, and it is the strongest in this document.** The Auditor role holds **zero** write permissions.
Not "few". Zero. An auditor who can fix what they find stops being evidence. This also removes the
segregation-of-duties argument entirely, because there is nothing to segregate.

---

### 3.13 HR / Employee Manager

Owns employee records and attendance.

| | |
|---|---|
| **Purpose** | Maintain correct employee data and a defensible attendance record |
| **Responsibilities** | Employee lifecycle, store access requests, role recommendations, rosters, attendance review, correction workflow, RFID credential issuance |
| **Typical actions** | Create and amend employee records, assign stores and roles (subject to approval), publish rosters, review attendance, file attendance corrections, issue RFID credentials |
| **Sensitive actions** | `Employee.Terminate`, `Employee.StoreAccess.Grant` (requests it; the Owner grants), `Role.Assign` (requests it), `Rfid.Credential.Issue` |
| **Should access** | Employee records, contracts, roles, schedules, attendance, leave |
| **Should not access** | Transaction detail beyond "this employee rang this sale" for a dispute; **customer PII beyond the minimum needed to explain a transaction**; financial reports; other employees' credentials |

**Design requirement EM-16.** The HR Manager can *request* a role or store-access grant but the **Organization
Owner approves it**. This is a two-person rule on the highest-value permission in the product.

**Decision.** The HR Manager files attendance corrections but does not approve them (SEP-01, action-level hard
block). A manager cannot rewrite their own attendance.

---

### 3.14 Employee

The baseline. A person who works in a store and may or may not have system access.

| | |
|---|---|
| **Purpose** | Do the work |
| **Responsibilities** | Their assigned duties; clocking in and out; observing policy |
| **Typical actions** | Clock in/out via RFID, view their own schedule, view their own attendance, view their own profile, reset their own password |
| **Sensitive actions** | **None beyond self-service.** They hold no operational permission by default |
| **Should access** | **Their own** record only: own schedule, own attendance, own profile, own RFID credential status |
| **Should not access** | **Any other employee's data.** Not even name and photo. Not their own salary. Not any transaction, stock, or configuration |

**Design requirement EM-15.** Self-service access is scoped to `self` by construction — the API takes no employee
id for self-service endpoints, so an employee cannot query a colleague by changing an id. The scoping is
structural, not a filter that could be forgotten.

---

### 3.15 Customer

An actor in the domain, not a user of the system. There is **no customer login** in v1 (see
[PHASE-1-REVIEW.md](PHASE-1-REVIEW.md) §9 — a self-service portal is out of scope).

| | |
|---|---|
| **Purpose** | Buy goods; optionally hold credit, loyalty, and a purchase history |
| **Responsibilities** | None in the system |
| **Typical interactions** | Be served; be identified by phone/email/member number at the till; hold a credit account; earn and redeem loyalty; receive a receipt, statement, or refund |
| **Sensitive actions** | Settling a credit balance; requesting a refund at the counter |
| **Should access** | Their own receipts, their own loyalty balance, their own credit balance and statement. **In v1: provided by staff, on request or on the receipt** |
| **Should not access** | Any other customer's data; supplier data; internal cost and margin; any internal report; any employee's personal data |

**Design requirement CU-14.** What a customer is told, and what is printed for them, is a **defined document
set** (receipt, invoice, credit statement, loyalty notice) and not "whatever the screen shows". The customer
surface is specified, not incidental.

---

### 3.16 Supplier

An external organization. No login in v1.

| | |
|---|---|
| **Purpose** | Sell goods to SmartStore's organization, and be paid |
| **Responsibilities** | Deliver ordered goods, issue invoices and credit notes, disclose batch and expiry data |
| **Typical interactions** | Receive a PO, deliver against it, submit an invoice, receive a purchase return, be paid, be measured on delivery performance |
| **Sensitive actions** | None in the system. They are counterparties, not users |
| **Should access** | Their own purchase orders, delivery schedules, statements, and payment remittance. **Provided as documents, not a portal** in v1 |
| **Should not access** | SmartStore's stock levels elsewhere; other suppliers' terms; SmartStore's margin or resale pricing; customer data |

**Design requirement SU-12.** Supplier-facing documents — PO, delivery schedule, statement — are a **defined
set** that does not disclose the volume or margin of goods sold onward. A PO reveals what was bought, never what
it was sold for.

---

### 3.17 Technician

A field or IT person. **Out of scope as a formal role in v1**; specified because hardware support is a real
operational need and the model must not block it.

| | |
|---|---|
| **Purpose** | Install, register, diagnose, and repair hardware |
| **Responsibilities** | Registering devices, replacing readers and printers, firmware updates, connectivity troubleshooting, physical resets |
| **Typical actions** | Register a device, view device health and logs, restart a device, update firmware, replace a unit |
| **Sensitive actions** | `Device.Disable` (which stops a till selling), `Rfid.Reader.Register` |
| **Should access** | Device registry, device health, device event logs, network configuration |
| **Should not access** | Transaction data, customer data, employee personal data, financial data |

**Decision.** The Technician cannot see transactions. A device problem is diagnosable from device telemetry —
connectivity, firmware version, last heartbeat, error codes, read rates — and none of that requires reading a
sale. If it appears to, the design is wrong: add a diagnostic counter, not a data permission.

**v1 approach.** Rather than build a technician portal, device management is a Store Manager or Super Admin
function. If field technicians become a real customer requirement, the role is enabled from the existing
permission set without model change. Recorded as an open item in the review.

### 3.18 System / Device Administrator

The **machine** actor — a registered terminal, reader, scale, or printer acting on its own. It is not a person,
holds no role, and is not in the human access-review population.

| | |
|---|---|
| **Purpose** | Execute a device's function inside a store's boundary and report its own health |
| **Responsibilities** | Presenting a sale, clocking an attendance read, reading a weight, printing a receipt, retrying a queued job |
| **Typical actions** | Post a `DeviceEvent`, request a re-print, serve a queued job, heartbeat |
| **Sensitive actions** | None of its own. Every effect it causes is evaluated under the acting user's permissions, never its own |
| **Should access** | Its own device record, its own configuration, its own queue, its own logs |
| **Should not access** | Any other device, any transaction data, any customer or employee data |

**Decision.** A device is authenticated as a **device**, not as a person (BI-35). It is never granted a role and
never appears in a segregation-of-duties report. The distinction that matters: a reader that reads a tag
establishes *identity*; it grants *no* authorization (BI-33). A terminal that posts a sale does so with the
permission of the signed-in cashier, checked server-side (BI-14, BI-22).

**Queue replay is a device action with a human origin.** A device retrying a queued job acts for the user whose
session created it, and that user is on the audit event. A device cannot originate a business action that no
signed-in user authorized.

**v1 approach.** Device identity is a device key, revocable without affecting any human account (§2.9,
hardware-domain). No device-management portal; registration is a Super Admin or Store Manager action (§3.3,
§3.4).

---

## 4. Role templates

A **role template** is a named, pre-built permission set. The templates below are the starting point. Every
organization may modify them, and **custom roles are permitted** — the templates are a convenience, not a
constraint.

| Template | Core permissions | Explicitly excluded |
|---|---|---|
| **Owner** | Everything in the organization, including `Audit.View.Sensitive`, `Report.OrganizationWide`, `Config.Organization`, `Config.Roles`, `Backup.Restore`, `Employee.StoreAccess.Grant` | Platform access. Bypasses nothing — holds explicit permissions like everyone else |
| **Super Administrator** | `Config.*`, `Device.*`, `Employee.*`, `Role.*`, `Report.View`, `Audit.View`, `Import.*`, `Product.*`, `Price.*` | **`Sale.Create`, `Discount.Large.Approve`, `Sale.Refund.Large.Approve`, `Cash.Variance.Acknowledge`, `Purchase.Pay`, `Customer.Credit.Approve`** — administration is separated from money approval (SEP-02, §3.3) |
| **Store Manager** | Full `Store` operational set for their store: `Sales.*`, `Discount.Large.Approve`, `Sale.Refund.Large.Approve`, `Return.*`, `Inventory.*`, `Purchase.View`+`.Receive`, `Shift.*`, `Cash.*`, `Customer.*`, `Employee.View`, `Attendance.*`, `Report.*` (store scope), `Audit.View` | Other stores, `Config.Organization`, `Config.Roles`, `Backup.*`, `Purchase.Pay`, `Purchase.Order.Approve` above their limit |
| **Assistant Manager** | As Store Manager, with independently configured lower thresholds; includes `Shift.*`, `Cash.*` | `Config.*`, `Backup.*`, `Purchase.Pay` |
| **Inventory Manager** | `Inventory.*`, `Product.View`, `Product.Cost.View`, `Purchase.View`/`.Receive`, `Report.View` | `Sales.*`, `Payment.*`, `Customer.*`, `Report.Financial` |
| **Warehouse Manager** | `Inventory.*`, `Purchase.Receive`, `Return.Dispose`, `Report.View` | `Sales.*`, `Customer.*`, `Report.Financial` |
| **Procurement Officer** | `Purchase.*` except `.Pay`, `Supplier.*` except payment, `Product.View`, `Product.Cost.View`, `Report.View` | `Sales.*`, `Employee.*`, `Customer.*`, `Audit.View.Sensitive` |
| **Senior Cashier** | `Sale.Create`, `Sale.Suspend`/`.Resume`/`.Void`, `Discount.Apply`, `Return.Create` (low limit), `Shift.Open`/`.Close`, `Cash.In`/`.Out` (low limit), `Customer.View`, `Product.View`, `Price.View` | `*.Large.Approve`, `Cost.View`, `Inventory.*`, `Report.Financial`, `Audit.*` |
| **Cashier** | `Sale.Create`, `Sale.Suspend`/`.Resume`, `Discount.Apply`, `Return.Create` (lowest limit), `Customer.View`, `Product.View`, `Price.View`, `Shift.Open` | `*.Large.Approve`, `Cost.View`, `Inventory.Adjust`, `Audit.*`, `Report.Financial` |
| **Accountant** | `Payment.View`, `Supplier.Balance.View`, `Supplier.Payment.Record`, `Customer.Payment.Record`, `Customer.Credit.Grant`, `Report.*`, `Report.Financial`, `Report.Export`, `Audit.View`, `Cash.Count.View` | `Sale.Create`, `Inventory.Adjust`, `Employee.Terminate`, `Config.*` |
| **Auditor** | `Report.*`, `Report.Export`, `Audit.View`, `Audit.View.Sensitive`, `Inventory.Ledger.View`, and **read-only** access to all transactional documents | **Every write permission. Zero.** Enforced by the role, reported if violated |
| **HR Manager** | `Employee.*` except `Terminate`, `Attendance.Correct`, `Attendance.View`, `Shift.Manage`, `Rfid.Credential.Issue`/`.Revoke` | `Sales.*`, `Inventory.Adjust`, `Report.Financial`, `Audit.View.Sensitive`, `Config.*` |
| **Employee** | Self-service only: own schedule, own attendance, own profile, own RFID status, own password | **Everything else. No role, no permissions, no data access** |
| **Technician** *(disabled in v1)* | `Device.*`, `Rfid.Reader.*` | All transactional and personal data |

---

## 5. Access review

`REVIEW-01` (**SHOULD**). The Owner and Super Admin can produce a **standing access review** listing every
employee, their roles, their store access, their last sign-in, and every permission they hold — grouped so
over-provisioning is visible at a glance.

Rationale: permission creep is the normal failure mode of an RBAC system. Nobody adds a permission
maliciously; they add it once for a reason and it stays forever. A periodic, printable review is the cheapest
possible control, and it is the one that actually gets done.

The report flags, separately: employees with **no** store access who still hold permissions (likely
misconfiguration); permissions held by **no** role (candidates for deletion); employees whose granted
permissions exceed their job function; and every `SEP-*` conflict from §2.13.

---

## 6. Permission change safety

Changing a role's permissions affects every employee holding it, silently, retroactively, and immediately.
That is a genuine operational hazard, so:

| ID | Rule |
|---|---|
| PC-01 | Every role change writes an `AuditEntry` recording the role, the exact before/after permission set, the actor, and the reason |
| PC-02 | A role edit that **removes** a permission lists the affected employee count and requires confirmation stating that number |
| PC-03 | A role edit that removes a permission takes effect for **new** requests; in-flight requests are unaffected. A user mid-shift is not logged out by a role change |
| PC-04 | Permissions are cached for **at most 60 seconds**, so a revocation takes effect within a minute without a per-request database hit. A revoked session therefore remains usable for up to 60 seconds — this is a deliberate, documented trade-off, and the security-relevant actions (approvals, refunds, adjustments) re-check without cache |
| PC-05 | Emergency "revoke everything now" invalidates all cached sessions organization-wide and is itself audited |
