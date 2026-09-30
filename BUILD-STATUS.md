# Build Status

**Last updated:** 2026-09-30

## Phase

**Phase 3 — database design.** Authorized by the owner on 2026-09-30
([Constitution §35](SMARTSTORE-CONSTITUTION.md)). Schema, entities, keys, constraints, indexes, and the migrations
that create them.

**Stack chosen:** [ADR-31](docs/architecture/ADR-31-V1-STACK-AND-TOOLING.md), approved by the owner on 2026-09-30 —
Node 26, TypeScript, Fastify 5, `pg` (no ORM), dbmate (plain-SQL, forward-only migrations), Vitest against a real
PostgreSQL, React + Vite. PostgreSQL is fixed per `ADR-03`. **No migration and no application code exists yet.**

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

## In progress

- Domain 6 (Audit): design document and migration.

## Owner actions pending

1. Upgrade Node: `winget upgrade OpenJS.NodeJS` (installed 25.8.2 is end of life; 26 is the approved runtime).
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\db-setup.ps1` once. It asks for the `postgres`
   password locally and writes `.env`. Then `npm ci`, `npm run db:migrate`, `npm test`.
3. Push `v1-build` at the end of each domain.

Until then, tests run on a scratch PostgreSQL 17.11 cluster and a portable Node 26 in the session scratch directory
(ADR-31 §14). Nothing on the owner's PostgreSQL service is touched.

## Next

1. **Domain 6 — Audit.** The append-only audit trail (architecture §14), the event types of D-06, and the audit rows
   the transition contracts of domains 1–5 require.
2. Then domain 7, Employee / Role / Permission, with the actor foreign keys of CONVENTIONS §11 and the transition
   permission table (architecture §8.4), where the `OPEN DECISION` keys of OQ-018 and OQ-023 refuse.
3. Then Step 3, implementation, in the order in the working agreements.

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
