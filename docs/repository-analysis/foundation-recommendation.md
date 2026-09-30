# SmartStore — Foundation Recommendation

**Phase 0 deliverable. Recommendation only — no SmartStore code has been written and no repository has been
forked, merged, or copied.**

This document answers the 13 questions that frame the foundation decision, then proposes the target
architecture. It depends on the evidence in [feature-matrix.md](feature-matrix.md),
[license-matrix.md](license-matrix.md), [architecture-comparison.md](architecture-comparison.md),
[database-comparison.md](database-comparison.md), [security-comparison.md](security-comparison.md),
[reuse-analysis.md](reuse-analysis.md), [missing-features.md](missing-features.md), and
[risk-register.md](risk-register.md).

> **Revision note — evidence was re-verified.** A full source-verification pass re-opened every security
> citation after this document was first written. **12 of 25 original security findings were refuted, 3 corrected, and 3 were left unconfirmed**, including a fabricated "SQL injection throughout the service layer" against
> YourGbDev, four fabricated RetailPOS findings, a fabricated OSPOS session-fixation claim, and a fabricated
> RFID singleton-`DbContext` claim. OSPOS's licence was also corrected **against** the first draft's direction:
> the root `LICENSE` exists and contains unmodified MIT text. See
> [security-verification.md](security-verification.md).
>
> **The recommendation below is unchanged — Option C, build clean.** It never depended on the security
> findings. It rests on the licensing position and on the greenfield-feature gap, both of which were verified
> independently. The corrections make the reasoning *more* accurate, not different in outcome.

---

## The decision, up front

> **Option C — build SmartStore clean.** No candidate repository is a viable foundation.
> Use OSPOS as the single design reference; reimplement every capability; take the *barcode library* (and
> other third-party libraries) directly rather than through a license-blocked repository.

| Option | Description | Verdict |
|---|---|---|
| **A — fork** | Take one repository wholesale and extend it | Rejected. **Three carry no license at all** (YourGbDev, RetailPOS, RFID), so default copyright applies and there is no permission to copy or adapt. The remaining two carry obligations (OSPOS: MIT plus a branding clause; NodeDR: MIT). Forking also inherits each codebase's defects, and three of the five cannot legally be forked at all |
| **B — adapt** | Lift modules across repositories and integrate | Rejected. Cross-license mixing is impossible, and no repository covers the domain. |
| **C — build clean** | Greenfield implementation, with the five as a design reference | **Recommended.** |

---

## 1. Which repository is the strongest foundation?

**None is a viable foundation. OSPOS is the strongest *reference* and the strongest *technical* candidate, but
only under conditions that do not currently hold.**

| Repository | Technical strength | Legal status | Foundation verdict |
|---|---|---|---|
| **OSPOS** | Best-in-class: the only real test suite (45+ files), a normalized schema with an inventory ledger, mature security (CSRF, XSS, centralized RBAC enforced in the controller constructor, atomic secret writes), 7 payment types, split tender, 21 reports | **Standard MIT** + a mandatory visible branding/attribution line; LGPL transitives; font binaries; unstated trademark | **REFERENCE ONLY** pending one narrow legal answer: may the branding line be removed or moved? The copyright terms themselves are compatible |
| **NodeDR** | Only repo with returns, refunds, customer credit (both directions), loyalty, and a real full-stack deployment | **AGPL-3.0-only**, no dual license | Unusable if SmartStore is proprietary/MIT/Apache. Even if AGPL were acceptable, it's a single-till kiosk with a `products.stock` integer and no purchasing |
| **YourGbDev** | Best inventory *model* in the set (balance + movement + row lock) | **No license** | `DO NOT USE` |
| **RetailPOS** | Essentially none — no auth, no inventory, no orders | **No license** | `DO NOT USE` |
| **RFID Ref** | Only real hardware (Zebra FX9600 LLRP) | **No license** | `REFERENCE ONLY`, clean-room, protocol spec as the source |

**Ranking by technical quality:** OSPOS ≫ NodeDR > YourGbDev > RFID Ref > RetailPOS.
**Ranking by legal usability:** none > none > none > none > none (all require clearance or are prohibited).
**Ranking by architectural fit to the brief:** OSPOS (partial, single-store) > NodeDR (partial, kiosk) > the rest
(cosmetic overlaps only).

**Why "none" is the honest answer to "strongest foundation":** a foundation must supply the *architecture* the
product needs, not just some working code. SmartStore needs multi-store, offline terminals, sync, suppliers,
purchasing, batches/FEFO, terminals, shifts, credit/AR, audit — and [missing-features.md](missing-features.md)
shows **at least half the brief is greenfield in all five**, with RFID auth/attendance and offline sync being the
two areas where even the domain-specific repositories have nothing. Adopting OSPOS buys a schema, a test suite,
and a security posture, and then requires a multi-store, offline-capable retail platform to be built on top of
one single-store server-rendered app. The "foundation" would be a liability as much as an asset.

---

## 2. What is the recommended technical approach?

**Build clean, in the SmartStore domain, using the five repositories as a map of solved problems and of traps.**

Concretely:

1. **Reimplement the domain from first principles** in a clean architecture with a hard boundary between the
   domain core, the application services, and the delivery mechanisms (HTTP, hardware, sync). This is the one
   lesson that comes directly from the analysis: every one of these repositories puts business logic in
   controllers or services-with-I/O mixed in, which is exactly why their transaction and reuse stories are weak.
2. **Adopt the *design* patterns that are demonstrably correct**, from the specific repository that got them
   right — the sale-line cost/discount **snapshot** (OSPOS), the split-tender payment **shape** (OSPOS),
   server-side total recomputation (OSPOS, YourGbDev — two independent implementations of the same rule),
   the balance-plus-movement **stock model** (YourGbDev, design only), the return **capping** rule (NodeDR),
   the credit **audit-trail** pattern (NodeDR), the centralized `pricing` module (NodeDR), the **ESC/POS direct**
   printing lesson (NodeDR), and the barcode-scanner **wedge+camera** pattern (NodeDR).
3. **Take third-party libraries directly, never through a license-blocked repository.** E.g. the barcode
   symbology set SmartStore needs is available from `jsbarcode` (MIT) or a permissively-licensed equivalent
   directly — *not* from OSPOS's LGPL `picqer` wrapper. This is a subtle but important point: **a capability can
   be licensed cleanly even when the repository that implemented it is not.**
4. **Design for the brief's distinctive features from Day 1**, because they have no prior art and they drive
   the schema: offline terminals and sync, RFID auth/attendance, stores/warehouses/transfers, terminals/shifts.
5. **Do not inherit any of the correction debt** listed in the [risk register](risk-register.md) — the
   non-transactional stock path, the CSV-import ledger corruption, the prefix-match permission check, the
   unsalted SHA-256 passwords, the anonymous-returns stock inflation, the 53-of-54 unauthenticated API, the
   shipped credential-reset script, the float money, the missing idempotency, the missing stock ledger.

   *(Corrected against the first draft, which also listed a session-fixation guard, unenforced location scoping,
   shipping debug flags, hardcoded secrets, and a service-layer SQL injection. All five were **refuted** — the
   cited code does not exist. See [security-verification.md](security-verification.md). The list above is
   shorter because the evidence is thinner, not because the work got easier.)*

---

## 3. What is the target architecture?

See [the full target architecture](#target-architecture) at the end of this document. In one line: a
**modular monolith** — a single deployable application with an offline-capable edge (till client) and a
central server, a normalized relational core with an append-only inventory ledger, integer money, an
append-only audit trail written in-transaction, per-store data isolation enforced in the data layer,
server-authoritative financial endpoints with idempotency, and hardware (RFID/printer/scanner/scale/ESP32) behind
driver interfaces. A monolith — not microservices — because the domain is transaction-heavy and single-writer
on stock; microservices would make the stock-isolation problem harder, not easier.

---

## 4. What technology stack should be used?

**The evidence does not favor any candidate's stack, because the domain gaps (offline, multi-store, purchasing,
shifts) exceed what any stack here demonstrates.** Choose a stack on its own merits for this problem, with two
hard requirements drawn from the analysis: **integer money** and **strong transactional integrity**.

A defensible default, given the analysis:

- **Application server:** a mature, actively maintained framework with a first-class migration story and
  **PostgreSQL** (transactional integrity, `SELECT … FOR UPDATE`, strict decimal, robust indexing) as the
  central store. Avoid SQLite-as-server unless the deployment is provably a single till; the offline tier
  handles edge cases with a local database, and the server should be a real client/server engine.
- **Till/offline client:** an offline-first local tier (IndexedDB/SQLite on the device or a local service) with a
  durable transaction queue, a service worker, and a sync engine. This is the piece no repository provides.
- **Real-time:** server-sent events or WebSockets for stock/queue updates; **not** polling (the RFID repo's
  5-second poll and NodeDR's 15-second health poll are the anti-pattern).
- **Money:** integer minor units end to end; `DECIMAL(18,4)` only for loyalty points/quantities. **Never
  float** (NodeDR uses `Float`, YourGbDev uses `Double`).
- **Auth:** sessions for web/POS (httpOnly, secure, sameSite), Argon2id or bcrypt ≥12, RBAC with `(store,
  module, action)` scoping enforced in the data layer. Avoid JWT-for-auth unless short-lived with refresh and
  re-checked `isActive` (NodeDR's 30-day TTL is the cautionary tale; its DB-backed role and per-request
  active-user re-check are the parts worth copying).
- **Barcode/RFID/hardware:** barcode and RFID libraries chosen directly (permissive), RFID reimplemented from
  the **EPCglobal LLRP v1.0.1 spec**, hardware behind driver interfaces.

**Stack is a Phase 1 decision, not a Phase 0 outcome.** What Phase 0 fixes is the *shape*: normalized core
ledger, integer money, in-transaction audit, per-store isolation, idempotent financial endpoints, offline-first
edge, driver-abstracted hardware.

---

## 5. What is the database design?

**PostgreSQL, normalized, with an append-only inventory movement ledger as the source of truth and a
continuously-reconciled stock balance as a cache.** This is where the analysis pays off most directly:

- **Stock = balance + movement ledger.** A `stock_balances(product, location, on_hand)` table and an
  `inventory_movements` table where **every** change to a balance is a signed movement row, written in the same
  transaction as the balance update. This is YourGbDev's model (the only internally-consistent one) and OSPOS's
  `inventory` table (used inconsistently). **Never** store stock as a column on `products` (NodeDR, RFID) and
  **never** set a balance absolutely (OSPOS's CSV import).
- **Movement types:** `RECEIPT`, `SALE`, `RETURN`, `ADJUSTMENT`, `COUNT_VARIANCE`, `TRANSFER_IN`, `TRANSFER_OUT`,
  `RESERVATION`, `RELEASE`. Explicit direction, never type-implied (RFID's scheme) or comment-implied (OSPOS).
- **Integer money** everywhere; per-location `on_hand`; `CHECK (on_hand >= 0)`.
- **Snapshots on transaction lines:** every sale/receipt line freezes cost price, unit price, discount, and
  serial/lot — as OSPOS's `sales_items` does. Retrofitting this across a ledger is a rewrite, so design it in.
- **Split-tender payment shape:** `payments(id, sale_id, tender_type, amount, reference, …)` one-to-many, so
  split tender and multi-tender refunds work (OSPOS's shape; NodeDR's single `paymentMethod` string cannot).
- **Per-store scoping on every table and every query** — a first-principles requirement, not a borrowed finding.
  *(The first draft cited OSPOS "granted-but-unenforced location isolation" (S-05). That finding was
  **refuted**: `Employee.php` has no location logic and `Sale.php:1500-1501` does apply a location predicate.
  The requirement stands because the other four repositories have no location concept at all.)* Store id on every
  business row; data-layer predicates; no auto-grant.
- **`created_at`/`updated_at` on every business table** (OSPOS and RFID both lack them, which makes an audit log
  un-retrofit-able) and a **reconciliation job** proving `SUM(movements) == balance`, alerting on drift.
- **Idempotency keys** on every financial mutation (unique index, checked before side effects) — the
  prerequisite for offline terminals.
- **Zero hardcoded tax defaults** (NodeDR seeds 0% as default — A-05); **indexes on every FK** (NodeDR misses two).

Full schema design is a Phase 1 deliverable; the invariants above are the Phase 0 output.

---

## 6. How should inventory be modelled?

Per Q5. The load-bearing choices, each traced to a finding:

| Decision | Why (evidence) |
|---|---|
| Balance + append-only movement ledger, not a `products.stock` column | **NodeDR is the sole counter-example** — its schema has **no inventory or movement model at all** (D-09), so `Product.stock` is mutated in place on both checkout and return. RetailPOS has no inventory concept whatsoever (D-16). OSPOS and YourGbDev both use balance+ledger, as does RFID |
| Every balance write paired with a movement write, **in one transaction** | RFID writes `InventoryTransaction` from four sites (`GoodsReceiptsController.cs:73`, `InventoryTransactionsController.cs:42`, `SalesCheckoutController.cs:117`, `SalesReturnController.cs:71`) but `InventoryController.Update` (`:103`) sets the balance with **no** movement row and no range check; OSPOS gets it right on sale, wrong on adjustment (D-02) and catastrophically wrong in CSV import (D-03) |
| `SELECT … FOR UPDATE` on the stock row at every mutating site | YourGbDev (belt-and-braces on top of the transaction) |
| Explicit `movement_type` + signed `delta` | Not RFID's type-implied direction, not OSPOS's string comment |
| `on_hand >= 0` enforced (CHECK + transaction) | YourGbDev's `CHECK (quantity >= 0)` |
| Continuous reconciliation + **alert** (do not silently repair) | OSPOS's `reset_quantity()` overwrites the balance — it detects drift but destroys the evidence |
| Reservations model (for offline + holds) | Nothing exists anywhere; OSPOS's suspended sales do not hold stock |
| Cost snapshots frozen on every transaction line | OSPOS's `sales_items` — the only historical-margin-correct model in the set |

---

## 7. How should offline and synchronization work?

**Design from first principles — no repository has this.** The design must be settled before the schema is
frozen, because it determines the idempotency, sequence, and attribution columns.

- **Edge tier:** each till has a local durable store and an append-only **outbox** queue of financial
  mutations, each carrying an **idempotency key** and a **monotonic per-device sequence number**. (NodeDR's
  "offline-first" is a *deployed topology* — its backend runs on the till — not a sync engine; the only
  idempotency trace anywhere is one unused, abandoned column in an unlicensed repo.)
- **Sync:** durable, resumable, ordered; the server is idempotent on the key so a retry never double-charges.
- **Conflict resolution:** deterministic per entity type. **Inventory is the hard case** — two terminals selling
  the last unit offline. The server must have a defined rule, and the choice (allow-and-reconcile vs.
  server-side reservation) is a *product* decision with a hard schema consequence.
- **Attribution:** sync preserves the originating **terminal id** and a **request/trace id** in the audit trail,
  so a synced transaction is attributable (the gap that makes OSPOS's missing audit log unfixable).
- **Time and identity:** server-assigned identity/sequence so ordering survives; never trust a device clock for
  business timestamps.
- **Observability:** a sync queue depth / lag / failure dashboard from Day 1 (no repo has observability — A-21).

---

## 8. What is the security model?

From [security-comparison.md](security-comparison.md) and the Critical risks, the non-negotiables:

- **Deny by default; one central auth/authz enforcement point**, with a fallback policy that requires
  authentication (OSPOS's constructor model is the right placement; RFID's missing fallback policy is the
  counter-example).
- **Explicit, database-backed, named roles** with `(store, module, action)` grants — no prefix `LIKE` matching
  (OSPOS S-06, confirmed), no never-read `PermissionsJson` (RFID S-12, confirmed).
- **Per-store row isolation enforced in the data layer on every query** — a design lesson, not a borrowed
  finding: OSPOS's auto-grant claim was **refuted**, and `Sale.php:1500-1501` does apply a location predicate.
  The other four repositories have no location concept at all, so this is greenfield either way.
- **Argon2id / bcrypt ≥12**; no unsalted single-pass SHA-256 (RFID S-11, confirmed).
- **Immediate deactivation** — re-check `isActive` on every authenticated request. NodeDR does this correctly
  (`auth.js:52-56`); YourGbDev does not.
- **Sessions (not long JWT) for POS/web**, httpOnly+secure+sameSite, rotated on login and privilege change.
  NodeDR's 30-day TTL (S-20, confirmed) is the cautionary tale; its `secure` flag being opt-in is the residual
  defect.
- **No state-changing GET**, no anonymous stock/returns mutation (RetailPOS S-03, RFID S-01 — both confirmed).
  Six of RetailPOS's unauthenticated deletions are `GET` requests; returns must be capped against remaining
  returnable quantity **and be idempotent**, since RFID's are replayable.
- **Parameterized queries throughout, with `ORDER BY` identifiers allowlisted**; **never `extract($_GET)`**
  (OSPOS A-02). *(The first draft credited this lesson to a "YourGbDev SQL injection" finding. **That finding
  was refuted** — the codebase uses PDO prepared statements exclusively, with `LIMIT`/`OFFSET` among the bound
  parameters. The lesson stands on first principles, not on that citation.)*
- **Append-only, in-transaction, immutable audit** covering auth success/failure/logout, permission changes,
  and financial changes, with actor/IP/terminal/request-id. RFID S-12 (confirmed) is the model of what goes
  wrong: two write sites, no actor, no IP.
- **Security headers + a maintained dependency tree** at the edge; **no committed private keys** (YourGbDev A-12).
  *(The "shipping debug flags" and "hardcoded JWT secret" claims were **refuted** — OSPOS's logger is
  production-aware, and RetailPOS has no `config/jwt.php` at all.)*
- **Hardware/sync: idempotent + rate-limited + authorized**, reader addresses from server configuration, never
  from request data (RFID S-02, confirmed). Allowlist resolved addresses and reject link-local ranges.

---

## 9. How should hardware be integrated?

Behind **driver interfaces** so each device is swappable, with:

- **Receipt printers:** ESC/POS direct (USB/network) **and** browser print — NodeDR's operational lesson (a
  headless kiosk where the browser print dialog hangs after every sale) plus OSPOS's PDF/format options.
- **Barcode scanners:** keyboard-wedge + camera, behind one interface (NodeDR's hook pattern; OSPOS has no
  hardware integration at all).
- **RFID readers:** a `LlrpReaderService` **interface** with a Zebra FX9600 implementation, built from the
  **EPCglobal LLRP v1.0.1 spec** (clean-room), reading the reader address from config, with **persistent
  connection + background event service** — not a request-scoped sleep-then-disconnect and not a 5-second audit
  poll (RFID S-24). Check every response status; never `resetToFactory` per read.
- **RFID auth/attendance:** greenfield. Badge-tap to open a shift/approve a void; tap-in/tap-out. Neither exists
  in the RFID repo (missing-features D3/D4) — design them fresh, sourced from the protocol spec, not from that
  tree.
- **Scales / ESP32 IoT:** greenfield; `PeripheralDriver` interface with implementations. No repo has ESP32 or
  device management.

---

## 10. What is the licensing risk and how is it mitigated?

**The licensing risk is the dominant risk of Phase 0, and it is resolved by not copying anything.** Full detail
in [license-matrix.md](license-matrix.md); the mitigations are:

- **Three repositories have no license** (YourGbDev, RetailPOS, RFID) — copying is legally prohibited. Mitigation:
  `DO NOT USE`; read for design only; reproduce ideas, never code.
- **OSPOS's "MIT" is inaccurate** — a nonstandard footer clause lives in a PHP config file. Mitigation:
  `REFERENCE ONLY` until counsel clears it and its transitives; SmartStore's own code is MIT/Apache from line one.
- **NodeDR is AGPL-3.0-only** — network copyleft would extend to SmartStore. Mitigation: unusable unless
  SmartStore is deliberately AGPL; counsel decides.
- **The single most important mitigating decision:** because SmartStore is built clean, **the foundation's
  license never infects SmartStore's**. The only licenses that matter are the third-party libraries SmartStore
  *chooses* — and those can be selected permissively (e.g. `jsbarcode` MIT for barcodes, rather than OSPOS's
  LGPL `picqer` wrapper).
- **LEGAL actions required before any code is copied:** confirm SmartStore's intended license; obtain OSPOS
  clause + transitives + font + trademark clearance; confirm AGPL position on NodeDR; confirm a clean-room
  boundary for RFID (spec-based, not code-based).

---

## 11. What is the build order and phasing?

Phase 0 (this) is complete: reconnaissance, license audit, comparison, risk register, recommendation. The
suggested Phase 1+ order, derived from the dependency structure in the analysis:

1. **Foundation:** schema + migrations + integer money + audit trail + RBAC + auth. (The audit table and
   idempotency are cheap now and near-impossible to retrofit — OSPOS's missing `created_at` is the lesson.)
2. **Core inventory:** balance + movement ledger + reconciliation. (Everything else depends on correct stock.)
3. **Catalog + barcode:** products, variants, attributes, barcode/label generation.
4. **POS checkout:** cart, split tender, receipts, discounts, returns/refunds.
5. **Stores + locations + transfers** and **terminals + shifts** (greenfield; the location-isolation and
   cash-reconciliation decisions land here).
6. **Suppliers + purchasing + GRN** (greenfield; the over-receipt guard from day one).
7. **Customers + loyalty + credit/AR.**
8. **Hardware:** printer, scanner, RFID driver interfaces; then RFID auth, then RFID attendance.
9. **Offline edge + sync** (the largest greenfield item; the idempotency and conflict decisions must already be
   made in steps 1 and 6).
10. **Reporting + export** (ledger-based, server-side, portable).

Steps 5, 6, 8, and 9 are greenfield in all five repositories — budget them as net-new engineering, not
"wire up the existing code."

---

## 12. What is the effort/risk profile?

**The honest estimate: this is a multi-month build, not a fork-and-rename.** Rough reasoning from the analysis:

- ~44 requirements, of which ~21 are ABSENT in all five and ~17 PARTIAL (missing-features summary counts).
- The greenfield areas (offline/sync, multi-store/transfers, terminals/shifts, suppliers/purchasing/GRN, RFID
  auth/attendance, credit/AR) are the majority of the hard work and have **no reference implementation**.
- The referenceable, reusable-by-design areas (checkout, catalog, barcode, payments, customer) are the minority
  and are all license-blocked for code — so they must be rebuilt too.
- Only OSPOS offers a transferable *test suite* philosophy, which is the one thing a clean build genuinely
  benefits from copying as a **practice** (not code).

Effort is dominated by correctness-under-concurrency (the ledger), offline/sync correctness (idempotency +
conflict), and the hardware/driver work — not by CRUD. The risk register's surviving High items (D-09, D-18,
A-19, S-12, L-02) are all *design-time* decisions; getting them right up front is what separates a feasible
build from a rewrite.

---

## 13. What are the key risks and mitigations?

Top risks, from [risk-register.md](risk-register.md) (**4 Critical / 23 High / 33 Medium / 4 Low**, 64 scored).
Every Critical belongs to a `DO NOT USE` repository; every surviving High is a design-time decision:

| ID | Risk | Mitigation |
|---|---|---|
| S-01 | RFID: anonymous stock mutation and replayable return-driven inflation | **`DO NOT USE`.** Authorization on every stock-mutating endpoint; returns capped against remaining returnable quantity **and idempotent**; DB `CHECK` on non-negative stock |
| S-03 | RetailPOS: 53/54 routes unauthenticated, six `GET` deletions | **`DO NOT USE`.** One central auth middleware; no state-changing route on `GET` |
| S-08 | YourGbDev: hardcoded credential reset shipped in the web root | **`DO NOT USE`.** No executable recovery tooling under the web root; CI guard |
| S-11 | RFID: unsalted SHA-256, no lockout, seeded `admin`/`Admin@123` | **`DO NOT USE`.** Argon2id or bcrypt ≥12; lockout; no seeded production credentials |
| S-12 | RFID: permissions stored but never enforced; audit trail has no actor or IP | Append-only in-transaction audit with actor/IP/terminal/request-id; enforce permissions in code |
| L-02 | Three repos unlicensed | Build clean; never copy; library licenses chosen directly and permissively. |
| D-09 | NodeDR has no stock ledger at all | Balance + movement ledger, in-transaction, reconciled. |
| D-18 | No idempotency anywhere | Idempotency key on every financial mutation, from the first endpoint. |
| A-19 | No offline/terminal/shift/multi-store anywhere | Design greenfield; the largest and most under-budgeted risk in the brief. |
| L-01 / L-03 | OSPOS branding clause; NodeDR AGPL | **LEGAL:** clear before any copy. **L-01 is now narrow** — OSPOS's copyright terms are standard MIT; only the required visible branding line is at issue. Foundation's license never infects SmartStore because SmartStore is clean. |

> **What the verification pass changed here.** The first draft of this table listed five Criticals including
> **S-09 "YourGbDev SQL injection throughout the service layer"** — a fabricated finding (the codebase uses
> PDO prepared statements, 110 `prepare()` calls, with `LIMIT`/`OFFSET` bound). It also listed S-05 (OSPOS
> location isolation, refuted) and S-21 (CORS misconfiguration, refuted — YourGbDev's CORS implementation is
> the *best* of the five). Removing them does not change the recommendation: it was never resting on the security
> findings. It rests on three licenses — two unlicensable outright, one AGPL — and on the fact that offline sync,
> RFID auth/attendance, multi-store transfers, terminals and shifts have **no implementation in any of the
> five**. Both of those were verified independently of this security work.

---

## Target architecture

A conceptual reference for Phase 1. **This is a design sketch, not an implementation.** No code, schema DDL, or
directory is created by this document.

```
┌───────────────────────────────────────────────────────────────────────┐
│  PRESENTATION  (three surfaces, one design system)                   │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │ Back-office│  │ POS terminal │  │ Mobile /     │                 │
│  │ (catalog,  │  │ UI (offline- │  │ staff self-  │                 │
│  │  reports,  │  │ capable)     │  │ service      │                 │
│  │  admin)    │  │              │  │ (RFID att.)  │                 │
│  └─────┬──────┘  └──────┬───────┘  └──────┬───────┘                 │
└────────┼────────────────┼─────────────────┼─────────────────────────┘
         │                │                 │
┌────────▼────────────────▼─────────────────▼─────────────────────────┐
│  APPLICATION  (use cases; one per capability; DTO in/out)          │
│  AuthN/AuthZ · Catalog · Inventory · Purchasing · POS · Customers   │
│  Credit/AR · Transfers · Shifts · Reporting · Sync ingest          │
├─────────────────────────────────────────────────────────────────────┤
│  DOMAIN CORE  (entities, value objects, domain services —          │
│  NO I/O, NO framework, NO ORM)                                      │
│  StockMovement ledger · Money (integer minor) · Payment splits     │
│  Return capping · Credit ledger · Reservation · Shift variance     │
├─────────────────────────────────────────────────────────────────────┤
│  PERSISTENCE  (PostgreSQL; every write transactional; per-store     │
│  scoping in the data layer; idempotency keys)                       │
│  stock_balances · inventory_movements · sales(+lines) · payments    │
│  receipts(+lines) · returns · suppliers · purchase_orders(+lines)   │
│  goods_receipts(+lines) · transfers · terminals · shifts ·          │
│  customers · loyalty_ledger · credit_ledger · audit_log (append-only)│
├─────────────────────────────────────────────────────────────────────┤
│  INTEGRATIONS  (all behind interfaces, all swappable)               │
│  EscPosPrinter · BarcodeScanner · RfidReader (LLRP/Zebra) ·        │
│  Scale · Esp32Device · PaymentGateway · Email/SMS · SyncEngine     │
└─────────────────────────────────────────────────────────────────────┘
```

**Cross-cutting, by design (each traceable to a risk):**

- **Per-store data isolation enforced in the persistence layer** on every query (first-principles; the OSPOS
  citation formerly attached to this, S-05, was **refuted**).
- **Inventory: balance + append-only movement ledger, every write transactional, continuous reconciliation
  alert** (D-09, D-02, D-03).
- **Integer minor-unit money end to end; `DECIMAL(18,4)` only for loyalty points** (D-17).
- **Append-only, in-transaction, DB-immutable audit** covering auth, permissions, and financial changes, with
  actor/IP/terminal/request-id (S-12, confirmed).
- **Idempotency key on every financial mutation** (D-18) — the prerequisite for offline terminals.
- **Cost/price/discount snapshots frozen on every transaction line** (OSPOS `sales_items`).
- **Server-recomputed financial totals; client totals never trusted** (OSPOS + YourGbDev).
- **Offline edge:** local durable store + outbox queue + idempotency keys + per-device sequence; server-authoritative
  ingest; explicit per-entity conflict policy; terminal/request attribution in the audit trail (A-19).
- **Hardware driver interfaces**; reader address from config; persistent RFID event service (S-02, S-24).
- **Deny-by-default authz at one enforcement point; Argon2id/bcrypt≥12; session auth for POS/web; rotate the
   session on privilege change** (S-06, S-11, S-20 — all confirmed).

**Why a modular monolith and not microservices:** stock is a single-writer, correctness-critical aggregate, and
the hardest requirements (offline sync, per-store isolation, transactional inventory) are all about *keeping*
one database consistent. Microservices would push the consistency problem into inter-service calls without
removing it. Split by module inside one deployable, and extract a service later only if a specific module
(most plausibly the sync ingest or the RFID event pipeline) proves to need independent scaling. **RFID event
ingestion is the most likely first extraction**, because it is the one genuinely asynchronous, high-volume
workload.

---

## Final recommendation

> **Build SmartStore clean (Option C).** Take OSPOS as the primary design reference and NodeDR as the reference
> for customer credit, returns, and the offline naming trap. Treat YourGbDev, RetailPOS, and the RFID repository
> as reference-only (unlicensed) and copy nothing from any of them. Reimplement RFID from the EPCglobal LLRP
> specification. Select third-party libraries (barcode, payments, PDF) directly and permissively. The foundation
> license never infects SmartStore because SmartStore shares no code with any of these repositories.
>
> **Two decisions must be made before Phase 1 code is written:**
> 1. **SmartStore's intended license** (decides whether Option B was ever available, and gates all reuse).
> 2. **The offline inventory conflict policy and idempotency scheme** (drives the schema, and offline is the
>    largest greenfield area with zero prior art in the set).
>
> Everything else the five repositories can offer is a well-evidenced *map* — of what has been solved, and,
> more usefully, of what has already been got wrong. That map is the deliverable. The code is not.
