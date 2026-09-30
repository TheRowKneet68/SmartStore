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

## In progress

- Tooling scaffold: package.json, dbmate, Vitest harness, `scripts/db-setup.ps1`, `.gitignore`.
- `docs/database/CONVENTIONS.md`, then Domain 1 (Organization / Store / Warehouse).

## Next

1. **Domain 1 — Organization / Store / Warehouse.** Cite the `RT-xxx` rows and rule IDs that require each table.
   Note `D-03`: attribution is an explicit `(StorageLocation, Store)` table; physical stock stays variant +
   location, with no single `StoreId` on the location.
2. Then continue domain by domain — one at a time, with tests, committing after each passing step: 2 Product /
   Barcode / Unit, 3 Inventory ledger / Batch, 4 Sale / Payment, 5 Returns / Refunds, 6 Audit, 7 Employee / Role /
   Permission.
3. Then Step 3, implementation, in the order in the working agreements.

Update this file after every step, including steps that failed and were abandoned.

## Log

Append-only. One dated line per step, including failed and abandoned attempts.

- 2026-09-30 — ADR-31 proposed, then approved by the owner ("approved which makes my project latency low use it";
  read as: approved as proposed, lowest-latency option where a choice existed — Fastify, Node 26). The installed
  Node is v25.8.2, which is end of life and outside Vitest 5's declared `engines`; the owner has to upgrade it
  (`winget upgrade OpenJS.NodeJS`).
