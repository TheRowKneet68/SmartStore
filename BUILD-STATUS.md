# Build Status

**Last updated:** 2026-10-01

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

Nothing. The shift close (`CD-20`..`CD-25`) is finished and committed: see Done and the log.

Earlier note, still true: Domain 3 is finished and committed.

The slice's Domain 4 code is built and tested but **not yet mutation-checked**. Domain 4's check covers it: see Next.
The files are `server/src/modules/sales/sales.ts`, `till.ts`, `payment-methods.ts` and `quotes.ts`, and
`server/src/modules/catalog/scan.ts` as rewritten for the slice.

## Owner actions pending

1. Upgrade Node: `winget upgrade OpenJS.NodeJS` (installed 25.8.2 is end of life; 26 is the approved runtime).
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\db-setup.ps1` once. It asks for the `postgres`
   password locally and writes `.env`. Then `npm ci`, `npm run db:migrate`, `npm test`.
3. Push `v1-build` at the end of each domain.
4. Decide what happens to the untracked `SmartStore.zip` (210 MB) at the repository root. It is not ignored, so every
   commit has to exclude it by name.
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
| 4 | Name the keys for card submit, capture and void | OQ-018 | Card payments in Domain 4 |
| 5 | The permission-key list, presented before Domain 5 (working agreement 8): refund submit and cancel, reversal edges, location management, `Config.Roles` | OQ-023, OQ-025, OQ-026, OQ-028 | Domain 5, and the till re-enable and refund retry edges |
| 6 | The route permissions chosen where the catalogue was not explicit, listed for veto | D1 §9, D7 §9, D2 §9, D3 §9 | Nothing |
| 7 | What to do with the untracked `SmartStore.zip` | Item 4 above | Nothing |
| 8 | Whether a shift count records a denomination breakdown. `RT-526` (`CD-20`) says "the denomination total is derived from the breakdown", but D4 deferred `CD-27`..`CD-29`, so the schema has no denomination tables and the count is a total. Building it needs a migration | `RT-526`, D4 | Nothing; counts are totals until decided |
| 9 | The variance tolerance and the higher threshold that needs a different approver. Interim: the tolerance is zero, so every non-zero variance needs an acknowledgement with a reason, and no second approver is required. "Closes automatically within tolerance" and the second-approver gate are unbuilt, because the numbers do not exist | OQ-020, `CD-23` | Those two behaviours only |
| 10 | Whether the declared closing float may exceed the counted amount. Interim: recorded as declared; it feeds no expected amount | OQ-029, `CD-20` | Nothing |

Until then, tests run on a scratch PostgreSQL 17.11 cluster and a portable Node 26 in the session scratch directory
(ADR-31 §14). Nothing on the owner's PostgreSQL service is touched.

## Next

1. **The very next task: Step 3, Domain 4 (Sale / Payment), starting with the mutation check of the slice's code.**
   - Files: `server/src/modules/sales/sales.ts`, `till.ts`, `payment-methods.ts`, `quotes.ts`, and
     `server/src/modules/catalog/scan.ts`.
   - Tests: `server/src/modules/sales/sales.test.ts`, `server/src/modules/catalog/catalog.test.ts`.
   - Harness: the session scratch directory's `mutate-app.mjs`, with a new `plan-d4-app.mjs`.
   - The slice's schemas write `z.number().int().safe()`. In zod 4.6.5 `int()` and `safe()` are one check, so the
     check will meet removing either as an equivalent mutant, as the shift close did. Drop `.safe()` in
     `products.ts`, `till.ts` and `sales.ts` before the run.
   - Then the rest of Domain 4:
     - ~~closing a shift~~: done (see Done);
     - two guards the shift close found missing in the schema, each a small migration. The shift-close brief excluded
       migrations, so they were reported, not written:
       - a closed shift's `closed_by` and `status_changed_by` can be rewritten by the runtime role, unaudited.
         `SM-57` makes a closed shift immutable, and `AU-05` takes the actor from the authenticated identity;
       - the database accepts an archived reason code on a count's acknowledgement. Only the route refuses it
         (`SS024`'s rule).
     - the till's other edges (disable, retire);
     - reading sales;
     - the receipt status.
     - Card payments wait for OQ-018's keys; until then they are refused.
2. Then the permission-key list for the owner, before Domain 5 (working agreement 8), with OQ-018, OQ-023, OQ-025,
   OQ-026 and OQ-028. Then Domain 5.
   - Owner decisions needed along the way: OQ-018 before the card path; OQ-023 before any refund is paid; OQ-025
     before an employee is reactivated, a till re-enabled or a refund retried.
   - Step 3 builds the one authorization gate (architecture §8.2). Two guards moved there from the database: it sets
     the audit context, and it binds every `*_by` column to the signed-in employee (CONVENTIONS §12).

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
