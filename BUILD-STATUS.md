# Build Status

**Last updated:** 2026-09-30

## Phase

**Phase 3 — database design.** Authorized by the owner on 2026-09-30
([Constitution §35](SMARTSTORE-CONSTITUTION.md)). Schema, entities, keys, constraints, indexes, and the migrations
that create them.

**No Phase 3 artifact has been created yet.** The backend language/framework is not chosen; it must be chosen by an
ADR the owner approves. PostgreSQL is fixed per `ADR-03`.

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

## Done

None. Phase 3 work has not started.

## In progress

None.

## Next

1. **Stack ADR.** Write the ADR choosing the backend language/framework, and get it **approved by the owner**
   before building anything. PostgreSQL per `ADR-03`; money as integer minor units end to end per `ADR-04`.
2. **Database design for Organization / Store / Warehouse.** First module. Cite the `RT-xxx` rows and rule IDs that
   require each table. Note `D-03`: attribution is an explicit `(StorageLocation, Store)` table; physical stock
   stays variant + location, with no single `StoreId` on the location.
3. Then continue module by module — one at a time, with tests, committing after each passing step.

Update this file after every step, including steps that failed and were abandoned.
