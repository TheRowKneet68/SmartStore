# SmartStore — Multi-Store Domain

**Phase 1 — Product & Domain Specification.**

Owner of: store scope enforcement, cross-store roles, cross-store transfers, central warehouse behaviour, and
consolidated reporting. The mechanism is specified in [organization-model.md](organization-model.md) §10; the
invariants are BI-14 and BI-43.

---

## 1. The decision, stated first

> **v1 operates one store. The model is built for many. The distinction is between what is *modelled* and what is
> *built*, and pretending otherwise is how multi-store systems leak data between tenants.**

**Rule MS-01.** Everything store-scoped carries a non-null `StoreId` from day one (overview §3.9, ORG principles
13). This is the entire cost of multi-store readiness: a column exists and is populated. The benefit is that
enabling a second store is a configuration act, not a migration.

**Rule MS-02.** The distinction is stated per item in the table below, and every future feature must declare which
side of the line it is on. A feature that cannot say is not ready to build.

| Built in v1 | Modelled but not built |
|---|---|
| One store, plus an organization-wide view | Many stores trading concurrently |
| Central warehouse modelled, one store's use supported | Central warehouse serving several stores |
| Store-scoped stock, prices, documents | Inter-store pricing policy |
| Store-scoped supplier ledger entries | Inter-store customer credit |
| Cross-store roles and access | Inter-store loyalty pooling |
| Organization-wide reports with a permission | Consolidated reporting with cost allocation |
| Stock transfers within a store | Cross-store transfer approval chains |

---

## 2. Scope enforcement — the security control

**Rule MS-03.** The permitted store set `S` is derived from `EmployeeStoreAccess × EmployeeRoleAssignment`,
intersected with the store named in the request (MS-01 in organization-model).

**Rule MS-04.** The scope predicate is applied **before** pagination, filtering, sorting, and aggregation
(MS-02). Applying scope after aggregation leaks aggregates, not just rows: an employee in Store A who can run
"total sales" would get Store B's total.

**Rule MS-05 — the scope predicate is not optional.** There is no "unscoped" query method available to
application code. An unscoped repository method is a leak waiting for a caller, and a caller will arrive.

**Rule MS-06 — a request may only narrow within `S`.** A `StoreId`, `WarehouseId`, or `LocationId` in a body,
query, or header is used to narrow. A value outside `S` is `403` (BI-43, MS-03).

**Rule MS-07 — `403` for no access, `404` for no existence** (MS-04). **`403` on an existing entity in an
invisible store confirms that it exists.** Where existence is itself sensitive, the endpoint returns `404`. This
is an open decision recorded in the review (§10): the trade-off is between an honest status and an existence
oracle, and different sub-resources deserve different answers. v1's default is `403`, with `404` available per
endpoint.

**Rule MS-08 — an employee with no store access signs in and sees an empty workspace** with an explanation, not
a permission error and not a store picker (MS-05). Choosing a store is a role assignment decision, made by
someone else (EM-14).

**Rule MS-09 — a `403` body is distinguishable from an empty result.** A client that treats `403` as "no data"
will page forever. The body names the reason.

**Rule MS-10 — scope is applied to every store-scoped read AND write, including exports, reports, and search
suggestions.** An export that ignores scope is the most common multi-store data leak, because exports are run by
administrators who "obviously" have access everywhere. `Report.OrganizationWide` is the explicit, separate,
audited grant.

---

## 3. Cross-store roles

**Rule MS-11.** A role assignment is scoped: organization-wide, or to a specific store. An organization-wide
assignment plus store access to three stores means permissions in those three.

**Rule MS-12 — an organization-wide role does not bypass the store scope.** It broadens *which stores* the
permissions apply to. It does not grant a permission the role does not contain, and it never bypasses
default-deny (AC-01, BI-21).

**Rule MS-13 — the Organization Owner is not a superuser** (actors-and-roles §3.2). The Owner holds the broadest
role and still requires an explicit permission for every action. An owner who bypasses the model is not
accountable, and accountability is the product's core promise.

**Rule MS-14 — the segregation-of-duties checks are cross-store aware.** SEP-05 (`Customer.Loyalty.Adjust` with
`Sale.Create`) is a conflict regardless of which store each was granted in, because a cashier in Store A who can
mint points in Store B is still minting value.

---

## 4. Central warehouse

**Rule MS-15.** A central warehouse is organization-global, holds stock, and **does not sell**
(organization-model §4). Its `StorageLocation`s default to `IsSellable = false` for a receiving location
(WH-02).

**Rule MS-16 — central-warehouse stock is still store-attributed** (organization-model §8.2). This is the awkward
one already named in CON-08's sibling discussion, and the reason is worth stating: the store is the *reason* the
movement happened.

**Rule MS-17 — a stock item is identified by variant and location, not by store.** A central warehouse is a
location set; a `StockItem` for a variant in the central warehouse's default location is one row, regardless of
how many stores draw on it. This is why the hierarchy, not the stock row, is where stores live.

**Rule MS-18 — a sale may never draw from a central warehouse directly.** A central warehouse is not a sellable
location, and a transfer into a store's sellable location is the mechanism. This keeps BI-13 intact across
organizations' structures and keeps "the customer bought it from a shop" true.

**Rule MS-19 — a central warehouse's `StockBatch` records are attributed to the store that received the batch**,
per organization-model §8.2, while the stock they represent sits in the central warehouse. The consequence is
recorded as a reporting nuance: central-warehouse stock reported by originating store is available and correct as
a *reconciliation* view, and is explicitly labelled as such, because the operational question ("how much can Store
A claim?") is a different question from the physical one.

**This is a genuine modelling compromise and it is named as one.** The alternative — making batches and stock
organization-global for central warehouses — is cleaner conceptually and breaks the uniform `StoreId` rule that
makes everything else simple. The uniform rule wins, and the reporting nuance is documented rather than
discovered later by a confused manager.

---

## 5. Cross-store transfers

**Rule MS-20.** In v1, cross-store transfers are **disabled by configuration, not by the model** (IV-40). The
model already expresses it: a transfer has an origin and a destination, and both are `TRANSFER_OUT` /
`TRANSFER_IN` pairs conserving total stock (BI-13).

**Rule MS-21 — enabling cross-store transfer has named prerequisites**, so that turning it on is not a one-click
change with four unconsidered consequences:

| Prerequisite | Why |
|---|---|
| An inter-store approval chain exists | Who authorises one store to deplete another's stock |
| A cost-allocation decision is made | Which store bears the cost, and which bears a shrinkage |
| A credit mechanism exists | One store is giving value to another; today there is none (SP-41) |
| Transit tracking is organization-wide | A transfer between stores travels; the in-transit report must include it (IV-44) |

**Rule MS-22.** Until all four exist, a stock movement between a store and a central warehouse is a
**dispatch-and-receive** the destination store requests and the central warehouse fulfils — modelled as a
transfer, executed as two documents, with the value question answered by *which store's payable absorbed the
purchase*. **That is a genuine simplification and it is the right one:** it uses v1's existing single-entity
credit model instead of inventing inter-store accounting.

**Rule MS-23 — the destination store's stock is increased only on receipt at the destination**, never on dispatch
from the central warehouse (IV-39). The in-transit period belongs to the organization (BI-13).

---

## 6. Consolidated reporting

**Rule MS-24 — a report's scope is always explicit in the output**: store, multi-store, or organization. The
header of every report states it. A number with an unstated scope is a number nobody can rely on.

**Rule MS-25 — organization-wide reporting requires `Report.OrganizationWide`**, and the result is **visibly
marked as organization-wide** (MS-10 in organization-model). A store manager must not be able to mistake a
chain-wide figure for their own store's.

**Rule MS-26 — cost allocation across stores is OUT OF SCOPE in v1** (overview §6). Where a purchase was
allocated to one store, organization-wide margin is reported as allocated, and any unattributed remainder is
reported as unattributed rather than being spread by a rule nobody chose. **A spreading rule is a business
decision and pretending it is arithmetic is how allocation disputes start.**

**Rule MS-27 — no inter-store pricing in v1.** Prices are per store already (PR-30, precedence), so a store's
price may differ, but there is no policy engine that manages inter-store price relationships. A store's price is
its own.

**Rule MS-28 — customer data is store-scoped in reports; cross-store requires `Report.OrganizationWide`** (CU-08).
A customer is a global entity, but seeing the whole organization's customer list is a privacy action, not a
reporting convenience.

**Rule MS-29 — the audit log is global within the organization and queryable only with an explicit store filter or
organization-wide permission** (organization-model §8.1). An auditor investigating a security event needs
cross-store visibility; a store manager needs their store.

---

## 7. What "multi-store" does not mean here

**Rule MS-30 — no franchise, no subsidiary, no legal-entity hierarchy** (organization-model §11). A franchisee
is a separate organization with its own SmartStore. v1 is one legal entity per organization.

**Rule MS-31 — no region, area, or geographic grouping** in v1. It is a single attribute away from being added
and no retail workflow in scope needs it (organization-model §11).

**Rule MS-32 — no inter-store transfer approval chain in v1** (MS-21). The one who dispatches and the one who
receives being different people (IV-42) is the v1 control.

**Rule MS-33 — no inter-store customer credit in v1.** A customer's credit belongs to one store's account
(CU-13). Using it in another store is a Phase 3+ feature with a real bad-debt allocation question.

**Rule MS-34 — no cross-store stock reservation in v1.** A reservation is a hold at a location (IV-46). Holding
another store's stock needs the inter-store credit question answered first.

**Rule MS-35 — no centralized catalog in v1** beyond the one organization-global catalog that already exists
(organization-model §8.1). A product is one entity; there is no "chain range" versus "store range" concept in v1.
A store-local product is a variant flagged as not sellable elsewhere, or a future feature. **Recorded as an open
item in the review.**

---

## 8. Multi-store rules index

| ID | Rule |
|---|---|
| MS-01 | Every store-scoped row carries a non-null `StoreId` from day one |
| MS-02 | Every feature declares whether it is built in v1 or merely modelled |
| MS-03 | The permitted store set is store access ∩ role assignment ∩ the request |
| MS-04 | Scope is applied before pagination, filtering, sorting, and aggregation |
| MS-05 | There is no unscoped query method |
| MS-06 | A request may only narrow within the permitted set; outside is `403` |
| MS-07 | `403` for no access, `404` for no existence; existence-oracle risk is an open decision |
| MS-08 | No store access means an empty workspace with an explanation, not a store picker |
| MS-09 | A `403` body is distinguishable from an empty result |
| MS-10 | Scope applies to reads, writes, exports, reports, and search suggestions |
| MS-11 | A role assignment is organization-wide or store-scoped |
| MS-12 | An organization-wide role broadens which stores, never which permissions |
| MS-13 | The Owner holds a role, not an exemption |
| MS-14 | Segregation-of-duties conflicts are cross-store aware |
| MS-15 | A central warehouse is organization-global, holds stock, does not sell |
| MS-16 | Central-warehouse stock is still store-attributed; the store is the reason |
| MS-17 | A stock item is variant-and-location, not store-and-variant |
| MS-18 | A sale may never draw directly from a central warehouse |
| MS-19 | Central-warehouse batch attribution is by originating store, and the report is labelled |
| MS-20 | Cross-store transfers are disabled by configuration in v1, not by the model |
| MS-21 | Enabling them needs an approval chain, a cost decision, a credit mechanism, and transit tracking |
| MS-22 | Until then, a central-warehouse move is dispatch-and-receive using v1's single-entity credit model |
| MS-23 | Destination stock increases only on receipt, never on dispatch |
| MS-24 | Every report states its scope in the output |
| MS-25 | Organization-wide reporting needs `Report.OrganizationWide` and is visibly marked |
| MS-26 | No cost allocation across stores in v1; unattributed remainder is reported as such |
| MS-27 | No inter-store pricing policy in v1 |
| MS-28 | Customer data is store-scoped in reports; cross-store needs the explicit permission |
| MS-29 | The audit log is organization-global, filtered explicitly |
| MS-30 | No franchise, subsidiary, or legal-entity hierarchy |
| MS-31 | No region or geographic grouping in v1 |
| MS-32 | No inter-store transfer approval chain in v1 |
| MS-33 | No inter-store customer credit in v1 |
| MS-34 | No cross-store reservation in v1 |
| MS-35 | No chain-range versus store-range catalog concept in v1 |
