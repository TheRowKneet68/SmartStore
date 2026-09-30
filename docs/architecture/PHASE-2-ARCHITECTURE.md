# Phase 2 — System Architecture

SmartStore Phase 2. This document turns the Phase 1 specification into an architecture: boundaries, the shapes
that were forced on us, the decisions that are still owed to us, and the record of why each choice was made.

**Read this first.** Phase 1 closed as **READY WITH BLOCKERS**
([../product/PHASE-1-REVIEW.md](../product/PHASE-1-REVIEW.md) §9). This architecture is written so that it can be
built in the parts that are not blocked, and so that the blocked parts fail loudly rather than silently. It does
not resolve the blockers. Where a decision is owed, §1.4 and §28.3 name it, and the affected section carries a
gate. **No section here picks a side on an open question.**

The foundation shape and the technology stack are **not** decided in this document. They were decided in
[../repository-analysis/foundation-recommendation.md](../repository-analysis/foundation-recommendation.md), whose
evidence is 5 repositories and ~250 findings. Re-deriving them here would discard that work. This document adopts
them and records the adoption as an ADR (§28).

---

## 1. Architecture principles

### 1.1 Principles, in priority order

When two principles conflict, the higher one wins. This ordering is itself a decision (`ADR-01`).

| # | Principle | Forced by |
|---|---|---|
| P1 | **The server is the only authority for money, stock, and permission.** A client may propose, never decide. Totals are recomputed server-side; a client-supplied total is discarded, not validated | `RT-344`, `SM-02`, `AC-03`, `CON-05` |
| P2 | **Deny by default.** A request with no explicit grant is refused. There is no implicit access and no fallback policy that skips the check | `AC-01` |
| P3 | **Every mutation is transactional and idempotent.** A financial mutation carries a client operation id; a retry of the same id returns the first result and repeats no side effect | `SM-04`, `RT-344` |
| P4 | **Money is an integer count of minor units, end to end.** Never a float. Quantities and loyalty points may use `DECIMAL(18,4)`; money may not | `BI-15a` family, Phase 0 §5 |
| P5 | **History is append-only.** Movements, finalized documents, and audit entries are never edited or deleted; a correction is a new linked record | `BI-08`, `BI-15`, `BI-24`, `BI-40`, `BI-41` |
| P6 | **Boundaries are enforced in the data layer, not in callers.** Store isolation, soft-delete guards, and referential rules are predicates in the persistence tier, because a caller that forgets is a breach | Phase 0 §5, `MS-17` |
| P7 | **External I/O never runs inside the business transaction.** Payment providers and devices are called before or after the transaction, never within it, so a network call cannot hold a lock or roll back a ledger | `CON-05` |
| P8 | **A closed vocabulary is extended deliberately, never by an implementer who needs a field.** Adding an event type is a reviewed schema change | `AU-11`, `AU-13`, `NT-04`, `CON-06` |
| P9 | **Derived state is a cache, not a source of truth.** Any derived value names the entity that owns it and has a rebuild path | `SM-01a`, `SM-35a`, `SM-44`, `SM-76` |
| P10 | **A spec that cannot be implemented should say so.** A check that has not run is not reported as passing; a gap is recorded as a gap | `SM-75a` |

### 1.2 What the principles are for

P1–P3 exist because the two hardest requirements in this system are **offline sync** and **per-store isolation**,
and both are failures of trust. P5 exists because Phase 0 found that the reference implementations make audit logs
un-retrofit-able — they lack the columns, so the history cannot be reconstructed later. P8 exists because a
vocabulary that grows silently stops being a vocabulary.

### 1.3 Explicit non-goals for Phase 2

- **No code, no DDL, no directory layout.** This document is architecture. Schema design is Phase 3.
- **No re-decision of the stack.** Phase 0 §4 fixed it on the evidence; §28.1 records the adoption.
- **No microservices.** See §3.3 and `ADR-02`.
- **No selection of the Q2 licence.** That is a legal answer, not an architecture one. The **use** is decided
  (D-10: sold/commercial); naming and clearing the licence stays with the owner and counsel, recorded as a release
  gate in §26.4, not resolved here.

### 1.4 Principles vs open decisions — the boundary

Three of Phase 1's questions are **not** principle questions and this document does not answer them:

| Question | Why it is not an architecture call | Where it lands |
|---|---|---|
| **Q1** central-warehouse attribution | One physical location carrying several store attributions is a schema shape. §9 and §23 are written to hold either answer | §28.3, gate `GATE-Q1` |
| **Payable creation timing** (`Matched` vs `ApprovedForPayment`) | A business fact about when a liability begins | §28.3, gate `GATE-PAYABLE` |
| **13 undefined permission keys** | Who may write is an access-control decision | §8.5, §28.3, gate `GATE-PERMKEYS` |

**Rule for this document:** where a section needs one of these to be settled, it declares a gate and describes both
outcomes. It does not pick the more convenient one.

---

## 2. System boundaries

### 2.1 What SmartStore is

A **modular monolith with an offline-capable edge**. One central server application, one database, and a local
client tier per till that keeps selling when the network does not.

### 2.2 Boundary diagram

```
                    ┌──────────────────────────────────────────┐
   STAFF  ─────────▶│  TILL CLIENT (edge tier, per terminal)   │
                    │  local durable store + outbox queue      │
                    │  idempotency keys, per-device sequence   │
                    │  hardware drivers (local)                │
                    └───────┬──────────────────────┬───────────┘
                            │ sync (durable)        │ device I/O
                            ▼                      ▼
   MANAGER ──────────▶┌──────────────────────┐   ┌──────────────────┐
   BACK-OFFICE        │  APPLICATION CORE    │   │  DEVICE LAYER    │
                      │  (modular monolith)  │◀──│  EscPos, Scanner,│
                      │                      │   │  Scale, LLRP RFID│
                      └──────┬───────────────┘   └──────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌────────────┐  ┌──────────────┐
        │RELATIONAL│  │  AUDIT LOG │  │  FILE STORE  │
        │   DB     │  │ (in-txn)   │  │ (receipts,   │
        │          │  │            │  │  imports)    │
        └──────────┘  └────────────┘  └──────────────┘
              ▲
              │ out-of-band, NOT in the transaction
        ┌─────┴──────────┐        ┌─────────────────┐
        │PAYMENT PROVIDER│        │ EMAIL / SMS     │
        └────────────────┘        └─────────────────┘
```

### 2.3 In scope, out of scope

| In scope | Out of scope (v1) | Authority |
|---|---|---|
| Catalog, pricing, inventory, batch/FEFO | Pharmacy, dispensing, controlled substances | `EC-91`, Q5 |
| Purchasing, GRN, invoices, three-way match | Supplier self-service portal | Phase 1 scope |
| Sales, returns, refunds, customers, credit | Dunning / automatic escalation | `CON-06`, Q4, `EC-65` |
| Shifts, cash, payments, loyalty | Multi-currency calculation engines (mechanism only) | Q3 |
| RFID read events, attendance, credentials | RFID as an authorization mechanism — **never** | `CON-04`, `RF-01` |
| Offline POS and sync | | `OF-29` |
| Audit and reporting | | `AU-03` |

### 2.4 The three boundaries that are load-bearing

1. **Till client ↔ server.** The only boundary where a client acts without server authority. Everything about
   idempotency, ordering, and attribution lives here (§11).
2. **Domain core ↔ persistence.** The domain core has no I/O and no framework. This is what makes P6 testable: if
   the domain cannot write, then a missing store predicate is a data-layer bug, not a domain bug (§6, §9).
3. **Application ↔ devices and payment providers.** Hard boundary at the transaction edge, forced by `CON-05` (§12,
   §13).

---

## 3. Logical architecture

### 3.1 Four layers

| Layer | Contains | May depend on |
|---|---|---|
| **Presentation** | Back-office UI, POS terminal UI, staff self-service | Application layer only |
| **Application** | Use cases, one per capability; DTO in/out; transaction boundary; authorization check | Domain core, persistence, integrations |
| **Domain core** | Entities, value objects, domain services. **No I/O, no ORM, no framework** | Nothing |
| **Persistence + Integrations** | Repositories, data-layer predicates; device and provider drivers | Domain core |

### 3.2 Why the domain core is pure

It is not purity for its own sake. Three requirements cannot be verified by inspection and can only be verified by
structure: the negative-stock checks must evaluate **inside** the business transaction, money must be integer
**everywhere** including intermediate calculations, and the movement ledger must be the only writer of stock
balances. If the domain core can call out to a repository or a framework, a future contributor will put a balance
write there and P4/P5 silently stop holding. The layering is the enforcement mechanism.

### 3.3 Modular monolith, not microservices — `ADR-02`

Stock is a **single-writer, correctness-critical aggregate**, and the three hardest requirements (offline sync,
per-store isolation, transactional inventory) are all requirements to keep *one* database consistent.
Microservices move that consistency problem into inter-service calls without removing it, and they add a network
hop to the one path where a partial failure is most expensive.

Split by **module inside one deployable**. Extract a service only when a specific module proves it needs independent
scaling. The one credible candidate is **RFID event ingestion** — it is the only genuinely asynchronous,
high-volume workload in the system. Recorded as a future option, not a plan.

### 3.4 Module map

| Module | Owns | Notes |
|---|---|---|
| Identity & Access | employees, roles, role assignments, sessions, permission checks | §7, §8 |
| Catalog | product, variant, barcode, price, category, supplier product | §6.1 |
| Inventory | locations, stock items, **movement ledger**, balances | §9 |
| Batch & FEFO | batches, expiry windows, FEFO selection, overrides | §9.5 |
| Purchasing | requisition, PO, GRN, supplier invoice, three-way match, payment run | §6.3 |
| Sales | cart, sale, hold/suspend, exchange, till operations | §10 |
| Returns | return, inspection, disposition, refund | §10.6 |
| Customers | customer, credit ledger, loyalty ledger | §6.4 |
| Suppliers | supplier, payable ledger, statements | §6.3 |
| Payments | tender, split tender, provider interaction, refunds | §13 |
| Cash | shift, drawer, float, variance, reconciliation | §6.5 |
| Devices | terminals, scanners, printers, scales, RFID readers, credentials | §12 |
| Sync | ingest, idempotency, conflict resolution, dead-lettering | §11 |
| Approvals | thresholds, request, decision, two-person rules | §6.6 |
| Audit | append-only audit entries | §14 |
| Notifications | notification events and delivery | §15 |
| Reporting | report catalogue, as-of semantics, export | §16 |

---

## 4. Backend architecture

### 4.1 Runtime shape

One application server process family, stateless except for the database. No in-process mutable session state, so
horizontal scaling behind a load balancer is a configuration change. This is a deliberate constraint: POS traffic
is bursty (opening hours) and the server must scale without a deploy.

### 4.2 Stack — adopted, not re-decided

From [../repository-analysis/foundation-recommendation.md](../repository-analysis/foundation-recommendation.md) §4.
The phase-0 reasoning was that **no candidate repository's stack is favored, because the domain gaps exceed what
any of them demonstrate**; the stack is therefore chosen on its own merits, against two hard requirements —
**integer money** and **strong transactional integrity**.

| Concern | Choice | Why this and not the alternative |
|---|---|---|
| Central store | **PostgreSQL** | Transactional integrity, `SELECT … FOR UPDATE`, strict decimal, robust indexing. SQLite-as-server rejected: the offline tier already covers edge cases locally, and the server should be a real client/server engine |
| Application | A mature framework with a first-class migration story | The migration story is the requirement, not the language. No framework is named in this document; picking one is an implementation decision that must first satisfy §21 and §22 |
| Auth | Server-side **sessions**, httpOnly + secure + sameSite, rotated on login and on privilege change | Long-lived JWT is the cautionary tale: one reference used a 30-day TTL, and `isActive` must be re-checked per request regardless |
| Password hashing | Argon2id or bcrypt ≥ 12 | No unsalted single-pass SHA-256 |
| Money | Integer minor units | Never float |
| Real-time | Server-sent events or WebSockets | **Not polling.** Two reference implementations poll for health (5s and 15s); that is the anti-pattern |
| Edge store | Local durable store (IndexedDB or SQLite) + service worker | The one piece no reference repository provides |
| Hardware | Barcode/RFID libraries chosen directly and permissively; RFID implemented from the **EPCglobal LLRP v1.0.1** specification | Permissive licensing is a hard requirement, not a preference |

### 4.3 Module-to-deployable mapping

One deployable. Modules communicate **in-process, through explicit interfaces only**. Two rules make this hold:

- **No module reaches into another module's tables.** Cross-module reads go through the owning module's interface.
- **No module's repository is shared.** If two modules need the same data, one of them owns it.

These are the rules that keep a modular monolith from becoming a distributed monolith with worse latency.

### 4.4 What the backend does *not* do

- It does not trust a client total, a client clock, or a client permission claim (P1, §7.5).
- It does not call a payment provider or a device inside a transaction (§21.4).
- It does not write a stock balance without a movement row in the same transaction (§9.2).

---

## 5. Frontend architecture

### 5.1 Three surfaces, one design system

| Surface | Users | Connectivity | Priority |
|---|---|---|---|
| **Back-office** | Managers, accountants, buyers | Online assumed | Usability, density, reporting |
| **POS terminal** | Cashiers | **Must work offline** | Speed, reliability, offline correctness |
| **Staff self-service** | Employees | Mobile, intermittent | Simple, tap-first |

### 5.2 The POS terminal is a different application

It is not the back-office with a smaller viewport. It is a **local-first application** with its own durable store,
its own outbox, and its own hardware drivers, because it must complete a sale when the network is down and the
back-office has no such obligation. Treating it as a mode of the same app is how offline correctness gets lost.

Its hard requirements: a sale completes locally within a bounded time regardless of connectivity; a failed network
never loses a completed sale; and every local mutation is queued with an idempotency key the moment it commits
(§11.2).

### 5.3 Rendering and state

A component-based client with server state and local state kept **separately and explicitly**. Concretely, this
means the same discipline as §9.4: cached server state is labelled as a cache with a named owner and an invalidation
path, never as authoritative local state. A till that treats a stale price list as truth is a pricing defect with a
customer standing in front of it.

### 5.4 Accessibility is not optional

Keyboard operation, visible focus, sufficient contrast, and non-color-only status signalling are baseline
requirements for the POS and self-service surfaces, not a phase. A cashier using a scanner wedge and a keyboard
must never be blocked by a focus trap. Concretely, every touch or tap target in the POS flow needs an equivalent
keyboard path, because a scanner is a keyboard.

---

## 6. Domain/module boundaries

### 6.1 The boundary test

Two entities are in the same module if they change in the same transaction **and** are invalid apart from one
another. If they can be independently invalid, they are separate modules with an interface between them.

### 6.2 Module dependency rules

```
  Identity&Access   Approvals    Notification    Reporting     Devices
        │               │            │              │             │
        └───────────────┴────────────┴──────────────┴─────────────┘
                                    │
   Catalog ◄── Inventory ◄── Purchasing      Sales ◄── Returns
                   ▲              ▲             │          │
                   └──────── Customers ─────────┴── Suppliers
                                    │
                            Payments,  Cash
```

- Dependencies point **downward and inward** only. Nothing depends on Presentation.
- `Inventory` depends on `Catalog` (a variant must exist) and on `Devices` (a reader location is a location), never
  the reverse.
- `Catalog` depends on **nobody**. A product can be created with no stock, no supplier, no sale.

### 6.3 The two boundary calls worth stating

**Catalog vs Inventory.** A `ProductVariant` is catalog; its stock is inventory, identified by variant **and**
location (`MS-17`). A price is catalog and *snapshotted* onto the transaction line — because a sale's price is a
historical fact, not a live lookup (§9.6). This is why the module boundary is drawn at "what a sale freezes", not
at "what is related".

**Purchasing vs Suppliers vs Inventory.** A GRN **creates stock** (inventory). A supplier invoice creates a
**payable** (suppliers). Neither creates the other, and a three-way match reads both without either module reaching
into the other. `PR-Q06a` fixes the corollary: a PO is never deleted in any state, including `Draft`.

### 6.4 Customers vs Credit vs Loyalty

One module, three ledgers, all append-only: `credit_ledger` and `loyalty_ledger` are ledgers, and the balance is a
**projection** of them (`SM-44`, `SU-09` for suppliers). In v1 a credit balance has **no due date**, so there is no
`CreditOverdue` event and no dunning state (`CON-06`). See §29 for the `EC-65` consequence.

### 6.5 Cash is not Sales

A shift is a cash-control object with its own lifecycle and its own variance rules (`CD-26`); a sale is a
transaction. They share a till but not a lifecycle. Folding shift state into the sale machine is how "the drawer
must be counted at close" turns into "each sale must be closed".

### 6.6 Approvals is infrastructure, not a feature

`ApprovalRequest` is the one state machine that was already conformant at the start of Phase 2. It is a
**cross-cutting service** (thresholds, request, decision, two-person separation) that domain modules call. It does
not own business data; it references a subject id and a subject permission (`RT-344`, `AP-10`).

---

## 7. Authentication architecture

### 7.1 Mechanism

**Server-side sessions.** httpOnly, secure, sameSite cookies. The session identifier is opaque and server-held.
Rotated on login and on **any privilege change** — a role assignment, a store-access grant, a suspension, or a
deactivation must invalidate the previous session identifier.

### 7.2 Why not JWT for auth

A self-contained token cannot be revoked before it expires. This system has immediate-deactivation requirements
(`AC-01`, P2) and a documented caution: one reference implementation used a 30-day token TTL. Even if a token were
short-lived with refresh, `isActive` and the current role set must be re-read on every authenticated request —
at which point the server is already doing a lookup, and the stateless benefit is gone while the revocation risk
remains. A short-lived token is acceptable for **read-only** internal service calls, and that is the only carve-out.

### 7.3 Password storage

Argon2id or bcrypt with a cost factor of at least 12, per-user salt, and a rehash-on-login path so the cost factor
can be raised without a forced reset.

### 7.4 Terminal and device identity

A terminal is **not** an authenticated user. It is a device with its own credential pair and a distinct identity in
the audit trail, so a synced transaction is attributable to the terminal that created it (§11.5). A device
credential authenticates the *device*; it never authenticates a person and never grants a business permission
(P2, `CON-04`).

### 7.5 Server-side re-check on every request

`AC-03` is absolute: the check runs in the application layer on every request, and a client-supplied claim is
discarded. Specifically re-evaluated per request: is the employee active, is the session valid, which roles are
currently assigned, which stores are in scope. A session outliving a suspension is the defect this prevents.

### 7.6 Open: session revocation semantics

Phase 1 finding gap 9 (`EC-45`, role-assignment removal, suspension, and store-access revocation each handled
differently) is **`REPORTED — NOT INDEPENDENTLY VERIFIED`**. It is recorded here as an unresolved area and is
**not** built on. Nothing in §7.3–§7.5 depends on which way it resolves: all three re-checks run per request
regardless. What is genuinely undecided is only the **UX** of revocation — immediate sign-out versus
next-request refusal, and the 60-second window one rule mentions.

---

## 8. Authorization / RBAC architecture

### 8.1 The model

Explicit, database-backed, named roles with grants. Permissions are **opaque dotted strings matched for equality**
(`AC-02`) — no prefix, substring, or wildcard matching at runtime. The `(store, module, action)` shape from Phase 0
is realized as a grant row; role *templates* (`actors-and-roles.md` §4) are starting points, and custom roles are
permitted.

### 8.2 One enforcement point

Every authenticated request passes through a single authorization gate in the application layer (`AC-03`). There is
no code path that skips it, and there is no fallback policy that allows access. If the gate cannot decide — database
unreachable, permission table missing — the request is **refused**, not allowed.

### 8.3 Least privilege by default

No template grants a permission unless a named retail responsibility requires it (`AC-04`). "It might be useful
later" is not a justification. The consequence is visible in the catalogue: the Super Administrator template is
**excluded** from `Sale.Create`, `Purchase.Pay`, `Customer.Credit.Approve`, and the large-approval permissions.
Administration is separated from money approval (`SEP-02`).

### 8.4 Enforcement relative to state transitions

This is the architectural consequence of Phase 1 defect 13 and it is the important part of this section.

A transition's permission is a property of the **transition**, and it is named in the specification's transition
contract. The architectural rule is therefore:

> The authorization gate evaluates the permission named by the transition the request attempts. The permission
> comes from the specification, not from the endpoint's URL, the request body, or the role template.

So `POST /transitions` with `{ transition: "Approve", subject: "PO-1" }` is authorized by looking up what `Approve`
requires for that machine — rather than by an endpoint author remembering to add a check. The mapping from
transition name to required permission is a **single table**, and that table is exactly the §22 Permission column.

**Gate `GATE-PERMKEYS`.** 13 of the keys in that table are **not defined** in the access model's catalogue, across
29 transitions in 8 machines: `Product.Edit`, `Purchase.Order.Submit`, `Purchase.Order.Approve`,
`Purchase.Order.Send`, `Customer.Edit`, `Employee.Create`, `Employee.Edit`, `Device.Register`, `Device.Edit`,
`Device.Disable`, `Shift.Close`, `Inventory.Count.Post`, `Inventory.Transfer.Receive`. Those transitions **cannot be
authorized**, because there is no permission to check. This is not a bug to work around by reusing a near
neighbour: `Product.Edit` is not `Product.View`, and a fallback that widens a permission to a read to make a write
work is a security regression. **The affected transitions must refuse until the keys are decided.**

The gap is shaped, not arbitrary: the catalogue has read and approve permissions for most of these edges and **not
the write**.

### 8.5 The Actor attribute, architecturally

Phase 1 recorded that actor is defined by rule rather than enumerated per row, because a permission is held by
several role templates. The architectural consequence: **authorization resolves a role, not a named person.** A user
with `Product.Edit` through any template may activate a product. Audit records the **person and the role they used**,
so "who was allowed to do this" is answerable later by re-deriving the grant set as it stood at the time.

### 8.6 Two-person and separation rules

Where a rule requires a second person — approver ≠ requester (`AP-10`, `SEP-07`), attendance correction filed and
approved by different people — the check is a **data** constraint on the decision (the requester's identity is
compared to the decider's), not a UI affordance. A UI that disables a button is not a separation-of-duties control.

### 8.7 Store scoping is part of authorization

Store scope and permission are the same decision: a grant is evaluated against `(permission, store)`, and the store
predicate is applied in the data layer (§23.2). A user with `Inventory.View` at Store A has no path to Store B's
rows, regardless of what the API returns.

---

## 9. Inventory ledger architecture

**This is the correctness core of the system.** Everything else is recoverable; an inventory ledger that lies is not.

### 9.1 Two structures, one truth

| Structure | Role | Writable by |
|---|---|---|
| `inventory_movements` | **Append-only ledger. The source of truth** | Only the movement-recording path |
| `stock_balances(variant, location, on_hand)` | Continuously reconciled **cache** | Only the movement-recording path, in the same transaction |

Stock is never stored as a column on a product. A balance is never set absolutely — a balance changes only by a
signed delta against a movement row.

### 9.2 The write path

Every mutation of stock, without exception, executes one sequence in **one transaction**:

1. Lock the balance row: `SELECT … FOR UPDATE`.
2. Validate: non-negative policy, batch sellability, FEFO selection, reservation ownership.
3. Insert the movement row (signed delta, explicit type, actor, terminal, correlation id, reason).
4. Update the balance by the same delta.
5. Write any audit entry required by the transition contract.

If step 3 fails, step 4 does not happen. If step 4 fails, step 3 rolls back. **There is no code path that updates a
balance alone** — that is what makes the reconciliation job in §9.4 a check rather than a repair.

### 9.3 Movement types are explicit

`RECEIPT`, `SALE`, `RETURN`, `ADJUSTMENT`, `COUNT_VARIANCE`, `TRANSFER_IN`, `TRANSFER_OUT`, `RESERVATION`,
`RELEASE`. Direction is a signed delta, never implied by the type name and never explained in a comment column.

### 9.4 Reconciliation, and it alerts

A job verifies `SUM(movements) == balance` per `(variant, location)` and **raises an alert on drift**. It does not
repair, and it never overwrites the balance. This is deliberate: one reference implementation detects drift and then
silently overwrites the balance, which destroys the evidence that the drift happened.

**Gate.** The balance is a projection (P9, `SM-01a`, `SM-44`). Its rebuild path must be specified alongside the
cache definition, not after. `SM-35a` is the precedent for how this is done for the sale-status cache.

### 9.5 Batches, FEFO, and expiry

Batch state (`Active`, `Quarantined`, `Blocked`, `Depleted`, `Expired`) is evaluated at issue time, and expiry is a
**business-date** check at a defined boundary rather than a wall-clock cron. FEFO selection is deterministic given
the same inputs. A non-FEFO issue is an **override**: it requires a reason always, its own permission
(`Inventory.FEFO.Override`), and its own audit event.

`Quarantined` and `Blocked` have **no permission key in the catalogue at all** — the nearest are `Inventory.Adjust`
and `Inventory.FEFO.Override`, and neither is a quarantine. Those three edges refuse until the key is decided
(`GATE-PERMKEYS`).

### 9.6 Frozen snapshots

Every sale, receipt, and return line **freezes** cost price, unit price, discount, and lot/serial. A historical
margin computed from a live price lookup is wrong the moment the price changes; retrofitting snapshots onto an
existing ledger is a rewrite, so they are in the schema from the first migration.

### 9.7 Reservations

Reserved stock is a movement type, not a boolean on the balance. Holds and offline carts hold stock; the reservation
is released by another movement. This is what lets `on_hand` stay a single honest number and lets "available"
be derived as `on_hand − reserved`.

---

## 10. POS architecture

### 10.1 Sale is server-authoritative

The client builds a **cart**; the server computes the sale. Price, discount eligibility, tax, tender allocation,
stock availability, and loyalty are all decided server-side (P1). A client-supplied total is discarded, and a
mismatched total is a **client defect to surface**, not a rounding difference to absorb.

### 10.2 The sale's own state is a cache

`SP-66` resolves it correctly: a sale's status is **derived from its line counters, and the stored status is a
cache** of them. The counter is authoritative. The cache exists so a till list does not aggregate a thousand rows
per row, and it is rebuildable (`SM-35a`).

### 10.3 Holding and suspending

A held cart reserves stock (`Inventory.Reservation.Manage`) and expires on a rule the specification states rather
than by chance. Suspending is distinct from holding: a suspended cart keeps its identity and its reservation, and
the rules must say what happens to it across a session end.

**Open.** §8.6 of the Phase 1 review notes the `REPORTED` finding that a price change on an open unsuspended cart is
undefined. Not built on. The architectural provision for it: the cart re-validates prices at completion and **fails
loudly** rather than completing at a stale price, because silently completing is the worse failure.

### 10.4 Duplicate sale is prevented by key, not by luck

Every sale carries a client operation id. A repeated submit with the same id returns the original sale. This is the
mechanism that makes a double-tap, a retry, and a queued-then-resynced transaction all safe.

### 10.5 Split tender

Payments are one-to-many against a sale: `(sale, tender_type, amount, reference)`. Split tender and
multi-tender refund fall out of that shape. A single payment-method string on the sale — as one reference
implementation does — makes both impossible.

### 10.6 Returns are capped and idempotent

A return is capped against the **remaining returnable quantity** and is **idempotent**. Both are required: replayed
return requests are a confirmed attack in one of the reference implementations, and an uncapped return is a
giveaway.

### 10.7 Void is a compensating document

A sale that is not yet finalized may be voided (`Sale.Void`). A **posted** sale may only be voided with approval
(`Sale.Void.Posted.Approve`), and the result is a **compensating document, never a delete** (`P5`, `BI-08`).

---

## 11. Offline / sync architecture

**No reference repository has this.** It is designed from first principles, and it is settled here because it
determines idempotency, sequence, and attribution columns — which is why it must be decided before the schema is
frozen.

### 11.1 Edge tier

Each till holds a **local durable store** and an **append-only outbox** of financial mutations. Every queued
mutation carries:

| Field | Purpose |
|---|---|
| `ClientOperationId` | Idempotency. The server returns the first result for a repeat (`SM-04`) |
| `DeviceSequence` | Monotonic per terminal. Gives a total order the server can trust |
| `TerminalId` | Attribution — which till created this |
| `RequestId` / correlation id | Attribution in the audit trail |
| Business payload | The intent. **Never** a client-computed total |

The device clock is **never** used for a business timestamp. Server-assigned time and sequence are what survive
out-of-order and delayed arrival.

### 11.2 Sync is durable, resumable, ordered

- The queue is **persistent**; a terminal that loses power mid-sale has the mutation on disk.
- Sync is **resumable** from the last acknowledged device sequence, not from a page offset.
- Sync is **ordered per device**, because the outbox is a sequence, and reordering a sale from a till changes its
  meaning.
- Sync is **batched but bounded**, and a failed item does not block the rest of the batch — it is retried or
  dead-lettered (§11.6).

### 11.3 The server is idempotent on the key

A repeat of a `ClientOperationId` returns the **original result** and performs no side effect: no second movement
row, no second audit entry, no second loyalty credit. This is what makes retry safe and is why the unique index on
the key is checked **before** side effects, not after.

### 11.4 Conflict resolution is per entity type, and inventory is the hard case

Two terminals selling the last unit while both are offline is a real, unavoidable race. The server needs a defined
rule, and **the choice is a product decision with a hard schema consequence** — it is not an implementation detail
and it is not decided in this document.

Two viable shapes:

| Option | Mechanism | Schema consequence |
|---|---|---|
| **A. Server-side reservation** | A reservation is taken when the offline sale is created; sync confirms or rejects | Requires a reservation lifecycle that survives offline, per terminal, with expiry. Changes `StockItem` and the reservation model |
| **B. Allow-and-reconcile** | Both sales apply; the second goes negative under `AllowNegative` and a variance record is raised | Requires the negative-stock policy to be authoritative and a reconciliation report that is a **business artifact**, not a log line |

Either is implementable. **They are not compatible**, and choosing later after the schema is frozen means a
migration. `GATE-OFFLINE-INVENTORY`.

Note the interaction with Q1 (`MS-16`/`MS-19`): attribution of a synced movement to a store is unresolved, and the
offline attribution column depends on that answer. **Q1 and this gate are the same decision, viewed twice.**

### 11.5 Attribution survives sync

A synced transaction is attributable to the originating terminal and request id in the audit trail. This is the gap
that makes one reference implementation's missing audit log permanently unfixable: without the columns, the
question "which till rang this sale" cannot be answered after the fact.

### 11.6 Dead-lettering — `GATE-DEADLETTER`

`OF-29` is emphatic: every synced transaction ends in exactly one of **exactly three** states, and there is no
fourth. `state-machines.md` reconciles its `DeadLetter` state as **client-side retention**, reached by exhausting
retries. **Owner decision D-07 (2026-09-29): `DeadLetter` remains client-only.** The server never observes a
dead-letter status in v1; its result vocabulary stays exactly `Applied`, `AppliedWithAdjustment`, `Rejected`;
`OF-29` is not modified; and no server-side `DeadLetter` status is added for operational convenience.

Architecture, decided: an outbox item that exhausts its retry budget moves to a local dead-letter state, **stays
visible to the operator**, and is never silently dropped. **Implementation must not invent a fourth server
outcome.** A client that exhausts retries keeps the item locally in the client-side `DeadLetter` retention state;
the server-side transaction is unaffected. The client-side retention transition records **no** server business
audit event (D-06/D-07).

### 11.7 Observability from day one

Queue depth, oldest unacknowledged item, sync latency, per-outcome counts, and dead-letter count. Two reference
implementations have no observability at all, which is how a silently stuck till stays stuck.

---

## 12. Hardware abstraction architecture

### 12.1 Driver interfaces

Every device is behind an interface, so each is swappable and testable without hardware:

| Interface | Implementations | Notes |
|---|---|---|
| `ReceiptPrinter` | ESC/POS (USB/network), browser print | Browser print is not a fallback for a kiosk — a headless kiosk hangs on the print dialog after every sale |
| `BarcodeScanner` | Keyboard-wedge, camera | One interface over both; the wedge is what most scanners actually are |
| `Scale` | `PeripheralDriver` | Greenfield |
| `RfidReader` | `LlrpReaderService` — Zebra FX9600 | Clean-room from **EPCglobal LLRP v1.0.1** |
| `Esp32Device` | `PeripheralDriver` | Greenfield; no reference implementation has ESP32 |

### 12.2 RFID reader service

**Persistent connection plus a background event service.** Not a request-scoped sleep-then-disconnect, and not a
5-second audit poll — both were found in reference implementations and both are the anti-pattern. Every response
status is checked, and `resetToFactory` is never called per read.

**Reader addresses come from server configuration, never from request data** (`CON-04` territory, and a confirmed
finding in Phase 0). Resolved addresses are allowlisted and link-local ranges are rejected — otherwise a read
endpoint is an SSRF primitive.

### 12.3 Device identity and health

A device has its own identity and health lifecycle, separate from its **mode**. A till in `Training` mode is a
*configuration* of a working terminal, not a health state. Keeping the two apart matters: mode is operator intent,
health is machine condition, and conflating them means a terminal in training cannot report a fault.

Device state transitions in the transition contract use permission keys (`Device.Edit`, `Device.Register`,
`Device.Disable`) that **are not in the access-model catalogue** — `GATE-PERMKEYS`.

### 12.4 RFID never authorizes

A tag proves **who is holding it**, not what they may do (`CON-04`, `RF-01`). A badge tap can open a shift, approve
a void within an existing permission, or punch attendance — each of which still passes the normal authorization gate
in §8.2. An RFID read is an **input to** an authorization decision, never the decision. This is the single most
important rule in this section, because a reader that grants access is an unauthenticated door.

### 12.5 Hardware I/O is outside the transaction

Device calls happen before or after the business transaction (`CON-05`). A printer that fails does not roll back a
sale; the sale is committed and the print is retried or queued. The reverse also holds: nothing prints before the
transaction commits.

---

## 13. Payment abstraction

### 13.1 Provider behind an interface

`PaymentGateway` is an interface with a provider implementation per acquirer. The application depends on the
interface, so a provider change is not a domain change.

### 13.2 Provider I/O is never inside the transaction

`CON-05` is the reason: a network call inside a transaction holds locks and cannot be rolled back. The sequence is:

1. Begin transaction, create the payment in `Pending`, commit.
2. Call the provider **outside** the transaction.
3. Begin a second transaction, record the provider result, commit.

A crash between 2 and 3 leaves a `Pending` payment, which a **reconciliation job** resolves by querying the
provider. `Pending` is therefore a real state with a real owner, not an error code — the Phase 1 payment machine
already models it as a non-terminal state.

### 13.3 Payment retry is idempotent

Every provider call carries a merchant-side reference derived from the payment id, so a retry after a timeout does
not double-charge. The same idempotency discipline as §11.3, applied to the provider call instead of the queue.

### 13.4 Money crosses the boundary as integer minor units

The provider adapter converts to the provider's minor-unit convention at the edge and back, and the conversion is
exact. Rounding happens in the domain, once, with a stated rule — never in the adapter and never twice.

### 13.5 Refunds are compensating records

A refund is a new payment record against the original, not a mutation of it (`P5`, `BI-08`). Multi-tender refunds
follow from the one-to-many payment shape (§10.5).

### 13.6 Provider configuration is the highest-privilege permission

`Payment.Provider.Configure` is called out in the access model as the highest-privilege operational permission. It
is audited like a permission change (`AU-03` floor), and the architectural note is that it is the one permission
whose compromise is worth more than a till's float.

---

## 14. Audit architecture

### 14.1 Append-only, in-transaction, immutable

Three properties, all required:

- **Append-only** — no update, no delete, ever (`BI-24`).
- **In-transaction** — the audit entry is written in the same transaction as the business change. An audit written
  after commit is missing exactly the entries you need: the ones where the transaction failed halfway.
- **DB-immutable** — enforced at the database, not only by application convention. Revoke `UPDATE` and `DELETE` on
  the table from the application role. This is the only enforcement that survives a bug in the application.

### 14.2 What must be audited

The `AU-03` mandatory floor: authentication success/failure/logout, **every permission change**, and **every
payment state change**, plus every event type in the closed `AU-12` vocabulary that a transition contract names.
Each entry carries actor, role-as-used, store, terminal, request/correlation id, IP, timestamp (server-assigned),
and the reason when the rule requires one.

### 14.3 The vocabulary is closed, and it is now complete for the floor

`AU-11` closes the set and `AU-13` makes adding a type a reviewed schema change. Phase 1 found five mandated events
with no type and added them (`AU-12b`): `Inventory.FEFOOverride`, `Offline.SyncAppliedWithAdjustment`,
`Product.Archive`, `Employee.Terminate`, `Audit.EventExpired`. Owner decision D-06 then closed the transition
contract's audit cells with twenty per-machine types (e.g. `Product.StateChange`, `Payment.StateChange`,
`Purchase.PayableCreated`, `Rfid.Credential.StateChange` — see `OWNER-DECISIONS.md` D-06).

**The floor is covered and was not weakened, and the transition contract is now decided.** The offline
`DeadLetter` edge resolved to `—` by owner decision D-07 (client-side retention, not a server business event), so
**no `OPEN DECISION` audit cell remains**. Architectural rule: **no audit entry is written with a free-text or
placeholder event type.** A type added after the audit table ships is the `AU-13` schema change.

### 14.4 Retention and expiry are themselves audited

`Audit.EventExpired` exists because expiry is a data-destroying event, and destroying evidence must be a recorded,
attributable decision rather than a scheduled job that silently truncates a table. Retention length is a
configuration value; the audit of the expiry is not optional.

### 14.5 Audit is not a reporting store

Reports read from business tables and projections. The audit log is queried for investigations through its own
read path (`Audit.View`, with a separate `Audit.View.Sensitive` for security events). Mixing them would let a report
optimization become an audit-surface change, and would couple retention to report performance.

---

## 15. Notification architecture

### 15.1 Outbox, not inline sends

A notification is written to an **outbox in the same transaction** as the triggering business change, then delivered
asynchronously by a worker. Sending inside the transaction makes an SMTP timeout a rolled-back sale, which is the
clearest possible violation of `CON-05`.

### 15.2 The vocabulary is closed too

`NT-04` closes the notification event set, and `CON-06` is the precedent for refusing to add an event: a customer
credit balance has no due date in v1, so there is **no** `CreditOverdue` event. An event type with nothing behind it
is worse than an absent one, and adding one to satisfy a report is how a vocabulary rots.

### 15.3 Delivery is best-effort; the record is not

Delivery failure does not fail the business transaction. But the **notification record** (that it was requested, by
whom, for what subject) is part of the business record and is durable. Retry with backoff; a permanently failing
channel is an operator-visible condition.

### 15.4 Routing is configuration

`Config.NotificationRule` manages routing. Adding a recipient is a setting; adding an event *type* is a schema
change (`NT-04`).

### 15.5 The notification state machine is now owned

Phase 1 recorded that `Notification`'s state set (`Unread`, `Read`, `Acknowledged`) was the consolidated document's
own vocabulary with no owner state list, and that read/acknowledge permissions and audit types were `OPEN
DECISION`. **Owner decision D-08 (2026-09-29) closed this:** the three names are confirmed and are now enumerated
by the owning document (`notification-domain.md` §7), with expiry outside the machine (NT-30) and `Read`/
`Acknowledged` independent (NT-28, SM-72, RT-324). Architecturally the shape is small — a record, a recipient, a
read timestamp, an acknowledgement. The read/acknowledge **audit** question is also closed: reads and
acknowledgements are not audited (AU-14, D-06), which is why "acknowledged" carries no audit obligation.

---

## 16. Reporting architecture

### 16.1 Read from projections, not from the ledger

Reports read materialized views and balance projections. Reading an append-only ledger per report is O(history)
and makes the ledger a performance dependency. The ledger stays authoritative; the projection is refreshed and
rebuildable (§9.4 pattern).

### 16.2 As-of semantics are explicit

Every report declares whether it is **as-of-now** or **as-of a timestamp**, and a report that claims a historical
figure names the projection that reconstructs it. A report whose date semantics are unstated is the class of defect
that makes a financial statement untrustworthy.

### 16.3 Cost and margin are separate permissions

`Report.Financial` (margin, cost, financial reports) is deliberately distinct from `Report.View`, and
`Product.Cost.View` is distinct from `Product.View`. This is a design choice, not a convenience: a cashier who can
see cost can infer margin, and a store that can see another store's margin has information it should not.

### 16.4 Export is a permission and an audited action

`Report.Export` is separate from `Report.View` because export leaves the system. Exports are audited, and customer
data export uses the distinct `Customer.DataExport` permission for the same reason — it is a privacy action, not a
reporting action.

---

## 17. File / storage architecture

### 17.1 What is stored as a file

| Content | Why not a column | Authority |
|---|---|---|
| Receipt / invoice PDFs | Size, and regenerated formatting | Phase 0 |
| Product images | Size and format handling | — |
| Import files (catalog, stock count) | Bulk, and may be large | — |
| Exports | Generated, not authoritative | §16.4 |

### 17.2 Documents are references, not blobs

A finalized document's **data** lives in relational columns; a rendered PDF is a derived artifact addressed by
document id. The document is the record; the PDF is one rendering of it. This preserves P5: a re-rendered receipt
does not change history, and a lost PDF is regenerated.

### 17.3 Storage is behind an interface

`FileStore` is an interface with a local-filesystem implementation and an object-store implementation. Nothing in the
domain names a path or a bucket.

### 17.4 Retention

`Config.Backup` and the retention rules are configuration. Destructive retention events are audited (§14.4), and
**no retention job deletes a finalized document referenced by another document** — `BI-41` (a document with a child
document cannot be deleted or cancelled out of order) applies to files as much as rows.

---

## 18. API architecture

### 18.1 Two API surfaces, not one

| Surface | Consumers | Style |
|---|---|---|
| **Back-office API** | Web clients | Resource-oriented HTTP/JSON |
| **Transition API** | POS, mobile, sync | `POST /transitions` with `{ machine, transition, subject, payload, ClientOperationId }` |

The split is not aesthetic. §8.4 requires that the permission checked is the one the **transition** names, and that
cannot be derived from a REST resource path. One generic transition endpoint with a single authorization table is
what makes that rule enforceable; a forest of bespoke endpoints makes it a per-endpoint memory test.

### 18.2 Every mutating request carries a client operation id

Required on all financial and state-changing requests (`SM-04`). The server checks the key **before** side effects and
returns the original result on a repeat.

### 18.3 No state-changing GET

Every mutation is a non-GET verb. Confirmed finding in Phase 0: six unauthenticated deletions in one reference
implementation were `GET` requests. A crawler, a prefetcher, or a link scanner would have triggered them.

### 18.4 Versioning and error shape

Versioned from the first release, because the POS client is deployed to tills and **cannot all be upgraded at once** —
a till offline for a week must keep working against a server that moved. Errors carry a stable machine-readable code
plus a human message, and the client branches on the code, never on the text.

### 18.5 Query surface is bounded

Report and list queries are paginated and bounded by construction. The till does not fetch a thousand-row
aggregation per row of a list — that is what the sale-status cache is for (§10.2).

---

## 19. Integration boundaries

### 19.1 Everything external is behind an interface

Payment providers, devices, email/SMS, file storage. The domain core names none of them, and no business rule
contains a provider name, a hostname, or an IP address.

### 19.2 Reader addresses from configuration, never from requests

Restated from §12.2 because it is the sharpest integration risk in the system: an endpoint that accepts a reader
address from a request is a server-side request forgery primitive against the store network. Addresses are
allowlisted from configuration; link-local and loopback ranges are rejected.

### 19.3 Outbound calls are queued, not inline

Email, SMS, and exports are outbox-driven (§15.1). Nothing in a business transaction waits on a third party.

### 19.4 No inbound webhooks in v1

If payment-provider webhooks are required later, they land in a **separate ingest path** that is authenticated by
signature, deduplicated by provider event id, and processed outside the request. It is not a transition endpoint.

---

## 20. Concurrency strategy

### 20.1 Row locks for contended aggregates, optimistic checks for the rest

| Aggregate | Strategy | Why |
|---|---|---|
| Stock balance | `SELECT … FOR UPDATE` on the balance row | The single-writer aggregate. Correctness beats throughput here |
| Payment / refund | Row lock, plus the provider idempotency reference | Prevents concurrent double-capture |
| Customer balance | Row lock on the balance projection | Concurrent returns and sales must not interleave |
| Shift / drawer | Row lock; one open shift per terminal | A terminal cannot open two shifts |
| Purchase order | Optimistic (version column) on draft; row lock once submitted | Drafts are high-churn and low-value; submitted POs are the opposite |
| Catalog | Optimistic (version column) | Low contention; a lost catalog edit is a re-type, not a financial event |
| Approval request | Row lock on decision | Two-person rule must be atomic with the decision |

### 20.2 Deadlocks are expected; they are not a strategy

Lock ordering is by convention: **stock before document, document before audit, always ascending primary key within
a table.** A transaction that hits a deadlock is retried a bounded number of times with jitter, and the retry is
safe because the whole transaction rolled back and every mutation is idempotent anyway.

### 20.3 The one-writer invariant

**One writer per `(variant, location)` balance row at a time.** This is what makes offline sync tractable: the
server is the only writer, so the race in §11.4 is resolved by the server in a single total order, not by
distributed consensus.

### 20.4 Application locks are not isolation

Negative-stock evaluation, FEFO selection, and return capping are evaluated **inside** the business transaction
against locked rows. Sixteen inventory rules depend on this. An application-level mutex around a check is not a
substitute, because it does not hold across processes and does not survive a crash.

---

## 21. Transaction strategy

### 21.1 One transaction per use case, at the application layer

The transaction boundary is the use case. A use case is one business intent, so a "save sale" that writes a sale,
its lines, its payments, its stock movements, its loyalty entry, its audit entry, and its notification record is
**one** transaction or it is nothing.

### 21.2 What is inside a transaction

- Validation that depends on current state (non-negative policy, FEFO, remaining returnable quantity, credit).
- All row writes for the intent.
- Audit entries (§14.1).
- Outbox rows for notifications (§15.1).

### 21.3 What is never inside a transaction

- Payment provider calls (§13.2).
- Device I/O — printers, scales, RFID readers (§12.5).
- Email, SMS, exports (§19.3).
- Report generation and any bulk read.
- **Any network call.**

### 21.4 Isolation level

Read committed, with explicit row locks where §20.1 requires them. The alternative — serializable — would buy
correctness the lock design already provides at a throughput cost, and would turn serialization failures into a
retry burden. The one place a stronger guarantee may be required is the negative-stock check across **multiple**
batches, and if the lock design cannot cover it, that is a targeted escalation, not a global default.

### 21.5 Long transactions are a defect

A transaction that spans an external call is a defect (`CON-05`). A transaction that spans a loop over thousands of
rows is a defect. Both are visible in review, and both are the usual cause of the deadlock rate in §20.2.

---

## 22. Idempotency strategy

### 22.1 The key

A client-generated `ClientOperationId`, unique per logical operation, carried on every financial and
state-changing request. For the edge tier it is generated at commit time and stored in the outbox (§11.1).

### 22.2 The mechanism

A **unique index on the key, checked before any side effect.** On a conflict, the stored original result is returned.
The check is inside the same transaction as the mutation, so a concurrent duplicate cannot interleave.

### 22.3 What is idempotent

| Operation | Key source | Note |
|---|---|---|
| Sale completion | Till, at commit | Prevents double-tap and resync |
| Return | Client or till | Required: replayed returns are a confirmed attack vector |
| Payment capture | Derived from the payment id | The merchant reference sent to the provider (§13.3) |
| Offline sync of any mutation | Device + sequence | The general case behind every specific one |
| Notification dispatch | Notification id | Retries never double-send |

### 22.4 What is *not* idempotent, by design

A request to re-read a balance is not idempotent, and does not need to be. A *reconciliation* job is not idempotent
in the sense of doing work once; it is idempotent in the sense of being safe to re-run and producing the same
verdict. Idempotency is for **mutations**.

### 22.5 Retention of keys

Idempotency keys are retained at least as long as any client that can retry — which means **at least as long as the
longest offline window**, or a client that was offline for a week will retry into a duplicate. This is a schema and
retention decision, and it is a direct consequence of the offline design.

---

## 23. Multi-store isolation

### 23.1 v1 reality

`EC-91` fixes v1 to a **single store**, so multi-store isolation is designed but not exercised by v1 data. It is
built now because retrofitting a store predicate onto every query is a rewrite, and because the one store is a
migration away.

### 23.2 Isolation is a data-layer predicate

Every business table carries a store id, and **every query** is filtered by the caller's store scope in the
persistence layer. Not in the service, not in the repository's caller, in the persistence layer — because a caller
that forgets is a breach, and the persistence layer is the last place that sees the query.

This is a first-principles requirement, not a borrowed finding. One reference implementation's isolation claim was
**refuted** during Phase 0: its `Employee.php` has no location logic at all, though `Sale.php:1500-1501` does apply
a location predicate. Three of the five have no location concept whatsoever. The requirement stands because the
problem is real, and the citation did not.

### 23.3 No auto-grant

Access to a store is granted explicitly. There is no "default to the user's home store when unspecified" fallback,
because a fallback that is generous under ambiguity is a breach under the one configuration nobody tested.

### 23.4 Central warehouse — `GATE-Q1`

`MS-17` identifies stock by variant and location. `MS-16` and `MS-19` attribute a central-warehouse batch to an
originating store, which means **one physical location with several store attributions**. The reporting compromise
is recorded as a nuance in `MS-19`; it is a compromise, and it is a **schema decision**:

| Option | Mechanism | Schema consequence |
|---|---|---|
| **A. Attribution table** | `(location, store)` rows; a location may carry several | A new table; stock is still per-location; reporting aggregates by store |
| **B. Nullable single store on the location** | A warehouse location has one (or no) owning store | A nullable column; reporting for other stores needs a different source |

Not decided here. §9 is written to hold either: stock is per-location, and attribution is a **reporting** concern
layered above it. That is the one structural decision that keeps the question open without blocking the schema
design of everything else — the attribution table can be added later without touching the ledger.

**This is the only Phase 1 question that constrains the schema.** The others are values, settings, or legal answers.

---

## 24. Security architecture

Phase 0's security findings are **evidence** ([../repository-analysis/security-verification.md](../repository-analysis/security-verification.md)).
Nothing in this document is evidence; it is design intent. §5 of the Phase 1 review makes the same distinction for
Phase 1, and it applies here.

### 24.1 Controls, and where each lives

| Control | Enforced in | Rule |
|---|---|---|
| Authentication | Application layer, every request | `AC-03` |
| Authorization | One gate, every request, deny by default | `AC-01`, `AC-02`, `AC-04` |
| Store isolation | Persistence layer predicate | §23.2 |
| Password storage | Identity module, Argon2id/bcrypt ≥ 12 | §7.3 |
| Session handling | Application layer; rotation on privilege change | §7.1 |
| Immutable audit | Database permissions on the audit table | §14.1 |
| Input validation | Trust boundary — every request is untrusted | — |
| SQL safety | Parameterized queries throughout; `ORDER BY` identifiers allowlisted | Phase 0 |
| No state-changing GET | API layer | §18.3 |
| Secret management | Deployment; no private keys in the repository | Phase 0 |
| Security headers + maintained dependencies | Edge | Phase 0 |

### 24.2 Input validation is not authorization

Validation answers "is this well-formed and in range"; authorization answers "may this actor do this". A payload
that validates perfectly can still be refused, and a payload that fails validation must not leak whether the actor
would have been allowed.

### 24.3 Information disclosure

Errors do not reveal whether an entity exists, whether a user exists, or whether a permission is missing versus a
subject is absent — the classic account-enumeration and permission-oracle pair. Authorization failures return a
uniform response; the detail goes to the audit log, which the actor may not read.

### 24.4 Device and sync endpoints are the highest-risk surface

A sync endpoint is unauthenticated by a human, authenticated by a device, and mutates money. Therefore: device
credentials are distinct from user sessions (§7.4); the ingest path is rate-limited **and** idempotent; payload
size is bounded; and the device's store scope is fixed at registration, never taken from the payload.

### 24.5 What security verification did not cover

`security-verification.md` is frozen Phase 0 evidence about the **reference repositories**. It is not a
verification of SmartStore, which does not exist yet. Citing it as a property of this system would be a category
error, and §5 of the Phase 1 review already flagged the pattern.

---

## 25. Observability

### 25.1 Five signals, and they are not optional

| Signal | Answers | Phase 0 status |
|---|---|---|
| **Sync health** — queue depth, lag, per-outcome counts, dead letters | "Is a till silently stuck?" | No reference implementation has it |
| **Ledger reconciliation** — `SUM(movements) == balance` per variant/location | "Is stock lying?" | One reference overwrites the drift, destroying evidence |
| **Auth events** — failure rates, privilege changes, session anomalies | "Is someone guessing?" | One reference has no actor or IP on its audit rows |
| **Business invariants** — negative stock, over-return, unpaid invoices over terms | "Is the domain being violated?" | — |
| **Job health** — reconciliation, outbox delivery, payment `Pending` resolution | "Is the system's own upkeep running?" | — |

### 25.2 Alerts, not just dashboards

A dashboard nobody watches is a log. Drift in reconciliation, a sync queue not draining, a growing `Pending`
payment population, and repeated authorization failures are **alerts with a threshold and an owner**.

### 25.3 Correlation

Every request carries a correlation id, propagated into the audit entry, the outbox row, the movement row, and the
provider call. This is what turns "a customer says they were charged twice on Tuesday" into a two-minute query
instead of an afternoon.

### 25.4 No business data in logs

Logs carry ids, states, and correlation ids. They do not carry customer names, card data, or amounts. A log store
is not an access-controlled system and must not become a copy of the customer table.

---

## 26. Backup / recovery architecture

### 26.1 What is backed up, and in what order

| Data | Mechanism | RPO / RTO posture |
|---|---|---|
| Relational database | Automated **point-in-time** recovery plus daily full backups | The ledger, audit, and documents are here; this is the one that must not lose data |
| File store | Versioned backup of the object store | Derived content is regenerable (§17.2) |
| Device outboxes | **Not backed up** — they are on the terminal | See §26.3 |

### 26.2 Restore is tested, not assumed

A restore drill is part of the definition of done for a backup. An untested backup is a hypothesis. The
reconciliation job (§9.4) runs immediately after a restore, because the first question after a restore is whether
the ledger and the balances still agree.

### 26.3 A terminal is a data-loss risk, and this is accepted

A till that is destroyed while holding unsynced mutations loses those sales. The mitigation is bounded by design, not
eliminated: a shift cannot close with an unsynced outbox without an explicit operator acknowledgement, and the
terminal is expected to be physically retained until its queue drains. **This is an accepted v1 risk**, stated here
so it is not discovered later.

### 26.4 Release gate: licence

**Owner decision D-10 (2026-09-29): SmartStore is a product sold commercially.** The **use** is decided; the
licence itself is **not named here** and no legal conclusion is asserted — naming and clearing it is the owner's and
counsel's. This blocks **commercial release, not engineering.**

Phase 0 chose a clean build, which is what makes the question answerable at all: because nothing was copied, the
reference projects' licences do not infect SmartStore, and the only licences that matter are the third-party
libraries chosen. **Pre-release requirement:** every dependency selected in Phase 3 must be permissively licensed
*and* its terms checked against the SmartStore licence and recorded before any distribution. This is a gate on
shipping, and the remaining licence-naming work is a legal answer, not an architectural one — recorded, not
resolved.

---

## 27. Deployment architecture

### 27.1 Three deployables

| Deployable | Where | Notes |
|---|---|---|
| Server application | Central, containerized | Stateless; scaled horizontally |
| Database | Central | Managed PostgreSQL preferred; the design assumes a single writer |
| Till client | Per terminal | Deployed and updated **independently** — this is the reason for API versioning (§18.4) |

### 27.2 The till fleet is the operational reality

A store has tills that are offline, in use, or on a slow link at any moment. Therefore: rolling updates with a
compatibility window, no destructive schema change without a forward/backward-compatible migration, and the
client must tolerate a server that is a version ahead. A migration that drops a column the client still reads is an
outage at the counter.

### 27.3 Configuration is data, per store and per currency

Thresholds (`Q6`), negative-stock policy, tax category, currency, rounding mode, notification routing. None of
these is a code change, and none is an architectural decision. The rounding mechanism is already specified and is
per store, per currency: `SP-25` makes cash rounding optional and per-currency, `SP-26` fixes the rounding
direction. On the purchasing side `PR-Q39` and `PR-Q40` govern tax separation and tax-inclusive extraction — a
different question, cited here so it is not conflated with the tax *configuration* above.

**Zero hardcoded tax defaults.** Phase 0 found a reference implementation seeding 0% as the default, which silently
produces wrong tax. An unset tax configuration is an error at the point of use, not a zero. **Which** jurisdictions
and rates apply is `Q3`, and that is a data question: the mechanism is specified, the values are not known, and no
architecture decision can supply them.

### 27.4 Environments

Development, test, staging, production, with **production-like data shapes** in staging — a staging dataset that
does not resemble production will not surface index, lock, or reconciliation problems.

### 27.5 Secrets

Injected at deploy time, never in the repository, never in an image layer. The `Config.Provider` permission level of
§13.6 means provider credentials are the highest-value secret in the system.

---

## 28. Architecture decision records

### 28.1 Accepted — inherited from Phase 0 and Phase 1

| ADR | Decision | Status | Source |
|---|---|---|---|
| `ADR-01` | Principles are ordered; the higher one wins on conflict | Accepted | This doc §1.1 |
| `ADR-02` | Modular monolith, not microservices | Accepted | Phase 0 §3; stock is a single-writer aggregate |
| `ADR-03` | PostgreSQL as the central store; no SQLite-as-server | Accepted | Phase 0 §4, §5 |
| `ADR-04` | Integer minor-unit money end to end | Accepted | Phase 0 §5; P4 |
| `ADR-05` | Balance + append-only movement ledger; no stock column on product; no absolute balance set | Accepted | Phase 0 §5, §6 |
| `ADR-06` | Integer minor units; `DECIMAL(18,4)` only for quantities and loyalty points | Accepted | Phase 0 §5 |
| `ADR-07` | Server-authoritative financial endpoints with idempotency keys | Accepted | Phase 0 §5; `SM-04` |
| `ADR-08` | Cost and price snapshots frozen on transaction lines | Accepted | Phase 0 §5 |
| `ADR-09` | Split tender as one-to-many payments | Accepted | Phase 0 §5 |
| `ADR-10` | Per-store scoping in the data layer, no auto-grant | Accepted | Phase 0 §5; §23.2 |
| `ADR-11` | Append-only in-transaction immutable audit | Accepted | Phase 0 §8; `AU-03` |
| `ADR-12` | Sessions, not long JWT, for web and POS; rotate on privilege change | Accepted | Phase 0 §4, §8; §7.2 |
| `ADR-13` | Offline-first edge: local durable store + outbox + idempotency key + device sequence | Accepted | Phase 0 §7; §11 |
| `ADR-14` | Hardware behind driver interfaces; reader address from config; persistent RFID event service | Accepted | Phase 0 §9 |
| `ADR-15` | Server-sent events or WebSockets, never polling | Accepted | Phase 0 §4 |
| `ADR-16` | RFID authenticates, never authorizes | Accepted | `CON-04`, `RF-01`; §12.4 |
| `ADR-17` | External I/O outside the business transaction | Accepted | `CON-05`; P7 |
| `ADR-18` | Derived state is a rebuildable cache with a named owner | Accepted | `SM-01a`, `SM-35a`, `SP-66`; P9 |
| `ADR-19` | One transition API with a single authorization table | Accepted | §8.4, §18.1 |
| `ADR-20` | PO is never deleted, in any state | Accepted | `RT-117`, `PR-Q06a`; P5 |
| `ADR-21` | Closed vocabularies extended only by reviewed decision | Accepted | `AU-11`, `AU-13`, `NT-04`; P8 |
| `ADR-22` | Reconciliation alerts, never repairs | Accepted | Phase 0 §5; §9.4 |
| `ADR-23` | API versioned from first release; tills update independently | Accepted | §18.4, §27.2 |
| `ADR-24` | Build clean; permissively licensed dependencies only | Accepted | Phase 0 §10; §26.4 |

### 28.2 Proposed — reasonable defaults, still reversible

These are recommendations, not decisions. Each is cheap to reverse now and expensive later.

| ADR | Proposal | Reverses cheaply because |
|---|---|---|
| `ADR-25` | `SELECT … FOR UPDATE` for contended aggregates, optimistic version columns elsewhere | A strategy table, not a schema |
| `ADR-26` | Read committed with explicit row locks; no global serializable | Escalation is per-case |
| `ADR-27` | Device health and device mode are separate state axes | Additive |
| `ADR-28` | RFID event ingestion is the first extraction candidate **if** it ever is | No action; the modular seam already exists |
| `ADR-29` | Single-writer invariant enforced by row lock, not by distributed consensus | Simplest thing that holds |
| `ADR-30` | Idempotency keys retained at least as long as the longest offline window | A retention parameter, set once the offline window is known |

### 28.3 Gates — decisions this document refuses to make

**These block the sections named. Each names both outcomes so the work can proceed around it.**

| Gate | Question | Blocks | Both outcomes are described in |
|---|---|---|---|
| `GATE-Q1` | Does a central warehouse location carry one store attribution or several? | §9 reporting, §23.4, multi-store schema | §23.4 options A and B |
| `GATE-PAYABLE` | When does a payable come into existence — at `Matched` or at `ApprovedForPayment`? | §6.3, AP ledger, supplier balances | Phase 1 review §8.1 defect 9 |
| `GATE-PERMKEYS` | Who may hold the 13 undefined permission keys? | **29 transitions, 8 machines**; §8.4 | Phase 1 review §8.1 defect 13 |
| `GATE-OFFLINE-INVENTORY` | Server-side reservation, or allow-and-reconcile? | §11.4, reservation model, negative-stock reporting | **DECIDED (D-04): allow-and-reconcile.** §11.4 options A and B; OF-38, IV-49, IV-17/20 |
| `GATE-AUDITTYPES` | What event types cover the `OPEN DECISION` audit cells? | §14.3, audit schema migration | **DECIDED (D-06): closed.** 20 types added; audit cells mapped; the `DeadLetter` cell resolved by D-07 |
| `GATE-DEADLETTER` | Does the server ever observe a dead-letter status? | §11.6, sync state model | **DECIDED (D-07): no — client-only retention.** OF-29, SM-64a; no fourth server outcome |
| `GATE-NOTIFICATION-STATES` | Are `Notification`'s states owned, and what do read/acknowledge require? | **DECIDED (D-08): `Unread`/`Read`/`Acknowledged`, owned by notification-domain §7.** §15.5 | Phase 1 review §8.1 defect 2 |
| `GATE-STOCKCOUNT-STATES` | `StockCount` has behavior but no owner state list | **DECIDED (D-09): `Open`/`Posted`/`Cancelled`/`Reversed`, owned by inventory-domain §8.3.** §9 reporting | Phase 1 review §8.1 defect 2 |
| `GATE-Q2-LICENCE` | May SmartStore be sold, and on what licence? | **Release**, not engineering | **DECIDED (D-10): sold/commercial.** §26.4 — no licence named; OSS-terms review pre-release |
| `GATE-Q4-DUNNING` | Is a credit balance repayable by a date? | §6.4; `EC-65` references a dunning policy that no rule defines | **DECIDED (D-05): no.** `EC-65` corrected to drop the due-date/dunning dependency; CON-06, NT-37 |

**`GATE-PERMKEYS` is the largest.** 29 transitions across 8 machines cannot be authorized, and the gap is
concentrated on **write** permissions for lifecycle edges. Three answers are all consistent with the current
catalogue: define the missing keys; grant the write to an existing role that already holds the read; or declare
those transitions out of v1 scope. The third is the cheapest and is currently unexamined.

**`GATE-Q1` and `GATE-OFFLINE-INVENTORY` are one decision seen twice**, as §11.4 notes. Solving the offline
inventory question first probably settles the attribution question, because both are about which store owns a unit
of stock at the moment it is sold.

### 28.4 Explicitly not decided here

The technology **language and framework** are not chosen in this document. Phase 0 fixed the constraints they must
satisfy (§4.2) — integer money, strong transactional integrity, a first-class migration story, and a framework that
supports the §20–§22 concurrency, transaction, and idempotency strategy. Naming one before that list is
implemented would be choosing a framework for adjectives.

---

## 29. Architecture trade-offs

### 29.1 Accepted costs

| Trade-off | What we pay | Why it is worth it |
|---|---|---|
| Modular monolith | One deployable; a bad module can affect another's release | Stock consistency in one database. Microservices move the problem, not the solution |
| Synchronous server authority | A sale depends on a network round trip when online | The alternative is a client that can lie about money. The offline tier (§11) is the answer to availability, not authority |
| Deny by default, one gate | Every request pays a check; new features need a key first | Least privilege is only real if the default is refusal (`AC-01`, `AC-04`) |
| Integer money | No native decimal type; careful arithmetic at boundaries | Float money is a rounding defect with a customer attached |
| Append-only ledger | Storage growth; expensive ad-hoc historical queries | History that cannot be reconstructed is not history; projections serve the queries |
| Tills update independently | Two API versions in flight; compatibility testing | The alternative is a coordinated update of every till in every store, which will not happen |
| Refuse unmapped transitions | 29 transitions unusable until keys are decided | A fallback that widens a write permission to a read is a security regression, and worse than a blocked feature |
| In-transaction audit | Slightly larger transactions | An audit written after commit is missing exactly the entries that matter |
| Row locks over optimistic | Lower peak throughput on stock | Contention here is correctness, not performance |

### 29.2 Risks this architecture carries

| Risk | Severity | Mitigation in place | Residual |
|---|---|---|---|
| Ledger/balance drift | **Critical** | Single write path, in-transaction, reconciliation with alerting | Requires the reconciliation job to actually run and alert |
| Offline conflict under-specified | **High** | Server is the only writer; gate named | `GATE-OFFLINE-INVENTORY` open — the rule does not exist yet |
| 29 transitions unauthorizable | **High** | They refuse rather than guess | `GATE-PERMKEYS` open — a business decision, not a design one |
| Till data loss (§26.3) | Medium | Shift close acknowledgement; physical retention | **Accepted, not solved** |
| Store isolation missed by a new query | Medium | Data-layer predicate, not caller discipline | Depends on review discipline; add a test that asserts cross-store reads fail |
| Audit type added post-migration | Medium | Closed vocabulary; no placeholder types allowed | `AU-13` schema review only — gate closed (D-06) |
| Framework chosen for the wrong reason | Low | §28.4 defers the choice until constraints are implemented | — |

### 29.3 What would change this architecture

Stated in advance so the triggers are not rationalized later:

- **Multi-store writes from more than one region** → the single-writer and single-database assumptions fail; this
  becomes a distributed consistency problem.
- **RFID volume exceeding the monolith's capacity** → `ADR-28` extraction becomes real.
- **A pharmacy or regulated-goods mode** (Q5) → dispensing, prescription, and controlled-substance logging are new
  modules, not new fields.
- **Central-warehouse stock becoming authoritative for pricing** → touches §9, §16, and `GATE-Q1` together.

---

## 30. Phase 2 review

### 30.1 What this document delivers

All 30 sections. The architecture is traceable: every load-bearing decision cites the specification rule that forces
it, and every gate names the two or more outcomes rather than choosing one.

### 30.2 Honesty statement

Three things in this document are **architecture intent, not verified property**, and should not be cited as
evidence:

1. **Nothing here has been built or run.** The concurrency strategy, the transaction boundaries, the idempotency
   mechanism, and the reconciliation invariant are all designs.
2. **`security-verification.md` is Phase 0 evidence about other codebases.** It is not a property of this system
   (§24.5).
3. **The `REPORTED` findings were not used.** The Phase 1 sub-agent leads — session-revocation semantics,
   open-cart price changes, RFID→attendance mapping, and the inventory tally — remain unverified. §7.6, §10.3, and
   §15.5 note the areas they touch and build nothing on them.

### 30.3 Traceability to Phase 1

| Phase 1 finding | Phase 2 response |
|---|---|
| `SM-02` asserts permissioned transitions; none existed | §8.4, §18.1 — one authorization table keyed by transition (`ADR-19`) |
| 13 permission keys missing from the access model | `GATE-PERMKEYS`; affected transitions refuse (§8.4) |
| `AU-12` vocabulary incomplete | §14.3 — five types added, floor covered, then D-06 closed `GATE-AUDITTYPES` with twenty per-machine types |
| PO could be deleted (`PR-Q06`) | `ADR-20`, §6.3 — never deleted, any state |
| `BI-15` overloaded | §1.1 P5, §9.1, §13.5, §14.1 — three immutability rules applied separately |
| `SM-01` "stored, not derived" | `ADR-18`, §9.4, §10.2, §16.1 — caches with named owners and rebuild paths |
| `DeadLetter` vs `OF-29` | **DECIDED (D-07): client-only retention.** §11.6 — no fourth server outcome; `OF-29` unchanged |
| `CreditBlocked` terminal | §6.4, §8.7 — credit is a ledger, blocking is a control, exit needs a key |
| `SM-75` false self-check | `P10` — a check that has not run is not reported as passing |
| Q1 central warehouse | `GATE-Q1`, §23.4 — the only schema-constraining question |
| Q2 licence | **DECIDED (D-10): sold/commercial** — §26.4; licence naming and OSS-terms clearance stay a pre-release requirement, not an engineering blocker |
| Q4 dunning / `EC-65` | `GATE-Q4-DUNNING` (decided: no due date in v1); `EC-65` corrected, no dunning policy |
| `Notification`/`StockCount` unowned states | Both **DECIDED** — Notification (D-08, §15.5) and StockCount (D-09, inventory-domain §8.3) states now owned by their domain documents |
| Loyalty accrual basis | **DECIDED (D-11): net of discount, excluding tax** — a configuration value (`CU-25`, `RR-41`, configuration-model.md §2); no schema change, `RP-08` basis vocabulary unchanged |

### 30.4 Phase 2 readiness

**READY WITH BLOCKERS**, consistent with Phase 1. The architecture is complete enough to begin: §9, §20, §21, §22,
and §23 are buildable, and the module boundaries in §6 are stable.

Ten gates are open (§28.3). Three are business decisions that no amount of architecture work resolves —
`GATE-PERMKEYS`, `GATE-PAYABLE`, `GATE-Q1` — and `GATE-OFFLINE-INVENTORY` is the largest design decision still
open. `GATE-Q2-LICENCE` blocks release, not engineering.

**Recommended order:** resolve `GATE-OFFLINE-INVENTORY` and `GATE-Q1` together first, since they are one question
about stock ownership seen from two directions and they determine reservation and attribution schema. Then
`GATE-PERMKEYS`, which unblocks 29 transitions. Then the remaining specification gates, which are small and
unblock a migration each.

### 30.5 What Phase 3 must not assume

1. **Do not assume a gate is closed because a section reads smoothly.** Ten are open; each names its section.
2. **Do not pick a framework to satisfy a gate.** A framework choice cannot answer a business question.
3. **Do not treat a design intent in this document as a verified property.** §30.2.
4. **Do not let a schema change make a gate moot.** A migration that hard-codes a `GATE-Q1` answer into a table
   makes the decision permanent and unrecorded.
5. **Do not copy from the reference repositories.** `ADR-24`: the build is clean, and the licences only stay clean if
   nothing is copied. Read for design, reproduce ideas.
6. **Do not invent an audit event type, a permission key, or a state name to make a screen work.** P8, §8.4, §14.3.
