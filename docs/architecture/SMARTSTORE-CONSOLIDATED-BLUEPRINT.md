# SmartStore — Consolidated Blueprint

**A living architecture document, written only from what the project already contains.** It consolidates the approved
record into one place: the specification in `/docs`, the approved ADRs, the owner's decisions, and the code and
migrations that exist. It decides nothing. Where the record does not answer a question, the document says so and marks
it **OPEN QUESTION**.

| | |
|---|---|
| **Written** | 2026-10-02, at the request of the owner |
| **Branch and commit** | `v1-build`, at `f68fdc3` (Phase E, step 1: owner decision D-16's keys applied) |
| **Evidence at that commit** | 14 forward-only migrations, 59 application tables, 77 functions, 96 triggers; 437 server tests passing; both workspaces typecheck |
| **Authority** | None of its own. Where it differs from `/docs`, the owner's decisions or an ADR, the source wins and this document is the defect |
| **Append rule** | Like the other governance documents in `docs/architecture/`, change it by appending a dated section that names what it supersedes |

---

## 0. How to read this document

### 0.1 The labels

| Label | Meaning |
|---|---|
| **BUILT** | Code or schema exists in a commit on `v1-build`, and a test exercises it. The file or document is named |
| **BUILT (schema)** | The tables, constraints and triggers exist and are tested, but no application code uses them yet |
| **SPECIFIED** | `/docs` states it, and nothing is built |
| **DEFERRED** | Specified, and deliberately outside v1 (BUILD-STATUS "Deferred"). The schema is designed so it can be added without a rewrite |
| **OPEN QUESTION** `OQ-nnn` | A question already recorded in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md) |
| **OPEN QUESTION** `BQ-nn` | A question this blueprint found the record does not answer. Listed in §11.5 and recorded as `OQ-034` |

A claim of "built" is never made without a named file, test or document. A check that has not run is not reported as
passing (`P10`; Constitution §4, §5).

### 0.2 Where authority comes from

1. The owner's decisions: [OWNER-DECISIONS.md](OWNER-DECISIONS.md), `D-01` to `D-16`.
2. The Phase 1 specification: the domain documents, the [business invariants](../domain/business-invariants.md), the
   [state machines](../product/state-machines.md), and the [requirements traceability](../product/requirements-traceability.md).
3. [PHASE-2-ARCHITECTURE.md](PHASE-2-ARCHITECTURE.md) and the ADRs: `ADR-01` to `ADR-30` there, and
   [ADR-31](ADR-31-V1-STACK-AND-TOOLING.md), which the owner approved on 2026-09-30.
4. The database design documents in [docs/database/](../database/): `CONVENTIONS.md` and `D1` to `D7`.
5. The code. It is evidence of what is built. It is not a source of requirements.

Citations in `backticks` are requirement or rule IDs, ADR numbers, owner decisions, or open questions. Every one appears
in `/docs`.

### 0.3 What the original request assumed, and what exists

The request that prompted this document asked for a blueprint "starting completely from scratch". The project is not
at the start:

- The specification is complete with documented gates: Phase 1, Phase 2, and Phase 3's seven database domains.
- The stack is chosen and approved ([ADR-31](ADR-31-V1-STACK-AND-TOOLING.md)).
- A first version is built and tested: the cash till, the catalogue, the stock ledger, shifts, the audit trail, and
  identity. §11.1 lists exactly what.

So this document describes **the system as specified and as built**. It does not propose a different one. Where the
request suggested a technology or a shape that the record does not contain, §1.2 says so rather than adopting it.

---

## 1. High-level architecture

### 1.1 Principles, in priority order (`ADR-01`)

When two conflict, the higher one wins. Source: PHASE-2-ARCHITECTURE §1.1.

| # | Principle | Forced by |
|---|---|---|
| P1 | The server is the only authority for money, stock and permission. A client may propose, never decide. A client total is discarded | `RT-344`, `SM-02`, `AC-03`, `CON-05` |
| P2 | Deny by default | `AC-01` |
| P3 | Every mutation is transactional and idempotent, carrying a client operation id | `SM-04`, `RT-344` |
| P4 | Money is an integer count of minor units end to end. Quantities may be `DECIMAL(18,4)`; money may not | `ADR-04`, `ADR-06` |
| P5 | History is append-only. A correction is a new linked record | `BI-08`, `BI-15`, `BI-24`, `BI-40`, `BI-41` |
| P6 | Boundaries are enforced in the data layer, not by callers | `MS-17`, `ADR-10` |
| P7 | External I/O never runs inside the business transaction | `CON-05`, `ADR-17` |
| P8 | A closed vocabulary is extended deliberately, never by an implementer who needs a field | `AU-11`, `AU-13`, `NT-04`, `ADR-21` |
| P9 | Derived state is a cache with a named owner and a rebuild path | `SM-01a`, `SM-35a`, `SP-66`, `ADR-18` |
| P10 | A spec that cannot be implemented says so. A check that has not run is not reported as passing | `SM-75a` |

### 1.2 The stack, as approved

Source: [ADR-31](ADR-31-V1-STACK-AND-TOOLING.md) §3, §13 to §16 (versions as installed; `package.json`).

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 26 | Runs TypeScript directly by stripping types: `npm start` is `node src/main.ts`. No build step and no `tsx` (ADR-31 §15) |
| Language | TypeScript, `strict`, `erasableSyntaxOnly` | |
| HTTP | Fastify 5.12.5 | An `onRoute` hook refuses to start a server with a route that declares no access (`AC-01`) |
| Database | PostgreSQL 17, driver `pg` 8.23.0, **no ORM** | Hand-written SQL in modules; `ADR-03` |
| Validation | zod 4.6.5 | At the request boundary; unknown fields are dropped |
| Migrations | dbmate 2.36.0, plain SQL, forward-only | `db/schema.sql` is generated and committed |
| Web | React 19.3.0, Vite 8.3.0 | `web/` |
| Tests | Vitest 5.0.1 against a **real** PostgreSQL | One template database per run, a clone per test file |
| Browser timing | Playwright 1.63.0, development only | `npm run perf` |
| Passwords | Node's built-in `crypto.argon2` (Argon2id) | No native dependency (ADR-31 §16) |

**What the record does not contain.** The request that prompted this document listed technologies the record neither
chose nor rejected. They are not adopted here:

| Item in the request | Position in the record |
|---|---|
| NestJS | ADR-31 §4.2 chose Fastify over Express. NestJS was not evaluated |
| Redis, a cache layer | **OPEN QUESTION `BQ-02`.** Nothing in `/docs` or the ADRs names one |
| A message queue | The architecture requires an **outbox** for notifications and external calls (§15.1, §19.3). It names no broker. **`BQ-02`** |
| Microservices | Rejected: `ADR-02`, PHASE-2-ARCHITECTURE §3.3. One candidate for later extraction is RFID event ingestion (`ADR-28`) |
| GraphQL | The record specifies resource-oriented HTTP/JSON plus a transition API (§7). GraphQL is not specified |
| Table partitioning | **OPEN QUESTION `BQ-01`.** Not specified, and not built |

### 1.3 System boundaries

Source: PHASE-2-ARCHITECTURE §2. A **modular monolith with an offline-capable edge**: one central server application,
one database, and a local client tier per till that keeps selling when the network does not.

```
                    ┌──────────────────────────────────────────┐
   STAFF  ─────────▶│  TILL CLIENT (edge tier, per terminal)   │   SPECIFIED, NOT BUILT
                    │  local durable store + outbox queue      │   (today: an online browser till)
                    │  idempotency keys, per-device sequence   │
                    │  hardware drivers (local)                │
                    └───────┬──────────────────────┬───────────┘
                            │ sync (durable)        │ device I/O
                            ▼                      ▼
   MANAGER ──────────▶┌──────────────────────┐   ┌──────────────────┐
   BACK-OFFICE        │  APPLICATION CORE    │   │  DEVICE LAYER    │
   (BUILT, in part)   │  (modular monolith)  │◀──│  EscPos, Scanner,│   SPECIFIED, NOT BUILT
                      │  BUILT, in part      │   │  Scale, LLRP RFID│
                      └──────┬───────────────┘   └──────────────────┘
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌────────────┐  ┌──────────────┐
        │RELATIONAL│  │  AUDIT LOG │  │  FILE STORE  │
        │   DB     │  │ (in-txn)   │  │ (receipts,   │
        │  BUILT   │  │   BUILT    │  │  imports)    │
        └──────────┘  └────────────┘  │ NOT BUILT    │
              ▲                       └──────────────┘
              │ out-of-band, NOT in the transaction
        ┌─────┴──────────┐        ┌─────────────────┐
        │PAYMENT PROVIDER│        │ EMAIL / SMS     │
        │ NOT BUILT      │        │ NOT BUILT       │
        └────────────────┘        └─────────────────┘
```

Three boundaries are load-bearing (§2.4):

1. **Till client ↔ server.** The only boundary where a client acts without server authority. Idempotency, ordering and
   attribution live here (§1.6).
2. **Domain core ↔ persistence.** The domain core has no I/O. In the built code the equivalent is that the database owns
   every invariant (§3.3), so a missing caller check cannot break one.
3. **Application ↔ devices and payment providers.** A hard boundary at the transaction edge (`CON-05`, `PY-36`, `HD-17`).

### 1.4 Modular monolith, not microservices (`ADR-02`)

Stock is a single-writer, correctness-critical aggregate, and the three hardest requirements (offline sync, per-store
isolation, transactional inventory) are all requirements to keep one database consistent. Microservices would move that
problem into inter-service calls without removing it.

Modules communicate in-process through explicit interfaces. **No module reaches into another module's tables, and no
module's repository is shared** (§4.3).

| Module | Owns | Status |
|---|---|---|
| Identity & Access | employees, logins, sessions, roles, permissions, store access | **BUILT** — `server/src/modules/identity/` |
| Organization | organization, store, settings, warehouses, locations | **BUILT** — `modules/organization/`; routes for settings only; no warehouse routes yet (D-16 decided the key; routes wait) |
| Catalog | products, variants, barcodes, prices, units, tax, categories, brands | **BUILT** — `modules/catalog/` |
| Inventory | locations, the movement ledger, balances, adjustments, reasons | **BUILT** — `modules/inventory/`; no batches, counts, transfers or reservations |
| Batch & FEFO | batches, expiry, FEFO | **SPECIFIED**; the schema extension is designed (D3 §7) |
| Purchasing | requisition, PO, GRN, invoice, three-way match | **SPECIFIED** — `procurement-domain.md` |
| Suppliers | supplier, payable ledger | **SPECIFIED** — `supplier-domain.md` |
| Sales | cart, sale, till operations | **BUILT**, cash only — `modules/sales/` |
| Returns | return, disposition | **BUILT (schema)** — D5 |
| Payments | tenders, split tender, provider | **BUILT** for cash; the card path is **SPECIFIED**; the keys are decided (D-16) |
| Cash | shift, drawer, float, variance | **BUILT** except reopen (`OQ-033`) |
| Customers | customer, credit ledger, loyalty ledger | Walk-in record only. The rest is **DEFERRED** (credit, loyalty) |
| Devices | terminals, scanners, printers, scales, RFID | A terminal and its lifecycle are **BUILT**. Devices are **DEFERRED** |
| Sync | ingest, idempotency, conflicts, dead letters | **SPECIFIED**, **DEFERRED** (offline) |
| Approvals | thresholds, request, decision | **SPECIFIED**. v1 builds no approval workflow; a refund and an adjustment are approved by a second person as a data rule |
| Audit | append-only events | **BUILT** — D6, `modules/audit/chain.ts` |
| Notifications | events and delivery | **SPECIFIED**, **DEFERRED** |
| Reporting | report catalogue | **SPECIFIED**; none built |

### 1.5 The multi-tenancy model

`Organization → Store → Warehouse → StorageLocation`, with terminals and drawers attached to a store. Sources:
[organization-model.md](../product/organization-model.md), [D1](../database/D1-ORGANIZATION-STORE-WAREHOUSE.md),
[multi-store-domain.md](../product/multi-store-domain.md). All **BUILT (schema)**; settings and a till are **BUILT**.

| Level | What it is | Rules |
|---|---|---|
| **Organization** | The tenant. Owns the currency and time zone | Never deleted (`RT-506`); currency and zone are frozen once a sale or payment exists (`ORG-01`, `ORG-02`, `SS037`) |
| **Store** | Operates a till, holds stock through its warehouses, has versioned settings | Its currency is immutable. Never deleted. No deactivation with stock (`SS019`) or an open shift (`SS039`) |
| **Warehouse** | `StoreAttached` (with a store) or `Central` (organization-global, never sells) | Exactly one `Default` location, checked at commit (`SS002`) |
| **StorageLocation** | The leaf that holds stock. Carries **no** `store_id` | `D-03`. Only a `Default` location of a store-attached warehouse can be sellable (`WH-01`, `WH-02`, `WH-04`, `RT-004`) |
| **Attribution** | `(central location, store)` rows, append-only | `D-03`: one central location may serve several stores |
| **Terminal and drawer** | A till has one drawer (`CD-01`) and sells from a sellable location of its store | `PT-01` to `PT-03`; the till's lifecycle is the Device machine; its mode is a separate field (`ADR-27`) |

**Scoping rules** (CONVENTIONS §8):

- A store-scoped table has a non-null `store_id`. An organization-global table has an `organization_id` and **no**
  `store_id`. Overview §3.9.
- A child proves its parent's store or organization by a **composite foreign key**, so a mismatch is impossible rather
  than checked.
- A request never supplies a store. The gate intersects the caller's permitted stores with the one the route names
  (`MS-03`). A store outside that set, an unknown store and another organization's store all get the same 403 (`MS-06`).
- A test classifies every table as store-scoped or organization-scoped, and asserts the rule (`schema-rules.test.ts`;
  `RT-001`). The scope predicate is not row-level security: **row-level security is not used in v1** (CONVENTIONS §8).

**v1 runs one store** (`EC-91`). Everything a second store needs exists in the schema (`RT-269`). Cross-store transfers
are disabled by configuration, not by the model (`MS-20`).

### 1.6 Offline-first strategy — **SPECIFIED, NOT BUILT**

The premise: *SmartStore must still sell when the network is down* (`OF-01`). Nothing in this section is built. Today's
till (`web/src/pos/`) is an online browser application whose cart lives in memory until the sale is saved
(ADR-31 §8).

**The shape** (PHASE-2-ARCHITECTURE §11; [offline-pos-domain.md](../product/offline-pos-domain.md)):

| Part | Rule |
|---|---|
| The POS is a different application from the back-office: local-first, with its own durable store, outbox and drivers | §5.2 |
| The edge tier holds six caches, a closed list: catalogue, price, tax, promotion, stock and customer. No cost, margin, bank detail or audit data, and no PII beyond a masked minimum | `OF-07` to `OF-10` |
| Offline means *the server was asked later*. A terminal may not decide a price, a tax rate, a discount or a credit limit | `OF-02`, `BI-30` |
| Offline requires the store's `AllowNegative` policy: a configuration guard, not an invariant exception | `OF-03` |
| Every queued mutation carries `ClientOperationId`, `DeviceSequence`, `TerminalId`, a correlation id and the business payload. **Never** a client-computed total, and never the device clock | §11.1 |
| The queue is durable and append-only, and survives a power cut | `OF-17` |
| A queue item is self-contained: sync does not need the catalogue cache | `OF-18` |
| Apply is "identify and apply in one transaction, or not at all": one insert of `(terminal, client operation id)` under a unique constraint, in the sale's transaction. "Apply then dedupe" is forbidden | `OF-22`, `OF-23`, `BI-29` |
| Sync is per store, in business-date order, then queue order. Responses are per item, never all-or-nothing | `OF-24`, `OF-26` |
| **Exactly three outcomes**, and no fourth: `Applied`, `AppliedWithAdjustment`, `Rejected` | `OF-29`, `BI-31` |
| A price or tax difference is an adjustment, never a rejection. `Rejected` is reserved for five cases where applying would be wrong | `OF-31`, `OF-32`, `OF-35` |
| A rejected item is never deleted. It is reported and a person resolves it | `OF-36`, `OF-37` |
| An offline window beyond the terminal's configured expiry stops the terminal and notifies | `OF-28` |
| Closing a shift with a materially unsynced queue is an explicit, recorded decision | `OF-49` |

**Owner decisions that shaped it:**

- **`D-04`**: offline stock is *allow-and-reconcile*. Two terminals offline selling the last unit both succeed, the
  balance goes negative, and the shortfall is recorded and reported (`OF-38`, `IV-17`, `IV-20`). There is no server-side
  reservation for an offline sale, and no implicit reservation at the till (`IV-49`).
- **`D-07`**: `DeadLetter` is client-only retention. The server never observes it; its vocabulary stays exactly the
  three outcomes above.

**What exists today that offline will use:**

- A sale and its checkout carry a client operation id, unique per terminal (`uq_checkout_operation`, `uq_sale_operation`).
  A repeat returns the sale already made, and a concurrent repeat waits on the key and gets the same one
  (`BI-28`; proved by a test that holds the table so that both repeats reach the key together).
- The server allocates the document number (`allocate_document_number`, `BI-42`), which is what `OF-25` needs.
- The audit vocabulary has the source `OfflineSync` and the type `Offline.SyncAppliedWithAdjustment`.

**OPEN QUESTIONS:** the till client's technology (a local store in the browser or a local agent; the wire format of the
sync endpoint), `BQ-04`. The edge agent's form (process, service or appliance) is listed as undecided by
product-overview §7. The idempotency keys' retention window (`ADR-30`, "at least as long as the longest offline
window") has no number, because no offline window has been chosen (`OF-28` leaves it to each store).

### 1.7 The three surfaces

PHASE-2-ARCHITECTURE §5.1; [ux-requirements.md](../product/ux-requirements.md).

| Surface | Users | Status |
|---|---|---|
| **Back-office** | Managers, accountants, buyers | **BUILT**, in part: people, roles, reference data, prices, shifts (committed); products, sales, stock, tills, adjustments and setup screens exist in the working tree, uncommitted (§11.1) |
| **POS terminal** | Cashiers | **BUILT** for an online cash sale: scan or find by name, pay, change, shift open and close, receipt print outcome. Not offline-capable |
| **Staff self-service** | Employees | **SPECIFIED**; a password-change screen exists in the working tree, uncommitted. The rest (own schedule, attendance, leave) is outside v1 (`EM-17` to `EM-32`) |

The look and the rules every screen follows (one fixed look, no theming, no animation at the till, never colour alone,
visible focus, controls at least 3rem) are in `web/src/styles.css` and `ux-requirements.md` (`UX-50` to `UX-68`). The
target size and contrast ratio are an **OPEN QUESTION `OQ-030`** with a strict interim in place.

---

## 2. Core domain model

### 2.1 The entities

Source: product-overview §4 is the canonical list. The columns below are the **built** tables (from `db/schema.sql`),
with the specified-only entities named at the end of each group. Every table cites its requirement IDs in a `COMMENT`
(`Cites:`), and a test fails the build if one does not (`citations.test.ts`).

| Domain | Built tables | Specified, not built |
|---|---|---|
| **D1 Organization** | `currency`, `organization`, `store`, `store_setting_version`, `warehouse`, `storage_location`, `storage_location_attribution`, `document_type`, `document_number_sequence` | |
| **D2 Catalog** | `state_machine_state`, `state_machine_edge`, `unit`, `tax_category`, `tax_rate`, `category`, `brand`, `product`, `product_variant`, `product_barcode`, `variant_price`, `store_variant_price`, `variant_standard_cost` | Unit conversions, option matrix, images, price lists by customer group, supplier products, discounts and coupons, import jobs (`DEFERRED`) |
| **D3 Inventory** | `reason_code`, `inventory_movement_type`, `stock_adjustment`, `stock_adjustment_line`, `inventory_transaction`, `inventory_movement`, `stock_balance` | `stock_batch`, counts, transfers, reservations, generic receipt/issue (`DEFERRED`; D3 §7, §8) |
| **D4 Sale / Payment** | `customer` (walk-in only), `pos_terminal`, `cash_drawer`, `cash_shift`, `cash_transaction`, `shift_count`, `payment_method`, `store_payment_method`, `checkout`, `payment`, `sale`, `sale_line`, `receipt_reprint` | Suspended sales, price overrides, cash rounding, stored-value tenders, `NoSale`, pay-in/out, denomination counts (`DEFERRED`) |
| **D5 Returns / Refunds** | `customer_return`, `customer_return_line`, `refund`, `refund_line` | Exchange, store credit, settling and closing a return (`DEFERRED`/`OQ-023`) |
| **D6 Audit** | `audit_event_type`, `audit_event`, `audit_chain_link`, `audit_chain_head`, `audit_redacted_field` | Retention, expiry, archival; the read path (`OQ-024`) |
| **D7 Identity** | `employee`, `user_account`, `user_session`, `permission`, `role`, `role_permission`, `employee_role_assignment`, `employee_store_access` | Attendance, leave, rostered shifts, RFID credentials (`DEFERRED`) |
| **Not started** | | Suppliers, supplier ledger, requisition, PO, GRN, invoice, purchase return, payment run; customers beyond walk-in, credit ledger, loyalty; devices, RFID; approvals; notifications; sync; reporting; imports |

### 2.2 The inventory model (D3, `ADR-05`)

**Two structures, one truth** (PHASE-2-ARCHITECTURE §9.1):

| Structure | Role | Writable by |
|---|---|---|
| `inventory_movement` | The **append-only ledger**; the source of truth | Only the movement-recording path |
| `stock_balance (variant, location)` | A continuously reconciled **cache** | Only the movement trigger, in the same statement |

Stock is never a column on a product, and a balance is never set absolutely.

- **The stock item** is `(variant, storage_location)`, never `(store, variant)` (`MS-17`, `D-03`). It exists from its first
  movement (`IV-02`).
- **Movements** have a positive quantity, an explicit direction and a generated signed `delta`. There are 17 rows in
  `inventory_movement_type`: 15 types, plus `REVERSAL` in both directions. There is no "set stock" type (`IV-13`) and no
  reservation type. The list comes from `inventory-domain.md`, not the shorter list in PHASE-2-ARCHITECTURE §9.3
  (working agreement 3).
- **Every movement names its cause** (`BI-03`): a transaction and exactly one document line. Today's causes are a stock
  adjustment line, a sale line and a customer-return line (`ck_inventory_movement_one_cause`).
- **A reversal** is a new `REVERSAL` movement referencing the original, opposite in direction and equal in store, variant,
  location and quantity (`IV-12`, `SS015`). A unique constraint refuses a second reversal.
- **Multiple warehouses and locations**: stock lives at a location. A store's view is its own warehouses' locations plus
  the central ones attributed to it (`MS-16`, `MS-17`).
- **Negative stock** is a per-store policy, judged on the resulting balance inside the transaction: `BlockNegative`
  refuses (`SS011`), `AllowNegative` records the negative in full and never clamps (`IV-16`, `IV-17`). A central
  location is always `BlockNegative` (`WH-02`).
- **Reservations**: the till reserves nothing (`IV-49`, deliberate). `IV-46` to `IV-50` are **DEFERRED**.
- **Batches, expiry and FEFO** are **SPECIFIED** and the schema extension is designed, additive (D3 §7):
  - `product_variant.is_batch_tracked`, frozen once the variant has any movement (`BE-02`);
  - `stock_batch` with expiry, received date, supplier, actual cost, remaining quantity and status;
  - `inventory_movement.batch_id`, and the same atomic statement applied to the batch;
  - the shortfall pseudo-batch is the one place a batch goes negative (`IV-19`, `IV-19a`, `BE-29`);
  - FEFO sorts by expiry ascending with a null expiry last (`BE-25`, `BE-27`), applies to every depletion (`BE-26`), and a
    cashier can never override it (`BE-31`).
- **Reconciliation** rebuilds every balance from the ledger and walks every `resulting_balance` chain. It never repairs
  (`IV-09`, `ADR-22`): `inventory_ledger_drift()`, run by `npm run ledger:check`. The rebuild is a release gate.
- **Valuation** uses batch actual cost, weighted (`IV-54`, `BE-41`): **SPECIFIED**; standard cost exists for margin and
  the below-cost check (`PR-35`).

### 2.3 The financial model

**Money.** `bigint` integer minor units. Every table with an amount also has `currency_code`, and a child repeats its
parent's by composite foreign key. The currency's exponent is recorded and never assumed to be 2
(`BI-01`, overview §3.1). Rounding is half-up, once per document type, at the point the domain names; the database
stores rounded results and never rounds. The `pg` driver returns `int8` as a JavaScript number only when it is a safe
integer, and throws otherwise (ADR-31 §2). Quantities come back as strings.

**There is no single "ledger entries" table.** The specification defines several ledgers, each owned by its domain:

| Ledger | What it records | Status |
|---|---|---|
| `inventory_movement` | Every change to stock | **BUILT**, append-only at every privilege (`SS010`) |
| `cash_transaction` | Drawer money: `OpeningFloat`, `ChangeDisbursed`, `ClosingFloat`, `RefundFromDrawer` | **BUILT**, append-only |
| `audit_event` and its hash chain | What happened, who, when, why, before and after | **BUILT**, append-only |
| `payment` | Every tender attempt, each its own row; terminal states frozen | **BUILT** (cash); card **SPECIFIED** |
| Customer ledger (`CustomerLedgerEntry`) | Charges, payments, credit notes; the balance is a projection (`CU-11`) | **DEFERRED** with credit (`D-05`) |
| Loyalty ledger | Earn and redeem entries | **DEFERRED** with loyalty (`D-11`) |
| Supplier ledger (`SupplierLedgerEntry`) | The payable; the balance is a projection (`SU-09`) | **SPECIFIED** |
| Stored-value ledger | `PY-29` to `PY-33` | **DEFERRED** |

**The sale is a frozen snapshot** (`ADR-08`, `SP-06`, `SP-07`). It records the store-settings version in force and the tax
mode (`REQ-AU-06`, `SP-33`). Each line records the description, unit, the **quoted price and quote time**, the tax-rate
version and the tax, the gross, the line total, the **settled amount** (`RT-146`), the cost at sale and the sell-from
location. A report run later shows what was true on the day.

**Tax.** A category and its effective-dated rates are data. None is seeded: rates are jurisdictional facts (`D-12`,
`GAP-044`, both open). A rate is a new version, never an edit (`RT-047`). Inclusive tax is extracted from the gross and the
tax is the difference (`PR-39`, `RT-492`); exclusive tax is added (`SP-33`). A line with no tax category is refused, never
treated as exempt (`RT-493`).

**Payment, refund and cash arithmetic:**

- A payment's amount is the amount *applied*; cash also records *tendered*, and change is the difference (`PY-02`,
  `PY-19`). Applied payments equal the total due (`PY-16`).
- A refund is a new linked document, bounded per line by the settled amount and per sale by the lines (`PY-22`, `RR-03`),
  holding its amount from `Processing` (`RR-24`). The refunded tax is the line's stored tax in proportion, rounded
  cumulatively half away from zero (`RR-06`, `SS052`).
- Expected cash is the opening float plus cash applied, less cash refunded from the drawer (`CD-06`, `OQ-015`). Card never
  enters the drawer (`CD-09`).

### 2.4 State machines

The consistency table of [state-machines.md](../product/state-machines.md) §21 lists 24 rows. Their graphs are **data**:
`state_machine_state` and `state_machine_edge` hold each machine's states, edges, the permission each edge needs, its
audit event type and whether it needs a reason. One trigger, `enforce_state_transition()`, refuses a creation state that
is not initial and any change that is not an edge (`SS004`). A state with no outgoing edge is terminal (`SM-05`); the graph
is asserted in tests.

| Machine | Built as data | Bound to the transition endpoint | Specified only |
|---|---|---|---|
| Product, StockAdjustment, Employee, Device, Shift | yes | **yes** | |
| Sale, Payment, CustomerReturn, Refund | yes | no (their application layers are not built) | |
| PosTerminal (a mode *field*, not a lifecycle) | `pos_terminal.mode` | | |
| StockBatch, PurchaseOrder, PurchaseReceipt, SupplierInvoice, StockTransfer, StockCount, ApprovalRequest, Notification, CustomerAccount, RfidCredential, RfidSession, ReadEvent, OfflineQueue | | | all **SPECIFIED** |
| StockItem | none, by design: a projection (`SM-76`) | | |

**Built machines, with the permission each edge needs.** `System` means a provider, telemetry or a derived state: no
person may take it. A reason is required where stated (`SS055`). Keys are the 122 of the catalogue.

| Machine | Edge | Key |
|---|---|---|
| **Product** | Draft → Active (activate: needs a live, priced variant) | `Product.Edit` |
| | Active → Discontinued; Discontinued → Active; Active ⇄ Hidden | `Product.Edit`; each with a reason |
| | Draft, Active, Discontinued, Hidden → Archived | `Product.Archive`, with a reason |
| **StockAdjustment** | Draft → PendingApproval (submit) | `Inventory.Adjust` |
| | PendingApproval → Approved (approver ≠ submitter, `BI-26`) | `Inventory.Adjust.Large.Approve` |
| | Approved → Posted; Draft → Cancelled; Posted → Reversed | `Inventory.Adjust` |
| | an opening balance's creation, lines, submit, post, cancel; approve | `Config.Organization`; `Import.Approve` |
| **Sale** | creation → Completed | `Sale.Create` |
| | Completed → PartiallyReturned → Returned (projections of the line counters, `SP-66`) | `Return.Create` |
| | Completed → Voided | `Sale.Void`; **refused** in v1 (`SS044`, `OQ-017`) |
| **Payment** | creation → Pending | `Sale.Create` (`D-16`) |
| | Pending → Authorized; → Declined; → Failed | `System` |
| | Authorized → Captured | `Payment.Capture` (`D-16`) |
| | Pending, Authorized → Voided | `Payment.Void` (`D-16`) |
| | out of Captured, Declined, Voided, Failed | none (`PY-12`, `PY-54`, `D-14`); a retry is a new `Payment` |
| **Shift** | creation → Open | `Shift.Open` |
| | Open → Reconciling (begin count); Reconciling → Closed (close); Reopened → Reconciling (recount) | `Shift.Close` |
| | Closed → Reopened | **no edge** (`OQ-033`); the key is `Shift.Reopen` (`D-16`) |
| **Device** (a till) | creation → Registered | `Device.Register` |
| | Registered → Active (activate) | `Device.Edit` |
| | Active → Disabled (disable, with a reason) | `Device.Disable` |
| | Disabled → Active (re-enable, with a reason) | `Device.Disable` (`D-16`) |
| | Registered, Active, Disabled → Retired (with a reason) | `Device.Edit` |
| **Employee** | creation → Active | `Employee.Create` |
| | Active → OnLeave (reason); OnLeave → Active | `Employee.Edit` |
| | Active → Suspended | `Employee.Edit`; ends every live session (`SM-47`) |
| | Suspended → Active (reason, `SM-50`) | `Employee.Reactivate` (`D-16`) |
| | Active, OnLeave → Terminated (refused with an open shift, `EM-10`) | `Employee.Terminate` |
| | Terminated → Archived (reason) | `Employee.Edit` |
| **CustomerReturn** | Draft → Posted | `Return.Create` |
| | Draft → Cancelled (reason) | `Return.Create` (`D-16`) |
| | Posted → Settled → Closed | **not built** (`OQ-023`) |
| **Refund** | Draft → PendingApproval (submit) | `Sale.Refund` |
| | PendingApproval → Approved (approver ≠ drafter and submitter) | `Sale.Refund.Large.Approve` |
| | Approved → Processing (submit to provider; takes the hold) | `Refund.Pay` (`D-16`) |
| | Processing → Completed; Processing → Failed | `System` |
| | Failed → Processing (retry; the hold stays) | `Sale.Refund` (`D-16`) |
| | Approved, Processing → Cancelled (reason; releases the hold) | `Sale.Refund` (`D-16`) |

**Machines the original request asked for, and where they stand:**

- **Purchase Order** — **SPECIFIED.** States: `Draft`, `PendingApproval`, `Approved`, `Ordered`, `PartiallyReceived`,
  `Received`; terminal `Closed`, `Rejected`, `Cancelled`; never reversible. A PO is never deleted in any state
  (`ADR-20`, `PR-Q06a`), and cancellation is refused once a goods receipt exists (`PR-Q08`). Seven of its edges have no
  permission key yet (§22.3, `GAP-036`).
- **Goods Receipt** — **SPECIFIED.** `Draft`, then terminal `Received` or `Cancelled`. One edge, its cancel, has no
  permission key (§22.4).
- **Sale, Return/Refund, Stock Adjustment, Cash Shift** — as above.

A transition not in the table is a bug. If an edge has no key, the correct behaviour is refusal until the owner decides
(`SM-02d`, architecture §8.4). 20 edges still have none (state-machines §22.0.2, `GAP-036`).

---

## 3. Database schema

PostgreSQL 17, built by `db/migrations/` (14 files) and shown whole in `db/schema.sql` (generated by dbmate, committed,
never hand-edited). Design documents: [CONVENTIONS.md](../database/CONVENTIONS.md) and
[D1](../database/D1-ORGANIZATION-STORE-WAREHOUSE.md) to [D7](../database/D7-EMPLOYEE-ROLE-PERMISSION.md). dbmate's own
`schema_migrations` table is not counted below.

### 3.1 Conventions that apply to every table

| Topic | Rule | Source |
|---|---|---|
| Identifiers | `id uuid DEFAULT gen_random_uuid()`, a random version 4: opaque and non-derivable | overview §3.4 |
| Ledger order | An append-only ledger also has `seq bigint GENERATED ALWAYS AS IDENTITY`: a total order for rebuilds, never returned by an API | CONVENTIONS §2 |
| Document numbers | Allocated in the creating transaction by `allocate_document_number(store, type)`, never reused. Prefixes, format and any reset are `OQ-004` | `BI-42`, `RT-479` |
| Time | Every instant is `timestamptz`. `created_at` is always server time (never insertable). A **business date** is a separate `date`, computed in the store's zone and stored | overview §3.3, `RT-353` |
| Money | `bigint` minor units; `currency_code` beside it; composite FK to the parent's currency; `CHECK (amount >= 0)` unless the domain says it is a signed effect | CONVENTIONS §4 |
| Quantity | `numeric(18,4)` in the base unit, never signed: direction is its own column | `BI-05`, `ADR-06` |
| Vocabularies | A small closed set owned by one table is `text` with a named `CHECK`. A shared or organization-extended set is a reference table. **No PostgreSQL `ENUM`** | CONVENTIONS §7, `ADR-21` |
| Scope | Store-scoped: `store_id NOT NULL`. Organization-global: `organization_id`, no `store_id`. Composite FKs prove same-store and same-organization | CONVENTIONS §8 |
| Deletion | No hard delete of anything with history; **no `ON DELETE CASCADE`** anywhere. The runtime role has no `DELETE`, except one case below | `BI-40`, `AU-32` |
| Actors | Every `*_by` column and `sale.employee_id` references `employee`; a schema test asserts none lacks the key | CONVENTIONS §11 |
| Citations | Every table, column, constraint, index, function and trigger carries `COMMENT ... 'Cites: <IDs>'`; a test fails if an ID is absent from `/docs` | CLAUDE.md |
| Migrations | Plain SQL, forward-only. Each file's `-- migrate:down` raises, so nothing rolls back. A mistake is corrected by a new migration | ADR-31 §6, Constitution §14 |
| Error codes | The schema raises `SSnnn` for a business-rule refusal; the server maps each to a 409 and its own words | CONVENTIONS §15 |

### 3.2 The tables

Scope: **S** store-scoped, **O** organization-scoped, **R** reference data. **A** marks a table the runtime role can only
read and insert into (append-only); no role can update or delete its rows, because a trigger refuses it even at owner
privilege (`SS010`).

| Domain | Table | Scope | Purpose |
|---|---|---|---|
| D1 | `currency` | R | Code and minor-unit exponent. No rows ship (`OQ-006`). No `UPDATE`, because changing an exponent would reinterpret every stored amount |
| | `organization` | O | The tenant: names, currency, time zone, deactivation (written once) |
| | `store` | O | Code, name, zone, currency (immutable), deactivation |
| | `store_setting_version` | S, A | Settings as immutable, effective-dated versions: tax mode, negative-stock policy, return window, default return disposition. A sale records the version it ran under |
| | `warehouse` | O or S | `StoreAttached` or `Central`; exactly one `Default` location |
| | `storage_location` | O | Location of stock; type, `is_sellable`. No `store_id` (`D-03`) |
| | `storage_location_attribution` | S, A | A central location's attributed stores (`D-03`) |
| | `document_type`, `document_number_sequence` | R, S | Closed document types; one counter per store and type that cannot move backwards (`SS003`) |
| D2 | `state_machine_state`, `state_machine_edge` | R | Every machine's graph, with each edge's permission, audit type and reason flag |
| | `unit` | O | Code, kind (`Countable`, `Measurable`, `Service`), scale 0 to 4. A used unit's kind is frozen (`SS021`) |
| | `tax_category`, `tax_rate` | O, O A | Category; rates append-only, effective-dated, `numeric(9,4) >= 0` |
| | `category` | O | A single-parent tree; cycles refused (`SS006`), including two concurrent moves |
| | `brand` | O | Optional; unique by name whatever the case |
| | `product` | O | The SPU; born `Draft`; the Product machine |
| | `product_variant` | O | The SKU: product, base unit and tax category; archival |
| | `product_barcode` | O | `value` as text, `kind` (10 symbologies), a generated `lookup_key`. Exact match on `uq_product_barcode_active_key` |
| | `variant_price`, `store_variant_price`, `variant_standard_cost` | O A, S A, O A | Effective-dated, prospective only, append-only; prices must be more than zero |
| D3 | `reason_code` | O | The per-organization reason list; none seeded; an archived code takes no new document (`SS024`) |
| | `inventory_movement_type` | R | 17 rows, each with its direction and class |
| | `stock_adjustment`, `stock_adjustment_line` | S | The correction document and its directional lines |
| | `inventory_transaction` | S, A | The business event: store, actor, server time, business date, correlation id |
| | `inventory_movement` | S, A | **The ledger** (§9.1) |
| | `stock_balance` | O | `(variant, location, on_hand)`. The application cannot write it at all |
| D4 | `customer` | O | The walk-in record only (`CU-01`); one per organization |
| | `pos_terminal` | S | A till: code, label, mode, status, the location it sells from |
| | `cash_drawer` | S | At most one per terminal, in the store's currency |
| | `cash_shift` | S | Who, when, where, status. One open shift per drawer and per employee per store, as partial unique indexes |
| | `cash_transaction` | S, A | The drawer ledger (§9.1) |
| | `shift_count` | S | One blind counting pass: counted, expected (server-computed), generated variance, acknowledgement |
| | `payment_method`, `store_payment_method` | O, S | Typed methods (`Cash`, `Card`); enablement per store, prospective |
| | `checkout` | S | Settling one cart at one till; holds every payment attempt. It is not a sale: no number, no lines |
| | `payment` | S | One attempt per row; terminal states frozen |
| | `sale`, `sale_line` | S | Born `Completed`; the frozen snapshot (§2.3); only `receipt_status` is ever updated |
| | `receipt_reprint` | S, A | Who reprinted a receipt, when, and why |
| D5 | `customer_return`, `customer_return_line` | S | Goods back against exactly one sale; a mandatory disposition that decides the location |
| | `refund`, `refund_line` | S | Money back for one sale, allocated to its lines, each with its tax |
| D6 | `audit_event_type` | R | The closed vocabulary: 47 types, 33 the database writes and 14 the application writes |
| | `audit_event` | O, A | The audit trail (§4.4) |
| | `audit_chain_link`, `audit_chain_head` | O, A | Each event's place in its organization's hash chain, and the chain's tip |
| | `audit_redacted_field` | R | The personal fields redacted at write time |
| D7 | `employee` | O | A person, with or without a login; never deleted |
| | `user_account` | O | A login: an Argon2id hash (or bcrypt cost 12 or more) only |
| | `user_session` | O | A server-held session: only the SHA-256 of its token; ended once, with a cause |
| | `permission` | R | The catalogue: **122 keys** (`D-16`), equality matching only |
| | `role`, `role_permission` | O | A named permission set; a revocation is a recorded fact and the row stays |
| | `employee_role_assignment`, `employee_store_access` | O, S | A role organization-wide or in one store; access to one store with optional dates |

**The one `DELETE` the runtime role holds** is on a stock adjustment's line while the document is a never-submitted
draft (overview §3.6 lists draft lines never submitted as hard-deletable).

### 3.3 Where the invariants live

The database enforces the rules a caller could forget (`P6`). 77 functions and 96 triggers carry them. The ones that
matter most:

| Function or trigger | What it guarantees | Rules |
|---|---|---|
| `apply_inventory_movement()` (`SECURITY DEFINER`) | The whole stock write path: validates the movement, applies the delta and reads the result in one atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, judges the negative-stock policy on the result, stamps the resulting balance and its sequence | `ADR-05`, `IV-08`, `IV-16`, `IV-21`, `IV-22` |
| `forbid_ledger_rewrite()` | No `UPDATE`, `DELETE` or `TRUNCATE` on a ledger, even for the schema owner (`SS010`) | `BI-15`, `RT-059`, `AU-02` |
| `assert_sale_complete()` (deferred, at commit) | A sale has lines; totals are the sums and follow the tax mode; settled amounts equal the total due; no tender left `Pending` or `Authorized`; captured tenders equal the total; change equals tendered less applied and is disbursed; every stocked line moved exactly its quantity | `SP-02`, `RT-119`, `PY-38` |
| `sale_line_before_insert()` | A line's price equals `resolve_price()` at its quote time, its tax rate and cost are the ones in force, its variant is sellable, its location is sellable and the store's, its barcode is the variant's | `BI-30`, `RT-124`, `RT-493`, `WH-01` |
| `enforce_state_transition()` | A state change is a contracted edge (`SS004`) | `SM-02`, `SM-06` |
| `apply_return_posting()`, `apply_refund_hold()` | One conditional `UPDATE` of the line counters that affects no row if the bound would be passed. Written only by these owner-owned triggers | `BI-06`, `BI-10`, `RR-14`, `RR-24`, `PY-22` |
| `assert_*_complete()` family | A posted adjustment wrote exactly its lines; a posted return took every line back whole; a refund equals its lines and its payout is one event | `SS022`, `SS053`, `PY-27` |
| `write_audit_event()` and the audit triggers | An event is written with the change, from the row, the change and the authenticated context; a change without an actor, a source and a correlation id is refused (`SS054`) | `AU-01`, `AU-05`, `AU-10` |
| `link_audit_event()` (deferred), `audit_chain_breaks()` | Each event joins its organization's `sha256` chain at commit; the check walks it and never repairs | `AU-29`, `AU-30` |
| `employee_holds_permission()` | The one definition of what a grant set allows (§4.2) | `AC-01`, `AC-02`, `EM-13`, `MS-11` |
| `resolve_price()` | The one price rule, used by the scan to quote and by the line check to verify | `PR-30`, `BI-30`, `RT-040` |
| `inventory_ledger_drift()`, `sale_counter_drift()` | Rebuild balances, chains, counters and status from their sources. Report; never repair | `IV-09`, `SP-66`, `ADR-22` |
| `allocate_document_number()` | One upsert; the counter row stays locked until commit; a counter cannot move backwards | `BI-42`, `RT-479` |
| `freeze_*`, `forbid_*` | Currency and zone frozen after a sale; tax mode frozen after a sale; a sold variant's name; a used unit's kind; no store deactivation with stock or an open shift; no termination with an open shift | `ORG-01`, `SP-33`, `PR-03`, `PR-14`, `ORG-05`, `EM-10` |

**Concurrency evidence** (tests against a real PostgreSQL; `P10`: these are measured, not designed):

| Race | Result |
|---|---|
| 8 concurrent one-unit losses against 1 on hand, 15 runs | Exactly 1 success, 7 refusals, every run; the ledger reconciles (`BI-36`, `RT-067`) |
| 6 concurrent checkouts of the last unit, 5 runs | Exactly one sale each time; stock 0; zero drift |
| 6 workers posting multi-line adjustments over 5 locations in random line order | No failure, no deadlock, totals exact, zero drift (`IV-24`) |
| 50 concurrent postings of one return line | Exactly the sold quantity comes back (`RR-14`) |
| 10 concurrent refunds of the same money | Exactly 1 |
| 4 concurrent opens of one drawer | Exactly one succeeds (`CD-03`) |
| 1,000 concurrent document-number allocations | Unique and contiguous (`BI-42`) |
| 30 concurrent audit links | No gap, no fork |
| Two concurrent repeats of one sale operation | One sale; both get it |

### 3.4 Keys and indexes

Every uniqueness the specification asks for is a constraint, never a check-then-act. The ones that matter:

| Index or constraint | Purpose |
|---|---|
| `uq_product_barcode_active_key (organization_id, lookup_key) WHERE archived_at IS NULL` | The scan: one probe, at most one row; a UPC-A and the same code read as EAN-13 are one barcode (`PR-08`, `PR-12`) |
| `uq_storage_location_one_default (warehouse_id)` | At most one `Default` location per warehouse |
| `uq_store_setting_version_effective (store_id, effective_from)` | The settings in force are unambiguous |
| `uq_cash_shift_open_per_drawer`, `uq_cash_shift_open_per_employee` | One open or counting shift per drawer, and per employee per store (`CD-01`, `CD-03`) |
| `uq_checkout_operation`, `uq_sale_operation`, `uq_customer_return_operation` | Idempotency: a client operation id is unique per terminal (`BI-28`, `RR-15`) |
| `uq_sale_number` | A document number is issued once |
| `uq_payment_provider_reference` | A provider reference is recorded once (`PY-15`) |
| `uq_inventory_movement_sale_line_once`, `uq_inventory_movement_adjustment_line_once` | A line moves stock at most once |
| `uq_role_permission_live`, `uq_employee_role_assignment_live`, `uq_employee_store_access_live` | One live grant, assignment or access at a time |
| `uq_user_account_username`, `uq_employee_number` | Unique per organization |
| `ix_audit_event_entity`, `ix_audit_event_store_time`, `ix_sale_business_date`, `ix_sale_shift`, `ix_stock_balance_location` | The access patterns the built screens use |

There are 30 explicit index statements, besides the indexes behind primary and unique constraints. Indexes follow the
access patterns that exist (`RP-23`); the report indexes follow the reports, which are not built.

### 3.5 Roles and grants

Two roles (ADR-31 §6, `ADR-11`). `smartstore_owner` owns the objects and runs migrations. `smartstore_app` is the runtime
role: never a superuser, owns nothing, cannot create objects, and is granted DML **per table, in the migration that
creates the table**, column by column for `INSERT` and `UPDATE`. A column missing from the `UPDATE` list is immutable to
the application. An append-only table grants `SELECT, INSERT` only. `DATABASE_URL` is the runtime URL;
`MIGRATION_DATABASE_URL` is the owner's, used only by `dbmate`. `.env` is gitignored.

### 3.6 How monetary precision and auditability are guaranteed

- **Precision.** No `numeric`, `real` or `double precision` holds money; a schema test fails the build if a float column
  appears (`BI-01`). The driver refuses an unsafe `int8`. Arithmetic that needs a fraction (tax, proration) happens in
  exact `numeric` inside one SQL statement and is rounded once, half-up (overview §3.1).
- **Reproducibility.** A sale stores the settings version, the rate version, the quoted price and the cost it used, so
  nothing is recomputed from current configuration (`REQ-AU-06`, `ADR-08`).
- **Immutability.** A finalized sale and its lines cannot be edited or deleted (`BI-08`), and nothing can be added to a
  sale after its completing transaction (`SS036`). Only the counters on a line move, by owner-owned triggers, in the same
  transaction as the compensating document.
- **Traceability.** The audit event is written by the database with the change (§4.4); the movement ledger carries its
  resulting balance and its cause; the reconciliation checks run on demand (`npm run ledger:check`,
  `npm run audit:check`).

### 3.7 High-volume tables — **OPEN QUESTION `BQ-01`**

`inventory_movement`, `audit_event`, `sale` and `sale_line` are the tables that grow without bound. **Partitioning, and
any archival of old rows, is not specified and not built.** Three things in the record bear on it, and none of them
decides it:

- Retention is open: `AU-17` needs configured financial periods (a legal floor, like `GAP-044`), and `AU-02` and `AU-20`
  contradict each other (`OQ-024` item 3). No deletion path exists.
- `AU-21` says archival must preserve the query path.
- The ledger tables are append-only at every privilege and carry a per-organization chain (audit), so any scheme must keep
  those two properties.

Today's mitigations are structural: keyset paging on the long lists (CONVENTIONS §18), and the access-pattern indexes
above.

---

## 4. Security and authorization

### 4.1 Authentication — **BUILT** (D7 §9)

| Part | As built | Rule |
|---|---|---|
| Sessions | Server-held. The cookie is `httpOnly`, `Secure`, `SameSite=Strict` and scoped to `/api`. The database keeps only the SHA-256 of the 32-byte token, so a copy of the database cannot be replayed as a login | `ADR-12`, architecture §7.1 |
| Why not a JWT | A self-contained token cannot be revoked before it expires, and the employee's status and roles are re-read on every request anyway | §7.2 |
| Passwords | Argon2id from Node 26's `crypto`: 19 MiB, 2 passes, 1 lane (the OWASP first configuration). A sign-in rehashes a password stored at another cost. A plain password, low-cost bcrypt or Argon2i is refused by the schema | `EM-04`, §7.3 |
| Failure answers | A wrong username and a wrong password get the same answer after the same work. Nothing says whether an entity exists or a permission is missing | §24.3 |
| Throttle | A login with too many recent failures is refused until the window passes, even with the right password. The employee's status is never touched. The failures are the login's own `Security.LoginFailed` events | `SM-49` |
| Who may sign in | `Active`, and `OnLeave` read-only: the gate refuses every write and every transition | `EM-09` |
| Rotation | Signing in again on the same browser rotates the old session out. A role assignment or its removal, a store-access grant or revocation, a suspension and a termination end the employee's live sessions. A role *edit* signs nobody out (permissions are checked on every request, with no cache) | §7.1, `EM-16`, `PC-03` |
| At a till | A session may bind to a till of the organization, in a store where the employee holds a permission. Its source is then `Terminal`, otherwise `UI` | `PT-01`, `MS-01` |
| Settings | Session lifetime, the failure limit and its window, the quote age and the lock timeout are **required** settings with no defaults. The server will not start without them | `OQ-027` (open: the owner sets them) |

**Not built, and specified:** device credentials for terminals and readers (§7.4, `HD-14`, `HD-15`), which are deferred with
devices. A terminal is not an authenticated user (§7.4). Today the till is identified by the session's till, set by a
manager once per browser (`web/src/App.tsx`), and the server checks it (`PT-02`). Whether that is enough before real
devices exist is **OPEN QUESTION `BQ-09`**.

### 4.2 Authorization — **BUILT** (D7)

**The model.** Permissions are opaque dotted strings matched for **equality** (`AC-02`). The catalogue is **122 keys**, in
the table `permission`. A role is a named set of keys, custom roles are allowed and there is **no nesting**
(actors-and-roles §1). A role is assigned organization-wide or in one store (`MS-11`). Access to a store is a separate
entity (`EM-12`). The permitted store set is the **intersection** of the two (`EM-13`, `MS-03`).

**`employee_holds_permission(employee, store, key)`** is true only if all of these hold:

1. a live role assignment,
2. of a live, unarchived role,
3. which holds the exact key, unrevoked,
4. organization-wide or in that store,
5. and the employee has live, in-window access to that store.

An organization-level action (editing the catalogue, the people, the roles) has no store, so it needs an
organization-wide assignment (`OQ-025` item 6). A role without store access grants nothing. An organization-wide role
broadens the stores, never the permissions (`MS-12`). The Owner holds a role, not an exemption (`MS-13`).

**Role templates.** The templates of actors-and-roles §4 are notation, not data (`OQ-025` item 5), and none is seeded.
Onboarding creates one role, `Owner`, holding every catalogue key, assigned organization-wide with access to the store.
A migration that adds keys gives them to every role that holds all the others (`D-16`; `grant_to_complete_roles()`).

**Separation of duties.**

- *Data rules, enforced.* The approver of a stock adjustment is not its submitter, by a `CHECK` (`BI-26`, `IV-35`). A refund's
  approver is neither its drafter nor its submitter. A late return's approver is neither the one who opened it nor the
  one who posts it (`AP-08`).
- *Advisory, specified, not built.* `SEP-01` to `SEP-12` (for example `Payment.Capture` with
  `Payment.Provider.Configure`) are warned at assignment and listed in a standing report. The report and the assignment
  warning are not built (`REVIEW-01`, `MS-14`).

**Permission change safety** (`PC-01` to `PC-03`) — **BUILT.** Granting a key to a role is idempotent. Removing one needs
the request to state how many employees lose it, and is refused with that number otherwise. A role edit applies from the
next request. Nothing is deleted: a removal is a recorded revocation, so a role's permission set at any moment can be
rebuilt.

### 4.3 Server-side enforcement — **BUILT** (`server/src/http/gate.ts`, `transitions.ts`)

Every route declares exactly one of four access kinds, or the server **refuses to start**:

```ts
export type Access =
  | { kind: 'public' }                                                   // signing in, and the probes
  | { kind: 'session' }                                                  // any signed-in employee, own workspace
  | { kind: 'permission'; key: string; scope: 'store' | 'organization' } // a catalogue key
  | { kind: 'transition' };                                              // the key is the attempted edge's
```

The start-up check also refuses a declared key that is missing from the catalogue, and a store-scoped route with no
`:storeId`. Then, on each request:

1. The principal is resolved from the session cookie only (`AC-03`): the session's end, its expiry and the employee's
   status are re-read every request. A client-supplied role, permission, store or total is never trusted.
2. For a `permission` route, the gate calls `employee_holds_permission()` for the key and the route's store. The same 403
   answers an unknown store, another organization's store and a store outside the caller's set (`MS-06`, §24.3). The
   message names the missing key (`UX-58`).
3. The handler receives the one store the gate authorized (`request.storeId`). There is no unscoped query function
   (`MS-05`).
4. Input is validated with zod **before** the permission is evaluated on a transition, so a malformed request gets the
   same answer whether or not the actor may make it (§24.2). Unknown fields are dropped, so a client cannot supply a
   `*_by` column (`AU-05`, `BI-33`).
5. Who made a change is the session, never the body. The same session sets the audit context for the transaction.
6. A refusal is itself recorded, after the transaction rolls back (`Security.PermissionDenied`, naming the permission).

**The transition endpoint** (§7) is where §8.4 is made real: the permission checked is the one the **attempted edge names
in `state_machine_edge`**, never one derived from a URL or a body. An `OpenDecision` or `System` edge refuses every
person. The subject is locked first, so the edge is decided on its state at the moment of change. A repeat of a
transition already made changes nothing (`SM-04`); an illegal one is refused by name (`SM-06`).

### 4.4 The audit log — **BUILT** except its read path (D6)

**Who, what, when, why, before and after.** The database writes every audit event itself, from triggers on the audited
tables, **in the transaction of the change** (`AU-01`): never a change without its event, never an event for a change
that did not happen. The application cannot insert into `audit_event`. Its one writer, `record_audit_event()`, accepts
only the 14 application-origin types and refuses any type the database writes (`SS056`).

| Field | Source |
|---|---|
| `occurred_at`, `event_type`, `entity_type`, `entity_id`, `organization_id`, `store_id` | The server's clock; the row; the entity's store (null when the entity has none, `AU-07`) |
| `actor_id`, `effective_actor_id`, `role_used`, `source`, `terminal_id`, `correlation_id`, `client_operation_id`, `ip_address`, `reason_code_id` | The authenticated context the application sets **per transaction** with `set_config('smartstore.<name>', value, true)`, from the session, never the body (`AU-05`, `AU-06`, `AU-10`) |
| `before`, `after` | Only the fields that changed (`AU-08`); the whole row on creation |

- **An audited change without an actor, a source and a correlation id is refused** (`SS054`). An edge whose contract needs a
  reason is refused without one (`SS055`).
- **The vocabulary is closed** (`AU-11`, `AU-13`, `P8`): 47 types. 26 are `AU-12`'s, 20 are `D-06`'s per-machine types and
  one is `Cash.In` (`OQ-024` item 1). The §22 Audit column is data on each edge.
- **Redaction happens at write time** (`AU-09`): an employee's names, email and phone never reach the table; the event shows
  that the field was set, not its value.
- **Impersonation** records both principals, and they must differ (`AU-06`).
- **Append-only at every privilege**, with a per-organization `sha256` chain linked at commit so it cannot deadlock with
  business locks. `audit_chain_breaks()` finds an altered, removed, tail-removed or unlinked event.
  `npm run audit:check` exits non-zero on a break. `AU-31` stands: someone who can disable triggers can rewrite events and
  recompute the chain after them; the stated mitigation (separate credentials, an external shipper) is outside v1
  (`AU-33`).

**Not built:**

- *The read path and its permissions* (`AU-23` to `AU-26`). `AU-25` requires every access to the log to be audited, and no
  type in `AU-12` records a read: **OPEN QUESTION `OQ-024` item 2**. A read surface would break `AU-25`, so there is none.
- *A scheduled job's own record* (`AU-16`): **`OQ-024` item 8.**
- *Retention, expiry and archival* (`AU-17` to `AU-22`): **`OQ-024` item 3**, and the legal floor.
- *Events for master data and configuration changes*: no type exists (`OQ-024` item 4). The version rows are the history.
- *Events for store access and role definitions* (`EM-15`, `PC-01`): no type; the rows are the history (`OQ-025` item 4).
- *Standing audit reports* (`AU-27`).

### 4.5 The controls, and where each stands

PHASE-2-ARCHITECTURE §24.1, with the state of each. `security-verification.md` is Phase 0 evidence about other
codebases and is **not** a property of this system (§24.5).

| Control | Status |
|---|---|
| Authentication on every request | **BUILT** (`AC-03`) |
| One authorization gate; deny by default; start-up refusal | **BUILT**, tested by mutation (`gate.test.ts`) |
| Store isolation in the data layer | **BUILT**: composite keys, the gate's store, and a cross-store test (`§29.2`) |
| Password storage | **BUILT** |
| Session handling and rotation | **BUILT** |
| Immutable audit | **BUILT**: triggers at every privilege, plus the chain |
| Input validation at the boundary | **BUILT** (zod) |
| SQL safety | **BUILT**: parameterized queries; the only dynamic identifiers come from fixed column maps |
| No state-changing `GET` | **BUILT** (§18.3): every change is `POST`, `PUT`, `PATCH` or `DELETE` |
| Secrets | `.env` is gitignored and secrets are never committed (`.env.example` is committed and holds no secret); injection at deploy time is **SPECIFIED** (§27.5) |
| Dependency hygiene | `.npmrc` sets `min-release-age=7`; licence review of every dependency is a pre-release requirement (`D-10`, `GATE-Q2-LICENCE`) |
| Security headers, CSRF beyond `SameSite=Strict`, general rate limiting | **OPEN QUESTION `BQ-09`.** §24.1 lists headers "at the edge"; the master goal lists CSRF and rate limiting; no document specifies them. Only the sign-in throttle exists |
| Device and sync endpoints (rate-limited, idempotent, bounded, device-scoped) | **SPECIFIED** (§24.4), **DEFERRED** |
| RFID never authorizes | **SPECIFIED** (`CON-04`, `RF-01`, `RF-03`), **DEFERRED**. A release gate when RFID is built |
| Threat model, security tests beyond the above | Not written. The master goal's checklist (§40) lists a threat model; none exists |

---

## 5. Key business flows

Each flow says what is **BUILT** and what is not. The rule IDs are the specification's. Pseudo-code is limited to excerpts
of code that exists (§9); a flow that is not built has no code here, because inventing it would be inventing behaviour.

### 5.1 Product and variant management — **BUILT**

Code: `server/src/modules/catalog/`. Design: [D2](../database/D2-PRODUCT-BARCODE-UNIT.md).

1. **Reference data** (organization-wide keys: `Product.Create`/`Product.Edit` for units, categories and brands, `Tax.Edit` for
   tax categories and rates). A unit has a kind and 0 to 4 decimal places, and a countable unit has none (`PR-14`,
   `PR-15`). A tax category and its rates are data: none is seeded (`D-12`). A rate is a new version, never an edit
   (`RT-047`). Categories form a tree. A brand is optional. Archiving a brand, unit or tax category: `OQ-031`.
2. **A product** is created `Draft`, always (`PR-02`). `status` is not insertable.
3. **A variant** is added with its base unit, an optional tax category, an optional first price, and up to 20 barcodes. The
   product and base unit are immutable (`PR-15`). A barcode is stored as text, canonical, with its GS1 check digit
   validated by the database; one is primary (`PR-08`, `PR-12`, `RT-490`).
4. **A price** is a new version, now or later, never back-dated (`PR-32`, `RT-041`). It must be more than zero (`RT-042`). One
   below the standard cost is **refused**, because the approval it needs (`PR-33`) is not built in v1 (architecture §8.4's
   fallback). A store price overrides the organization default (`PR-30`).
5. **Activation** (`Draft → Active`) is the completeness check (`SM-12`): at least one live variant, each with a price in
   force (`SS005`, `SS008`). A variant with no tax category is *unclassified* and cannot be sold (`RT-493`).
6. **The lifecycle** continues on the transition endpoint: discontinue, reactivate, hide, unhide, archive, each with a reason
   (`SS055`). An archived product is never reactivated (`PR-47`). A variant, category and barcode are archived once, never
   deleted. A barcode is never reassigned: archive it and issue a new one (`PR-09`, `PR-10`).
7. **The till finds an item** by an exact barcode key (`GET /stores/:storeId/scan/:code`), or by name
   (`GET /stores/:storeId/items?name=`, case-blind, wildcards escaped, at most 20, only what the store can sell here). A
   barcode is exact and a name is fuzzy, and the two never mix (`UX-48`, `RT-379`).

**Not built** (`DEFERRED`): the option matrix, unit conversions and packaging sales, images, price lists by customer group,
supplier products, discounts and coupons, import jobs (D2 §1).

### 5.2 Purchase order → goods receipt → batch → stock (FEFO-aware) — **SPECIFIED, NOT BUILT**

Sources: [procurement-domain.md](../product/procurement-domain.md) (`PR-Q01` to `PR-Q41`),
[batch-expiry-fefo.md](../product/batch-expiry-fefo.md) (`BE-01` to `BE-49`), [supplier-domain.md](../product/supplier-domain.md)
(`SU-01` to `SU-26`), [D3](../database/D3-INVENTORY-LEDGER.md) §7. Nothing here has code. **GRN creates stock; the supplier
invoice creates the payable** (`PR-Q22`).

| Step | What the specification requires | Rules |
|---|---|---|
| Requisition | A suggested supplier is a convenience, never a constraint. Approval by value; the requester cannot approve. It moves no stock and creates no payable | `PR-Q01` to `PR-Q04` |
| Purchase order | One ordering store. Lines store an immutable description snapshot; prices are recorded, never recalculated. `Draft → PendingApproval → Approved → Ordered`. Cancellation is refused once a receipt exists. Close-short is a first-class path with a reason. **Never deleted in any state** | `PR-Q05`, `PR-Q07`, `PR-Q08`, `PR-Q09`, `PR-Q10`, `ADR-20` |
| Goods receipt | Partial at the line level, in several staged receipts. **Over-receipt is bounded by a tolerance and otherwise needs approval and a reason; under-receipt is always allowed.** Damaged goods create no sellable stock. Already-expired goods are refused, or accepted non-sellable with a reason. The counted quantity is authoritative. A posted receipt is immutable | `PR-Q11` to `PR-Q21`, `BE-11` |
| Batch creation | One receipt line creates exactly one batch. It records the actual invoice cost, never a PO price silently adopted. A receipt writes batch-level `PURCHASE_RECEIPT` movements only, through the same write path as every movement | `BE-13`, `BE-14`, `BE-15`, `IV-08` |
| Stock increase | At the receipt's posting only. Not at the PO, and not at the invoice | `PR-Q22`, `BI-27` |
| FEFO issue | Allocated automatically on every depletion: lock candidate batches in a deterministic order, sort by expiry ascending with null last, consume greedily. Depleted, quarantined and blocked batches are excluded. A shortfall under `AllowNegative` posts to the pseudo-batch with a `BATCH_SHORTFALL` error. A cashier can never override FEFO; an override needs its own permission, a reason, and records available versus chosen | `BE-25` to `BE-35`, `IV-19`, `IV-19a` |
| Invoice and match | Billed quantity is bounded by received. The match result is computed, the approved result is stored. Tolerance is explicit with a zero default. Matching mode is a store setting | `PR-Q23` to `PR-Q28` |
| Payable | Exists at `ApprovedForPayment` (**`D-02`**). The balance is a projection of the supplier ledger | `SM-29`, `SU-09`, `GATE-PAYABLE` |
| Payment | Bounded by the outstanding payable; the Accountant's, not the buyer's | `PR-Q34`, `PR-Q35` |
| Purchase return | Bounded by quantity received; may not drive stock negative | `PR-Q29` to `PR-Q33` |

**Why it is blocked, besides not being built.** Seven edges of the PO machine (§22.3), one of the receipt (§22.4) and five of
the supplier invoice (§22.5) have no permission key, and refuse until the owner names them (`GAP-036`). The batch schema
extension is designed (D3 §7) and is additive: nothing already built changes shape. Until it exists, v1 loads opening stock
by an `OpeningBalance` adjustment, which writes the same movement type, needs a reason and takes a second person's
approval (D3 §3).

**OPEN QUESTION (already recorded):** batch-number uniqueness is "per supplier" in `BE-05` and "per supplier per variant" in
the table (D3 §7 notes it, to be settled when the table is built).

### 5.3 The point-of-sale sale

**Online cash sale — BUILT.** Code: `modules/sales/` and `modules/catalog/scan.ts`. Design: [D4](../database/D4-SALE-PAYMENT.md).

1. **Prerequisites.** The employee is signed in at an `Active` till, in service and not in training (`PT-03`, `SS025`); a shift
   is `Open` at its drawer (`BI-39`); the store has settings in force; cash is enabled at the store (`PY-05`, `SS045`); the
   organization has its walk-in customer (`CU-01`).
2. **Scan.** One read: the exact barcode key, the price from `resolve_price()`, and the item's status and tax class. It reads
   no stock and takes no lock (`UX-25`). An unknown, unreleased, unclassified or unpriced item is each its own answer, and
   the cart is untouched (`UX-11`). The answer carries a **signed quote**: an HMAC-SHA256 over the store, variant, unit price,
   currency, server time and barcode (`RT-124`, `BI-30`).
3. **The cart stays in the browser** until checkout; its running total is for display (`UX-10`).
4. **Complete.** `POST /stores/:storeId/sales` with a client operation id, the lines as `{ quote, quantity }`, and the cash
   handed over. A client price, total, tax or cost is not in the request.
   - A repeat of the operation id is answered with the sale already made, before anything else (`SM-04`, `BI-28`).
   - Each quote is verified: signed by this server, for this store, and not older than `QUOTE_MAX_AGE_MINUTES`, judged on
     the database's clock (`OQ-027`).
   - **One transaction** at READ COMMITTED, with a bounded lock wait (`IV-23`): the settings version in force; the open
     shift; cash enabled; the walk-in customer; then every line planned in one SQL statement (price, tax rate, cost, whether
     the quote has expired). A line with no tax rate in force is refused by name (`SP-33`).
   - Totals are computed on the server in exact `numeric`: inclusive tax is extracted from the gross, exclusive tax is added
     (`PR-39`). An underpayment is refused with the total and the amount tendered (`SP-40`, `UX-17`).
   - Rows are written in this order: the `checkout`; the cash `payment` (`Pending → Authorized → Captured`, each its own
     update); the `sale`, server-numbered; its `sale_line`s; one `inventory_transaction`; a `SALE` movement per **stocked**
     line, sorted by variant (`IV-24`); the `ChangeDisbursed` drawer row (`CD-18`).
   - At commit, `assert_sale_complete()` checks the whole (§3.3). Anything short rolls the entire transaction back (`RT-119`).
5. **The audit trail** is written by the database in that transaction: the sale, the payment, each movement, the change.
6. **The receipt** is rendered from the stored sale (`SP-57`); the till reports whether the first print worked, recorded once
   (`SP-03`); a failed print queues a reprint, and a reprint carries a banner, repeats the original numbers exactly and needs
   a reason (the owner's instruction of 2026-10-01).

**Lock order.** A sale takes the store's document-number counter first, then the stock-balance rows in sorted order. Every sale
takes them the same way, so sales cannot deadlock one another. Architecture §20.2 says "stock before document", but a
movement's foreign key to the sale forces the document first; the consistent order is what prevents deadlock, and the
concurrency test confirms it (D4 §1).

**There is no stock reservation.** The request that prompted this document asked for one. The specification says the till
reserves nothing (`IV-49`, deliberate), and reservations are deferred (`IV-46` to `IV-50`). A shortfall surfaces at completion
(`UX-25`).

**Card payment — SPECIFIED, NOT BUILT.** The keys are decided (`D-16`: `Sale.Create` submits, `Payment.Capture` captures,
`Payment.Void` voids). The order is fixed by the specification:

> authorize → capture → **commit** → print, each step idempotent with a recovery path (`PY-37`, `PY-38`, `PY-39`)

- Each payment attempt is a `payment` row created `Pending` in its own transaction. The provider is called **outside** any
  transaction (`PY-36`, `CON-05`). The result is recorded in another transaction. A timeout leaves the row `Pending`,
  reconciled, never assumed (`PY-11`).
- A decline is retried as a new `Payment`; `Failed` and `Voided` are terminal (`PY-14`, `PY-54`, `D-14`).
- The provider is behind an interface of `Authorize`, `Capture`, `Refund`, `Void` and `Query`, with no provider name in
  business logic (`PY-07`, `PY-08`). The owner approved a **simulated gateway** for v1; a real acquirer needs an account and
  secrets, which is the owner's call (ADR-31 §13, item 4).
- A reconciliation job finds payments captured with no sale and reports them for voiding or refund. It never auto-adjusts
  (`PY-40`). **Not built.**
- `checkout` exists because the order requires attempts to be recorded against a sale that does not exist yet (D4 §1).

**Offline sale — SPECIFIED, NOT BUILT.** See §1.6 and §5.7. The server already refuses a duplicate by key.

### 5.4 Returns and refunds — **BUILT (schema); application layer NOT BUILT**

Design: [D5](../database/D5-RETURNS-REFUNDS.md); rules: [returns-refunds-domain.md](../product/returns-refunds-domain.md), `PY-21` to
`PY-28`. A return is goods coming back and a refund is money going back. They are separate documents with separate machines,
linked when both exist, never nested (`RR-01`, `SM-38`, `SM-39`).

**Both bounds live on the sold line**, in counters only owner-owned triggers write, each by **one conditional `UPDATE`** that
affects no row if the bound would be passed. That is atomic with no read-then-write race:

| Counter | Bounded by | Written when |
|---|---|---|
| `returned_quantity` | `quantity` (`BI-06`, `RR-14`) | A return is **posted** |
| `refunded_amount`, `refunded_tax_amount` | `settled_amount`, `tax_amount` (`RR-03`, `RR-06`, `BI-10`) | A refund enters **`Processing`**: the hold (`RR-24`) |

- **Return, partial or full.** A draft holds lines, each naming one sold line of the same sale, a quantity, a **mandatory
  disposition** (`Sellable`, `Quarantine`, `Damaged`, `Expired`) and the matching location (`RR-17`, `RR-19`, `SS047`). Each
  return and each line has its own operation id (`RR-15`, `RR-16`). **Posting** is one transaction: the status, the line
  counters in line-id order, then one `SALE_RETURN` movement per line into its dispositioned location, naming the
  disposition. At commit every line must have come back whole (`SS022`). The window closes on the sale's business date plus
  `return_window_days`; later needs a late approver who is neither the opener nor the poster (`RR-10`, `RR-11`, `SS048`). A
  return that takes everything back passes through `PartiallyReturned` to `Returned`.
- **Refund.** To the original tender (cash to the drawer, card to the provider) or in cash. Every refund is approved by a second
  person (`BI-26`), and its lines are fixed from submission (`AP-03`). A refund linked to a return pays only for lines the
  *posted* return took back (`SS051`). A refund with no return is goodwill and needs a reason (`RR-35`). A cash refund and its
  payout are one event (`PY-27`), and expected cash falls by it. A failed refund keeps its hold and may be retried; only a
  cancellation releases it.
- **Proved concurrently:** 50 concurrent returns of a five-unit line yield exactly 5; 10 concurrent refunds of the same
  money yield exactly 1.
- **Exchange** and **store-credit refund** are `DEFERRED` (`RR-30` to `RR-34`, `RR-26` to `RR-29`): in v1 an exchange is a
  return and a new sale, done separately.

**What blocks building it:** nothing now for the keys (`D-16`). It is the next piece of work (Phase E). **Still open:**
`OQ-023` items 1 to 6 (skipping approval below a threshold, how a return settles and closes, the window's edges, refunding a
service, refund tax rounding, a cap per tender). Whether a refund's *retry* should need `Refund.Pay` like its first payment
was raised with the owner (Q8) and stands as answered: `Sale.Refund`.

### 5.5 Stock adjustments and transfers

**Adjustments — BUILT.** Code: `modules/inventory/adjustments.ts`. Design: [D3](../database/D3-INVENTORY-LEDGER.md) §3, §9.

1. A document is created `Draft` with a server-allocated number and a **reason code, always** (`IV-33`).
2. Lines are added only while `Draft` (`SS018`). A *correction* is entered as the counted quantity; the server reads the
   system quantity beside it, keeps both as evidence and writes the difference as one directional line; a count equal to the
   system is refused (`UX-36`, `UX-37`, `IV-34`). Damage, expiry, loss and found are entered as what happened.
3. **Submit** (`Inventory.Adjust`), then **approve** by a different person (`Inventory.Adjust.Large.Approve`; a `CHECK`,
   `BI-26`, `IV-35`). The contract has no edge from `Draft` to `Posted`, so every adjustment takes a second person; whether
   approval should apply only above a threshold is `OQ-013`.
4. **Post** writes the movements in `(variant, location)` order (`IV-24`) in the transition's own transaction. The database
   checks that it wrote exactly its lines (`SS022`). Under `BlockNegative` a posting that would go below zero is refused
   whole (`IV-16`). **Reverse** writes one `REVERSAL` per movement (`IV-12`).
5. An **opening balance** is the same machine with its own keys (`Config.Organization`; approval `Import.Approve`). It is v1's
   way to load stock, because import jobs are outside the slice.

**Transfers — SPECIFIED, NOT BUILT.** Two steps through a real `Transit` location (`IV-39`). They may cross warehouses;
**cross-store is disabled by configuration** in v1 (`IV-40`, `MS-20`), and enabling it needs an approval chain, a cost decision,
a credit mechanism and transit tracking (`MS-21`). One transfer is one inventory transaction group with two effect sets
(`IV-05`). Dispatched must equal received, and a difference is a separate reasoned adjustment (`IV-41`). Dispatch and receipt
may be different people (`IV-42`). Destination stock rises on receipt, never on dispatch (`MS-23`); batch identity is preserved
(`IV-45`); transit age is monitored (`IV-44`). Three edges of the transfer machine have no permission key (§22.18, `GAP-036`).

**Stock counts — SPECIFIED, `DEFERRED`.** States `Open`, `Posted`, `Cancelled`, `Reversed` (`D-09`); expected is frozen at
creation; posting writes `COUNT_VARIANCE_*` movements with a reason per line and an approval (`IV-25` to `IV-31`). v1
corrects stock with counted-quantity adjustment lines instead.

### 5.6 Cash drawer and shift management — **BUILT**, except reopen

Code: `modules/sales/till.ts`, `shift-close.ts`. Design: [D4](../database/D4-SALE-PAYMENT.md) §5, §9; rules: `CD-*` in
[cash-management.md](../product/cash-management.md).

1. **Open** (`Shift.Open`): the cashier counts the float, possibly zero, and the shift is created with exactly one
   `OpeningFloat` drawer row (`CD-11`, `CD-14`, `SS042`). One open shift per drawer and per employee per store is a unique
   index, proved by 4 concurrent opens (`CD-01`, `CD-03`).
2. **Trade.** Each cash sale applies the net amount; change leaves the drawer as a `ChangeDisbursed` row (`CD-18`).
3. **Begin count** (`Shift.Close`): `Open → Reconciling`. No sale can run, because a sale needs an `Open` shift (`BI-39`).
4. **The blind count** (`CD-21`, `CD-22`, `CD-31`): the cashier enters the counted total; the *server* computes the expected
   amount (opening float plus cash applied, less cash refunded, `CD-06`) and the variance is a generated column. The
   application cannot supply the expected amount. The count is a total in v1 (denominations are `DEFERRED`).
5. **Acknowledge** (`Cash.Variance.Acknowledge`): a non-zero variance needs an acknowledgement with a live reason before the
   shift can close (`CD-23`, `CD-25`, `BI-25`). The tolerance is zero, and the second-approver threshold does not exist
   (`OQ-020`). A recount is a new pass; the earlier ones stand (`SM-57`).
6. **Close** (`Shift.Close`): needs a latest count that is balanced or acknowledged, and a **declared closing float**, which
   is written as a `ClosingFloat` row (`CD-20`, `RT-526`). The close records who closed it. A closed shift's actors cannot be
   rewritten (a database guard added in Phase B). A manager reviews every shift's four answers on the shift screen
   (`CD-30`, `RT-527`).
7. **A till disabled mid-shift** can still have its open shift counted and closed (nothing in the close depends on the till
   being in service).

**Not built:** reopening a closed shift (**`OQ-033`**: what the recount counts, the closing float already handed on, who the row
names as closer). The key exists (`Shift.Reopen`, `D-16`). Also not built: cash in and out, withdrawals and approval
thresholds (`CD-15` to `CD-17`, deferred), denomination counts (`CD-27` to `CD-29`), auto-close within a tolerance
(`OQ-020`), `NoSale`, whether the closing float may exceed the count (`OQ-029`), and the X/Z report.

### 5.7 Offline sale reconciliation — **SPECIFIED, NOT BUILT**

The algorithm the specification gives; none of it has code. The queue item and the sync request are in §9.5.

1. **Queue.** A completed offline sale is stored durably with its `ClientOperationId` and `DeviceSequence`, self-contained
   (`OF-17`, `OF-18`). It is marked offline on screen and on its receipt, with a provisional number (`OF-47`).
2. **Sync.** Triggered on reconnection, on an interval, on request and at shift close (`OF-27`), per store and per terminal in
   business-date order (`OF-24`). The server answers **per item** (`OF-26`).
3. **Apply.** One transaction: insert `(terminal, client operation id)` under the unique constraint, then apply the sale. On a
   conflict, return the stored original response and run nothing else (`OF-22`, `OF-23`, `BI-29`). The server re-prices and
   re-taxes: the terminal never decided (`OF-02`, `BI-30`).
4. **Outcome.** Exactly one of three (`OF-29`):

   | Outcome | When | Stock | Money |
   |---|---|---|---|
   | `Applied` | Exactly as the terminal computed it | As computed | As tendered |
   | `AppliedWithAdjustment` | A price, tax, promotion or credit difference; the sale otherwise valid (`OF-31` to `OF-34`) | Server-correct | Server-correct |
   | `Rejected` | Applying would be wrong: a training terminal, a terminal not offline-enabled, a store the terminal no longer belongs to, an expired offline window, a duplicate of a reversed transaction, an unallocatable number (`OF-35`) | Unchanged | Unchanged |

5. **Stock** never loses a sale: under `AllowNegative`, which offline requires, it always applies, and a negative is recorded
   (`OF-30`, `D-04`). A shortfall on a batch-tracked variant goes to the pseudo-batch; a real batch is never negative
   (`OF-39`).
6. **Conflict is visible.** The terminal shows a sync summary with counts by outcome and each adjusted or rejected item
   (`OF-48`). A supervisor inspects the queue (`Sale.OfflineQueue.Manage`, `OF-21`). A rejected item is never deleted, and a
   rejected sale is a business event a person resolves, not retried automatically (`OF-36`, `OF-37`).
7. **Dead letters** are client-side retention only (`D-07`); the server never observes one.

---

## 6. The hardware abstraction layer — **SPECIFIED; NOTHING BUILT**

Sources: [hardware-domain.md](../product/hardware-domain.md) (`HD-01` to `HD-34`), [rfid-domain.md](../product/rfid-domain.md)
(`RF-01` to `RF-38`), PHASE-2-ARCHITECTURE §12, `ADR-14`, `ADR-16`, `ADR-27`, [HARDWARE-REQUIREMENTS.md](../hardware/HARDWARE-REQUIREMENTS.md).
**No device table, driver, or device test exists.** What exists is a till and its drawer (§6.5).

### 6.1 The rule that makes it real

> Business logic issues a **domain command** against a registered `Device`. It never names a manufacturer, a protocol or a
> vendor SDK. (`HD-01`)

The commands (`HD-01`): `ReadBarcode`, `ReadTags`, `ReadWeight`, `PrintReceipt`, `OpenDrawer`, `ReadTemperature`, `ReadStatus`,
`Restart`. Enforcement is a **static check in the build**, not a code review: no file in the business-logic layer references a
device SDK, a protocol constant or a manufacturer name (`HD-02`, `BI-34`, `PY-08`). That check does not exist yet.

### 6.2 The interfaces

| Interface | Implementations named by the architecture | Notes |
|---|---|---|
| `ReceiptPrinter` | ESC/POS over USB or network; browser print | Browser print is not a kiosk fallback: a headless kiosk hangs on the print dialog after every sale (§12.1) |
| `BarcodeScanner` | Keyboard wedge; camera | One interface over both; the wedge is what most scanners actually are |
| `Scale` | A peripheral driver | A *settled* reading (`SP-17`); a source of `Scale`, `Manual` or `BarcodeEmbedded` (`PR-27`, `SP-16`) |
| `RfidReader` | A clean-room LLRP service for the Zebra FX9600, from EPCglobal LLRP v1.0.1 | Persistent connection plus a background event service; never a request-scoped connect-read-disconnect (§12.2) |
| `Esp32Device` | A peripheral driver | **No command set is specified for it.** `BQ-10` |
| `CashDrawer`, `PosTerminal`, `TemperatureProbe` | | Device types in `HD-04`; the drawer opens by `OpenDrawer` |

A `DeviceType` is a **capability contract**, not a model number (`HD-04`); "Zebra DS2208" is a model recorded on the device. A
device that is both a scanner and a printer is two `Device` records (`HD-06`). **A label printer and a customer display** are
named in the master goal's hardware list (§6.13) but not in `HD-04`'s type list: `BQ-10`.

### 6.3 The device model

- **`Device`**: serial or asset number, a `DeviceType`, a store or warehouse, a label, a status, a last heartbeat and a health
  state (`HD-03`). **`DeviceConnection`**: a connection type (`Usb`, `Serial`, `Network`, `Bluetooth`, `Virtual`, `Cloud`),
  endpoint, transport, an authentication reference and health. **`DeviceEvent`**: typed health and error events, not an
  exception in business logic (`HD-21`).
- **Status** (`HD-07`): `Registered`, `Active`, `Degraded` (still in service), `Offline` (no heartbeat), `Disabled` (by an
  administrator), `Retired`. `Offline` is not `Disabled` (`HD-16`). Health and mode are separate axes (`ADR-27`).
- **Capabilities are validated at registration**, not at first failure (`HD-09`). A device is never deleted (`HD-08`); a
  replacement is a new device with a cross-reference (`HD-33`). The type is immutable once the device has produced events
  (`HD-05`).
- **Identity.** A per-device credential is established at registration; events are accepted only from an authenticated
  device; a device credential never impersonates an employee (`HD-14`, `HD-15`, §7.4).

### 6.4 How the domain stays hardware-agnostic

1. **The domain names commands, never devices** (`HD-01`), and a build check enforces it (`HD-02`). The verification the
   specification gives: registering a different `ReceiptPrinter` implementation requires no change to any sales code.
2. **A connection is configuration** (`HD-13`): swapping a USB scanner for a network one is a row, not a code change.
3. **Device I/O is outside the business transaction** (`HD-17`, `P7`). Commit before print: a failed print costs a receipt, not a
   sale (`HD-19`, `SP-58`). A timeout is reconciled, never assumed (`HD-20`).
4. **A missing device degrades one feature, never the till** (`HD-10`, `HD-11`):

   | Absent | The POS |
   |---|---|
   | Scanner | Manual search and code entry |
   | Scale | A manual weight, with a reason (`PR-28`, `SP-18`) |
   | Receipt printer | The receipt goes to the reprint queue (`SP-58`) |
   | RFID reader | Nothing RFID-dependent happens; attendance is manual |
   | Cash drawer | Cash is counted and recorded without an open event |
   | Card terminal | Card is unavailable, and the till says so before the cart is rung (`HD-12`) |

5. **RFID authenticates; it never authorizes** (`CON-04`, `RF-01`, `ADR-16`). The flow is *read → credential → employee →
   session → permission check → action*. The RFID subsystem has no code path to a business operation, and a zero-permission
   employee with a valid tag still cannot act: a release gate (`RF-02`, `RF-03`). A tag never satisfies an approval
   (`RF-21`). A read identifies; it never changes stock (`RF-29`).
6. **Reader addresses come from configuration**, allowlisted, link-local and loopback rejected: otherwise a read endpoint is an
   SSRF primitive (§12.2, §19.2).
7. **Telemetry carries no business or personal data** (`HD-24`, `HD-25`). A device error is rate-limited and notified on
   transition (`HD-22`).

### 6.5 What exists today

- A **terminal and its drawer** (`pos_terminal`, `cash_drawer`), a till's lifecycle as the Device machine
  (`Registered → Active ⇄ Disabled → Retired`), and its mode as a separate field. There is no `Degraded`, `Offline` or
  heartbeat: telemetry is deferred (`SM-60a`, `PT-04`).
- The **print outcome** and **reprint** of a receipt (`sale.receipt_status`, `receipt_reprint`), for when printing exists.
- A cash drawer's open event, the printer, the scanner, the scale and RFID are **not built**. Today a scanner works because it is
  a keyboard (the till's scan field takes Enter). Receipt printing, "a printer or an agreed browser print flow", needs the
  owner (BUILD-STATUS).
- A firmware version, a registry, a simulator and a hardware test harness: none. The master goal asks for a simulator and a
  real-device test for each integration (§34). Firmware updates are manual and audited in v1 (`HD-27`).
- **The Technician role is disabled in v1**; the permission set is ready (`HD-34`).

---

## 7. API design — **BUILT** for the slice (`server/src/http/`, `server/src/modules/*`)

### 7.1 The shape (PHASE-2-ARCHITECTURE §18)

| Surface | Consumers | Style | Status |
|---|---|---|---|
| **Back-office API** | Web clients | Resource-oriented HTTP/JSON under `/api/v1` | BUILT for the slice |
| **Transition API** | POS, mobile, sync | `POST /api/v1/transitions` with `{ machine, event, subject, payload?, clientOperationId?, reasonCodeId? }` | BUILT; five machines bound (§2.4) |
| **Device and sync endpoints** | Tills, readers | Not specified beyond "the highest-risk surface" (§24.4) | NOT BUILT; `BQ-04`, `BQ-09` |
| **GraphQL, WebSocket, webhooks** | | Not in the record. No inbound webhooks in v1 (§19.4). Transport for live updates is `BQ-03` | NOT BUILT |

The split exists because the permission a transition needs is the one **the edge names**, and that cannot be read off a
REST path (§18.1). A route is therefore one of four access kinds (§4.3), declared in its route config, and a route with none
stops the server from starting.

### 7.2 Conventions that every route follows

- **Versioned from the first release**: everything is under `/api/v1`, except `GET /health` and `GET /ready`, which are
  public and unversioned (§18.4). A till offline for a week must still work against a server that moved.
- **No state-changing GET** (§18.3, `AC-01`). Every mutation is POST, PUT, PATCH or DELETE.
- **Errors**: `{ "error": { "code": "<stable>", "message": "<what happened and what to do>", ...details } }`. A client branches
  on `code`, never on the text (`UX-55`). The database's own text never leaves the server (§24.3); a business-rule
  refusal (`SSnnn`) is mapped to a plain message. Every response carries `x-correlation-id`, the request id, which is also the
  audit event's correlation id (`AU-10`).
- **Refusals the gate itself raises**: `401` for no or an expired session, `403` with code `forbidden` (names the permission
  and the store) or `read_only` (an `OnLeave` employee's write). A refused attempt is itself audited (`AC-04`).
- **Idempotency** (`SM-04`, `BI-28`): a sale carries `clientOperationId`, checked **before** side effects; the repeat returns
  `200` with the original result and a first write returns `201`. A concurrent duplicate loses on a unique index
  (`uq_checkout_operation`) and is then answered with the winner's result. Transitions accept the key too and write it to the
  audit event. **Gap:** not every state-changing route takes a key. The specification says all financial and state-changing
  requests carry one (§18.2); the slice has keys on the sale and the transition, and natural uniqueness elsewhere (for
  example a barcode or a document number). Whether the remaining creates need one is `BQ-06`.
- **Lists are bounded**: `limit` (1 to 200, default per route) and a keyset cursor `after`; the response is
  `{ items, next }`, with `next` null on the last page (§18.5). Short configuration lists use an offset cursor (a row added
  between two pages can shift the rest by one, a noted limit); the long ones (sales, movements, products, employees) page by key.
- **Validation**: every body, query and path is parsed by a **zod** schema before anything else, so a malformed request is
  answered the same whether or not the caller may make it (§24.2). Money in a request is an integer in minor units;
  quantities are decimal strings.
- **Tenant isolation**: a subject in another organization is `404`, not `403` (`MS-04`, §24.3).
- **Money in responses** is integer minor units with the `currencyCode` beside it, never a float (`ADR-04`).

### 7.3 The route table (as built)

All paths are under `/api/v1`. "Key" is the catalogue permission the gate checks (`store` scope means the key must be held in the
store named by `:storeId`; `org` means organization-wide).

| Group | Method and path | Access |
|---|---|---|
| **Session** | `POST /session` (sign in), `GET /session`, `DELETE /session`, `PUT /session/password` | public for sign-in; session otherwise |
| **Employees** | `GET /employees`, `GET /employees/:id` | `Employee.View` (org) |
| | `POST /employees` | `Employee.Create` |
| | `PATCH /employees/:id` | `Employee.Edit` |
| | `PUT /employees/:id/login` | `Employee.Password.Reset` |
| **Access** | `GET /permissions`, `GET /roles`, `GET /employees/:id/roles` | `Role.View` |
| | `POST /roles` | `Role.Create` |
| | `PATCH /roles/:id`, `POST /roles/:id/archive`, `PUT` and `DELETE /roles/:id/permissions/:key` | `Role.Edit` |
| | `POST /employees/:id/roles`, `DELETE /role-assignments/:id` | `Role.Assign` |
| | `GET /employees/:id/stores` | `Employee.View` |
| | `POST /employees/:id/stores`, `DELETE /store-access/:id` | `Employee.StoreAccess.Grant` |
| **Settings** | `GET` and `POST /stores/:storeId/settings` | `Config.Store` (store) |
| **Catalog reads** | `GET /units`, `/categories`, `/brands`, `/products`, `/products/:id` | `Product.View` |
| | `GET /tax-categories` | `Tax.View` |
| | `GET /variants/:id/prices` | `Price.View` |
| **Catalog writes** | `POST /units`, `/categories`, `/brands`, `/products`, `/products/:id/variants` | `Product.Create` |
| | `PATCH` on units, brands, categories, products, variants; `POST` variant archive, barcodes, barcode primary and archive, category archive | `Product.Edit` |
| | `POST /variants/:id/costs` | `Product.Edit` and `Product.Cost.View` |
| | `POST /tax-categories`, `POST /tax-categories/:id/rates`, `PATCH /tax-categories/:id` | `Tax.Edit` |
| | `POST /variants/:id/prices` (organization default) | `Price.Edit` (org) |
| | `POST /stores/:storeId/variants/:id/prices` (store price) | `Price.Edit` (store) |
| **Till** | `GET /stores/:storeId/scan/:code`, `GET /stores/:storeId/items?name=` | `Sale.Create` (store) |
| | `GET /stores/:storeId/terminals`; `POST /stores/:storeId/terminals` | `Device.View`; `Device.Register` |
| | `GET /stores/:storeId/shift`; `POST /stores/:storeId/shift` | `Sale.Create`; `Shift.Open` |
| **Shift close** | `POST /stores/:storeId/shifts/:id/counts` | `Shift.Close` |
| | `POST …/counts/:id/acknowledge` | `Cash.Variance.Acknowledge` |
| | `GET /stores/:storeId/shifts`, `…/shifts/:id` | `Cash.Count.View` |
| **Sales** | `POST /stores/:storeId/sales` | `Sale.Create` |
| | `GET /stores/:storeId/sales`, `…/sales/:saleId` | `Sale.View` |
| | `GET …/receipt`, `PUT …/receipt-status`, `POST …/reprints` | `Sale.Create` (`D-16`) |
| **Payment methods** | `GET` and `POST /payment-methods`; `PUT /stores/:storeId/payment-methods/:methodId` | `Payment.Method.Configure` |
| **Inventory** | `GET /reason-codes` | session |
| | `POST /reason-codes`, `POST /reason-codes/:id/archive` | `Config.Organization` |
| | `GET …/locations`, `…/stock` | `Inventory.View` (store) |
| | `GET …/movements` | `Inventory.Ledger.View` (store) |
| | adjustment and opening-balance documents under `/stores/:storeId/adjustments` and `/opening-balances` | the document's own keys; the machine's edges carry the rest |
| **Transitions** | `POST /transitions` | the key the attempted edge names |
| **Operations** | `GET /health`, `GET /ready` (unversioned) | public |

The table is the **built** surface, taken from the route declarations. The specification's resource list is larger (§7.5).

### 7.4 Contract documentation — **OPEN QUESTION `BQ-06`**

No OpenAPI or other contract document is generated. The request schemas live in zod beside each route and the web client
holds hand-written response types (`web/src/lib/api.ts`). ADR-31 does not choose a documentation tool or a generated client.

### 7.5 What the specification still requires of the API and is not built

The reporting API (`RP-*`, deferred), the notification inbox (`NT-*`), the offline sync endpoint (`OF-24` to `OF-27`), the
device and heartbeat endpoints (`HD-14`, `HD-15`), the purchase-order, receipt and supplier-invoice transitions, and the
customer, credit and loyalty resources. They need no new *style*: each is either a resource route with a declared key or an edge
on `POST /transitions`. Which keys they use is `GAP-036` for the 20 rows still without one.

---

## 8. Project structure — **as it exists** at `f68fdc3`

```
SmartStore/
├─ SMARTSTORE-CONSTITUTION.md   BUILD-STATUS.md   OPEN-QUESTIONS.md   CLAUDE.md   AGENTS.md
├─ docs/
│  ├─ product/        the specification: 12 domains, state machines, requirements-traceability (RT-nnn)
│  ├─ architecture/   PHASE-2-ARCHITECTURE (ADR-01..30), ADR-31, OWNER-DECISIONS, this blueprint
│  ├─ database/       CONVENTIONS, D1..D7 (one design per database domain)
│  ├─ hardware/       HARDWARE-REQUIREMENTS
│  ├─ domain/ testing/ repository-analysis/
├─ research/          read-only evidence base (never modified)
├─ db/
│  ├─ migrations/     14 forward-only dbmate migrations (plain SQL; every `migrate:down` raises)
│  └─ schema.sql      the dumped schema, regenerated by `npm run db:migrate`
├─ server/
│  ├─ src/
│  │  ├─ main.ts  app.ts  config.ts  onboarding.ts
│  │  ├─ db/pool.ts            createPool, withTransaction, AuditContext, int8 parser
│  │  ├─ http/                 gate.ts (one gate), transitions.ts (one endpoint), errors.ts, paging.ts, health.ts
│  │  ├─ modules/
│  │  │  ├─ identity/          sessions, password, employees, access (roles, permissions)
│  │  │  ├─ organization/      stores, warehouses, locations
│  │  │  ├─ catalog/           products, reference data, scan
│  │  │  ├─ inventory/         adjustments, reasons, stock
│  │  │  ├─ sales/             sales, till, shift-close, payment-methods, quotes
│  │  │  └─ audit/             chain (hash-chain verification)
│  │  └─ cli/                  onboard, audit-check, ledger-check, demo
│  └─ test/                    per-domain database tests (d1..d7), schema-rules, citations, perf/
├─ web/
│  └─ src/
│     ├─ App.tsx  MyAccount.tsx  main.tsx
│     ├─ back/                 back-office screens (People, Roles, Prices, Reference, Shifts, …)
│     ├─ pos/                  Sale, ShiftClose
│     └─ lib/                  api client, money, form, Problem, Announcer
├─ scripts/           db-bootstrap.sql, db-setup.ps1
└─ notes/             WHAT-IS-LEFT.md
```

- **Layers**: a route handler (HTTP, validation, the gate), a use-case function that owns one transaction, and SQL. There is
  no ORM and no repository abstraction beyond `identity/repo.ts` and `organization/repo.ts`. The rules live in the database
  (§3.3), so a layer above it that restated them would be a second definition.
- **What the request's layout has and this does not**: `domain/`, `ports/`, `adapters/`, `jobs/`, an `apps/` split into several
  deployables, `packages/`. The record fixes one server, one web workspace and a migration directory (ADR-31). Whether the
  device agent and the till client become separate workspaces is `BQ-04`.
- **Modules**: the module map in §1.4 names the specified modules. Six exist as directories; the rest (`procurement`,
  `suppliers`, `customers`, `approvals`, `notifications`, `reporting`, `hardware`, `sync`) do not.
- **Commands** (root `package.json`): `npm test`, `npm run typecheck`, `npm run db:migrate`, `npm run db:status`, `npm run
  onboard`, `npm run audit:check`, `npm run ledger:check`, `npm run perf`, `npm run demo`, `npm start`, `npm run web`.

---

## 9. Foundational code skeletons — **excerpts from code and DDL that exist**

Every block below is copied from the repository and trimmed with `…` where noted. There is no pseudo-code for a part that is not
built, because writing one would be inventing its design. The **offline client has no skeleton** (§9.7).

### 9.1 The stock ledger and the balance it feeds (`db/schema.sql`, D3)

```sql
CREATE TABLE public.inventory_movement (
    seq bigint NOT NULL,                       -- global order of the ledger
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inventory_transaction_id uuid NOT NULL,    -- the document group (IV-05)
    store_id uuid NOT NULL,   organization_id uuid NOT NULL,
    variant_id uuid NOT NULL, storage_location_id uuid NOT NULL,
    movement_type text NOT NULL,
    direction text NOT NULL,                   -- 'In' | 'Out'
    quantity numeric(18,4) NOT NULL,           -- always positive
    delta numeric(18,4) GENERATED ALWAYS AS (CASE direction WHEN 'In' THEN quantity ELSE -quantity END) STORED,
    resulting_balance numeric(18,4) NOT NULL,  -- the balance this row produced
    balance_sequence bigint NOT NULL,          -- per (variant, location)
    reverses_movement_id uuid,
    -- … cause columns: stock_adjustment_line_id, sale_line_id, customer_return_line_id, disposition …
    CONSTRAINT ck_inventory_movement_one_cause CHECK (num_nonnulls(stock_adjustment_line_id, sale_line_id, customer_return_line_id) = 1),
    CONSTRAINT ck_inventory_movement_positive  CHECK (quantity > 0),
    CONSTRAINT ck_inventory_movement_reversal  CHECK ((movement_type = 'REVERSAL') = (reverses_movement_id IS NOT NULL))
);

CREATE TABLE public.stock_balance (            -- a cache of the ledger; written only by the movement trigger
    organization_id uuid NOT NULL, variant_id uuid NOT NULL, storage_location_id uuid NOT NULL,
    on_hand numeric(18,4) NOT NULL, movement_count bigint NOT NULL, last_movement_at timestamptz NOT NULL,
    CONSTRAINT ck_stock_balance_count CHECK (movement_count >= 1)
);
```

`apply_inventory_movement()` is `SECURITY DEFINER`, runs before each insert on `inventory_movement`, and is the **only** writer of
`stock_balance`. Its checks, in order, include: a service cannot be stocked (`SS012`); quantity decimals within the unit's scale
(`SS013`); a Transit location only by transfer movements (`SS023`); the store may move stock at that location (`SS014`, `D-03`);
the store is not deactivated (`SS020`); a reversal mirrors its original (`SS015`); the negative-stock policy (central
warehouses are always `BlockNegative`, `WH-02`; a store's comes from its settings in force, `SS017`, `SS011`).

### 9.2 The drawer ledger (D4)

```sql
CREATE TABLE public.cash_transaction (
    seq bigint NOT NULL,  id uuid DEFAULT gen_random_uuid() NOT NULL,
    cash_shift_id uuid NOT NULL,  cash_drawer_id uuid NOT NULL,  store_id uuid NOT NULL,
    type text NOT NULL,           -- OpeningFloat | ChangeDisbursed | ClosingFloat | RefundFromDrawer
    direction text NOT NULL,      -- fixed by type: 'In' for OpeningFloat, 'Out' otherwise
    amount bigint NOT NULL,       -- minor units
    currency_code text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,  created_by uuid NOT NULL,
    sale_id uuid,  refund_id uuid,
    CONSTRAINT ck_cash_transaction_amount CHECK (amount > 0 OR (amount = 0 AND type IN ('OpeningFloat','ClosingFloat'))),
    CONSTRAINT ck_cash_transaction_sale   CHECK ((type = 'ChangeDisbursed')  = (sale_id IS NOT NULL)),
    CONSTRAINT ck_cash_transaction_refund CHECK ((type = 'RefundFromDrawer') = (refund_id IS NOT NULL))
);
```

The ledger has four types. Cash in, cash out, withdrawals, deposits and `NoSale` arrive with their flows (§5.6).

### 9.3 The audit event (D6)

```sql
CREATE TABLE public.audit_event (
    seq bigint NOT NULL,  id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,  store_id uuid,
    occurred_at timestamptz DEFAULT now() NOT NULL,
    event_type text NOT NULL,                       -- closed vocabulary, audit_event_type (47 types)
    entity_type nonblank_text NOT NULL,  entity_id uuid,
    actor_id uuid,  effective_actor_id uuid,  role_used nonblank_text,
    source text NOT NULL,                           -- UI | API | Job | Device | OfflineSync | Terminal
    terminal_id uuid,  correlation_id uuid NOT NULL,  client_operation_id uuid,
    ip_address inet,  reason_code_id uuid,  before jsonb,  after jsonb,
    CONSTRAINT ck_audit_event_actor CHECK (actor_id IS NOT NULL OR event_type = 'Security.LoginFailed')
    -- …
);
```

A trigger writes it in the transaction of the change it records. `forbid_ledger_rewrite` refuses `UPDATE`, `DELETE` and
`TRUNCATE` on it, for every role including the owner (`SS010`). A per-organization sha256 chain over the events is checked by
`audit_chain_breaks()`.

### 9.4 The state machine as data (D0)

```sql
CREATE TABLE public.state_machine_edge (
    machine nonblank_text NOT NULL,  from_state nonblank_text NOT NULL,  to_state nonblank_text NOT NULL,
    event nonblank_text NOT NULL,
    audit_event_type text,
    requires_reason boolean DEFAULT false NOT NULL,
    permission_rule text NOT NULL,                  -- 'Key' | 'System' | 'OpenDecision'
    permission_key text,
    CONSTRAINT ck_state_machine_edge_not_loop   CHECK (from_state <> to_state),
    CONSTRAINT ck_state_machine_edge_permission CHECK (permission_rule IN ('Key','System','OpenDecision')
                                                       AND (permission_rule = 'Key') = (permission_key IS NOT NULL))
);
```

`OpenDecision` is the explicit "the owner has not named a key" value: such an edge **refuses**, and is the mechanism that keeps
the application from inventing a permission (`GAP-036`).

### 9.5 The request context, the transaction, and the gate (`server/src/`)

```ts
// http/gate.ts — what a route requires. Every route declares one, or the server refuses to start (AC-01).
export type Access =
  | { kind: 'public' }
  | { kind: 'session' }
  | { kind: 'permission'; key: string; scope: 'store' | 'organization' }
  | { kind: 'transition' };

export interface Principal {
  employeeId: string;  organizationId: string;  sessionId: string | null;  terminalId: string | null;
  readOnly: boolean;                      // OnLeave: may look, may not change anything
}
```

```ts
// db/pool.ts — one use case, one transaction, READ COMMITTED, the audit context set first (ADR-26, §21.1).
export async function withTransaction<T>(
  pool: pg.Pool, context: AuditContext, work: (client: pg.PoolClient) => Promise<T>,
  options: { lockTimeoutMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (options.lockTimeoutMs !== undefined) { /* set_config('lock_timeout', …, true) — IV-23 */ }
      await client.query(SET_CONTEXT, [ /* actor, source, correlation id, role, terminal, … */ ]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      // 40001 serialization failure and 40P01 deadlock only: the transaction rolled back whole, so a retry is safe.
      if (attempt < TRANSACTION_ATTEMPTS && RETRYABLE.has(error.code)) { /* jittered sleep */ continue; }
      throw error;
    } finally { client.release(); }
  }
}
```

The audit context is set with `set_config(…, true)`, which lasts until the transaction ends, so a pooled connection never
carries one request's actor into the next.

### 9.6 The transition endpoint's contract and the sale route

```ts
// http/transitions.ts — a machine is bound to a table, not coded.
export interface MachineBinding {
  machine: string;  noun: string;  table: string;  stateColumn: string;  actorColumn: string;
  storeColumn: string | null;          // store-scoped subjects are authorized in their store
  organizationColumn?: string;
  actorColumnsFor?: (to: string) => string[];
  extraColumns?: string[];
  payloads?: Record<string, z.ZodType>; // validated before anything is looked up or authorized
  before?: (client, subjectId, from, to, principal, payload) => Promise<void>;
  // … keyFor: the key the specification names where it differs by the subject's kind
}
```

```ts
// modules/sales/quotes.ts — the price the till may sell at is one the server signed.
export interface Quote { storeId; variantId; unitPrice: number; currencyCode; quotedAt; barcode: string | null }
// HMAC-SHA256 over the JSON body, compared with timingSafeEqual; verified for the store; its age is judged at save.
```
```ts
// modules/sales/sales.ts — the request, and the idempotent route.
const NewSale = z.object({
  clientOperationId: z.uuid(),
  lines: z.array(z.object({ quote: z.string().min(1).max(4000), quantity: z.number().int().min(1).max(1_000_000) })).min(1).max(500),
  cash: z.object({ tendered: z.number().int().min(0) }),
});

app.post('/stores/:storeId/sales', inStore('Sale.Create'), async (request, reply) => {
  const body = NewSale.parse(request.body);
  const till = await tillOf(pool, request);
  const before = await existing();                                   // a repeat is answered first (SM-04)
  if (before !== undefined) return reply.status(200).send(await summary(pool, before.id));
  try {
    const sale = await completeCashSale(pool, request, till, body, options.quotes, options.quoteMaxAgeMinutes, options.lockTimeoutMs);
    return reply.status(201).send(await summary(pool, sale));
  } catch (error) {                                                  // a concurrent duplicate loses on the unique index
    const raced = error.constraint === 'uq_checkout_operation' ? await existing() : undefined;
    if (raced !== undefined) return reply.status(200).send(await summary(pool, raced.id));
    throw error;
  }
});
```

`completeCashSale` is the sequence in §5.3 step 4, inside one `withTransaction`. Its price, tax and cost come from SQL, never
from the body.

### 9.7 The offline sale — **no skeleton, by design**

What the record fixes, and nothing more:

| Field or rule | Source |
|---|---|
| `ClientOperationId`, unique per `(terminal, id)`; a conflict returns the stored response and runs nothing else | `OF-22`, `OF-23`, `BI-29` |
| `DeviceSequence`, a per-terminal counter that orders a terminal's own queue | `OF-18`, `OF-24` |
| A queue item is self-contained: lines, quoted prices, tender, business date, a provisional number | `OF-17`, `OF-47` |
| The server's answer is **per item**, one of `Applied`, `AppliedWithAdjustment`, `Rejected` | `OF-26`, `OF-29` |
| `DeadLetter` is client-only | `D-07` |

The client store, the wire format, the encryption of the queue at rest, and the batch size are **`BQ-04`**. A TypeScript
interface for them would be an architectural choice, which this document may not make.

---

## 10. Non-functional requirements

### 10.1 Scalability and performance

| Requirement | Source | Status |
|---|---|---|
| A single writer database; the server is stateless and scales horizontally | `ADR-02`, §27.1 | The server holds in memory one value that breaks this: the quote-signing key (`quotes.ts`). A restart voids open quotes, and several processes need one shared key from configuration. Recorded in code as a `ponytail:` note |
| Contended aggregates use a row lock; no global serializable | `ADR-25`, `ADR-26` | BUILT; READ COMMITTED with explicit locks, bounded lock wait (`IV-23`) |
| Scan to cart: **p95 ≤ 100 ms** on the local setup (the owner's figure) | ADR-31 §16 | Measured p95 **5.1 ms** over HTTP and **24.1 ms** in the browser, over a 100,000-variant catalogue |
| Sale save, 10-line cash cart | ADR-31 §16 | **No budget approved.** p95 ≤ 100 ms is *proposed* for the owner; measured p95 **69.1 ms** (an earlier run gave 27.1 ms on the same code, and the rise is unexplained, per BUILD-STATUS) |
| Sale save, 10-line card cart (SimulatedGateway, authorize + capture inline) | ADR-31 §16 | **No budget approved.** Measured p95 **70.6 ms** over a 10,000-variant catalogue (2026-10-03). The SimulatedGateway is in-process, so this measures the persistence cost and not provider latency. |
| The 100 ms budget is a local-network figure; a cloud round trip adds latency the server cannot remove | ADR-31 §16 | A client-side price cache is the remedy, deferred with offline |
| Throughput, concurrent tills, sales per day, database size | | **OPEN QUESTION:** no number is stated in the record. The owner's list names "safe concurrent sales" and "safe concurrent stock updates" (master goal), which are proved by tests (50 concurrent returns, 10 concurrent refunds, concurrent sales and shift opens), not sized |
| Partitioning or archival of the three append-only ledgers | | `BQ-01` |

### 10.2 Reliability and data integrity

- **The database refuses the wrong state** rather than trusting the application (`P1`): constraints, triggers, and the deferred
  `assert_*` checks (§3.3).
- **Atomic business transactions**: a sale is all or nothing (`RT-119`); a document that moves stock is checked to have
  written exactly its lines (`SS022`).
- **Provider I/O outside a transaction**, and a timeout is reconciled, not assumed (`PY-36`, `HD-17`, `HD-20`).
- **The ledger is checkable**: `npm run ledger:check` recomputes the balances from the movements and reports a difference without
  correcting it; `npm run audit:check` verifies the audit chain. **Both are now schedulable** via `npm run checks:run`; see `docs/operations/SCHEDULED-CHECKS.md`. The outbox and notification delivery remain deferred (`BQ-02`).
- **Migrations** are forward-only, applied as the owner role, and a migration that is wrong is fixed by a new one (`ADR-31`).
  The compatibility-window rule for a till fleet (§27.2) has no till to protect yet.
- **A terminal is a data-loss risk and this is an accepted v1 risk** (§26.3): a shift cannot close with an unsynced outbox without
  an acknowledgement. That control belongs to offline, which is not built.

### 10.3 Observability

Five signals are required (§25.1): sync health, ledger reconciliation, auth events, business invariants, job health. Alerts have
a threshold and an owner (§25.2). Every request carries a correlation id into the audit event, the movement row and the
provider call (§25.3). Logs carry ids, states and correlation ids, never customer names, card data or amounts (§25.4).

| Signal | Built |
|---|---|
| Correlation id on every response and in the audit event | Yes |
| Auth events (failed sign-in, privilege change, refusal) in `audit_event` | Yes (47-type vocabulary) |
| Ledger reconciliation | A command, not a job; no alert |
| Business invariants | Enforced as refusals; **not measured** |
| Sync health, job health | No: neither sync nor jobs exist |
| Metrics, dashboards, alert routing, log shipping | **None.** The tooling is `BQ-08` |
| A readiness check that tests the database | Yes (`GET /ready`) |

### 10.4 Backup and recovery

The architecture requires point-in-time recovery plus daily full backups for the database, a versioned backup for the file store,
a restore drill as part of "done", and a reconciliation run right after a restore (§26). **The RPO, the RTO and the restore window
are `D-13`, open.** `backup-and-recovery.md` says explicitly that no tier, schedule, number or tooling may be invented. Nothing
is built: no backup script, no restore drill. This blocks release, not engineering (`GAP-038`).

### 10.5 Security (summary; the controls are §4)

Server-side authorization on every request; the cookie is `HttpOnly; Secure; SameSite=Strict; Path=/api`; passwords are hashed
with the built-in `argon2` (§4.1). **Not built and not specified in the record**: security headers, CSRF tokens beyond
`SameSite=Strict`, general rate limiting (only sign-in throttling exists), device credentials, a threat model (`BQ-09`).
Secrets are injected at deploy time and never committed (§27.5); the repository holds `.env.example`, which has no secret. A
real payment provider's credentials are the highest-privilege secret (§13.6) and are the owner's to supply.

### 10.6 Compliance

- **Tax**: no rate is seeded and none may be invented; an unset tax configuration is an error at the point of use, not a zero
  (§27.3, `D-12`). The jurisdictional facts for Nepal are `GAP-044`, needing the owner and legal counsel. **A fiscal receipt,
  an invoice number series required by law and a tax report format are not in the record.**
- **Currency**: NPR is the project's currency (D-15; see §11.3 for the caveat that D-15 is not committed), integer minor units
  (`ADR-04`); rounding is per store and per currency (`SP-25`, `SP-26`).
- **Licence**: sold commercially (`D-10`); no licence is named, and a dependency-terms review is a pre-release requirement
  (`GATE-Q2-LICENCE`). The clean-build position from Phase 0 stands.
- **Privacy**: telemetry carries no personal data (`HD-24`); logs carry no customer data (§25.4). **OPEN QUESTION:** a
  data-protection regime, a retention period for customer data, and a right-to-erasure rule are not in the record. The audit
  trail and the ledgers are append-only and never deleted (Constitution), which constrains any such rule.

### 10.7 Retention

Retention and expiry are themselves audited events (§14.4), and **nothing is built**: the closed vocabulary has the types, and no
job writes them. Retention periods are not stated by the record, and the idempotency-key retention window (`ADR-30`: "at least as
long as the longest offline window") has no value until the offline window does (`BQ-11`).

### 10.8 Accessibility and usability

A requirement, not an extra (§5.4, `UX-*`). The touch-target minimum and the contrast ratio are `OQ-030`. Screens have tests that
assert labels and announcements (`Announcer`), but there is **no automated accessibility audit** in the suite.

---

## 11. Status registers

### 11.1 Built and not built, by domain

| Domain | Database | Application | Web | Notes |
|---|---|---|---|---|
| Organization, store, warehouse, location (D1) | BUILT | BUILT (read, settings) | Setup, Tills, Settings | Lifecycle vocabulary `OQ-001` |
| Product, variant, barcode, unit, price (D2) | BUILT | BUILT | Products, Reference, Prices | See §5.1 for what is deferred |
| Inventory ledger and adjustments (D3) | BUILT | BUILT | Stock, Adjustments | Batches, transfers, counts, reservations: not built |
| Sale and payment (D4) | BUILT | **Cash** only | Sale screen, Shifts, Sales | Card, split tender, hold, void: not built |
| Returns and refunds (D5) | BUILT | **Not built** | Not built | The next piece of work |
| Audit (D6) | BUILT | Written by triggers; **no read path** | None | `OQ-024`, `OQ-025` |
| Employee, role, permission (D7) | BUILT | BUILT | People, Roles, MyAccount | Attendance, leave, RFID credentials: not built |
| Procurement, suppliers, payables | Not built | Not built | Not built | Specified; keys open (`GAP-036`) |
| Batches, expiry, FEFO | Designed (D3 §7) | Not built | | |
| Customers, credit, loyalty | Not built | Not built | | Specified (`CU-*`) |
| Approvals engine | Not built | Not built | | Specified as infrastructure (§6.6); two-person rules are `CHECK`s today |
| Notifications | Not built | Not built | | Specified; states owned (`D-08`) |
| Reporting | Not built | Not built | | Deferred (`RP-*`) |
| Import and export | Not built | Not built | | v1 loads stock by opening-balance adjustment |
| Hardware, RFID | Not built | Not built | | §6 |
| Offline POS and sync | Not built | Not built | Not built | §5.7 |
| Backup and restore | Not built | | | `D-13` open |

The Web column names the screens that exist in the working tree. Only some are committed (§11.2).

### 11.2 The web back-office

Committed screens at `f68fdc3`: People, Roles, Prices, Reference data, Shifts, the sale screen, and the shift-close screen. **Further
screens exist in the working tree, uncommitted, from another session** (Products, Sales, Stock, Tills, Adjustments, Setup, NotYet,
MyAccount); their status is that session's to record, and one of its test files (`Products.test.tsx`) was failing when this
document was written. This blueprint describes the committed code only.

The web has no router and no data-fetching library: a screen is chosen by state in `App.tsx` and calls the hand-written `api()`
helper. That is an existing fact, not a decision; whether it stays is `BQ-06`.

### 11.3 Owner decisions

| ID | Decision (short) | Date |
|---|---|---|
| D-01 | The 13 undefined permission keys: held via wildcard templates; PO separation of duties | 2026-09-29 |
| D-02 | A supplier payable exists at `ApprovedForPayment` | 2026-09-29 |
| D-03 | A central warehouse is attributed to stores by an explicit table; stock stays variant + location | 2026-09-29 |
| D-04 | Offline stock: allow and reconcile; no server reservation | 2026-09-29 |
| D-05 | Store credit has no due date in v1 | 2026-09-29 |
| D-06 | A small per-machine set of 20 new audit types | 2026-09-29 |
| D-07 | `DeadLetter` is client-only | 2026-09-29 |
| D-08 | Notification states: `Unread`, `Read`, `Acknowledged` | 2026-09-29 |
| D-09 | StockCount states: `Open`, `Posted`, `Cancelled`, `Reversed` | 2026-09-29 |
| D-10 | Sold commercially; no licence named; dependency review before release | 2026-09-29 |
| D-11 | Loyalty accrual: net of discount, excluding tax | 2026-09-29 |
| D-12 | Product configuration versus legal and tax compliance (Nepal, NPR) | **open** |
| D-13 | Backup RPO, RTO and restore window | **open** |
| D-14 | A `Failed` payment is terminal; a retry is a new payment | 2026-09-30 |
| D-15 | **Not in the committed `OWNER-DECISIONS.md`.** A working-tree edit by another session adds it (NPR); this blueprint cites it only as that session's uncommitted record | uncommitted |
| D-16 | Permission keys for the transitions and creations that had none (catalogue 117 → 122) | 2026-10-02 |

`D-12` and `D-13` are recorded as open, not decided (CLAUDE.md). The committed record jumps from `D-14` to `D-16`.

### 11.4 Gates and release-only items

`GATE-PERMKEYS`, `GATE-PAYABLE`, `GATE-Q1`, `GATE-OFFLINE-INVENTORY`, `GATE-Q4-DUNNING`, `GATE-AUDITTYPES`, `GATE-DEADLETTER`,
`GATE-NOTIFICATION-STATES` and `GATE-STOCKCOUNT-STATES` are closed by `D-01` to `D-09`, `D-14` and `D-16`, with `GAP-036` (permission keys
for edges) narrowed from 27 rows to 20. **Release-only and not blocking engineering:** `GAP-044` (jurisdictional tax facts),
`GAP-038` (RPO and RTO), `GATE-Q2-LICENCE` (licence naming).

### 11.5 Open questions

The engineering questions found while designing and building are `OQ-001` to `OQ-033` in [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md),
which is their register and the only place their status is kept. This document does not copy their status, to avoid a second
copy that drifts. The ones it relies on: `OQ-013` (adjustment approval threshold), `OQ-020` (variance tolerance), `OQ-023`
(returns), `OQ-024`, `OQ-025` (audit and employee gaps), `OQ-029` (closing float), `OQ-030` (touch target and contrast), `OQ-031`
(archiving reference data), `OQ-032` (manual-weight threshold), `OQ-033` (reopening a shift).

**The blueprint's own questions** are numbered `BQ-nn`. They are questions this consolidation found because the request, or the
specification's own list of components, assumes something the record does not decide. They are recorded as `OQ-034` in
OPEN-QUESTIONS.md.

| ID | Question | Why it is open | Blocks |
|---|---|---|---|
| `BQ-01` | Partitioning, archival, or neither, for `inventory_movement`, `audit_event` and `cash_transaction` | No volume is stated; ADRs say nothing | Nothing now |
| `BQ-02` | A cache, a queue, a scheduler or a job runner, for the outbox, reconciliation jobs, retention, and notification delivery | §15 requires an outbox and §9.4 a reconciliation job; ADR-31 chooses no mechanism and says no cache or queue is used | Notifications, jobs, scheduled checks |
| `BQ-03` | Real-time transport (server-sent events, WebSocket, polling) for device status and notifications | Not specified | Live dashboards, device status |
| `BQ-04` | The till client's technology, its local store, the sync wire format, and whether it is a separate workspace | The spec fixes the behaviour (`OF-01` to `OF-50`), not the technology | Offline POS |
| `BQ-05` | File storage and receipt rendering (the file-store interface of §17.3, where a receipt image or PDF lives) | Interface required; no implementation or format chosen | Receipt printing, exports, attachments |
| `BQ-06` | API contract documentation, generated clients, the web router and data layer, and which remaining creates need a client operation id | Not chosen in ADR-31 | Contract tests, a second client |
| `BQ-07` | Hosting, containers, CI/CD, environments and secrets injection | §27 states the shape, not the platform | Release |
| `BQ-08` | Metrics, tracing, log shipping and alert routing | §25 states the signals, not the tooling | Operating it |
| `BQ-09` | Device credentials, security headers, CSRF beyond `SameSite=Strict`, general rate limiting, and a written threat model | §7.4 defers device credentials; no other control is specified | Devices, release |
| `BQ-10` | Device types and commands beyond `HD-04`: a label printer, a customer display, and the ESP32's command set | Named in the master goal's hardware list, absent from `HD-04` | Those devices |
| `BQ-11` | The idempotency-key retention window | `ADR-30` ties it to the longest offline window, which is unset | Offline, key cleanup |

---

## 12. Keeping this document true

1. **It decides nothing.** A fact enters it from `/docs`, an ADR, an owner decision, or code that exists. A new rule, key, state or
   architecture choice starts as an `OQ-nnn` or `BQ-nn` and moves into the document only after the owner answers it.
2. **Change it by appending.** Add a dated section that names what it supersedes, as the other governance documents do. Do not
   rewrite an earlier section to make it look current.
3. **Re-measure before re-stating.** The header's counts (migrations, tables, functions, triggers, tests) are facts about one
   commit. When the commit moves, recount them from `db/schema.sql` and a test run; do not edit the number.
4. **A built flow cites the code, and a specified flow cites the rule.** If a section says BUILT, a reader must be able to find the
   file; if it says SPECIFIED, the rule IDs. A flow with neither is not justified and is to be sent back.
5. **It is not a requirement document.** Where it and `/docs` disagree, `/docs` wins and this document is the defect.

---

## 13. Update, 2026-10-02, after commit `f68fdc3`

Appended as §12 requires. It supersedes what §5.3, §5.4, §6.5, §7.3, §9.6 and §11.1 say about card payments, returns and
refunds, and nothing else. The header's counts (migrations, tables, functions, triggers) are unchanged: no migration was added.

| Was (at `f68fdc3`) | Now |
|---|---|
| Returns and refunds: schema built, application layer not built (§5.4, §11.1) | **BUILT.** `server/src/modules/returns/`: open, fill and post a return; late approval; draft, submit, approve, pay, cancel a refund. Both machines are bound to `POST /transitions`, which now binds nine. D5 §10, `OQ-035` |
| Card payments: specified, keys decided, not built (§5.3) | **BUILT against a simulated gateway.** `server/src/modules/payments/`; a card sale authorizes, captures, then commits, resumably, alone or split with cash. D4 §15, `OQ-036` |
| Card refunds not built (§5.4) | **BUILT** against the same gateway: `POST /refunds/:id/pay` (`Refund.Pay`) and `/retry` (`Sale.Refund`). D5 §11 |
| The payment provider: an interface required, none chosen (§1.2, `BQ`-adjacent) | `PaymentGateway` is the interface (`PY-07`, `PY-10`). **`SimulatedGateway` is TEST / simulated**: it moves no money, accepts only `TEST-` tokens, is marked in its header, a startup warning, `SIM-` references and `simulated: true` on a payment and a refund. A real acquirer needs an account and secrets, the owner's call (ADR-31 §13 item 4) |
| §7.3 route table | Adds `POST/DELETE /stores/:storeId/returns[/:id/lines[/:lineId]]`, `POST …/returns/:id/late-approval` (`Return.Approve`), `POST /stores/:storeId/refunds`, `POST …/refunds/:id/pay`, `POST …/refunds/:id/retry`; `POST /sales` takes `card`. A sale's detail names its lines' counters and its payments |
| §9.6 `completeCashSale` | Now `completeSale`, planned by `planSale` and tendered by `splitTender`; a card sale is driven by `completeCardSale` |
| Tests: 437 | 480 |

**Still not built in this area:** voiding a payment and the reconciliation job (`OQ-036` item 2), the provider per store (`PY-09`),
the card's display fields (`PY-43`), reading returns and refunds (no key, `OQ-035`), settle and close of a return (`OQ-023`),
the notification of a failed refund, and offline card payment.

---

## 14. Update, 2026-10-02, owner decision D-17

Supersedes §13's "reading returns and refunds (no key)" and the permission count of §4.2 (122 keys). The catalogue holds **124**:
`Return.View` and `Refund.View` are new. Returns and refunds are read at `GET /stores/:storeId/returns[/:id]` and
`…/refunds[/:id]`. A draft refund may be withdrawn (`Draft → Cancelled` on `cancel`, `Sale.Refund`, a reason; one migration,
`20261002120000`, so the migration count is 15). A drawer refund is paid by someone signed in at its till. `OQ-035` is closed;
tests are 483. Still open in this area: the orphaned-payment path, `OQ-036` item 2.

---

## 15. Update, 2026-10-02, orphaned payments (part A)

Supersedes §13's "not built: voiding a payment and the reconciliation job" in part. **Built:** `POST /stores/:storeId/payments/:id/void` (`Payment.Void`) and `GET /stores/:storeId/payments/attention` (`Payment.View`), with `npm run payments:check`; D4 §16. **Not built:** the scheduler (`BQ-02`), the settlement-file comparison, the notification, and **part B**, what returns the money of a payment captured with no sale (`OQ-036` item 2: three options, the owner's to decide). `OQ-037`: the window a payment may wait is not given by the specification, so it is a required parameter. Tests: 493.

---

## 16. Update, 2026-10-02, owner decision D-18

Supersedes §15's "part B". **Built:** a refund may name a captured card payment instead of a sale (`refund.sale_id` optional; `payment.refunded_amount`; one migration, `20261002130000`, so the count is 16; `SS058`, `SS059`). It reuses the refund machine, its keys (`Sale.Refund`, `Sale.Refund.Large.Approve`, `Refund.Pay`), the approval and the audit. A payment being refunded cannot become a sale. `OQ-036` is closed; a failed card refund's cancel is `OQ-038`. D5 §13. Tests: 502.

---

## 17. Update, 2026-10-02, owner decision D-19

A failed refund can be cancelled (`Failed → Cancelled` on `cancel`, `Sale.Refund`, a reason), which releases its hold (one migration, `20261002141000`, so the count is 17). `OQ-038` is closed. D5 §14. Tests: 504.
