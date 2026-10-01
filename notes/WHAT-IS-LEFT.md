# What is left before a real store can use SmartStore

Written 2026-10-02 for the owner, at the end of Phase D of the brief of 2026-10-01 ("finish v1 as fast as possible").
Phase E waits for the owner's answers, so this is the state before Phase E, and it is re-measured after it. It is an
inventory, not approved work. `/docs` stays the specification. Where this file and `/docs` differ, `/docs` wins.

## 1. Where it stands

A store can do this today, end to end:
- **Set up:** onboarding from the command line; then people, roles, permissions and store access; units, tax
  categories and rates, and brands; prices and their history. All are on screens, and each is offered only to someone
  allowed.
- **Trade, at a till, in cash:**
  - open a shift with a counted float;
  - scan or find items by name, and take cash with the change shown;
  - record whether the receipt printed, and reprint with a reason;
  - count the drawer, acknowledge a difference with a reason, and close with the float left;
  - a manager reviews every shift's figures.
- **Keep the books honest:** stock moves only through documents. Every balance agrees with its ledger, and the audit
  chain is unbroken (both checked below).

It cannot yet take a card, pay a refund, or accept a return. Those are Phase E, waiting for the owner's answers
(§3).

## 2. Release blockers: the owner's, not engineering's

Each needs the owner, and the first needs legal counsel. None stalls engineering, and none may be invented.

| Item | What is missing | Why a real store needs it |
|---|---|---|
| **`GAP-044`** (`D-12`) | The jurisdiction's tax facts: rates, taxable classes, receipt obligations | The system takes rates as data and asserts none. A store cannot be configured correctly for its own jurisdiction until someone qualified states them |
| **`GATE-Q2-LICENCE`** | The product's licence name and the clearance of its open-source terms | Distribution |
| **`GAP-038`** (`D-13`) | The recovery point and recovery time objectives, and the restore window | Backup and restore tooling, and its drill, are sized from them. None exists yet (§4) |

## 3. Owner answers that unblock building

| Answer | Where | Unblocks |
|---|---|---|
| **The permission-key proposal, Q1–Q14** | `docs/architecture/PERMISSION-KEY-PROPOSAL.md` | Phase E: returns and refunds (Domain 5), card payments, reactivating an employee, re-enabling a till, storage locations, reopening a shift |
| The five required settings: session lifetime, sign-in failure limit and window, quote age, lock timeout | OQ-027, `.env.example` | Starting the server for real (`npm start`). The tests use TEST-ONLY values |
| The sale-save budget: p95 ≤ 100 ms is proposed | ADR-31 §16 | A pass or fail for the number in §6 |
| The variance tolerance, and the second approver's threshold | OQ-020 | The close's "within tolerance" path. Today every difference needs an acknowledgement |
| A migration for manual weigh entry, and its threshold | OQ-032 | Selling by weight typed at the till |
| An audit event type for reading the log, and one for a job's run | OQ-024 items 2 and 8 | The audit-log screen, and scheduled checks |
| Archiving brands, units and tax categories | OQ-031 | Archive only; editing is built |
| The closing float above the count; target size and contrast | OQ-029, OQ-030 | Nothing; interims are in place |

## 4. Engineering still to do

**After the answers (Phase E):**
- Domain 5: returns, then refunds, holding the D5 concurrency bounds, then its mutation check.
- Card payments through the simulated gateway. `Failed` is terminal, and a retry is a new payment (`D-14`).
- **A real card provider.** The simulated gateway proves the flow. Taking real cards needs a provider contract, its
  keys, and its certification: money and secrets, so the owner's. ADR-09 and architecture §19.1 put every provider
  behind one interface, so a real one replaces the simulation without touching the sale.

**Without waiting:**
- **The other session's back office.** Products, sales, stock, tills, adjustments and setup screens are in the tree,
  uncommitted. Its `Products.test.tsx` fails 7 tests and does not typecheck, as does its `Setup.test.tsx`. Its D-15
  work (the NPR currency) is uncommitted too.
- **The web onboarding wrapper.** It waits on that session's onboarding changes.
- **Printing the receipt at the till.** The server records print outcomes and reprints (D4 §10). Printing needs a
  printer, or an agreed browser print flow; hardware is the owner's.
- **Backup and restore tooling, and a drill.** Sized by `GAP-038`.
- **Running it for real:**
  - the owner actions in BUILD-STATUS. Node 26 now answers on this machine (v26.7.0, in the perf run), so the first
    looks done. Whether the deployment database is on the owner's PostgreSQL service is in `.env`, which no session
    reads;
  - the server kept running, and served over TLS if it leaves the shop's machine.
  - The probes `GET /health` and `GET /ready` are ready for whatever supervises it.

## 5. Out of v1 by decision

These are deferred in BUILD-STATUS, each designed so the schema can carry it later. A real store may need some of
them, and each is a scope decision for the owner:
- offline trading (the till needs the network);
- devices, including scales and drawer kicks;
- credit;
- loyalty;
- multi-store;
- discounts and price overrides;
- customers beyond the walk-in;
- purchasing and goods receipts (stock enters by adjustment);
- transfers;
- stock counts beyond counted-quantity adjustments;
- notifications;
- reports;
- voiding a completed sale (OQ-017; a return is the v1 correction).

## 6. Phase F's measurements (2026-10-02)

| Check | Result |
|---|---|
| Server typecheck | Passes |
| Server tests | 435 of 435 pass (25 files) |
| Web tests | 143 of 150. All 7 failures are in the other session's uncommitted `Products.test.tsx` |
| Web typecheck | Fails, only in the other session's uncommitted `Products.test.tsx` and `Setup.test.tsx` |
| `npm run ledger:check` | Every stock balance agrees with its ledger |
| `npm run audit:check` | The audit chain is intact for every organization |
| scan-to-cart, HTTP, 100,000 variants | p95 5.1 ms, against a budget of p95 ≤ 100 ms: met |
| scan-to-cart in the browser, Enter to line drawn | p95 24.1 ms: met |
| sale-save, 10 lines, cash | p95 69.1 ms (max 190.8 ms), against the proposed p95 ≤ 100 ms: met |

**Sale-save is 2.5 times the first measurement**, which was p95 27.1 ms (ADR-31). Nothing in its path changed in this
session, and the machine was not the same:
- this run used the machine's Node v26.7.0, where the first used a portable 26.10.0;
- seeding the catalogue took 12.6 minutes.

Re-run it on the first setup before reading this as a regression. If it holds there, profile the sale's transaction.
The two checks ran against the deployment database, which holds little data; they prove the checks run, not that a
busy store's books balance.
