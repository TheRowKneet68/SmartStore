# Build Status

**Last updated:** 2026-10-02

## Phase

**Step 3 — v1 implementation**, started 2026-10-01 on the owner's instruction ("start Step 3"), under the rules in
the working agreements (7 to 12). Constitution §35 authorized "Phase 3 (database design) and the subsequent v1
implementation".

**Phase 3 — database design** is complete: all seven domains are designed, migrated and tested (Done, below).

**Stack chosen:** [ADR-31](docs/architecture/ADR-31-V1-STACK-AND-TOOLING.md), approved by the owner on 2026-09-30 —
Node 26, TypeScript, Fastify 5, `pg` (no ORM), dbmate (plain-SQL, forward-only migrations), Vitest against a real
PostgreSQL, React + Vite. PostgreSQL is fixed per `ADR-03`.

Phase 2 documentation is closed. All thirteen entry criteria (C-01..C-13) are met or decided
([PHASE-3-ENTRY-CRITERIA.md](docs/architecture/PHASE-3-ENTRY-CRITERIA.md) §6), and no genuine Phase 3 blockers
remain. The last one, `CON-03`, was closed by owner decision **D-14**.

## v1 slice — in scope

| Area | Notes |
|---|---|
| Single store | One store, not multi-store |
| Online POS | Online sales; the offline-sync engine is deferred |
| Barcode | Scanning and lookup |
| Inventory ledger | Balance plus append-only movements (`ADR-05`); no stock column on product |
| Payments | Card, cash, split tender (`ADR-09`); a `Failed` `Payment` record is terminal, a retry is a new `Payment` (D-14) |
| Returns | Return and refund, bounded per line and per sale |
| Audit | Append-only audit trail; small deliberate per-machine type set (D-06) |

## Deferred — design for, do not build yet

| Area | Why deferred |
|---|---|
| Offline sync | `OF-*` rules are specified; the sync engine is not in v1 (D-04 chose allow-and-reconcile) |
| RFID / devices | Hardware abstraction is specified (`HD-*`); no fleet is committed, and budget is open (`GAP-039`) |
| Credit | No `CreditOverdue` event, no AR aging, no dunning in v1 (D-05) |
| Loyalty | Accrual basis is documented and configurable (D-11), but no loyalty build in v1 |
| Multi-store | Warehouse attribution is designed for future multi-store (D-03); v1 is single-store |

Outside the v1 slice as well, found while designing (the slice is the positive list above). Each is additive to the
schema; details in the domain documents:

| Area | Rules | Found in |
|---|---|---|
| Weighed goods (scale, embedded-weight barcodes, tare) | `PR-13`, `PR-24`..`PR-28`, `RT-038`, `RT-039` | D2 — needs scales (devices deferred) |
| Variant option matrix | `PR-03`, `RT-030` | D2 — v1 variants carry a descriptive name |
| Unit conversions, packaging sales, purchasing units | `PR-16`..`PR-23`, `RT-034`..`RT-037` | D2 — purchasing is outside the slice |
| Discounts and coupons | `PR-42`..`PR-45`, `RT-049`..`RT-052`, `RT-494` | D2 |
| Customer-group prices | `PR-30` tier 1 | D2 — customers are outside the slice |
| Supplier products, imports, attributes, images | `PR-07`, `PR-49`..`PR-55` | D2 |
| Approval workflow | `PR-32` backdated price, `PR-33`/`RT-043` below-cost price | D2 — without approvals these are **refused** (architecture §8.4 fallback) |
| Batches, expiry, FEFO | `BE-*`, `IV-10`, `IV-19`, `IV-19a`, `RT-065`, `RT-066`, `RT-086`..`RT-089` | D3 — created by goods receipts, keyed per supplier; the additive extension is designed in D3 §7 |
| Stock counts | `IV-25`..`IV-31`, `D-09`, `RT-071`..`RT-073` | D3 — v1 corrects stock with counted-quantity adjustment lines (`UX-36`, `UX-37`) |
| Transfers and Transit | `IV-39`..`IV-45`, `RT-078`..`RT-080` | D3 |
| Reservations | `IV-46`..`IV-50`, `RT-082`, `RT-084` | D3 — the till reserves nothing by rule (`IV-49`) |
| Generic stock receipt and issue | `IV-51`..`IV-53`, `RT-063` | D3 |
| Import jobs | `PR-51`..`PR-55`, data-import | D3 — v1 loads opening stock with an `OpeningBalance` adjustment (same movement type, reason and approval) |
| Notifications | `IV-17` `NEGATIVE_STOCK`, `IV-59` `OUT_OF_STOCK`, `BE-30` | D3 — the conditions are queryable now; the outbox is not in the slice. `BI-36`(b) waits for it |
| Resolve negatives by receiving | `IV-38`, `RT-069` | D3 — needs goods receipts |
| Voiding a completed sale | `SP-52`..`SP-56`, `RT-138`, `RT-139` | D4 — the documents contradict each other (OQ-017); refused (`SS044`); returns are the v1 correction |
| Suspended sales | `SP-44`..`SP-49`, `RT-141`, `RT-142`, `UX-23`..`UX-26` | D4 — the cart stays in the browser (owner speed requirement) |
| Credit sales, zero-value payment | `SP-41`, `PY-01`, `PY-18`, `RT-134` | D4 — deferred with credit |
| Stored-value, loyalty, wallet, bank-transfer tenders | `PY-29`..`PY-35` | D4 — v1 methods are Cash and Card |
| Price overrides | `SP-22`..`SP-24` | D4 — below cost needs approval |
| Cash rounding | `SP-25`, `SP-26` | D4 |
| Weighed lines | `SP-16`..`SP-20`, `RT-127` | D4 (see weighed goods, D2) |
| NoSale, pay-in/out, safe drops, cash adjustments | `RT-143`, `CD-15`..`CD-17` | D4 — v1 cash types are opening float, change, closing float |
| Denomination counts | `CD-27`..`CD-29`, `UX-32` | D4 — counts are totals in v1 |
| Shift reopen | `CD-26`, `SM-56` | D4 — permission `OPEN DECISION` (OQ-014) |
| Customer management | `CU-02`..`CU-38` | D4 — only the walk-in record exists |
| Device telemetry | `SM-60a`, `PT-04`, `HD-16` | D4 — terminal status is the lifecycle only |
| Goodwill return with no sale | `RR-09`, `RT-476` | D5 — every v1 return names its sale's lines; a goodwill refund (with a reason) covers money without goods |
| Store credit and gift-card refunds | `RR-07`, `RR-26`..`RR-29`, `PY-28`, `RT-158`, `RT-162`, `RT-522` | D5 — deferred with credit; v1 refunds to the original tender or in cash |
| Exchanges | `RR-30`..`RR-34`, `RT-159` | D5 — a return and a new sale, done separately in v1 |
| Loyalty reversal, promotion recalculation, coupon decrements | `RR-38`..`RR-41`, `RT-160` | D5 — deferred with loyalty and discounts |
| Batch attribution of returns | `RR-20`, `BE-45`, `BE-46` | D5 — with batches (D3 §7) |
| Settling and closing returns | §22.7, `SM-43` | D5 — undefined refundable remainder and `OPEN DECISION` keys (OQ-023); a return rests at `Posted` |
| Refund notifications, cash-out threshold, goodwill concentration report | `SM-41`, `CD-15`, `RR-37`, `RT-523` | D5 — with notifications, approval thresholds and reporting |
| Customer-facing refusal text | `RT-524`, `UX-31` | D5 — UX phase; the internal reason code is stored |
| Cross-store returns | multi-store-domain | D5 — a return is at its sale's store; comes with multi-store |
| Audit retention, expiry, archival | `AU-17`..`AU-22`, `RT-297`, `RT-298`, `RT-466` | D6 — no deletion path exists; needs configured financial periods (a legal floor) and `AU-02`/`AU-20` reconciled (OQ-024) |
| Audit read path, its permissions, and auditing reads of the log | `AU-23`..`AU-26`, `RT-299`, `RT-300` | D6 — domain 7 and the application; reading the log has no event type (OQ-024) |
| Standing audit reports; the chain check's schedule; an external log shipper | `AU-27`, `AU-28`, `AU-30`, `AU-31`, `RT-301` | D6 — projections and jobs (P5); the check itself, `audit_chain_breaks()`, is built |
| Audit of master data and configuration changes | OQ-024 | D6 — the closed vocabulary has no type for them |

Design these so the schema can carry them without a rewrite. Do not build them.

Test gates deferred with them (`TEST-STRATEGY.md` §1, ADR-31 §7): idempotency of offline apply (`OF-22/23`) waits for
offline sync; atomic bounded redemptions (`PY-31`, `BI-19`, `BI-06`) wait for credit and loyalty. Online idempotency
(`SM-04`) is tested in v1.

## Working agreements

Owner-approved with ADR-31 on 2026-09-30 (ADR-31 §13 has the full text):

1. Step 2 designs all seven domains, in the owner's order, before any application code. Actor foreign keys in
   domains 3 to 6 are added in domain 7. Step 3 implements in dependency order 1, 7, 6, 2, 3, 4, 5.
2. A sale requires a shift (`BI-39`), so a minimal Shift/Drawer belongs to the Sale/Payment domain. Nothing else from
   Cash.
3. Movement types come from `inventory-domain.md` (includes `OPENING_BALANCE`), not the shorter list in
   PHASE-2-ARCHITECTURE §9.3.
4. Card payments are an interface plus a simulated gateway; a real acquirer is the owner's call. Tax rates are data;
   fixtures are labelled TEST-ONLY.
5. Work is on branch `v1-build`; commit after each passing step; remind the owner to push at the end of each domain.
6. Migrations are forward-only.

Step 3 rules, given by the owner on 2026-10-01 with "start Step 3":

7. Order: Organization/Store/Warehouse (1), Employee/Role/Permission (7), Audit (6), Product/Barcode/Unit (2),
   Inventory ledger/Batch (3), Sale/Payment (4), Returns/Refunds (5).
8. **Before starting Domain 5**: list every transition that lacks a permission key (OQ-023, OQ-025), show which
   existing keys could be reused, propose names for the rest, and **wait for the owner's approval**. No invented keys.
9. **First working slice early.** After domains 1, 7, 6 and 2, build a minimal vertical slice (login, scan a barcode,
   add to the cart in the browser, save a sale), run the performance test (scan-to-cart and sale-save timing), and
   show the owner the numbers.
10. Run the full mutation check only at the end of each domain; run focused tests while developing.
11. CLAUDE.md rules stand: cite requirement IDs, small commits, update this file, never commit secrets or `.env`.
    Remind the owner to push at the end of each domain.
12. After each domain: the 5-line summary, then continue unless the owner must decide something. **Stop and ask
    before** changing an owner decision, adding any feature from the deferred list, or anything needing money,
    secrets or real hardware.

## Done

- 2026-09-30 — ADR-31 (stack and tooling) written and approved by the owner.
- 2026-09-30 — Tooling scaffold. **TESTED** (2 tests passing; environment in ADR-31 §14):
  - npm workspaces (`server`); dependencies pinned exactly, `min-release-age=7`, `engine-strict`.
  - dbmate migrations in `db/migrations/`, forward-only; `db/schema.sql` generated.
  - Vitest harness: one template database migrated per run, a private clone per test file, pools as both roles.
  - `server/test/citations.test.ts`: every table, constraint, index, function, trigger and domain must carry a
    `Cites:` comment whose IDs appear in `/docs`; a self-test proves the checker flags violations.
  - `scripts/db-setup.ps1` + `db-bootstrap.sql`: creates `smartstore_owner` and `smartstore_app` and the dev database,
    and writes `.env`. Tested on a scratch cluster: fresh run, refusal when `.env` exists, `-ResetPasswords`, and both
    URLs log in under `scram-sha-256`.
  - `docs/database/CONVENTIONS.md`: naming, keys, time, money, quantity, vocabularies, scoping, deletion, grants,
    citations, migrations.
  - `d0` foundation migration: the `nonblank_text` domain.
- 2026-09-30 — **Domain 1 — Organization / Store / Warehouse.** DESIGNED + IMPLEMENTED (migration) + **TESTED**
  (57 tests passing). No application code. [D1 design](docs/database/D1-ORGANIZATION-STORE-WAREHOUSE.md).
  - Tables: `currency`, `organization`, `store`, `store_setting_version` (append-only, `REQ-AU-06`), `warehouse`,
    `storage_location`, `storage_location_attribution` (D-03), `document_type`, `document_number_sequence` +
    `allocate_document_number()` (`BI-42`).
  - Schema-wide tests added: every table's scope classified (`RT-001`), no float columns (`BI-01`), runtime role
    has no `DELETE` anywhere, append-only tables have no `UPDATE`, `created_at` is always server time (`RT-353`),
    no cascading foreign keys (`AU-32`).
  - Mutation-checked: three guards removed one at a time, each test went red.
  - Guards that depend on later tables are registered in CONVENTIONS §12 and D1 §6, not stubbed.

- 2026-09-30 — **Domain 2 — Product / Barcode / Unit.** DESIGNED + IMPLEMENTED (migration) + **TESTED** (105
  tests passing, 10 consecutive clean runs). No application code. [D2 design](docs/database/D2-PRODUCT-BARCODE-UNIT.md).
  - Tables: `state_machine_state`/`state_machine_edge` (lifecycles as data, one trigger enforces any machine),
    `unit`, `tax_category`, `tax_rate`, `category`, `brand`, `product`, `product_variant`, `product_barcode`,
    `variant_price`, `store_variant_price`, `variant_standard_cost`.
  - Scan path: exact match on `uq_product_barcode_active_key (organization_id, lookup_key)`; UPC-A and EAN-13
    spellings of one code are one barcode; check digits validated in the database.
  - Mutation-checked: four guards removed one at a time, each test went red.

- 2026-09-30 — **Domain 3 — Inventory ledger.** DESIGNED + IMPLEMENTED (migration) + **TESTED** (146 tests
  passing on 6 consecutive runs). No application code. [D3 design](docs/database/D3-INVENTORY-LEDGER.md).
  - The only way stock changes is inserting a movement: a `SECURITY DEFINER` trigger validates it, applies the delta
    in one atomic statement, judges the negative-stock policy on the result in the same transaction, and stamps the
    resulting balance. The application cannot write `stock_balance` at all.
  - Tables: `reason_code`, `inventory_movement_type` (closed, 17 rows), `stock_adjustment` + lines (machine from
    §22.17 as data, approver ≠ submitter, posting all-or-nothing), `inventory_transaction`, `inventory_movement`
    (append-only at every privilege), `stock_balance`. `inventory_ledger_drift()` rebuilds and alerts, never repairs.
  - Proven concurrently: last unit under `BlockNegative` resolves to exactly one success on 15 of 15 runs; 6 workers
    posting multi-line adjustments in random order produce no deadlock and zero drift.
  - Closed pending guards from D1/D2: store deactivation with stock, central never negative, movement store
    attribution (D-03), unit quantity kind frozen once used, service never stocked.
  - Batches deferred with procurement; the additive extension is designed (D3 §7). Six guards mutation-checked.

- 2026-09-30 — **Domain 4 — Sale / Payment.** DESIGNED + IMPLEMENTED (two migrations) + **TESTED** (191 tests
  passing on 5 consecutive runs). No application code. [D4 design](docs/database/D4-SALE-PAYMENT.md).
  - Till and cash: `customer` (walk-in only), `pos_terminal`, `cash_drawer`, `cash_shift` (one open per drawer and
    per employee per store, proven concurrently), `cash_transaction` (append-only), `shift_count`, payment methods.
  - Sale and payment: `checkout` holds the payment attempts that `PY-38` takes before the sale exists; `payment`
    (each attempt a row, terminal states frozen, `D-14`); `sale` born `Completed`; `sale_line` with the price
    verified against price history at the server's quote time, and cost and tax rate verified against those in
    force; the sale's `SALE` movements through the D3 write path; everything checked whole at commit.
  - Last unit under `BlockNegative` via real checkouts: exactly one sale on 5 of 5 runs.
  - Closed pending guards: organization currency and zone frozen after the first sale, tax mode frozen after a
    sale, no deactivation with an open shift, sold variant's identity fixed. Five guards mutation-checked.
  - **Owner decision needed before Step 3's card path: OQ-018** (payment submit, capture and void permission keys are
    `OPEN DECISION`).

- 2026-09-30 — **Domain 5 — Returns / Refunds.** DESIGNED + IMPLEMENTED (migration) + **TESTED** (229 tests
  passing). No application code. [D5 design](docs/database/D5-RETURNS-REFUNDS.md).
  - `customer_return` + lines: goods back against the lines of exactly one sale; a mandatory disposition that decides
    the location (Sellable, Quarantine, Damaged, ExpiredHold); the store's return window with late approval by a
    different employee; posting all-or-nothing; the stock movement names its disposition.
  - `refund` + lines: to the original tender (cash to the drawer, card to the provider) or in cash; approved by a
    second person; the hold on `Processing` bounded per line by the settled amount; tax at the stored tax in
    proportion; the drawer payout and the completion are one event; expected cash reduced.
  - Both bounds are single conditional updates of the `sale_line` counters, written only by owner triggers. **50
    concurrent returns of a five-unit line: exactly 5 succeed.** 10 concurrent refunds of the same money: exactly 1.
    `sale_counter_drift()` rebuilds the counters and the sale's status and never repairs.
  - Mutation-checked: 59 guard removals (see the log).
  - **Owner decision needed before Step 3 pays any refund: OQ-023** (the `submit to provider` and `cancel` keys are
    `OPEN DECISION`).

- 2026-10-01 — **Domain 6 — Audit.** DESIGNED + IMPLEMENTED (migration) + **TESTED** (252 tests passing on 3
  consecutive runs). No application code. [D6 design](docs/database/D6-AUDIT.md).
  - The database writes every audit event itself, from triggers, in the transaction of the change. The §22 Audit
    column is data on the state-machine edges. Every stock movement, cash transaction and price records its floor
    event, and the eight built machines record their contracted events.
  - An audited change without the authenticated actor, source and correlation id is refused (`SS054`). An edge whose
    contract needs a reason is refused without one (`SS055`); this closes the product and device reason gap of
    domains 2 and 4.
  - Events and the per-organization hash chain are append-only at every privilege. The chain is linked at commit, so
    it cannot deadlock with business locks. `audit_chain_breaks()` finds an altered, removed, tail-removed or
    unlinked event.
  - The application writes events only through `record_audit_event()`, and only its own types (`SS056`).
  - Mutation-checked: 49 of 51 detected. The two truncate guards shadow each other by design; removing both is
    detected.

- 2026-10-01 — **Domain 7 — Employee / Role / Permission.** DESIGNED + IMPLEMENTED (migration) + **TESTED** (273 tests
  passing on 4 consecutive runs). No application code. [D7 design](docs/database/D7-EMPLOYEE-ROLE-PERMISSION.md).
  - Employees, with the §22.9 machine; never deleted. Termination is refused while the employee has a till shift that
    is not closed (`SS057`).
  - Optional logins. Only an Argon2id hash, or bcrypt of cost 12 or more, is stored. Server-held sessions keep only a
    token hash and end once, with a cause.
  - The 117-key permission catalogue, and roles, grants, assignments (organization-wide or per store) and store access,
    each kept as history by recorded revocations. `employee_holds_permission()` is the one definition of what a grant
    set allows.
  - The permission each creation and edge needs is data (architecture §8.4). Its `OPEN DECISION` entries refuse until
    the owner names a key.
  - Every `*_by` column and `sale.employee_id` references `employee`. Employee names and contact details are redacted
    from the audit trail at write time (`AU-09`). Tests name TEST-ONLY staff employees seeded in the test template.
  - Mutation-checked: 41 of 41 detected, after one added test (see the log).
  - **Owner decision needed before Step 3 can reactivate an employee, re-enable a till or retry a refund: OQ-025.**

- 2026-10-01 — **Step 3, Domain 1 — Organization / Store / Warehouse: application layer.** IMPLEMENTED + **TESTED**
  (17 new tests, 290 passing). [D1 §9](docs/database/D1-ORGANIZATION-STORE-WAREHOUSE.md).
  - **The server skeleton every domain uses** (ADR-31 §5):
    - environment validation;
    - the pool, with exact `int8` (`ADR-04`);
    - `withTransaction()`, which sets the audit context per transaction and makes a bounded retry of deadlocks;
    - the error shape, with stable codes (§18.4).
  - **The one authorization gate** (§8.2). The server refuses to start if a route declares no access, names a key
    outside the catalogue, or is store-scoped with no store. Every request is checked with
    `employee_holds_permission()`, and refused unless allowed.
  - Store settings: read the version in force and those scheduled; add a version (`Config.Store`, `REQ-AU-06`,
    `SS038`).
  - Runs with `node src/main.ts`: Node 26 strips the types, so no build step and no `tsx` (ADR-31 §15).
  - Mutation-checked: 21 of 21 detected.
  - New open question: **OQ-026**, which key manages warehouses and locations. It is for the key list before
    Domain 5.

- 2026-10-01 — **Step 3, Domain 7 — Employee / Role / Permission: application layer.** IMPLEMENTED + **TESTED**
  (46 new tests, 336 passing). [D7 §9](docs/database/D7-EMPLOYEE-ROLE-PERMISSION.md).
  - **Signing in.**
    - Argon2id built into Node 26, rehashed at sign-in when the cost changes.
    - Server-held sessions: httpOnly, Secure, SameSite=Strict cookie; the database keeps only a hash of the token.
    - The same answer for a wrong username or password.
    - A throttle on the login, never on the employee (`SM-49`).
    - Read-only sessions for staff on leave.
    - Every request re-checks the session and the employee's status.
    - Rotation on sign-in. Sessions end on any assignment or access change, and on suspension or termination.
    - Every sign-in, failure, sign-out, session end and refusal is audited.
  - **The workspace**: the stores and permissions the employee holds (`MS-01`, `MS-05`, `UX-05`, `UX-08`).
  - **Onboarding** (`npm run onboard`): the organization, its Owner holding every key, and its default store, in one
    transaction.
  - **The transition endpoint** (§18.1, §8.4). It checks the permission the attempted edge names. `OpenDecision`
    refuses everyone. The Employee machine is bound.
  - **Management**: employees, logins and passwords, roles and grants (`PC-02` confirmation), assignments, and store
    access.
  - Mutation-checked: 50 of 50 detected, after 8 tests were added or strengthened (see the log).
  - New open questions: **OQ-027** (session lifetime and throttle are required settings, set by the owner) and
    **OQ-028** (`Config.Roles` overlaps `Role.*`).
  - **Owner action:** set `SESSION_LIFETIME_MINUTES`, `SIGN_IN_FAILURE_LIMIT` and `SIGN_IN_FAILURE_WINDOW_MINUTES` in
    `.env` before `npm start` (OQ-027).

- 2026-10-01 — **Step 3, Domain 6 — Audit: application layer.** IMPLEMENTED + **TESTED** (4 new tests, 340
  passing). [D6 §11](docs/database/D6-AUDIT.md).
  - Every audited change made through the server carries the role used: the ids of the roles that granted the
    checked permission at that moment, in that scope (architecture §8.5, §14.2).
  - Every response returns its correlation id, which the audit event stores (`AU-10`).
  - `npm run audit:check` checks every organization's hash chain and exits non-zero on a break (`AU-29`, `AU-30`).
  - The read path and the check's schedule stay deferred (§10).
  - Mutation-checked: 8 of 8 detected.

- 2026-10-01 — **Step 3, Domain 2 — Product / Barcode / Unit: application layer.** IMPLEMENTED + **TESTED** (20 new
  tests, 360 passing). [D2 §9](docs/database/D2-PRODUCT-BARCODE-UNIT.md).
  - **Catalogue routes**: units, tax categories and rate versions, categories, brands, products, variants with
    their first price and barcodes, barcodes, default and store prices, standard costs. The Product machine is bound
    to the transition endpoint.
  - **The below-cost rule (`PR-33`)** is enforced by the routes: refused, because v1 builds no approvals.
  - **The till's scan**: one statement, an exact barcode-key match plus the price in force and the quote time. No
    stock, no lock. Unknown, unreleased and unclassified items each get their own answer.
  - Mutation-checked: 26 of 26 detected, after 10 tests were added (see the log).

- 2026-10-01 — **The first working slice** (working agreement 9). IMPLEMENTED + **TESTED** (9 new server tests, 369
  passing) + **MEASURED**. Sign in, scan a barcode, add it to the cart in the browser, save a sale.
  - **Server:** tills and drawers, opening a shift, payment methods, and the cash sale in one transaction. These are
    built early from Domain 4. The scan now quotes with `resolve_price()` and signs each quote. A sale accepts only
    signed quotes no older than `QUOTE_MAX_AGE_MINUTES` (OQ-027).
  - **Browser:** `web/`, React + Vite. Sign in, set up a browser as a till, open the shift, scan to the cart, pay cash,
    see the outcome. It is keyboard-first, plain, and announces each action.
  - **The numbers** (`npm run perf`; ADR-31 §16), on 100,000 variants:
    - scan-to-cart over HTTP: **p95 3.4 ms**;
    - scan-to-cart in the browser, Enter to line drawn: **p95 20.6 ms**;
    - against the owner's budget of p95 ≤ 100 ms, both are **met**;
    - sale-save for 10 lines in cash: **p95 27.1 ms**. No budget is stated; **p95 ≤ 100 ms is proposed** for the
      owner's approval.
  - **OQ-018 reading (owner may veto):** a cash tender is created and captured only inside the sale's completion, as
    the `Sale.Create` side effect §22.6 names. Card payments stay refused.
  - `npm run demo` adds TEST-ONLY items, cash and a till to an onboarded organization, so the slice can be tried.
  - Mutation check: with Domain 4, which owns this code (working agreement 10).

- 2026-10-01 — **Step 3, Domain 3 — Inventory ledger: application layer.** IMPLEMENTED + **TESTED** (9 new tests,
  378 passing). [D3 §9](docs/database/D3-INVENTORY-LEDGER.md).
  - **Stock adjustment and opening balance documents** on the StockAdjustment machine (§22.17), under
    inventory-domain §5's keys.
    - A correction is entered as the counted quantity, beside the system's (`UX-36`, `UX-37`).
    - Two people submit and approve (`BI-26`).
    - Posting and reversing write their movements in the transition's transaction (`IV-14`, `IV-24`, `SS022`).
    - `BlockNegative` is honoured (`IV-16`).
  - Reason codes (`IV-33`); the store's locations, stock and ledger views (`MS-02`); `npm run ledger:check` (`IV-09`).
  - **`IV-23`**: a bounded lock wait on contended balances, `LOCK_TIMEOUT_MS`, the fifth required setting (OQ-027).
  - Mutation-checked: 21 of 21 detected, after 7 tests were added or strengthened (see the log).

- 2026-10-01 — **Shift close, `CD-20`..`CD-25`, inside Domain 4: application layer.** IMPLEMENTED + **TESTED**
  (25 tests; 403 server tests passing). [D4 §9](docs/database/D4-SALE-PAYMENT.md). Built on the owner's brief of
  2026-10-01, in six committed steps.
  - Begin count and the close are on the transition endpoint, under `Shift.Close` (§22.11). The endpoint gained two
    options: per-event payloads, validated before authorization (architecture §18.1, §24.2); and work that runs after
    the permission check.
  - Built:
    - the blind count (`CD-21`, `CD-22`, `CD-31`);
    - acknowledging a variance (`CD-23`, `CD-24`, `BI-25`);
    - the close, with its declared float written as a `ClosingFloat` row (`CD-20`, `CD-25`, `RT-526`);
    - the shift screen (`CD-30`, `RT-527`).
  - **Not built, each recorded:**
    - the denomination breakdown (decision row 8);
    - auto-close within a tolerance, and the second approver (row 9, OQ-020). The numbers do not exist;
    - a loss recorded as a cash `Adjustment` (`CD-24`). D4 §8 defers `CD-15`..`CD-17`;
    - reopen (`CD-26`, OQ-014).
  - Mutation-checked: 47 of 47 detected on the final code. That took 9 strengthened tests and one doubled check
    removed (see the log).
  - **Two schema gaps found and reported, not fixed** (the brief excluded migrations). See Next.

## In progress

**Finishing v1, on the owner's brief of 2026-10-01** (phases A to F; see Next).
- **Phase A is done.** `*.zip` is ignored, and `v1-build` is pushed (`83e752b`).
- **Phase B, finishing Domain 4, is done.** Domain 4's full mutation check detected 126 of 126. A gap found
  afterwards, a sold service's unit kind, is closed by a forward-only migration (Next, item 1.7; D4 §12).
- **Phase C is done:** the permission-key proposal waits for the owner's answer.
- **2026-10-02: the owner answered it.** The answers are owner decision D-16. The owner said "go" after the report of
  affected files and rule IDs, and the keys are applied (Phase E, step 1: migration `20261002100000_d7_d16_permission_keys.sql`;
  D7 §11, D4 §14). What Phase E still holds: the locations routes and reopening a shift (OQ-033).
  Domain 5's application layer (step 2), the card path through a simulated gateway (step 3), owner decision D-17 (step 4),
  the void and the report of unsettled payments (step 5) and owner decision D-18 (step 6) are built.
- **Phase D is under way.** The audit-log read is not built (OQ-024 item 2). The identity admin screens and the
  reference-data screen are written and tested in `web/`; they are committed with their server routes.
- The UI steps below are the earlier part of this work. U5 is Phase B's fourth step.

**The till's UI**, on the owner's instruction of 2026-10-01 ("make UI also good ui FOR CONSUMER").
- **Who:** the owner chose the till and the shift close first, built by this session now, in parallel with the web
  agent.
- **"Consumer"** means the people who use SmartStore. product-overview puts a shopper-facing web shop out of scope.
- **The limits on the look** come from ux-requirements.md:
  - one fixed look, with no theming (`UX-67`);
  - no animation in the till (`UX-68`);
  - never colour alone (`UX-52`);
  - target size and contrast at OQ-030's interim.

Steps:

1. **U1:** the design foundation and the till's shell. `web/src/styles.css` and `web/src/App.tsx`, with the drawer
   state on the bar (`UX-35`). **Done.**
2. **U2 (server):** the till's own shift read also returns a shift being counted, and each pass carries the tolerance
   (`UX-34`). **Done.**
3. **U3:** the shift close at the till: begin count, the blind count, the variance, acknowledge or recount, and the
   close (`UX-33`, `UX-34`, `CD-20`..`CD-25`). **Done.**
4. **U4:** the manager's shift review (`CD-30`), under `Cash.Count.View`. **Done.**
5. **U5**, after the web agent's tests of `Sale.tsx` land:
   - the payment panel (`UX-14`);
   - user and system errors styled apart (`UX-59`);
   - a close that cannot strand a cart (`UX-57`).

   **Done**, as Phase B's fourth step. The web agent's tests had not landed, and the owner directed it.

**Coordination:** the web agent is writing tests for `web/src/lib/api.ts` and `web/src/pos/Sale.tsx`. Both files stay
untouched until its tests are committed. Commits stage explicit paths only.

Earlier note, still true: Domain 3 is finished and committed.

The slice's Domain 4 code is **mutation-checked: 36 of 36**, after 15 tests were added (2026-10-01, see the log). The
files are `server/src/modules/sales/sales.ts`, `till.ts`, `payment-methods.ts` and `quotes.ts`, and
`server/src/modules/catalog/scan.ts` as rewritten for the slice. **Domain 4's full check, run once at the end of the
domain, detected 126 of 126** (D4 §11).

## Owner actions pending

1. Upgrade Node: `winget upgrade OpenJS.NodeJS` (installed 25.8.2 is end of life; 26 is the approved runtime).
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\db-setup.ps1` once. It asks for the `postgres`
   password locally and writes `.env`. Then `npm ci`, `npm run db:migrate`, `npm test`.
3. Push `v1-build` at the end of each domain.
4. ~~Decide what happens to the untracked `SmartStore.zip`~~. **Resolved 2026-10-01:** on the owner's instruction,
   `.gitignore` now ignores `SmartStore.zip` and `*.zip`, and the file is no longer at the root.
5. **To try the slice:**
   1. Set the five required settings in `.env` (OQ-027): `SESSION_LIFETIME_MINUTES`, `SIGN_IN_FAILURE_LIMIT`,
      `SIGN_IN_FAILURE_WINDOW_MINUTES`, `QUOTE_MAX_AGE_MINUTES`, `LOCK_TIMEOUT_MS`.
   2. Run `npm run onboard` once, to create the organization, its Owner and its store.
   3. Run `npm run demo` for TEST-ONLY items, cash and a till.
   4. Run `npm start` (the server) and, in a second terminal, `npm run web`. Then open http://127.0.0.1:5173.
   5. Sign in as the Owner and choose the till. Sign in again, open the shift, type a barcode `npm run demo` printed,
      press Enter, and press Enter twice more to pay.
6. Approve, or change, the proposed sale-save budget of p95 ≤ 100 ms (ADR-31 §16).

**Decisions the owner needs to make.** None blocks the next task.

| # | Decision | Where | Blocks |
|---|---|---|---|
| 1 | The five numbers `/docs` does not give: session lifetime, sign-in failure limit and window, quote age, lock timeout | OQ-027, `.env.example` | Starting the server (`npm start`), not the tests |
| 2 | The sale-save budget: p95 ≤ 100 ms is proposed (measured p95 27 ms) | ADR-31 §16 | Nothing |
| 3 | Accept or veto the reading that a cash tender is captured as part of completing the sale, under `Sale.Create` (§22.6) | OQ-018 "Step 3 reading" | Nothing now; cash sales rely on it |
| 4 | ~~Name the keys for card submit, capture and void~~ **Decided, D-16:** `Sale.Create`, `Payment.Capture`, `Payment.Void` | OQ-018 | Nothing; implementation waits for the owner's go-ahead |
| 5 | ~~The permission-key list~~ **Decided, D-16** (2026-10-02). Applied to the documentation only | OQ-014, OQ-023, OQ-025, OQ-026, OQ-028 | Nothing; implementation waits for the owner's go-ahead |
| 6 | The route permissions chosen where the catalogue was not explicit, listed for veto | D1 §9, D7 §9, D2 §9, D3 §9 | Nothing |
| 7 | ~~What to do with the untracked `SmartStore.zip`~~ **Resolved:** `*.zip` is ignored (owner, 2026-10-01) | Item 4 above | Nothing |
| 8 | Whether a shift count records a denomination breakdown. `RT-526` (`CD-20`) says "the denomination total is derived from the breakdown", but D4 deferred `CD-27`..`CD-29`, so the schema has no denomination tables and the count is a total. Building it needs a migration | `RT-526`, D4 | Nothing; counts are totals until decided |
| 9 | The variance tolerance and the higher threshold that needs a different approver. Interim: the tolerance is zero, so every non-zero variance needs an acknowledgement with a reason, and no second approver is required. "Closes automatically within tolerance" and the second-approver gate are unbuilt, because the numbers do not exist | OQ-020, `CD-23` | Those two behaviours only |
| 10 | Whether the declared closing float may exceed the counted amount. Interim: recorded as declared; it feeds no expected amount | OQ-029, `CD-20` | Nothing |
| 11 | Veto, or accept, two choices for receipts. (a) Recording a print's outcome and reprinting need `Sale.Create`: the catalogue has no reprint key, and receipt issuance is the cashier's work (actors-and-roles §4). (b) A reprint has no audit event: AU-12 has no type for one, and the `receipt_reprint` row is the record. The reprint's mandatory reason is your instruction of 2026-10-01; `/docs` asks for none. **Reading a receipt at the till is decided by D-16 (Q13): `Sale.Create`.** (a) and (b) stay for veto | D4 §10 | Nothing |
| 12 | Authorize one forward-only migration for manual weigh entry: the sale line's weight source (`PR-27`) and its reason code (`PR-28`), and a per-store threshold. Also give the threshold: the interim proposed is zero, so every manual weight needs a reason | OQ-032 | Manual weigh entry at the till |
| 13 | Archiving brands, units and tax categories: whether they can be archived, and what an archive stops | OQ-031 | Archiving those three only; editing them is built |
| 14 | Reopening a closed shift: what the recount counts, whether the closing float is declared again, and who the row names as closer. `Shift.Reopen` exists (D-16); the edge does not | OQ-033, `CD-26` | Reopening a shift |

Until then, tests run on a scratch PostgreSQL 17.11 cluster and a portable Node 26 in the session scratch directory
(ADR-31 §14). Nothing on the owner's PostgreSQL service is touched.

## Next

The owner's brief of 2026-10-01 (second), "finish v1 as fast as possible without breaking the working agreements",
sets the order. Phase A (housekeeping and the push) is done.

1. **The very next task: Phase B, finishing Domain 4 (Sale / Payment)**, in this order:
   1. **Two forward-only migrations, with tests,** for the guards the shift close found missing:
      - a shift's `closed_by` and `status_changed_by` cannot be rewritten (`SM-57`, `AU-05`);
      - an archived reason code is refused on a count's acknowledgement (`SS024`'s rule).

      **Done.**
   2. **The till's other edges,** disable and retire, on the transition endpoint (the Device machine, §22.12).
      **Done.**
   3. **Reading sales:**
      - a list by date, till and cashier, paged;
      - `GET /sales/:id`;
      - the receipt document, and a reprint with a mandatory reason;
      - the receipt status.

      **Done.** See D4 §10.
   4. **UI U5:**
      - the payment panel (`UX-14`);
      - user and system errors styled apart (`UX-59`);
      - a close that cannot strand a cart (`UX-57`).

      Coordinate with the web agent's tests, and stage explicit paths. **Done.**
   5. **The slice's mutation check, then Domain 4's full check, once, at the end.**
      - Files: `server/src/modules/sales/sales.ts`, `till.ts`, `payment-methods.ts`, `quotes.ts`, and
        `server/src/modules/catalog/scan.ts`.
      - Tests: `server/src/modules/sales/sales.test.ts` and `server/src/modules/catalog/catalog.test.ts`.
      - Harness: the session scratch directory's `mutate-app.mjs`, with a new `plan-d4-app.mjs`.
      - Drop `.safe()` in `products.ts`, `till.ts` and `sales.ts` first. In zod 4.6.5 `int()` and `safe()` are one
        check, so removing either is an equivalent mutant.

      **The slice's check is done: 36 of 36** (see the log). **Domain 4's full check is done: 126 of 126**, once,
      over `plan-d4-app`, `plan-shift-close`, `plan-u2`, `plan-u4`, `plan-b1`, `plan-b3` and `plan-d4-edges`
      (D4 §11).
   6. **BUILD-STATUS**, and the 5-line summary. **Done.**
   7. **Found after the check, while preparing Phase D:** a unit's kind is frozen once a movement or a stock
      adjustment line uses it, but not once a sale line does (`PR-14`, `RT-491`: "any movement or document"). A
      service moves no stock, so a sold service's unit can still change kind. **Done:** migration
      `20261001140000_d4_unit_kind_sale_lines.sql` adds the sale line to `freeze_used_quantity_kind()`, with a test,
      and its mutant is detected (D4 §12).

   Card payments wait for OQ-018's keys. Until then they are refused.
2. **Phase C:** write `docs/architecture/PERMISSION-KEY-PROPOSAL.md` (working agreement 8).
   - It covers every transition and creation without a key: OQ-018, OQ-023, OQ-025, OQ-026, OQ-028.
   - For each, the reusable existing keys, and a proposed name for the rest. Invent no keys.
   - A recommended default per question, a tick-box answer format, and the other open questions that block building:
     OQ-014, OQ-020, OQ-029, OQ-030.

   Then stop on the blocked parts only. Domain 5, card payments and employee reactivation wait for the answers.

   **Done (2026-10-01): the file is ready for the owner's answer.** It holds 14 questions, each with the catalogue
   keys that could be reused, a proposed name where none fits, a recommendation and tick boxes, and the blocking open
   questions. Every reused key was checked against the catalogue migration, and every proposed name is absent from it.
3. **Phase D, while waiting.** Only unblocked work, in this order:
   - the audit-log read, if OQ-024 allows it; otherwise record why not. **Not built:** `AU-25` and `RT-300` require
     every read of the log to be audited, and the closed `AU-12` vocabulary has no event type for a read (OQ-024 item
     2; the proposal's last table);
   - the identity admin screens. **Done:** People and Roles in the back office, with `GET /permissions` (D7 §10);
   - reference-data edit and archive. **Edit done** (D2 §10). Archive is not specified for brands, units or tax
     categories (OQ-031);
   - price history. **Done** (D2 §11);
   - selling by name. **Done** (D4 §13);
   - manual weigh entry. **Blocked** (OQ-032): it needs a forward-only migration for the line's weight source
     (`PR-27`) and its reason (`PR-28`), which Phase D is not authorized for, and the store's threshold, a number
     `/docs` does not give;
   - the onboarding wrapper. **Waiting** (2026-10-02): another session has uncommitted changes in
     `server/src/onboarding.ts`, `cli/onboard.ts` (D-15) and `web/src/App.tsx`, which this would touch. It resumes
     once that work is committed;
   - health and readiness endpoints. **Done:** `GET /health` and `GET /ready`;
   - consistent paging on every list. **Done** (CONVENTIONS §18);
   - housekeeping jobs, only if no new dependency is needed. **Not built** (OQ-024 item 8): scheduling would need no
     new dependency, but `AU-16` makes a scheduled job record each run, and `AU-12` has no type for one.

   **Phase D stands at:** built, the identity screens, reference-data edits, price history, selling by name, the
   probes and paging. Blocked: the audit-log read (OQ-024 item 2), manual weigh entry (OQ-032), reference-data archive
   (OQ-031) and housekeeping jobs (OQ-024 item 8). Waiting on the other session's uncommitted work: the onboarding
   wrapper.
4. **Phase E, after the key list is approved:**
   - the keys applied, never renamed without asking;
   - Domain 5: returns, then refunds;
   - card payments through the simulated gateway;
   - Domain 5's mutation check.

   **The keys are decided (D-16, 2026-10-02) and applied** (Phase E, step 1; see the log). Q8, a refund's retry under
   `Sale.Refund` while paying it is `Refund.Pay`, was raised back to the owner, who gave no change. **Still to build:**
   routes for warehouses and storage locations (`Config.Organization`). **Domain 5's
   application layer is built** (step 2 in the log; its focused mutation check is there too). **Not buildable yet:**
   reopening a shift (OQ-033).
5. **Phase F:**
   - typecheck, tests, perf, ledger check and audit check, measured against the p95 ≤ 100 ms budget;
   - a "what is left before a real store can use this" list. It names GAP-044, GATE-Q2-LICENCE and GAP-038 as release
     blockers, not engineering ones.

   **Run 2026-10-02, before Phase E,** because Phase E waits for the owner. The list is
   `notes/WHAT-IS-LEFT.md`, and the numbers are appended to ADR-31. Run it again after Phase E.

Step 3 builds the one authorization gate (architecture §8.2). Two guards moved there from the database: it sets the
audit context, and it binds every `*_by` column to the signed-in employee (CONVENTIONS §12).

Update this file after every step, including steps that failed and were abandoned.

## Log

Append-only. One dated line per step, including failed and abandoned attempts.

- 2026-09-30 — ADR-31 proposed, then approved by the owner ("approved which makes my project latency low use it";
  read as: approved as proposed, lowest-latency option where a choice existed — Fastify, Node 26). The installed
  Node is v25.8.2, which is end of life and outside Vitest 5's declared `engines`; the owner has to upgrade it
  (`winget upgrade OpenJS.NodeJS`).
- 2026-09-30 — Tooling scaffold. Four failed attempts, each fixed and kept here:
  (1) `pg_ctl start` through the tool shell hung, because the server inherited the tool's output pipes. Fixed by
  starting `postgres.exe` detached with redirected output.
  (2) `dbmate --strict migrate` failed with "flag provided but not defined": in dbmate 2.36.0 `--strict` belongs to
  `migrate`. Corrected to `migrate --strict` (ADR-31 §14).
  (3) The first citation test failed because the foundation migration has no tables and the test demanded at least
  one. The test was wrong. It now checks that a migration is recorded, and a self-test plants violations to prove the
  checker is not vacuous.
  (4) Vitest 5.0.3 was published today, so the new 7-day release-age rule excludes it; pinned 5.0.1.
  The scratch cluster first ran with `fsync` and `synchronous_commit` off. It was restarted with defaults before any
  measurement, so later timings are not flattered.
- 2026-09-30 — Domain 1. Two failed attempts, each fixed:
  (1) The new schema-wide test caught a real defect in the draft migration: `GRANT INSERT ON currency` was
  table-level, which let the application supply `created_at`. Changed to a column-level grant before commit. The
  migration had only been applied to throwaway test databases.
  (2) The first mutation check reported the central-not-sellable test as vacuous. It was the harness that was wrong:
  the mutated migration still had the constraint's `COMMENT`, so it failed to apply and no test ran. Redone properly,
  the test goes red. The migration file was restored byte for byte after each mutation.
  Also: the untracked `docs.zip` present at session start is gone from the working tree. This session's commands did
  not delete it (the one `Remove-Item` attempted was blocked, and it targeted a scratch file). Flagged to the owner.
- 2026-09-30 — Domain 2. Failed attempts, each fixed:
  (1) The first run had two failing tests whose expectations were wrong: PostgreSQL runs BEFORE triggers before CHECK
  constraints, so a self-move is refused by the cycle trigger (`SS006`), not the check (`23514`), and `OutOfStock` by
  the state machine (`SS004`). The tests now expect the named codes and prove each CHECK separately.
  (2) Three tests were flaky (about 3 failing runs in 17). Two used the test process's clock to ask "what is in force
  now" against database-stamped times. One called `has_column_privilege` with a literal column name that SQL's
  unordered WHERE evaluation sometimes applied to `schema_migrations`. Fixed at the root and confirmed by 10
  consecutive clean runs.
  (3) Twice wrote SQL-style `''` escapes into TypeScript strings (a syntax error), and once patched it with a
  `.replace` hack before replacing that with proper double-quoted strings.
- 2026-09-30 — Domain 3. Failed attempts, each fixed:
  (1) A heredoc append of the inventory fixtures failed in the shell; nothing was written, which was checked before
  the fixtures were added with the Edit tool.
  (2) Two test expectations were wrong, not the schema: an unlisted movement type is refused by the line's closed type
  list (`23514`) before its foreign key runs; and a line's `store_id` is proven through its document's composite key,
  which the schema-wide store test now accepts (a key into `store` or into another store-scoped table).
  (3) Wrote SQL-style `''` quotes into four TypeScript test names again, and an `await` inside a non-async arrow;
  caught by the typecheck before any run and fixed.
  Decided in design, stated for the owner: batches are deferred with procurement (they are created by goods receipts
  and keyed per supplier), with the extension designed in D3 §7; opening stock loads through an `OpeningBalance`
  adjustment until import jobs exist.
- 2026-09-30 — Domain 4. Failed attempts, each fixed before commit:
  (1) A cash-transaction foreign key listed three columns against a four-column key; caught on review before the
  first run, fixed with a matching three-column key on `cash_shift`.
  (2) The citation checker refused a comment citing `P1` (an architecture principle label, not a rule ID); the
  replacement `RT-344` was then judged the wrong citation on reading it, and `RT-040` ("a client-supplied price is
  ignored") was used.
  (3) Two shift tests asserted the wrong thing: a zero-float and a missing-float case collided with the one-open-shift
  index first. Rewritten on a second till so each asserts what it claims. And one more SQL-style quote in a test
  name, caught before running.
  All 191 tests passed on the first full run after those review fixes. Design decisions stated for the owner:
  `checkout` (a structure PY-38's order requires; its name and statuses are this design's own), the quote-time price
  check (RT-124 over architecture s10.3), and the nine open questions OQ-014..OQ-022.
- 2026-09-30 — Domain 5. Failed attempts, each fixed before commit:
  (1) Review of the first draft against the specification, before any run, found five defects.
      - A `MATCH FULL` on the refund's till key would have required a till on every card refund, because `store_id` is
        never null. Replaced with an all-or-nothing check.
      - A cap on refunds per original tender that the specification never states. Removed; now OQ-023.
      - A `Completed → Returned` sale edge with an invented event name. Replaced: the status now moves through the two
        contracted edges.
      - A store default disposition allowing four values where organization-model §3 allows two. Narrowed.
      - A movement with no disposition, where `BE-36` requires the movement to name it. Added, proven by key.
  (2) PL/pgSQL ends an `IF` condition at the first `THEN`, so `IF CASE … WHEN … THEN` did not parse. The test
      template migration failed and no test ran. Fixed with parentheses. dbmate printed "Applied" for the file before
      the error, so the mutation harness judges a broken migration by dbmate's failure message instead.
  (3) The scratch development database still had the first draft applied. It was dropped and rebuilt from the
      migrations (scratch cluster only), so `db/schema.sql` is generated from the committed migration.
  (4) The mutation plan exposed seven guards that no test yet exercised. A test was added for each before the run:
      - a refund to a declined card attempt, which needed a `declinedCardAttempts` option in the sale fixture;
      - rewriting a refund's submitter;
      - rewriting a refund's approver;
      - a late approval without a reason;
      - a cash refund row without its refund;
      - lines claiming another sale than their document's.
  Result: 229 tests passing on 4 consecutive runs, and 59 of 59 mutations detected. Decisions stated for the owner are
  in D5 §8 and OQ-023. The most important: **no refund can be paid until the owner names the `submit to provider`
  permission key.**
- 2026-10-01 — Domain 6. Failed attempts, each fixed before commit:
  (1) `(a, b) IS DISTINCT FROM (subquery)` is not a row comparison PostgreSQL accepts. The template migration failed;
      rewritten with `NOT EXISTS`.
  (2) Referencing `NEW.direction` in a trigger function shared with tables that have no such column fails when
      PL/pgSQL prepares the expression. Caught on review and read through `to_jsonb(NEW)` instead.
  (3) Turning audit on made seven earlier tests fail, as intended:
      - product and device transitions now need a reason, supplied through a new `withReason` fixture;
      - the new tables needed classifying in the schema rules.
  (4) Four guards had no test of their own before the mutation run (source vocabulary, raw actor, raw store, session
      time zone). A test was added for each.
  Decisions stated for the owner, in OQ-024 and D6 §3: the vocabulary gaps (`Cash.In`, reading the log, master data
  and configuration), `AU-02` against `AU-20`, the reading of "on exit", and the tender's event.
- 2026-10-01 — Session recovery under a pasted "continuation protocol" that assumed C-06 was still open and Phase 3
  unauthorized, and so forbade migrations and code. Repository evidence, which the protocol says wins, contradicts
  both premises. Read-only inspection:
  - **C-06 is closed.** Commit `446aea6` closed it on the owner's acceptance. `measure-c06.ps1` passes today (all
    asserted checks): 1161 rules `mapped`, 0 `inferred`, a two-way bijection, ten batches summing to 342, and 175
    drafted rows (RT-355..RT-529). The disclosed limits stand: the per-rule reasoning was lost and rebuilt
    mechanically, and 49 rule identities are not reconstructable.
  - **Phase 3 is authorized** by Constitution §35 (commit `31f3f70`), and ADR-31 was approved. Domains 1 to 6 are
    committed; Domain 7 is uncommitted (see In progress).
  - **One discrepancy, recorded and not resolved.** C-06 review §15 reports 48 coverage rows resolving to an OUT OF
    SCOPE row. The file measures 50 canonical homes (52 counting any listed home) at every commit since the rebuild
    baseline `bc96f2d`, so the gap predates the closure. `requirements-traceability.md` is byte-identical to its
    state at `15e27ac`: no Phase 3 work has touched it.
  - **An untracked `SmartStore.zip` (210 MB) appeared at the root at 00:49.** It was not made by this session, it is
    not ignored by `.gitignore`, and it must not be committed.

  Nothing was continued: the pasted protocol forbids migrations and code, and there is no open C-06 row to work on.
  The only change was to this file. Exact next operation, once the owner says which instruction governs:
  - **Continue the v1 build:**
    1. Add a test that a revoked assignment grants nothing (P21).
    2. Re-run mutations P09 and P15.
    3. Record Domain 7 as done here.
    4. Commit.
    5. Remind the owner to push.
  - **Stop Phase 3 work:** leave the Domain 7 files uncommitted, delete nothing, and ask what should happen to them.

  Must not be done without that answer: committing the Domain 7 migration, or re-opening C-06, which is recorded as
  closed on owner acceptance.
- 2026-10-01 — The owner answered "claude --continue". It was read as **continue the v1 build**, the first option
  offered, whose scope ended at finishing Domain 7, committing, and the owner pushing. Domain 7 was finished.
  Failed attempts, each fixed before commit:
  (1) `COMMENT ON INDEX x ON table` is not PostgreSQL syntax (the form is `COMMENT ON INDEX x IS`). The same mistake
      was made more than once. Each time the template migration failed and no test ran.
  (2) A bash heredoc mangled the generator script for the mutation plan. It was rewritten as a Node script with the
      file tool.
  (3) The first mutation run detected 38 of 41:
      - **P21 survived, a test gap.** The only test that revoked an assignment did so after the employee's store
        access had gone, so the result never depended on the revocation. A test now revokes an assignment and nothing
        else.
      - **P09 and P15 were inconclusive.** The test run failed before any test: dropping the template gave `42501`
        "permission denied to terminate process".
      - **The root cause was found, not retried around.** Autovacuum visits the freshly seeded template about a
        minute after seeding. `DROP DATABASE … WITH (FORCE)` run by a role that is not a superuser cannot end an
        autovacuum worker. Back-to-back runs, as in a mutation run, start in that window.
      - **The fix.** Both drops in the harness (the template, and each test file's clone) are now plain
        `DROP DATABASE`, which stops autovacuum itself.
      - **The proof.** A probe that waited for an autovacuum worker inside a database reproduced `42501` with
        `FORCE`, and dropped the database in 251 ms without it.
      - The re-run detected all three: 41 of 41.
  Result: 273 tests passing on 4 consecutive runs. Decisions stated for the owner are in D7 §8 and OQ-025. Step 3 was
  not started (see Next).
- 2026-10-01 — `v1-build` was pushed: 9 commits, ADR-31 through Domain 7. `git push -u origin v1-build` was run in
  this session at the owner's request, after a check found no `.env`, no archive and no file over 409 KiB in the
  range. The owner then said **"start Step 3"**, with six rules, recorded as working agreements 7 to 12. That instruction
  supersedes the pasted protocol's "no application code". CLAUDE.md's "Current phase" gets a dated note so that a
  later session does not stop at "design only".
  - Noted for the record: Constitution §6 lists "Phase 4 — UI/UX system" before implementation. No Phase 4 document
    exists. The browser slice follows `ux-requirements.md` and architecture §5, and is plain (`UX-67`, `UX-68`). It is
    built because the owner asked for it by name.
- 2026-10-01 — Step 3, Domain 1 (application layer). Failed attempts and corrections:
  (1) The first typecheck failed on an index that might be undefined in the error mapping. Fixed before any run.
  (2) Before the mutation run, review found that the rollback test could not fail: an uncommitted row is invisible
      from another connection either way. The test now commits a further transaction on the same connection, and
      the missing-`ROLLBACK` mutation is detected.
  (3) Mutation G04's search text matched twice, because `auditContext()` has the same refusal. The harness reported
      it as a bad match rather than running it. It was re-run with a unique match and detected.
  (4) A PowerShell string replacement on the mutation plan silently matched nothing. The plan was edited with the
      file tool instead.
  The new open question OQ-026 (who manages warehouses and locations) blocks nothing until Domain 5.
- 2026-10-01 — Step 3, Domain 7 (application layer), in three commits (`26bc545`, `74f817d`, `7d76ad0`) and a fourth
  for the mutation check. Failed attempts and corrections:
  (1) **A real bug, found by a test.** The workspace's permission lists arrived as the string
      `"{Config.Store,Sale.View}"`. `permission.key` is a domain type, and pg does not parse arrays of a domain type.
      The keys are now cast to `text`.
  (2) Typecheck: a test helper typed a request payload as `unknown`, which made Fastify's `inject` resolve to its
      callback overload. The helper's payload is now `object`. The tests had passed at run time.
  (3) A test expected a second archive of a role to fail with `SS001`. The database treats a repeat by the same
      person as a no-op, and refuses only a rewrite by someone else. The test was wrong. The route now makes a
      repeat explicitly idempotent and keeps who archived first (the `SM-04` pattern).
  (4) Planning the mutation run found six guards no test reached. A test was added for each:
      - the salt per hash;
      - the subject's row lock, now proven by the error code a concurrent change produces;
      - who changed a transition;
      - a login set on another organization's employee, which would have been a cross-tenant hole had the
        organization filter been lost;
      - the role list after a revocation;
      - that the required settings have no defaults.
  (5) The first run still let two survive:
      - the store-permission check on a till sign-in: the only refused till was another organization's;
      - the transition's actor: the creator and the changer were the same person.
      Both tests were strengthened, and both mutations are detected.
  (6) The gate was refactored, which left Domain 1's mutations of its permission check matching nothing. Two
      mutations of the refactored check were added; both are detected.
  Result: 336 tests passing; 50 of 50 mutations detected.
- 2026-10-01 — Step 3, Domain 6 (application layer). One correction before commit: planning the mutation run showed
  that the multi-role test could not catch a wrong exclusion of a role. It now includes:
  - an archived role;
  - a role whose grant was revoked;
  - a revoked assignment;
  - a role assigned only in a store, on an organization-level action.

  None of them counts as a role used. All 8 mutations are detected. The three `.env` loaders (server, onboarding, chain
  check) became one `loadDotEnv()`.
- 2026-10-01 — Step 3, Domain 2 (application layer). Failed attempts and corrections:
  (1) A test expected a zero price to be refused as `invalid_value`, after a standard cost of 700 had been set, so the
      zero was refused first as `below_cost`. Both refusals are right. The test now checks zero before setting the
      cost.
  (2) **Test fidelity.** The test servers used the test helper's pool, which lacks the server's exact-`int8` parser,
      so money arrived in tests as strings and in production as numbers. They also used connections carrying a
      default audit context, which would have hidden a route that forgot to set its own. Test servers now get a pool
      built exactly as `main.ts` builds one, with no defaults, and every route still passes.
  (3) Planning the mutation run found nine guards no test reached. A test was added for each:
      - four cross-organization writes and reads (tax rate, category, variant, product), any of which would have let
        one organization reach into another's catalogue;
      - a new primary barcode;
      - an archived variant;
      - future prices;
      - Discontinued selling.
      One more survived the first run (a variant's first barcode added on its own) and has a test now. 26 of 26
      detected.
- 2026-10-01 — The vertical slice. Failed attempts and corrections:
  (1) Three catalogue tests failed after the scan began quoting with `resolve_price()` and signing its quotes. They
      still expected the old answer, with a price `source` and no `quote`. The expectations were updated.
  (2) A sale test's own SQL named an ambiguous `status` column. Another expected the opening float as a string,
      though the server's pool returns exact numbers. Both tests were fixed; the sale itself was right in each case.
  (3) A Node edit through bash mangled its quoted match strings and changed nothing. The three test lines were edited
      with the file tool.
  (4) The web app's typecheck did not know the CSS import. Vite's client types were added.
  (5) The browser check first expected Playwright's Chromium build 1243. The machine had 1234; `PERF_CHROMIUM` names
      it, and nothing was downloaded.
  Two design points were corrected before any code depended on them:
  - The scan had duplicated the price resolution in its own SQL. D4 §3 makes `resolve_price()` the one rule for both
    the quote and the sale line's check, so the scan now calls it.
  - Quote times would have lost their microseconds in a JavaScript `Date`. The quote now carries the database's own
    timestamp text.
  Domain 2's scan mutations (S04 to S06) were written against the old query. Domain 4's mutation check covers the scan
  as it is now.
- 2026-10-01 — Step 3, Domain 3 (application layer), then the session wrapped up at the owner's request. Failed
  attempts and corrections:
  (1) A location check was injected through a Node script, and its message's apostrophe broke a single-quoted string.
      The typecheck caught it; the string is now double-quoted.
  (2) A test expected another store's stock list to be empty. The Owner has no access to that store, so the right
      answer is a 403 (`EM-13`). The test was wrong and now expects the 403.
  (3) Planning the mutation run found six guards no test reached. A test was added for each:
      - an opening balance's reversal key;
      - a recount against a non-zero system quantity;
      - the document family;
      - another store's document;
      - a repeated archive;
      - the `IV-23` lock timeout, proven with a real held lock.
      The first run then let one survive: the reason list's organization filter, because the test ran before any
      second organization existed. It now creates one. 21 of 21 detected.
  Session end: 378 tests pass, and both workspaces typecheck. Nothing is in progress. The next task is Domain 4's
  mutation check of the slice's code (Next, item 1).
- 2026-10-01 — Gap inventory and work sizing, on the owner's instruction. No application code changed.
  - `notes/MISSING-FEATURES.md`: 33 things the system does not do, each marked **specced and unbuilt** or **not
    specced**, because only the first kind is backlog under `CLAUDE.md`. `notes/WORK-SPLIT.md`: the same inventory
    sorted into hard (about 550 rules, 16 workstreams) and routine (about 100–150 rules plus a dozen screens), each
    routine item naming the file to copy. `notes/README.md` says what the folder is and is not. Kept out of `/docs`
    on purpose: they are analysis, and `docs/` is the specification.
  - Sizing was read, not assumed: all 47 route registrations, `server/src` (41 files), `server/test` (13), all 9
    migrations, `web/` (11 files, one screen), `OPEN-QUESTIONS.md` (OQ-001..OQ-028), and the §26.2 coverage table
    (1,161 rules / 529 requirements / 25 canonical homes).
  - **Defect found in the traceability file.** §23 claims 354 requirement rows, §24 `GR-01` claims 819 cited and
    320 `inferred`, §24 `GR-06` and §25 `GR-01`/`GR-06` claim 140 machine-assigned, and §26.3 claims 48 coverage
    rows on an `OUT OF SCOPE` row. Measured: 529 rows (`MUST` 490, `SHOULD` 11, `COULD` 4, `OUT OF SCOPE` 24),
    1,161 cited, 0 `inferred`, and **50** `OUT OF SCOPE` rows. Counted from the file and cross-checked against
    `measure-c06.ps1`, which agrees.
  - **Fixed append-only, not by rewriting.** §27 added to `requirements-traceability.md` naming each superseded
    statement and its true figure; `git diff --numstat` is 61 insertions and **0 deletions**. Four dated
    forward-pointers added at the head of §23, §24, §25 and beside §26.3's figure, so a reader who lands on a stale
    table is sent to §27. No number, wording or citation was altered. `measure-c06.ps1` passes before and after:
    529 rows, 1,161 coverage rows, 1,161 mapped, 0 inferred, mapped-but-uncited 0, cited-but-absent 0, batch
    populations summing 342 — **ALL CHECKS PASSED**.
  - **The 48 / 50 difference is left open, not papered over.** Likely cause, from §26.3's own Batch 5d bullet: that
    batch drafted two `OUT OF SCOPE` rows, `RT-514` (`EM-05`) and `RT-529` (`CD-37`), one rule each, and
    `48 + 2 = 50`. Recorded in §27.2 as a reading, not a verified cause, and as an open reconciliation for the owner.
  - **A mutation-test session was reverted at the owner's instruction and is not part of the build.**
    `sales.test.ts`, `catalog.test.ts` and `test/fixtures.ts` were restored to HEAD; the new
    `src/http/errors.test.ts` was deleted (copy kept outside the repo). Before the revert it had reached 28/28
    sales tests and 21/21 catalog tests passing. **None of it was committed, so Domain 4's mutation check is still
    outstanding and is still Next item 1.** Nothing in this entry should be read as that work being done.
  - Still uncommitted and unchanged by this session: `.env.example` (the five OQ-027 values, written as
    `KEY= 15` with a space, which a `.env` loader may not trim) and an untracked `.vscode/settings.json` naming an
    ESP-IDF path. Neither has been committed.
- 2026-10-01 — **Shift close, step 1 of 6: begin count.** The owner's brief of 2026-10-01 makes `CD-20`..`CD-25` the
  single objective. Another agent owns `web/**`, so every commit stages explicit paths.
  - **Read first:** CLAUDE.md, the Constitution (all of it), OWNER-DECISIONS, OQ-014 and OQ-020, cash-management
    §2–§8, `requirements-traceability.md` §26.2 for `CD-20`..`CD-25`, `notes/WORK-SPLIT.md`, and the D4 triggers.
    The traceability rows cited are `RT-526` (`CD-20`), `RT-243`/`RT-072` (`CD-21`), `RT-244` (`CD-22`..`CD-25`),
    `RT-245` (`CD-23`) and `RT-246` (`CD-25`).
  - **Built:** the Shift machine is bound to the transition endpoint (`server/src/modules/sales/shift-close.ts`).
    `Open → Reconciling` needs `Shift.Close` (§22.11, `CD-20`), and is audited as `Shift.StateChange` by the
    database. The endpoint gained one generic option: a binding may say how to find its subject's organization,
    because `cash_shift` has none of its own.
  - **Tests:** 3 new (403 without `Shift.Close`; no sale while counting, and a repeat is a no-op; another
    organization's shift is not found). Root `npm test`: server 381, web 20, all passing.
  - **Found, not built:** `RT-526`'s acceptance includes "the denomination total is derived from the breakdown". The
    schema has no denomination tables: D4 deferred `CD-27`..`CD-29`, with counts as totals in v1. Adding them is a
    migration, which the brief excludes, so the count is a total and the breakdown is a decision for the owner (see
    "Decisions the owner needs to make").
- 2026-10-01 — **Shift close, step 2 of 6: the blind count.**
  - **Built:** `POST /stores/:storeId/shifts/:shiftId/counts { countedAmount }`, under `Shift.Close` in the store
    (`CD-20`). It locks the shift and refuses unless the shift is `Reconciling` (`not_counting`; the database's
    `SS042` is the backstop). It then inserts one pass. Only the response reveals the expected amount and the
    variance, both computed by the database (`CD-21`, `CD-22`, `CD-31`, `RT-243`, `RT-244`). A recount is a new pass,
    and the earlier one stands (`SM-57`).
  - **Tests:** 4 new:
    - counting before the count begins is refused;
    - 2200 counted against 2250 expected gives −50, and 2300 gives +50, as passes 1 and 2;
    - earlier passes stand, and the runtime role cannot rewrite a counted amount (`42501`);
    - `Shift.Close`, whole non-negative minor units, and the shift of this store are required.

    Root `npm test`: server 385, web 20.
- 2026-10-01 — **Shift close, step 3 of 6: acknowledging a variance.**
  - **Built:** `POST /stores/:storeId/shifts/:shiftId/counts/:countId/acknowledge { reasonCodeId }`, under
    `Cash.Variance.Acknowledge` in the store (`CD-23`, `RT-245`, `BI-25`). It refuses three cases:
    - a count with no variance (`nothing_to_acknowledge`);
    - a reason from another organization (`invalid_reference`);
    - an archived reason (`SS024`).
  - The database writes who acknowledged and when, once (`SS001`), and only while the shift is reconciling (`SS042`).
    The variance stays as counted (`CD-24`).
  - **OQ-020, as the owner's brief directs:** the tolerance is zero, so every non-zero variance needs this
    acknowledgement. The different approver "beyond a higher threshold" is not applied, because no threshold exists.
    One person holding both keys may count and acknowledge their own pass. A test records that, so configuring a
    threshold later has to change it on purpose. Both unbuilt behaviours are now row 9 of "Decisions the owner needs to
    make". The denomination breakdown that step 1's entry pointed at is row 8.
  - **Tests:** 6 new:
    - a manager acknowledges with a reason, and a cashier without the key is refused;
    - a matching count has nothing to acknowledge;
    - a missing, foreign or archived reason is refused, and the row is left unacknowledged;
    - a second acknowledgement is refused (`SS001`), and the count and variance are unchanged;
    - OQ-020's interim position;
    - an unknown count or shift is not found.

    Root `npm test`: server 391, web 20. `npm run typecheck` clean.
- 2026-10-01 — **Shift close, step 4 of 6: the close.**
  - **Built:** `Reconciling → Closed` (event `close`, `Shift.Close`) on the transition endpoint, with
    `payload: { closingFloat }` (`CD-20`, §22.11). Two generic options were added to the endpoint:
    - a binding may declare an event's payload. It is validated before the subject is looked up or the permission
      checked, so a malformed close gets the same 400 with or without `Shift.Close` (architecture §18.1, §24.2);
    - a binding may do work before the state changes, after the permission check.
  - **Before the close,** the latest pass decides (`SM-57`):
    - no pass is refused (`not_counted`, `CD-20`);
    - a non-zero, unacknowledged variance is refused (`variance_unacknowledged`, with the count's id; `CD-23`,
      `CD-25`);
    - otherwise the declared float is written as a `ClosingFloat` movement out of the drawer (cash-management §5).
  - The close records `closed_by`, and the database stamps `closed_at` and audits `Shift.Close`. The database's
    `SS042` checks all three conditions again.
  - **Counting and acknowledging now share one guard:** a locked shift in `Reconciling`. A closed shift's message no
    longer tells the counter to begin a count it cannot begin.
  - **OQ-014, as the brief directs:** `reopen` and `Reconciling → Open` are refused. Neither has an edge row, so the
    endpoint answers `illegal_transition`, even for the Owner, and the database answers `SS004` at any privilege.
    `CD-26` is out of scope.
  - **New open question:** OQ-029, whether the declared float may exceed the count. `/docs` sets no bound, so none is
    applied; it is row 10 of the decisions table.
  - **Tests:** 7 new:
    - a matching count closes, with the float, who, when, and the audit event;
    - the float is required and whole, a malformed close is 400 even without the key, and a zero float is a
      declaration;
    - no close from `Open`, and none without a count;
    - an unacknowledged variance blocks the close and leaves nothing behind;
    - the latest pass decides;
    - closing again is a no-op with one float, and a closed shift takes no count or acknowledgement;
    - OQ-014.

    Root `npm test`: server 398, web 20. `npm run typecheck` clean.
- 2026-10-01 — **Shift close, step 5 of 6: the shift screen.**
  - **Built:** `GET /stores/:storeId/shifts/:shiftId` and `GET /stores/:storeId/shifts?status=&limit=`, under
    `Cash.Count.View` in the store ("see counts and variance history", actors-and-roles §2.10; `MS-02`).
  - **The four answers** (`CD-30`, `RT-527`), from the latest pass, the one the close is decided on:
    - `expected`;
    - `counted`;
    - `variance` against `tolerance`, which is 0 under OQ-020;
    - `why`: the reason, who acknowledged it, and when;
    - `next`: `begin count`, `count`, `acknowledge`, `close`, or nothing once closed. Reopening is undecided under
      OQ-014.
  - The detail adds every pass, in order, as it stands (`SM-57`). The list carries the answers only.
  - **Blind by construction** (`CD-21`, `CD-31`, `RT-243`): every figure comes from a submitted pass. Before one, the
    only number in either answer is the tolerance, even for someone who holds both `Shift.Close` and
    `Cash.Count.View`.
  - **Not shown:** the opening float and the declared closing float. `CD-30` limits the screen to the four answers,
    and cash reports are out of scope (`CD-32`, `RP-13`).
  - **Tests:** 5 new:
    - the four answers through a whole close;
    - the latest pass answers, and the history keeps every pass;
    - the screen and the list are blind before a count;
    - `Cash.Count.View` is required, with this store's shifts only;
    - the list is newest first, filters by status, and has a limit.
  - **Citation correction:** step 4's first close test cited `RT-246`, which is the reopen row. It now cites
    `RT-526`, `CD-20`'s row, whose acceptance it proves ("the declared next float is recorded as a cash row"). `RT-246`
    moved to the OQ-014 test, which concerns reopening.

    Root `npm test`: server 403, web 20. `npm run typecheck` clean.
- 2026-10-01 — **Shift close, step 6 of 6: the mutation check and the docs.**
  - **Planning the 47 mutants (one per guard) found 9 gaps.** A test was strengthened for each before any run:
    - each of the 4 keyed routes is refused to someone holding every other key of the feature. Before this, a mutant
      swapping in another key the same people held would have survived;
    - another organization's shift, counted through its own store, is refused;
    - another shift's count, named under this shift, is refused;
    - this shift, acknowledged through another organization's store, is refused;
    - another organization's archived reason answers `invalid_reference`, not `SS024`, so its state stays hidden
      (§24.3);
    - a closer who did not open the shift is recorded as the closer, in `closed_by` and in the float's `created_by`
      (`AU-05`);
    - someone without `Shift.Close` who tries to close an uncounted shift is refused before anything about the count
      is said.
  - **Run 1:** 45 of 47 detected.
    - **C11 and C17 survived.** Both removed `.int()` from `z.number().int().safe().min(0)`.
    - They were equivalent mutants, not missing tests. In zod 4.6.5, `int()` and `safe()` are the same check: both
      refuse 12.5 and 2^53, verified directly.
    - Fix: the repeated `.safe()` was dropped from the shift close's two schemas.
    - The same doubled check is in `products.ts`, `till.ts` and `sales.ts`. That is outside this brief, so it is
      recorded in Next.
  - **Run 2, on the final code:** 47 of 47 detected, and every file was restored byte for byte. The plan is
    `plan-shift-close.mjs` in the session scratch directory.
    - `git diff --stat faa3115 -- server/src/http/transitions.ts` is empty.
    - On `shift-close.ts`, the same diff shows only the two schema lines and one comment line.
  - **A probe** verified two schema gaps. It was a temporary test, run once; the test file was restored byte for
    byte. Both gaps are reported, not fixed, because the brief excluded migrations. D4 §9 and Next describe them:
    - the runtime role can rewrite `closed_by` and `status_changed_by` on a closed shift, with no audit event
      (2 events before, 2 after);
    - the database accepts an archived reason on a count's acknowledgement.
  - **Docs:** D4 §9, the shift close's application layer and its mutation check.

    Root `npm test`, the full suite: server 23 files and 403 tests, web 2 files and 20 tests, all passing.
    `npm run typecheck` is clean for both workspaces.
- 2026-10-01 — **UI, step 1 of 5: the design foundation and the till's shell.** The owner asked for a good UI for
  the people who use SmartStore, and chose the till and the shift close first, built now, in parallel with the web
  agent.
  - **Read first:** ux-requirements.md in full. It specifies behaviour, not looks, but it bounds the look:
    - one fixed design (`UX-67`);
    - no animation in the till (`UX-68`);
    - never colour alone (`UX-52`);
    - targets and contrast (`UX-53`, `UX-54`). Their numbers were deferred to Phase 2 and never set, so they are
      recorded as **OQ-030 (new)**.
  - **`web/src/styles.css`:**
    - one fixed palette, as variables. Every text pair measured WCAG AAA; the lowest is 7.29:1;
    - every control is at least 3rem tall;
    - a yellow focus ring in a black halo, visible on light and on dark;
    - no transition or animation anywhere;
    - the till laid out in two columns: scan and cart on the left, total and payment on the right. This is done in
      CSS only, because `Sale.tsx` is under the web agent's tests;
    - an empty cart that says what to do.
  - **`web/src/App.tsx`:**
    - the bar shows where (organization, store, till), who is signed in, and the drawer state in words beside a
      symbol (`UX-35`, `UX-52`);
    - sign-in, till set-up and opening the shift are cards.

    Behaviour is unchanged.
  - **Tests:** `web/src/App.test.tsx`, 4 tests (`UX-35`, `UX-52`, `UX-07`, `UX-08`, `CD-10`), with `fetch`
    stubbed.

    Root `npm test`: server 403, web 24 (3 files). `npm run typecheck` clean.
- 2026-10-01 — **UI, step 2 of 5: what the counting screen needs from the server.**
  - **The till's own shift read** (`GET /stores/:storeId/shift`) also returns a shift being counted, with its status
    (`UX-35`, `UX-33`).
    - Before, a till whose shift was `Reconciling` was told "no shift", and offered to open one, which the database
      would refuse.
    - It still returns at most one shift, by the same index (`CD-01`), and none once the shift is closed.
  - **Each pass carries the tolerance it is judged against,** from one constant (zero, OQ-020). The counting screen
    can then show counted, expected, variance and threshold together without the browser hardcoding the interim
    (`UX-34`).
  - **The till** now shows a shift being counted as its own mode, with no sale screen. U3 fills in that mode.
  - **Tests:** 2 server (`UX-35`/`UX-33`/`CD-01`; `UX-34`/OQ-020) and 1 web (`UX-35`/`UX-33`/`BI-39`).
  - **Mutation check of the new guards:** 5 of 5 detected, restored byte for byte (`plan-u2.mjs` in the session
    scratch directory).

    Root `npm test`: server 405, web 25 (3 files). `npm run typecheck` clean.
- 2026-10-01 — **UI, step 3 of 5: closing the shift at the till.** New file `web/src/pos/ShiftClose.tsx`; `Sale.tsx`
  untouched.
  - **Asking first** (`UX-02`):
    - "Close shift…" appears only with `Shift.Close` (`UX-08`);
    - it asks above the sale, which stays mounted, so "Keep selling" returns to the cart exactly as it was (`UX-57`);
    - the safe choice has the focus, and the question says that sales stop until the close (OQ-014: no way back).
  - **The count** is its own mode (`UX-33`) and is blind: nothing on screen says what the drawer should hold until the
    count is submitted (`CD-21`, `CD-31`).
  - **The variance screen** shows counted, expected, difference and allowed difference together (`UX-34`), and names
    short, over or balanced in words beside a symbol (`UX-52`).
  - **A difference:**
    - with `Cash.Variance.Acknowledge`, it is acknowledged with a reason from the live list (`CD-23`, `BI-25`);
    - without the key, the till says a manager must acknowledge it, and offers no control (`UX-08`);
    - "Count again" starts a new blind pass (`SM-57`).
  - **The close** declares the float left in the drawer, in the currency's decimal places, and zero counts as a
    declaration (`CD-20`, `RT-526`). The summary stays until "Done", and the bar says "Shift closed".
  - **The server decides every step.** A refusal is shown in its words, with the count still on screen (`UX-55`,
    `UX-57`).
  - **Tests:** `web/src/pos/ShiftClose.test.tsx` (11) and `web/src/App.test.tsx` (3 more), with `fetch` stubbed and
    every request body checked.
  - **One test failure on the way:** the first test expected exactly one request. A short count rightly also fetches
    the reason list for someone who may acknowledge, so the test was wrong, not the code. It now checks that nothing
    is fetched before the count, and what the count sends.

    Root `npm test`: server 405, web 39 (4 files). `npm run typecheck` clean.
- 2026-10-01 — **UI, step 4 of 5: the manager's shift review.**
  - **Server:** the shift screen names its till and its people, where it had given ids:
    - who opened and who closed the shift;
    - who counted each pass;
    - who acknowledged a difference, which is `CD-30`'s "approver".

    It uses the workspace's name form. This is a stated decision, recorded in D4 §9: holders of `Cash.Count.View`
    see these names. The test names the cashier, manager and closer apart, so no join can borrow another's name.
    Mutation check of the joins: 7 of 7 detected, restored byte for byte (`plan-u4.mjs`).
  - **Web:** new file `web/src/back/Shifts.tsx`, shown when signed in away from a till.
    - It offers only the sections the person may use: "Shifts" under `Cash.Count.View`, "Till set-up" under
      `Device.View` (`UX-05`, `UX-08`). With both, they are tabs, the current one marked in weight and underline.
    - The list shows each shift's till, opener and status in words beside a symbol, then expected, counted, and the
      difference in words. A shift not yet counted shows only dashes (`CD-30`, `CD-31`, `UX-52`).
    - The detail shows the four answers, what happens now, and every count as it stands (`SM-57`). A difference
      waiting for an acknowledgement can be acknowledged there, with a reason, by someone allowed to (`CD-23`,
      `BI-25`). That way a cashier without the key is not stuck at the till.
  - **Tests:** 1 server, 6 in `web/src/back/Shifts.test.tsx`, and 2 more in `web/src/App.test.tsx`.
  - **Fixed on the way:** React warned that the status-filter test ended before the filtered list rendered (an update
    "not wrapped in act"). The test now waits for the list. The whole web suite runs without a warning.

    Root `npm test`: server 406, web 47 (5 files). `npm run typecheck` clean.
- 2026-10-01 — **The owner's brief to finish v1: Phase A, housekeeping.**
  - **`.gitignore`** now ignores `SmartStore.zip` and `*.zip` (`83e752b`).
  - **Checked before the push:**
    - no blob over 1 MB is in the 30 unpushed commits;
    - the only secret-looking path is `.env.example`, whose two connection strings carry placeholder passwords
      (checked without printing them);
    - no `.env` is tracked.
  - **Pushed:** `git push origin v1-build`, `ab2ce8a..83e752b`. `v1-build` equals `origin/v1-build`.
  - **Next** now follows the brief's phases B to F. Owner action 4 and decision row 7 (the zip) are resolved.
- 2026-10-01 — **Phase B, step 1: the two guards the shift close found missing.** Migrations are authorized for this
  phase, forward-only.
  - **`20261001120000_d4_shift_actors_fixed.sql`:** `status_changed_by` and `closed_by` change only together with a
    shift's status, at any privilege (`SS001`; `SM-57`, `AU-05`).
  - **`20261001120100_d4_count_reason_live.sql`:** a count's acknowledgement takes only a live reason (`SS024`;
    `CD-23`, `BI-40`), through the existing `assert_reason_code_live()`.
  - **One failed attempt:** the first run stopped at the template build. dbmate requires a `-- migrate:down` block,
    which I had left out. Both files now end with the repository's forward-only down block, which raises.
  - **The route's archived-reason check was removed.** It had become a copy of the database's, with the same code and
    message, so its mutant could only be equivalent. The route still looks the reason up in the caller's organization
    first, which keeps another organization's archived reason from answering `SS024` (§24.3).
  - **Tests:** 2 new. A rewrite is refused as the runtime role and as the owner role, on an open shift and on a closed
    one. An archived reason is refused at the database.
  - **Mutation check of the new guards:** 5 of 5 detected, restored byte for byte (`plan-b1.mjs`). It includes
    mutants of the migrations themselves; each test run rebuilds the template.
  - **`npm run db:migrate`** applied both migrations and rewrote `db/schema.sql`. Its diff is only the new objects and
    the two migration versions.
- 2026-10-01 — **Phase B, step 2: the till's disable and retire edges.**
  - **No code was needed.** The Device machine was already bound to the transition endpoint, and §22.12's edges,
    keys, reasons and audit types are data. The 3 new tests passed on their first run: this step proves the behaviour.
  - **Disable** (`Active`/`Degraded` → `Disabled`): needs `Device.Disable` (`Device.Edit` is refused) and a reason
    (`SS055`), and is audited with that reason.
    - A disabled till sells nothing and opens no shift (`SS025`).
    - Its open shift can still be counted and closed. Nothing in the close (`CD-20`) depends on the till being in
      service, so the money is still reconciled.
  - **Re-enable** (`Disabled` → `Active`) is refused for everyone, the Owner included (`not_permitted`), until the owner
    names its key (OQ-025).
  - **Retire** (any state → `Retired`): needs `Device.Edit` (`Device.Disable` is refused) and a reason. The till stays
    listed, because a till is never deleted (`HD-08`, `BI-40`). Retiring again changes nothing, and no edge leaves
    `Retired`. A till never activated can be retired too.
  - **Not built:**
    - `HD-31`'s approval for disabling a till in use. It is a SHOULD, and the approval engine is outside v1;
    - a back-office screen for these edges.
  - **Noted, not changed:** sign-in does not check whether a till is in service, and no rule asks it to. A retired till
    can be signed into, but cannot open a shift or sell (`SS025`).
  - These rules live in migration data, so their mutants belong to Domain 4's full mutation check at the end.
- 2026-10-01 — **Phase B, step 3: reading sales, and the receipt.** D4 §10.
  - **Reading:** the store's sales, newest first and paged by document number, filtered by business date, till,
    cashier and receipt status (`MS-02`, §18.5). `receipt=Failed` is `SP-58`'s reprint queue. One sale's existing
    `GET /stores/:storeId/sales/:saleId` stays store-scoped, as `MS-02` requires; it is what the brief's `GET /sales/:id`
    asks for.
  - **The receipt** renders the stored sale with `SP-59`'s mandatory core and no cost (`SP-57`, `SP-60`).
  - **The first print's outcome** is recorded once (`SP-03`, `SP-58`).
  - **A reprint** repeats the original numbers under a banner, sets `Reprinted`, and is recorded with who, when and why.
    The reason is mandatory, by the owner's instruction; `/docs` asks for none. It needs a new forward-only migration,
    `20261001130000_d4_receipt_reprint.sql`, with a reason-liveness trigger (`SS024`) and append-only triggers.
    `npm run db:migrate` applied it and rewrote `db/schema.sql`.
  - **Keys** are `Sale.View` to read, and `Sale.Create` to record a print's outcome or reprint. The catalogue has no
    reprint key. This is row 11 of the decisions table, for veto.
  - **A shared name helper** (`identity/names.ts`) replaces the shift screen's own copy.
  - **Failed on the way:**
    - the citations test refused "CONVENTIONS s11" in a `Cites:` comment, which must hold only rule IDs;
    - the receipt printed a quantity as "1.0000". `trim_scale()` now prints the stored quantity without trailing zeros.
  - **Tests:** 6 new in `sales.test.ts`. `schema-rules.test.ts` classifies the new table as store-scoped and
    append-only.
  - **Mutation check:** 24 mutations; 23 detected on the first run. The survivor, P06, showed that no test refused a
    reprint to someone with only `Sale.View`. A test was added, and P06 is now detected. Planning also strengthened 4
    tests (D4 §10).
- 2026-10-01 — **Phase B, step 4: UI step U5.**
  - **Coordination:** the web agent's tests of `Sale.tsx` and `api.ts` had not landed, and none of its files was in
    the tree. The owner's brief directed U5, so `Sale.tsx` was changed. Every existing label, test id and behaviour is
    kept. The new tests are in `web/src/pos/SaleScreen.test.tsx`, a name apart from the `Sale.test.tsx` that the web
    agent's brief reserves. The web agent's files were not touched.
  - **The payment step** (`UX-14`, `UX-15`, `UX-17`) shows the total due, the cash given, and the change or what is
    still to pay, as the cash is typed.
    - An empty field is the exact total. Text that is not an amount gives a dash.
    - An underpayment is named, says what to do, and is not sent. The server refuses one too (`SP-40`).
  - **Problems are styled by whose they are** (`UX-59`), through one small component, `web/src/lib/Problem.tsx`,
    used on every screen:
    - a refusal or a value to correct is an amber "⚠ Check";
    - a server failure (5xx) or a lost network is a red "✖ System problem", and says the till is still working and
      nothing on screen was lost.
  - **No close over a cart** (`UX-57`): the sale screen tells the till how many lines it holds. While there are any,
    "Close the shift?" says how many items there are and what to do, and offers only "Keep selling".
  - **A bug the new tests caught:** an exact payment showed its change as "-£0.00". JavaScript's negative zero is
    printed with a minus sign; the change is now never below a positive zero.
  - **Tests:** 7 new in `SaleScreen.test.tsx` and 1 in `App.test.tsx`. They also cover `SM-04` (a retried save sends
    the same operation id) and `BI-30` (the outcome shows the server's amounts).
  - **Not built:** printing and recording the receipt at the till. The server side is done (D4 §10). Printing needs a
    printer device, or a browser print flow decided with the owner.
- 2026-10-01 — **Phase B, step 5a: the slice's mutation check.** `plan-d4-app.mjs` in the session scratch directory:
  36 mutations, one per guard, of `sales.ts`, `quotes.ts`, `till.ts`, `payment-methods.ts` and `catalog/scan.ts`.
  - `.safe()` was dropped first from three money schemas (`products.ts`, `till.ts`, `sales.ts`). In zod 4.6.5 it is
    the same check as `int()`, so removing either is an equivalent mutant (D4 §9).
  - **The first run detected 21 of 36.** Each of the 15 survivors was a guard no test reached, so a test was added for
    each. No check was weakened.
    - A quote with a part appended (Q03), a tax category with no rate in force yet (S04), a tax-exclusive store (S06),
      and a service line, which moves no stock (S10).
    - **S12 looked equivalent, and is not.** The database's key catches a repeat too, but without the early answer a
      repeat is checked again: a retry after the store stopped taking cash was refused. The test now proves the retry
      gets its sale.
    - **The old race test never raced (S13).** The second request always found the first's sale before it reached the
      key. The test now holds the `checkout` table until both repeats wait at the key, so the loser must answer with
      the winner's sale.
    - `Sale.Create` to sell (S15), and another store's sale is not found (S16).
    - A session at another store's till (T02), the till list (T03), and a second sellable location must be named
      (T04).
    - Payment methods: the list, another organization's method, and an unknown one (P01–P03).
    - **No price at a store (C04)** is reachable, though the database requires a price on an active variant
      (`RT-042`, `SS008`): `resolve_price()` gives none at a store whose currency differs from the price's.
  - **The second run detected 15 of 15**, and every file was restored byte for byte. The slice's total is 36 of 36.
  - 423 server and 55 web tests pass, and both workspaces typecheck. Next: Domain 4's full check, once.
- 2026-10-01 — **Phase B, steps 5b and 6: Domain 4's full mutation check, once, at the end of the domain.**
  - Seven plans, 126 mutations: `plan-d4-app` 36, `plan-shift-close` 45, `plan-u2` 5, `plan-u4` 7, `plan-b1` 5,
    `plan-b3` 24, `plan-d4-edges` 4. **All 126 detected**, and every plan restored its files byte for byte. The run
    took about 70 minutes, mostly in `shift-close.test.ts`.
  - D4 §11 records both runs, and what each plan mutates.
  - Nothing in `server/` or `db/` changed during the run. Phase D's web screens were written meanwhile, and the
    server's tests were not run, so that no test run could overlap the harness.
  - **A gap found afterwards**, while reading the unit rules for Phase D: `freeze_used_quantity_kind()` (domain 3)
    checks movements and stock adjustment lines, but not sale lines. `PR-14` and `RT-491` freeze a unit's kind once
    "any movement or document" uses it, and a sold service moves no stock. It is Next item 1.7: a forward-only
    migration, under Phase B's authorization.
  - **OQ-031 raised:** `/docs` gives no archive to brands, units or tax categories, which the brief's Phase D lists
    to "edit/archive". Editing is unblocked.
  - Phase C is done: the permission-key proposal is committed (`776d318`) and waits for the owner.
- 2026-10-01 — **Phase B, step 7: a sale line freezes its unit's kind** (`PR-14`, `RT-491`). D4 §12.
  - Migration `20261001140000_d4_unit_kind_sale_lines.sql` replaces `freeze_used_quantity_kind()` with a third
    branch, for sale lines. Return and refund lines always follow a sale line of the same variant, so they need none.
    `npm run db:migrate` applied it and rewrote `db/schema.sql`.
  - The service-sale test now proves the sold service's unit cannot change kind (`SS021`). Its mutant, the branch
    switched off, is detected (`plan-b7.mjs`), and the file was restored byte for byte.
- 2026-10-01 — **Phase D: the identity admin screens.** D7 §10.
  - **Audit-log read: not built**, as the brief allows. `AU-25` and `RT-300` require every read of the log to be
    audited, and `AU-12` has no event type for a read (OQ-024 item 2; the permission-key proposal's last table).
  - **People** (`Employee.View`):
    - the organization's people a page at a time, with each status in words beside a symbol;
    - adding a person, giving a sign-in or a new password, giving a role in all stores or one and removing it, and
      giving and taking away access to a store;
    - each change is offered only with its key, and says that the person was signed out (`EM-16`).
  - **Roles** (`Role.View`):
    - each role's permissions;
    - making a role from catalogue keys grouped by area;
    - adding a key, and archiving after a question;
    - removing a key shows the server's count of employees who lose it, and is sent again with that number
      (`PC-02`).
  - **Server:** `GET /permissions` (`Role.View`), the catalogue the roles screen offers.
  - **Shared pieces:** `web/src/lib/Chip.tsx`, the status chip (the shift screen now uses it), and
    `web/src/test/serve.ts`, the fetch stub for new tests. The four older copies in existing tests are left as they
    are.
  - The tabs wrap, and permission boxes are full-row targets (`UX-53`).
  - Keys held organization-wide show the tabs, because the gate checks these routes organization-wide.
  - **Coordination:** the web agent's tests of `api.ts` have still not landed. The next commit adds `PATCH` to
    `api.ts`'s method list, an additive one-word change, because the brief's reference-data edits need it.
  - Tests: 1 server (the catalogue, its key) and 12 web (5 People, 6 Roles, 1 App). `plan-d-server.mjs` detected
    both of the route's mutants.
  - Not built: an employee's status changes from the People screen (suspend, leave, terminate). The transition
    endpoint has them; reactivation waits for the owner's keys (OQ-025).
- 2026-10-01 — **Phase D: editing reference data.** D2 §10.
  - **Server:** `PATCH /units/:id` and `PATCH /brands/:id` (`Product.Edit`), and `PATCH /tax-categories/:id`
    (`Tax.Edit`). One helper writes only the fields sent, and only on a row of the caller's organization. The
    database keeps the rules an edit could break: a used unit's kind (`SS021`, which now has its own message), a
    countable unit's decimal places, and the codes' and names' uniqueness. A rate is never edited: a new rate is a
    new version (`RT-047`).
  - **Web:** "Units, tax and brands" in the back office, shown with `Product.View` or `Tax.View` held
    organization-wide. Units, tax categories with their rates in force, and brands can be listed, added and changed.
    A new rate can be added from now or from a later time.
    - An edit sends only what changed.
    - The screen says three things before the server does: a countable unit's decimal places, a malformed rate,
      and a form with nothing changed.
  - **Coordination:** `api.ts` gains `PATCH` in its method list, as the previous entry said it would.
  - **Archive is not built** for these three: OQ-031.
  - **Decision for veto:** units and brands are changed with `Product.Edit`, as categories are (D2 §10).
  - Tests: 3 server and 7 web (6 for the screen, 1 App). `plan-d-server.mjs`: 11 of 11 detected over both Phase D
    server steps, restored byte for byte.
- 2026-10-01 — **Phase D: price history.** D2 §11.
  - **Server:** the existing `GET /variants/:id/prices` also answers who set each version, and the currency's
    decimal places.
  - **Web:** "Prices" in the back office, with `Product.View` and `Price.View` held organization-wide.
    - It finds a product by name, a page at a time.
    - It shows each live variant's versions newest first: scheduled, in force, or replaced (`PR-32`, `RT-041`).
    - With `Price.Edit`, a new price is set from now or later. The server's refusals are shown in its words.
  - **Not shown:** a store's own prices. No route reads them yet.
  - Tests: the server's price test now lists the whole history, set by two differently named people. 2 web tests.
    `plan-d-prices.mjs` detected the setter's join, 1 of 1.
  - **A mutant left unclaimed:** fixing the decimal places at 2 would survive, because the fixtures have one
    currency, with two places. D2 §11 says so.
- 2026-10-01 — **Phase D: selling by name at the till.** D4 §13.
  - **Server:** `GET /stores/:storeId/items?name=` (`Sale.Create`). A name is looked up by name only, never as a
    barcode (`UX-48`, `RT-379`).
    - It returns only what this store can sell (`UX-47`, `UX-49`): released, live, classified, priced here, and at
      most 20.
    - Each item carries a signed quote with no barcode, so its line is recorded as `Selected` (`RT-489`).
    - The scan and the lookup now share one row mapping and one quote signer.
  - **Web:** "Or find an item by name" under the scan field. The item chosen joins the cart, and focus goes back to
    the scan field. Nothing found is said, and the cart is untouched (`UX-11`). `api.ts`'s `Scanned.barcode` may be
    null.
  - Tests: 2 server (catalog: what a name finds and does not; sales: a found item is sold as `Selected`) and 2 web.
  - **Mutation check:** `plan-d-name.mjs`, 10 of 10. The scan's 9 mutants were re-run after the refactor, and all 9
    are detected.
    - Two of `plan-d4-app`'s search texts changed with the code: C08, the quote's store, and C09, the scan's key,
      which now matched the new route too. Both were updated, re-run and detected.
- 2026-10-01 — **Phase D: manual weigh entry, not built.** OQ-032 (committed as `bc1d782` by the owner's session).
  - `PR-27` and `SP-16` store a weight with its source, and `PR-28` and `SP-18` need a reason for a manual weight
    above a per-store threshold.
  - `sale_line` has no column for either, and `/docs` gives no threshold. The migration that would add them is not
    authorized for Phase D.
  - A typed decimal quantity would be exactly that unrecorded manual weight, so a sale still takes whole quantities.
- 2026-10-02 — **A second session works in this tree.** At session start the tree held commits under the owner's git
  identity:
  - `8448a7c` merges the web agent's `api.ts` and `Sale.tsx` tests, so the coordination hold on those two files is
    over;
  - `6eafe76` fixes a key name in the role templates;
  - `bc1d782` commits OQ-032.
  - **Uncommitted work by that session:** D-15 (the deployment currency is NPR with exponent 2) in
    `OWNER-DECISIONS.md`, OQ-006, `tax-and-currency.md` and onboarding; a new `AGENTS.md`; and a back office in
    `web/` (products, sales, stock, tills, adjustments, setup).
  - This session does not stage, revert or edit those files. Its commits stage explicit paths only.
  - **The shared tree's web suite is red, from that work:** `web/src/back/Products.test.tsx` fails 7 tests, and it
    and `Setup.test.tsx` do not typecheck. Both files are that session's, uncommitted. Until they land, this session's
    server-only commits are checked with the server suite and the server typecheck. The web suite is run to show
    that its only failures are in those files.
- 2026-10-02 — **Phase D: liveness and readiness.**
  - `GET /health` answers while the process runs, and touches nothing else.
  - `GET /ready` answers once the database replies within a second. Otherwise it gives 503 and `{ status:
    'not_ready' }`, with nothing about why (architecture §24.3, §25.4).
  - Both are public and outside `/api/v1`, because they are not part of the API. They are not the §25 signals
    (ledger, auth, invariants, jobs); `ledger:check` and `audit:check` remain those.
  - `/docs` has no requirement row for a server probe. The owner's brief is the justification.
  - Tests: 3, including a database that refuses, and one that does not answer: the pool's only connection is held,
    and the probe still says not ready in about a second. `plan-d-health.mjs`: 4 of 4 detected.
- 2026-10-02 — **Phase D: consistent paging on every list** (architecture §18.5). CONVENTIONS §18.
  - **One way for every list:** `limit` (1 to 200) and `after`, answered with `{ items, next }`.
  - **Bounded and paged for the first time:** units, tax categories, categories, brands, roles, an employee's roles
    and stores, reason codes, payment methods, tills and locations.
  - **Bounded before, now paged:** price versions (it was 50), shifts and stock (both were up to 500).
  - **Short configuration lists default to the full 200,** because screens, including the other session's
    uncommitted ones, read them whole. They page by position, through one helper (`http/paging.ts`).
  - **The sales list and the movement ledger** answer `next` and take `after`, and still answer and take `before`.
    The other session's uncommitted sales and stock screens use `before`, so dropping it waits for them.
  - **Not paged, by design:** the permission catalogue (117 keys, fixed by migration) and the till's name lookup (at
    most 20, `UX-49`).
  - `storeLocations()` was folded into its one route; `STORE_LOCATIONS` stays, because adjustments use it.
  - **Tests:** one table-driven test pages 15 lists two at a time, and checks that the pages, joined, are the whole
    list in its order. It also walks the ledger by `before`, and checks the 200 cap, the 200 default (60 units come
    whole) and a bad cursor. The sales reading test now pages by `after` and by `before`.
  - **Mutation check:** `plan-d-paging.mjs`, 24 of 24. Each route's offset is neutralized, keeping its parameter
    bound so that the failure is the paging and not SQL. The shift-close plan's R12 search text moved with the code;
    it was updated, re-run and detected.
  - 435 server tests pass, and the server typechecks. The web suite fails only in the other session's uncommitted
    `Products.test.tsx`.
- 2026-10-02 — **Phase D: housekeeping jobs, not built.** OQ-024 item 8.
  - `/docs` names reconciliation, outbox delivery, Pending-payment resolution, report jobs and batch-expiry proposals.
    Only the ledger reconciliation exists to schedule; it, and the audit-chain check, run as commands on demand.
  - Scheduling needs no new dependency. `AU-16`, though, makes a scheduled job record what it did and changed, in
    the `AU-12` vocabulary, and no type there records a job's run. Adding one is a reviewed change for the owner
    (`AU-13`), as for the audit-log read.
  - `OPEN-QUESTIONS.md` held the other session's uncommitted OQ-006 resolution, which rests on its uncommitted D-15.
    Only item 8 was staged: the staged copy is the committed file plus the new item, built with
    `git hash-object` and `git update-index`. The working file keeps both changes.
- 2026-10-02 — **Phase F, run before Phase E**, because Phase E waits for the owner. `notes/WHAT-IS-LEFT.md`.
  - **Typecheck:** the server passes. The web fails only in the other session's uncommitted `Products.test.tsx` and
    `Setup.test.tsx`.
  - **Tests:** server 435 of 435. Web 143 of 150; all 7 failures are in the other session's uncommitted
    `Products.test.tsx`.
  - **`ledger:check`:** every balance agrees with its ledger. **`audit:check`:** the chain is intact. Both ran on the
    deployment database, which holds little data.
  - **Perf** (100,000 variants; `PERF_CHROMIUM` named the machine's Chromium 1234; nothing was downloaded):
    - scan-to-cart, HTTP: p95 5.1 ms;
    - scan-to-cart in the browser: p95 24.1 ms;
    - both meet p95 ≤ 100 ms;
    - sale-save, 10 lines, cash: p95 69.1 ms (max 190.8 ms). That meets the proposed 100 ms, but is 2.5 times the
      first run's 27.1 ms.
  - **On the sale-save rise:** nothing in its path changed, and the environment did. The Node on the path is now
    v26.7.0, where the first run used a portable 26.10.0, and seeding took 12.6 minutes. A re-run on the first setup
    comes before calling it a regression. Appended to ADR-31 as a dated re-measurement.
  - **The list** names the release blockers (`GAP-044`, `GATE-Q2-LICENCE`, `GAP-038`) and the owner answers that
    unblock building. It also lists the engineering left, and what v1 leaves out by decision.
- 2026-10-02 — **The tills' and people's states, on the owner's brief to finish the UI.**
  - **One shared component, `web/src/lib/Moves.tsx`, draws every state edge on a screen.** The edge, the key it names,
    and whether its contract records a reason are data; the machine in the database still decides what is legal
    (`SM-06`), so the screen offers only what is allowed from where the record stands.
  - **Every move asks its question first (`UX-03`)**, not only the dangerous-sounding ones. The earlier version sent a
    reasonless move on the click alone, which was wrong: suspending a person signs them out at once (`EM-16`), so it
    is asked like any other.
  - **A reason is asked for exactly when the edge records one (`SS055`)** — disabling a till, retiring a till, putting a
    person on leave, archiving a person — and nothing is sent until one is chosen. The reasons are read when a
    question that needs one opens, so a screen that never asks fetches nothing (it was fetching once per till row).
  - **Reactivating is `OPEN DECISION` and refuses everyone (OQ-025), so neither screen offers it**; each says why, in
    words, where the button would have been. The old tills screen offered a Disabled to Active button that always
    failed.
  - **Permissions are per edge, not per screen** (`UX-08`): `Device.Edit` retires but does not disable, `Device.Disable`
    does the reverse, and `Employee.Terminate` is the only key that ends an employment.
  - `People.tsx` also shows when a person's status last changed, from the new `statusChangedAt` on `Person`.
  - **Tests:** 10 added across `Tills.test.tsx` and `People.test.tsx`, for the reason being required, the keys being
    separate, the OpenDecision edge being absent, and the suspended/retired states ending. Web is now 153 of 160
    passing, and the 7 failures are still only the other session's uncommitted `Products.test.tsx`.
  - `.ask` in `styles.css` gives the question its own weight, in the warn colour beside a symbol, never colour alone.
  - **Not committed:** the working tree also holds the other session's uncommitted work, so the paths here are
    unstaged for the owner to commit.
- 2026-10-02 — **My account: a person can change their own password.**
  - The route has been there and no screen used it. `web/src/MyAccount.tsx`, reached from the person's own name on the
    bar, at the till as well as away from it.
  - **It is not behind a permission, and that is the rule, not a shortcut** (`EM-03`): the actor is the session, so the
    request names no employee and there is no id to change. It is the one screen in the product with no key.
  - **What it says is what `/docs` says:** the current password must be right and a wrong one is recorded as a failed
    sign-in (`SM-49`), so the screen says to check rather than to guess; nothing reads a password back afterwards,
    including for an administrator (`EM-04`), so every box is cleared once it has been used; and the new password is
    typed twice, so a mistyped one cannot lock anyone out.
  - **No rule about the shape of a password was invented.** The server takes two non-empty strings and sets no
    complexity rule, so the screen checks only that both are filled and that the two boxes agree.
  - **Not claimed:** a change here does not end the person's other sessions, and the screen does not say it does.
  - 6 tests in `web/src/MyAccount.test.tsx`. Web is now 159 of 166 passing, the same 7 failures in the other session's
    uncommitted `Products.test.tsx`, and the web typecheck fails only in `Products.test.tsx` and `Setup.test.tsx`.
- 2026-10-02 — **Owner decision D-16: the permission keys, recorded in the documentation only.**
  - The owner answered `PERMISSION-KEY-PROPOSAL.md` Q1–Q14, and asked for three things in order: record the answers,
    update the catalogue, state-machine and actor-role documents, then report the affected files and rule IDs before
    any implementation.
  - **Recorded:**
    - `OWNER-DECISIONS.md` D-16, with the owner's reasons for Q3, Q5, Q7 and Q14. It is numbered 16 because the other
      session's uncommitted D-15 (the NPR currency) holds 15.
    - `PERMISSION-KEY-PROPOSAL.md`: the answers, appended.
  - **Applied to the documentation:**
    - actors-and-roles §2: five new keys. The rows of the reused keys name what they now cover. `Config.Roles`
      authorizes nothing.
    - state-machines §22: seven permission cells and four reversal cells. §22.0's census goes from 27 rows with no key
      to 20, and from 117 keys to 122.
    - OPEN-QUESTIONS: OQ-014, OQ-018, OQ-023, OQ-025, OQ-026 and OQ-028.
    - The gap register, §7.8: GAP-036 narrowed.
  - **Not touched:** migrations, code and tests, nor the design documents that describe the built schema (D4, D7). They
    change with the implementation.
  - **Raised back to the owner:** Q8, a refund's retry under `Sale.Refund` while paying it is `Refund.Pay`.
  - **Staging:** OWNER-DECISIONS, OPEN-QUESTIONS and BUILD-STATUS hold other sessions' uncommitted work. Their staged
    copies are the working files with those blocks taken back out.
- 2026-10-02 — **Phase E, step 1: owner decision D-16's keys applied.** D7 §11, D4 §14.
  - **Migration `20261002100000_d7_d16_permission_keys.sql`** (forward-only; applied to the dev database, and
    `db/schema.sql` regenerated):
    - five keys join the catalogue, which now holds 122: `Payment.Capture`, `Payment.Void`, `Employee.Reactivate`,
      `Refund.Pay`, `Shift.Reopen`;
    - nine groups of edges stop refusing everyone: a card's submit (`Sale.Create`), capture and void, back from leave
      and reactivation, a till's re-enable, a return's cancel, a refund's payment, retry and both cancels;
    - `grant_to_complete_roles(keys)`, for migrations only, gives every live role that holds every other key the new
      ones, each in the name of whoever granted that role its first key, so the Owner still holds everything.
  - **The reopen edge is not created.** What a reopened shift's recount counts is unspecified: OQ-033, new.
  - **Reading a receipt now needs `Sale.Create`** (Q13). The list and a sale's detail stay under `Sale.View`.
  - **Tests:** the catalogue is 122 in three tests; the edge contract names every key; the employee test that proved
    an undecided edge refused everyone now proves each reactivation's own key and its reason; the till test now proves
    a re-enabled till trades again; the receipt's key; and the grant, on a role written as an Owner's was before D-16, a
    role missing one key, and an archived role. 437 server tests pass, and the server typechecks.
  - **Mutation check:** `plan-e1.mjs`, 16 of 16 detected, restored byte for byte. `plan-b3`'s R01 was repointed at the
    receipt's new key and re-run, and `plan-d4-edges`' V02, which mutated the old refusal, is retired.
  - **One path lost its proof:** the gate's `not_permitted` on an edge with no key has no edge left to prove it on
    among the bound machines. D7 §11 says so.
  - **Staging:** BUILD-STATUS, OPEN-QUESTIONS and `onboarding.test.ts` hold another session's uncommitted work, so
    their staged copies are the committed files plus this step's lines only.
- 2026-10-02 — **Consolidated blueprint written** at the owner's request: [SMARTSTORE-CONSOLIDATED-BLUEPRINT.md](docs/architecture/SMARTSTORE-CONSOLIDATED-BLUEPRINT.md).
  - **What it is:** one document, §0 to §12, in the structure the owner asked for: architecture, domain model, schema,
    security, business flows, hardware layer, API, project structure, code skeletons, non-functional requirements, status
    registers. Written only from `/docs`, the ADRs, the owner's decisions and the code at `f68fdc3`. It decides nothing.
  - **Labels:** every part is BUILT, SPECIFIED, DEFERRED or an OPEN QUESTION. Where the request assumed a technology the
    record does not contain (Redis, a message broker, NestJS, GraphQL, partitioning) the blueprint says so rather than
    adopting it. Stock reservation, which the request wanted, is deliberately absent (`IV-49`).
  - **New questions:** `BQ-01` to `BQ-11`, recorded as OQ-034.
  - **Not changed:** no code, migration, test or owner decision. 437 server tests pass.
  - **Staging:** BUILD-STATUS and OPEN-QUESTIONS hold another session's uncommitted work, so their staged copies are the
    committed files plus this step's lines only.
- 2026-10-02 — **Phase E, step 2: Domain 5's application layer (returns, then refunds).** D5 §10; `OQ-035`.
  - **Code:** `server/src/modules/returns/returns.ts` and `refunds.ts`, wired in `app.ts`; the CustomerReturn and Refund
    machines are bound to `POST /transitions`. Nine machines are now bound (Sale, Payment and the card refund path are
    not). Shared code gained `reasonColumnFor` on a machine, the post-use-case state in a transition's answer, messages
    for `SS046` to `SS053` with the remainder returned beside the code, and a sale's detail now names its lines'
    counters and its payments.
  - **Keys:** every one is named by the specification or D-16, and **none is an open decision**: open and line
    `Return.Create`; post and cancel `Return.Create`; late approval `Return.Approve`; draft `Sale.Refund`; submit
    `Sale.Refund`; approve `Sale.Refund.Large.Approve`; pay `Refund.Pay`; cancel and retry `Sale.Refund`. The two edges
    still `OPEN DECISION`, a return's settle and close, are not built.
  - **Not built, by choice:** a refund to a card (the provider is not built, so paying one answers
    `provider_not_available`); reading returns and refunds (no key, OQ-035); settle and close.
  - **Tests:** `returns.test.ts`, 19, through the routes. Server: 456 pass, and the server typechecks.
  - **Mutation check:** `plan-d5-app.mjs`, 33 mutations (the new routes, both machines' bindings, the shared hook, the error detail, the sale detail). 31 were detected at once. Two survived, a store predicate on a line added to another store's return and on a refund's sale, because the database's keys refused them with another status; `MS-04` tests (a 404) were added, and both are now detected. **33 of 33**, restored byte for byte.
  - **Staging:** BUILD-STATUS and OPEN-QUESTIONS hold another session's uncommitted work, so their staged copies are
    the committed files plus this step's lines only.
- 2026-10-02 — **Phase E, step 3: card payments and card refunds, through a simulated gateway.** D4 §15, D5 §11; `OQ-036`.
  - **The gateway is TEST / simulated, and says so:** `PaymentGateway` is the interface (the five commands of `PY-07`, the
    closed outcomes of `PY-10`, a merchant reference per call); `SimulatedGateway` moves no money. It is marked in its
    header, in a startup warning, in `SIM-` references, and as `simulated: true` on a payment and a refund. It accepts only
    `TEST-` tokens, so a real card number is declined and stored nowhere. A token picks the outcome, timeouts included.
    Nothing outside the gateway files and `main.ts` names it (a test, `PY-08`). A real acquirer is the owner's call.
  - **A card sale** (`card: { token, amount? }` on `POST /sales`, beside or instead of `cash`): planned and the tender checked
    first, then authorize, capture and commit (`PY-38`), the provider called between transactions (`PY-36`), resumable by the
    cart's operation id, never charging twice. Split with cash, the card first. Capturing needs `Payment.Capture` (D-16).
  - **A card refund:** `POST /refunds/:id/pay` (`Refund.Pay`) and `/retry` (`Sale.Refund`); a failure is held and retryable, a
    timeout is resolved by asking the provider. The transition endpoint refuses a card refund.
  - **No permission key is new, and none was open.** The shared test shop moved to `server/test/shop.ts`.
  - **Not built:** void and the reconciliation job, the provider per store, the card's display fields, offline card, and a
    failed card refund's cancel, which has no edge (`OQ-036` items 1 and 2).
  - **Tests:** `payments/card.test.ts`, 24. Server: 480 pass; the server typechecks.
  - **Mutation check:** `plan-card.mjs`, 29 mutations: the card sale (the steps, the tender, the keys, the concurrency), the card refund (the routes, the keys, the states) and the gateway's own promises. 26 were detected at once. Three survived: a concurrent record guard and a concurrent save (both now proved by a test of two copies of one resumed request, which also found a real race: the loser was told the card was taken and the sale not saved, when it was saved), and a capture-key check made redundant by the route's earlier one (removed). **29 of 29**, restored byte for byte.
  - **Staging:** BUILD-STATUS and OPEN-QUESTIONS hold another session's uncommitted work, so their staged copies are the
    committed files plus this step's lines only.
- 2026-10-02 — **Phase E, step 4: owner decision D-17 (`OQ-035` closed).** D5 §12, D7 §12, OWNER-DECISIONS D-17.
  - **Item 4:** a drawer refund is paid by someone signed in at the till it was drafted at (`not_at_refund_till`, whole: nothing
    is held or paid). An application rule in the refund machine's before-hook. A card refund is not affected.
  - **Item 5:** a draft refund may be withdrawn. Migration `20261002120000_d17_return_refund_view_and_withdraw.sql` adds
    `Draft → Cancelled` on `cancel`, under `Sale.Refund` with a reason, audited as `Refund.StateChange`. **The owner did not
    name that key or reason:** it is read from D-16 Q9, and raised for the owner's veto. A draft held nothing, so nothing is
    released. `ck_refund_submitted_when` gained its one exception (a cancelled refund never approved), because a withdrawn
    draft was never submitted.
  - **Items 7 and 8:** `Return.View` and `Refund.View` join the catalogue (122 → 124), granted to every role that held all the
    others. `GET /stores/:storeId/returns[/:id]` and `/refunds[/:id]`, newest first, paged by document number, filtered by
    status or sale. No write key reads.
  - **Tests:** 3 new in `returns.test.ts`; the catalogue counts, the edge contract and the audit table updated. Server: 483
    pass; the server typechecks.
  - **Mutation check:** `plan-d17.mjs`, 14 mutations (the reads, their keys and scoping, paging and filters, the payer at the till, the edge and its constraint). 13 were detected at once, one of them (the edge) because the migration then refuses to apply. One survived, a refund read outside its own store; a test of another store's refund now detects it. One is not detectable in a test: the migration's grant of the two keys to roles that already hold every other key, because the test database has no such role when the migration runs (the grant function itself is proved by D-16's test, and the Owner's role by onboarding). **13 of 13 detectable, restored byte for byte.**
  - **Next, the orphaned payments** (`OQ-036` item 2), in two parts. **A, buildable now, no new key:** void a `Pending` or
    `Authorized` card payment (`Payment.Void`, `PY-13`, the provider asked outside the transaction), and report payments that
    need a person (`PY-40`): `Pending` past a window, `Authorized` and never captured, `Captured` on an open checkout with no
    sale. The report is read under `Payment.View` (existing: "see payments and refunds") by a route and by a command like
    `ledger:check`, because the scheduler is `BQ-02`. **B, waits for the owner:** what returns the money of a payment that was
    captured and never became a sale. The payment has no way out but a linked refund, and a refund needs a sale.
  - **Staging:** BUILD-STATUS, OPEN-QUESTIONS, OWNER-DECISIONS and `onboarding.test.ts` hold another session's uncommitted work, so
    their staged copies are the committed files plus this step's lines only.
- 2026-10-02 — **Phase E, step 5: orphaned payments, part A.** D4 §16; `OQ-036` item 2 (part B waits for the owner); `OQ-037`.
  - **Void:** `POST /stores/:storeId/payments/:id/void` under `Payment.Void` (D-16). A `Pending` or `Authorized` card payment is voided
    at the provider outside the transaction; one the provider never answered is first asked about, and if it holds nothing a
    person voids it here, and the answer says so. A provider that does not confirm leaves it unchanged (`void_failed`,
    `void_pending`). Terminal; its cart is abandoned; the same sale answers `card_voided`. Captured is refunded, never voided.
  - **Report:** `GET /stores/:storeId/payments/attention?olderThanMinutes=N` under `Payment.View`, and `npm run payments:check --
    --older-than N [--store id]` (exits non-zero when anything needs a person): `PendingTooLong`, `AuthorizedNotCaptured`,
    `CapturedNoSale`. It changes nothing. **The window is required and never defaulted** (`OQ-037`).
  - **No key is new and none was open.** The simulated gateway learned `TEST-VOID-FAIL` and `TEST-VOID-TIMEOUT`.
  - **Not built:** part B (the three options are in `OQ-036`, for the owner), the scheduler (`BQ-02`), the settlement-file
    comparison, and the notification.
  - **Tests:** 10 new in `payments/card.test.ts`, one of them running the command. Server: 493 pass; the server typechecks. The
    command was also run against the development database, which had nothing to report.
  - **Mutation check:** `plan-void.mjs`, 18 mutations (the void and its guards, the report, its key, window, scope, age, order and counts). 13 were detected at once. Five survived. One was a real design flaw, found because a survivor asked why the filter existed: the report listed only payments on an open checkout, which would hide a pending payment on an abandoned one, so the filter was removed. Two needed tests (the void racing a capture, and oldest first), one became detectable once the filter was gone, and one (the simulated void's idempotency on the default path) cannot be observed and was dropped. **18 of 18**, restored byte for byte.
  - **Staging:** BUILD-STATUS and OPEN-QUESTIONS hold another session's uncommitted work, so their staged copies are the committed
    files plus this step's lines only.
- 2026-10-02 — **Phase E, step 6: owner decision D-18, the refund of a payment that never became a sale (`OQ-036` item 2, part B).** D5 §13, OWNER-DECISIONS D-18.
  - **The owner chose option 1 and confirmed the keys:** `Sale.Refund` to issue, `Sale.Refund.Large.Approve` to approve, `Refund.Pay` to pay. **No key is new.**
  - **Migration `20261002130000_d18_refund_of_a_payment.sql`:** `refund.sale_id` is optional; a refund with no sale names a captured card
    payment of its store and currency, an amount and a reason, with no return, tax or lines (`ck_refund_sale_or_payment`).
    `payment.refunded_amount`, written only by the owner's hold trigger, never more than the payment took; entering `Processing` holds it
    with one conditional increment, as a line is held (`PY-22`, `RR-24`), kept through `Failed` and `Completed`, released only by a
    cancellation. `SS058` (more than is left), `SS059` (a payment with a sale is refunded through the sale; a payment being refunded
    cannot become one, even as a draft: `assert_sale_complete()`). `payment_refund_drift()`. A captured payment stays frozen in every other
    column (`PY-12`).
  - **Application:** `POST /refunds` with no `saleId` takes `{ clientOperationId, method, paymentId, amount, reasonCodeId }`, strict. The
    machine, approval, audit, pay and retry routes and the reads are unchanged. Paying one gives its cart up (`card_refunded`). The
    report keeps a payment until all of it has been given back.
  - **Read, not written, by the owner (raised for veto, in D-18):** card payments only; partial; a reason; a refund, even a draft, blocks the sale.
  - **`OQ-036` is closed.** Its item 1, a failed card refund that cannot be cancelled, is not decided by D-18 and is moved to `OQ-038`.
  - **Tests:** 9 new in `payments/card.test.ts`, including the concurrency proof (five refunds of 1,000 against 3,000: exactly three) and
    the table's own refusals. Server: 502 pass; the server typechecks. Migrations: 16.
  - **Mutation check:** `plan-d18.mjs`, 23 mutations: the table's shape (return, tax, reason, store and currency), the sale-or-payment exclusion in both directions, the hold and its release, the frozen payment, the counter's bounds, the drift check, the report, and the application. 22 were detected, the last of them after two tests were added (the table's own refusals, and a payment-bound refund with a stray return). One survived and is equivalent: the reason is required twice, by `ck_refund_sale_or_payment` and by the older `ck_refund_goodwill_reason`, so dropping the first changes nothing. **22 of 22 detectable**, restored byte for byte.
  - **Staging:** BUILD-STATUS, OPEN-QUESTIONS and OWNER-DECISIONS hold another session's uncommitted work, so their staged copies are the committed files plus this step's lines only.
- 2026-10-02 — **Phase E, step 7: owner decision D-19, a failed refund can be cancelled (`OQ-038` closed).** D5 §14, OWNER-DECISIONS D-19.
  - **The owner chose the pattern of D-17:** `Failed → Cancelled` on the refund's `cancel` event, under `Sale.Refund`, with a required reason, audited as `Refund.StateChange`. Cancelling **releases the hold**. **No key is new.**
  - **Migration `20261002141000_d19_cancel_a_failed_refund.sql`:** the edge, and `apply_refund_hold()` releases a hold on a cancellation from `Processing` or from `Failed`, on the sold lines or, for a refund with no sale, on the payment (D-18). The edge contract and the audit table name the new edge. `Cancelled` is final: it is not retried.
  - **Tests:** 2 new in `payments/card.test.ts` (a failed refund of a sale, and of a payment with no sale: held through the failure, cancelled with a reason under the key, released, the drift checks empty, the money refundable again). Server: 504 pass; the server typechecks. Migrations: 17.
  - **Mutation check:** `plan-d19.mjs`, 4 mutations: the edge, its key and reason, and the release of the hold on a payment and on a sold line. All 4 caught; the first because the migration then refuses to apply. **4 of 4**, restored byte for byte.
  - **Staging:** BUILD-STATUS, OPEN-QUESTIONS and OWNER-DECISIONS hold another session's uncommitted work, so their staged copies are the committed files plus this step's lines only.
- 2026-10-02 — **Phase F, run again after Phase E.** ADR-31 §16 (a third table appended). `npm run perf`, `ledger:check`, `audit:check`, `payments:check`.
  - **Numbers (p95):** scan over HTTP 7.8 ms, scan in the browser 29.2 ms, **sale-save (10 lines, cash) 69.8 ms**, 100,000 variants. The budget for
    the scan is p95 ≤ 100 ms: met. Sale-save's proposed budget of p95 ≤ 100 ms, not yet approved: met, with 30 ms to spare.
  - **Against before:** sale-save p95 27.1 ms (first), 69.1 ms (second), **69.8 ms (now)**: Phase E did not move the cash path. The
    earlier 2.5-times rise is still unexplained and not Phase E's. The scan crept up (3.4, 5.1, 7.8 ms) with unchanged code.
  - **Not measured:** a card sale, a return, a refund. **The checks:** the ledger agrees with every balance, the audit chain is intact,
    and no card payment needs a person. They ran against the development database, which holds little; the same checks run
    on every test's data (`inventory_ledger_drift`, `sale_counter_drift`, `payment_refund_drift`, `audit_chain_breaks`).
  - **A first run was lost to a missing browser** (Playwright's Chromium was not installed, so the run died after 11 minutes of
    seeding, before printing a number). `npx playwright install chromium` fixed it.
  - **Staging:** BUILD-STATUS holds another session's uncommitted work, so its staged copy is the committed file plus this entry only.
- 2026-10-02 — **UI, step 1: the Returns screen** (`web/src/back/Returns.tsx`, `Returns.test.tsx`, 19 tests). The first of the owner's five screens (returns, refunds, the card panel, void, the payments report).
  - **What it does, and no more:** lists the store's returns (newest first, by status, "show more" on the server's cursor); opens a return against a sale **by its number**
    (the sales list pages by number, so the sale numbered N is the first below N + 1); adds goods (item, quantity, state, place) and removes a line; posts; cancels with a
    chosen reason; approves late. It speaks the contract of D5 §10 and D-17 exactly, and decides nothing the server decides: the bounds (`RR-14`), the window (`RR-10`), the
    place a state goes to (`RR-19`) and the late approver (`AP-08`) stay the database's.
  - **Rules it keeps:** no default state of the goods, only a choice (`RR-17`, `RR-18`); the places offered are those the state goes to, and the server judges them again; what is left to
    return is shown beside each item and an item with none cannot be chosen; past the window it names the day it closed and who must approve (`SS048`); a reason is chosen, never
    typed (`SM-42`); a refusal is said in place with its next step, and the system's failures apart from the person's (`UX-55`, `UX-57`, `UX-59`); what is spoken is what is on screen
    (`UX-51`); the first field has focus and a line added returns focus to the first field (`UX-01`).
  - **Keys, exactly the server's:** the screen is offered with `Return.View`; opening, filling, posting and cancelling need `Return.Create`; the late approval `Return.Approve`. Nothing is
    offered to someone without the key (`UX-05`, `UX-08`).
  - **Coordination with the other session:** `App.tsx`, `App.test.tsx` and `NotYet.tsx` hold that session's uncommitted work (a grouped back-office navigation). The screen uses only
    committed libraries (`api`, `Problem`, `Chip`, `Announcer`, `test/serve`), so the commit builds without their files. **Two shapes of the same wiring:** the committed `App.tsx` is the
    committed file plus the Returns tab; the working `App.tsx` has the same entry in their groups (under Sell, "Returns", `Return.View`) and their `NotYet.tsx` entry "Returns and refunds" is now
    "Refunds", because returns exist. Both were tested: the committed shape in a clean checkout of HEAD, the working shape in the tree. Their files stay uncommitted; nothing of theirs was staged.
  - **Not here:** linking a posted return to a refund (the Refunds screen, next); the store's default disposition (reading settings needs `Config.Store`, so the person chooses); who
    opened or approved (the API returns ids, not names).
  - **Tests:** web 19 new, plus 2 in `App.test.tsx` (Returns appears with `Return.View` only). The web typechecks.
- 2026-10-02 — **UI, step 2: the Refunds screen** (`web/src/back/Refunds.tsx`, `Refunds.test.tsx`, 29 tests; and `Returns` gains "Refund this return", 1 test). The second of the owner's five screens.
  - **Draft, from a sale:** find the sale by number (or arrive from a posted return); each refundable item shows **the most it can still be refunded** (settled less held, from the sale's detail), an item with nothing
    left is not offered, and choosing an item fills in that most for the person to **only reduce** (agreed in the owner's OQ-035 table, item 6); more than is left is refused in place, and a server refusal that names
    what remains (`SS049`) is shown as the amount to reduce to. Where the money goes is chosen from the sale's own tenders or as cash from the drawer, and is sent as the server takes it (`OriginalTender` with the payment, or
    `Cash` with none). A reason is required with no return (`RR-35`) and optional with one. With a return chosen, **only the lines that return took back are offered** and each shows how much came back (`SS051`).
  - **Draft, from a card payment with no sale (D-18):** the payments the report calls `CapturedNoSale` (read with `Payment.View`) are listed with what each can still give back; the amount starts at that and can
    only be reduced; a reason is required; and the body is exactly the strict shape the server takes (`clientOperationId`, `method`, `paymentId`, `amount`, `reasonCodeId`). `SS058` is shown in money.
  - **View:** a list (newest first, by status, "show more" on the server's cursor) with what each is for, its status in words, how it is paid, and the amount in the store currency; a detail with its lines, tax and status.
    A refund with no sale says so. A refund that went through the **simulated gateway says so** ("Simulated card gateway: no real money moved"), in the list and the detail (ADR-31 §13).
  - **Acts, each only with its own key (`UX-05`, `UX-08`):** send for approval, withdraw a draft and cancel (`Sale.Refund`, with a reason chosen, never typed); approve (`Sale.Refund.Large.Approve`; without it the screen says
    someone else must, and the server's refusal of the submitter is shown in place); pay (`Refund.Pay`): **cash on the transition endpoint**, **a card at its own route** (`PY-36`); retry a failed card refund at its route
    (`Sale.Refund`); **cancel a failed refund** (D-19) and a refund the provider has not confirmed, saying that cancelling releases the money held. A failed or unconfirmed card refund is shown as a state with its next
    step, not only an error, and is reloaded.
  - **Away from a till:** a cash refund is drafted and paid at one till (D-17, `PY-27`), so the cash choices are shown, explained and cannot be chosen, and a cash refund's Pay is disabled with the reason. The screen takes
    `atTill`; the back office passes false. The till will pass true when the card panel and the till tools are built (step 3).
  - **Coordination with the other session:** the same two shapes as step 1. The committed `App.tsx`/`App.test.tsx` are the committed files plus the Refunds tab, its state and the "Refund this return" hand-over; they were
    tested in a clean checkout of HEAD (65 tests, typecheck clean). The working `App.tsx` has the same entry in their groups and their `NotYet.tsx` "Refunds" placeholder is **removed**, because the screen exists. Their files stay uncommitted.
  - **Not here:** the card panel on the sale screen, the void action and the payments report (steps 3 to 5); the refund's tax per line is shown but computed by the server; who drafted or approved (ids only).
  - **Tests:** web 29 new + 1 (`Returns`) + 2 (`App`). The web typechecks. Not run in a real browser.
- 2026-10-02 — **UI, step 3: the card payment panel on the till, and the till's tools** (`web/src/pos/Tender.tsx`, `TillWork.tsx`; `Sale.tsx`; `SaleCard.test.tsx` 21 tests, `TillWork.test.tsx` 5). The third of the owner's five screens, with the void.
  - **Paying a sale (D4 §15):** with `Payment.Capture` (D-16 Q2) the payment step offers **Cash**, **Card** or **Card and cash**, cash first; without the key the till is exactly the cash sale it was (the 17 existing sale tests pass
    unchanged). A card sale sends `{ card: { token } }` and nothing the client computed; a split sends `{ card: { token, amount }, cash: { tendered } }`. The total, the card amount, the cash given, what the card leaves and the change are
    shown as they are typed; a card for the whole total, an amount that is not money, and cash that is short are each refused in place before the card is touched (`PY-16`, `PY-19`, `SP-40`). A card is never shown change. The outcome lists
    each payment (`Card $2.50 (simulated)`, `Cash $1.50`).
  - **The simulated-gateway warning:** choosing a card says in words, in a note beside a symbol, "SIMULATED card gateway: type a test card token. No real card is read and no money moves", and the outcome says it again when a payment
    was simulated (`UX-52`, ADR-31 §13). The server offers the till no way to ask beforehand whether the gateway is simulated, so `GATEWAY_IS_SIMULATED` is a constant of the build, to be changed when a real acquirer is connected. The token
    field offers the test cards (`TEST-APPROVE`, `-DECLINE`, `-FAIL`, `-TIMEOUT`) and is never stored.
  - **The failure modes (`PY-14`, `PY-54`, `SP-43`, `PY-11`, `PY-41`, `PY-39`):** a **decline** or a **technical failure** (and a void, a refund, `SS059`) ends that attempt: the message is said in place, the cart is kept, and the next payment is a **new
    payment on a new operation id**. A **timeout**, a **capture that did not go through**, and **money taken with the sale not saved** are *the same sale sent again*: the cart, the lookups and the tender are fixed ("Do not charge the card again"), the
    button becomes "Check the card payment and finish the sale" (or "Send the sale again"), and it resends the same body under the same operation id. A server failure is the system's, and a retry is the same operation. A store that does not take
    cards says so in place.
  - **The void (D-16 Q3, `PY-13`, `PY-40`):** while a card payment is pending or authorized, someone holding **`Payment.Void` and `Payment.View`** may "Void the card payment": the screen finds this cart's payment on the report by its operation id,
    voids it, keeps the cart, and the next payment is a new one. Anyone else is told who can. A void the provider does not confirm is said in place and the payment stays as it was. A captured payment is never offered a void: the screen says a manager
    can give the money back (D-18). The void also belongs on the report of payments that need a person (step 5), which will reuse the route.
  - **At a till (D-17, `PY-27`):** `TillWork` wraps the sale and offers **Returns** (`Return.View`) and **Refunds** (`Refund.View`) as tools, each only with its key. The sale stays mounted, hidden, so the cart survives (`UX-57`), and "Back to the
    sale" puts the cursor in the scan field (`UX-01`). The screens are the back office's, here with `atTill`, so **a cash refund can be drafted and paid at the till**. A posted return hands over to the refund of it.
  - **Coordination with the other session:** `App.tsx` and `App.test.tsx` again have two shapes. The committed ones are the committed files plus `ShiftGate` handing the store's keys to `TillWork` and 2 shell tests; they were tested in a clean
    checkout of HEAD with the whole web suite (186 tests, typecheck clean). The same edit is applied to their working `App.tsx`. `Sale.tsx` and `lib/api.ts` (the sale's `payments`) are mine and were unmodified by them. Their `SaleScreen.test.tsx` and
    `ShiftClose.test.tsx` pass against the new `Sale.tsx`.
  - **Not here:** the report of payments that need a person as a screen (step 5); a receipt for a card sale; reading the card (a real terminal is hardware and the owner's); the card panel's behaviour against a real acquirer.
  - **Tests:** web 26 new + 2 (`App`). The web typechecks. Not run in a real browser.
- 2026-10-02 — **UI, step 4: the card payments to check** (`web/src/back/PaymentsAttention.tsx`, `PaymentsAttention.test.tsx`, 19 tests; `Refunds` gains `startFromPayment`, 2 tests). The last UI piece of this slice. **All five of the owner's screens now exist:** returns, refunds, the card panel with its void,
  and this report.
  - **What it shows (D4 §16):** the existing report as it is: `PendingTooLong` ("Waiting on the provider"), `AuthorizedNotCaptured` ("Approved, not taken"), `CapturedNoSale` ("Taken, no sale"), each in words beside a symbol with its amount, how long
    it has waited ("12 min", "2 h 15 min", "1 d 1 h"), what the provider last said (`PY-10`), a simulated mark, what has been held and given back of a payment taken with no sale, what to do next, and the **cart reference** (the first eight characters of
    the operation id) so a person can find the cart at the till. The counts are the server's, over all pages; the list can be narrowed to one kind; "Show more" is the server's cursor.
  - **How long is too long (`OQ-037`):** the screen **asks and never fills it in**. The field is empty and has focus; a window that is empty, not a whole number, negative or beyond a year is said in place and nothing is read; 0 means every payment that has not
    settled. The value is sent as typed. Refresh asks again with the same window.
  - **Void (D-16 Q3, `PY-13`):** offered only with `Payment.Void`, and only on a pending or authorized payment (a captured one is refunded, never voided). It asks first, in place, with the focus on "Yes, void it" and a safe "Keep it"; sending nothing until
    confirmed. The report is read again and the outcome is spoken, saying whether the provider voided it or **a person voided it here because the provider held nothing for it** (`PY-41`). A void the provider does not confirm (`void_pending`,
    `void_failed`) or a refusal (`cannot_void`) is said in place and the payment stays as it was.
  - **Refund a payment taken with no sale (D-18):** offered on `Taken, no sale` only, with `Sale.Refund` **and** `Refund.View` (the screen where it is made and seen), while some of the payment can still go back. It hands over to the Refunds screen, which opens on **that
    payment already chosen**, the amount at the most it can still give back for the person to only reduce, and a reason required; if the payment is no longer waiting, the person is told and the list is shown.
  - **Reading** is `Payment.View`, which offers the screen (back office, under Money in the other session's navigation, and as a tab in the committed one). No key is new and none is invented.
  - **Coordination with the other session:** again two shapes of `App.tsx`/`App.test.tsx`. The committed ones are the committed files plus the tab, the hand-over state and 2 shell tests, tested in a clean checkout of HEAD with the **whole web suite (209 tests,
    typecheck clean)**. The same edit is in their working copy, under their Money group. Nothing of theirs was staged.
  - **Not here:** a till-side report (the till's void is on the sale screen, step 3); notifications that something needs a person (`BQ-02`); any scheduler.
  - **Tests:** web 21 new + 2 (`App`). The web typechecks. Not run in a real browser.
- 2026-10-02 — **Owner decision D-15 committed on its own** (the deployment currency is `NPR`, minor-unit exponent 2; closes `OQ-006`). The owner chose the order: D-15 first, then the 7 failing `Products` tests, then the three screens made stale by D-16, and only then the rest of the other session's work.
  - **What is in the commit:** the onboarding CLI takes `NPR`/2 on a blank answer and keeps any typed code and exponent as the override (`DEFAULT_CURRENCY`, `onboarding.ts`; `cli/onboard.ts`); one test (`onboarding.test.ts`); OWNER-DECISIONS D-15; `OQ-006` resolved; a dated D-15 note in `tax-and-currency.md`; and the **web fixtures moved off £/GBP to NPR** (`Prices.test.tsx`, `Shifts.test.tsx`, `SaleScreen.test.tsx`, `ShiftClose.test.tsx`, and one comment in `Shifts.tsx`).
  - **What is not:** the currency is data, not a constant, and nothing treats 2 as universal (overview §3.1); conversion stays out of scope; `D-12` and `GAP-044` are untouched. Fixtures that use ISO 4217's non-currency codes (`XTS`, `XXX`, `XBB`) are unchanged on purpose.
  - **Checked before committing:** each of the web files' diffs is only a currency fixture change; all 504 server tests pass; the web suite passes (209 tests) and typechecks in a **clean checkout of HEAD** with these files applied.
  - **Not included, by the owner's instruction:** `AGENTS.md` (stale, left uncommitted), every new web screen, `App.tsx` and its test, `People`, `Reference`, `Tills`, `Products` and the rest of the other session's working tree. Their BUILD-STATUS entries (the shared move component, My account) stay uncommitted with them.
  - **Staging:** BUILD-STATUS holds that session's two further entries, so its staged copy is the committed file plus this entry only.
- 2026-10-03 — **Cleanup of the other session's web work, steps 3 and 4 (working tree only; nothing staged or committed).**
  - **The 7 failing `Products` tests are fixed by changing the tests, not the screen.** Mechanical: replies wrapped as `{ body: … }` for `serve()`, an invalid `exact` option removed, and `Setup.test.tsx` reads `c.key.startsWith('DELETE')` instead of a `.method` the helper does not record. Real mismatch: recording a cost needs `Product.Edit` beside `Product.Cost.View` (the server's rule), so the cost test now renders with the right key sets. A test that raced the units fetch now waits for the option before choosing it (it failed once in three runs).
  - **Three screens brought up to D-16:** `People` offers `reactivate` from leave (`Employee.Edit`, no reason) and from suspension (`Employee.Reactivate`, with a reason); `Tills` offers `activate` on a disabled till (`Device.Disable`, with a reason); `Sales` requests the receipt only with `Sale.Create` (D-16 Q13) and tells a `Sale.View`-only reader whose work it is instead of asking and being refused. Each had a test asserting the old "OPEN DECISION, refuses everyone" behaviour; those now assert the new behaviour, and each new path has a test for the key that does not hold it.
  - **Checked:** the web suite passes (274 tests, six runs in a row) and typechecks. Not run in a real browser.
  - **Still uncommitted at that point:** every new screen, `App.tsx` grouped navigation, `Moves.tsx`, `form.ts`, `MyAccount`, `AGENTS.md` (stale, left alone).
- 2026-10-03 — **Web Group 1: shared form helpers, Moves component, People (D-16), Reference (categories), and styles.**
  - **What is in the commit:** `lib/form.ts` (`changesOf`, `useList`, `when` helpers moved out of `Reference.tsx`); `lib/Moves.tsx` (renders state-machine moves with UX-08 key guard, UX-03 question, optional reason, posts `/transitions`); `People.tsx` updated for D-16 Q4/Q5 (reactivate from leave = `Employee.Edit`, no reason; reactivate after suspension = `Employee.Reactivate`, requires reason); `Reference.tsx` adds the `Categories` panel (`/categories`, `PR-04`–`PR-06`), moves `changesOf`/`useList` to `form.ts`; `styles.css` adds `.ask` styles for Moves, `.backoffice`/`.groups` styles for the navigation (used by later commits); tests updated for all four files.
  - **Checked:** web suite 274/274, typecheck clean. Verified in a clean checkout of HEAD with these files applied.
  - **Still uncommitted:** `Products`, `Sales`, `Stock`, `Adjustments`, `Setup`, `Tills` and their tests; `App.tsx` grouped navigation; `MyAccount`; `AGENTS.md` (stale, left alone).
- 2026-10-03 — **Web Group 2: Tills (D-16 Q6), Setup (reason codes, payment methods).**
  - **What is in the commit:** `Tills.tsx` + test: device management (register, activate, disable, re-enable, retire) and the `StoreSettings` panel (return window, tax rounding); D-16 Q6 wired — putting a disabled till back uses `Device.Disable` with a required reason (`HD-32`, `SS055`); uses `Moves.tsx` from Group 1. `Setup.tsx` + test: reason codes (`BI-25`, `IV-33`, `SS024`) and payment methods (`PY-03`, `PY-05`, `SS045`); uses `form.ts` from Group 1.
  - **Checked:** 240/240 web tests in staged-only mode, typecheck clean.
  - **Still uncommitted:** `Products`, `Sales`, `Stock`, `Adjustments` and their tests; `App.tsx` grouped navigation; `MyAccount`; `AGENTS.md` (stale, left alone).
- 2026-10-03 — **Web Group 3: Stock balances, Adjustments (draft/approve/post).**
  - **What is in the commit:** `Stock.tsx` + test: read-only view of stock balances per location (`IV-01`, `IV-02`, `IV-17`); uses `useList`/`when` from `form.ts`. `Adjustments.tsx` + test: create a draft adjustment, add lines, submit for approval, approve (with `Stock.Adjust.Approve`), post; state-machine moves via `Moves.tsx`; uses `useProductHits` to search products by barcode/name (`IV-33`, `SM-*`, `SS055`).
  - **Checked:** 251/251 web tests in staged-only mode, typecheck clean.
  - **Still uncommitted:** `Products`, `Sales` and their tests; `App.tsx` grouped navigation; `MyAccount`; `AGENTS.md` (stale, left alone).
- 2026-10-03 — **Web Group 4: Sales (history, receipt, D-16 Q13), Products (catalogue management).**
  - **What is in the commit:** `Sales.tsx` + test: sale list and detail, receipt (loaded only with `Sale.Create` per D-16 Q13; a `Sale.View`-only reader sees the sale's lines and totals and a note that the receipt is the cashier's work). `Products.tsx` + test: full product/variant/price workflow (`PR-04`, `PR-09`, `PR-33`, `PR-35`, `PR-47`, `RT-042`, `SS008`, `D2 §4`); product search, variant add, price edit, standard cost (`Product.Cost.View` + `Product.Edit` required together), state transitions (Draft → Active → Hidden → Archived) via `Moves.tsx`; barcode management.
  - **Checked:** 266/266 web tests in staged-only mode, typecheck clean.
  - **Still uncommitted:** `App.tsx` grouped navigation + test; `MyAccount`; `NotYet`; `AGENTS.md` (stale, left alone).
- 2026-10-03 — **Web Group 5: grouped navigation (App.tsx), MyAccount, NotYet. All back-office screens now wired.**
  - **What is in the commit:** `App.tsx` (fully revised): grouped sidebar navigation; each area shown only to someone who holds its key (`UX-05`, `UX-08`); all built screens wired — Shifts, Sales, Returns, Refunds, Payments Attention, Products, Prices, Reference, Stock, Ledger, Adjustments, Opening Stock, Payment Methods, People, Roles, Tills, Store Settings, Reason Codes; `NotYet` areas listed for gaps still open (procurement, batches, stock counts, customers, offline). `MyAccount.tsx`: own-account password change (`EM-03`, `EM-04`, `SM-49`), no permission required, available at the till and off it. `NotYet.tsx`: shows each planned-but-not-built area with its doc reference, rules, and why it is blocked — never a form that pretends to work.
  - **Checked:** 274/274 web tests in staged-only mode, typecheck clean.
  - **Nothing uncommitted:** all back-office screens, shared helpers, and navigation are now on `v1-build`. `AGENTS.md` (stale, left alone by owner instruction) is the only item left out.
