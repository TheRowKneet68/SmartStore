# ADR-31 — v1 implementation stack and tooling

**Status: ACCEPTED — owner approval recorded 2026-09-30 (§13).** Constitution §35 requires "an ADR that the owner
approves", and CLAUDE.md lists choosing the tech stack as an owner decision; §13 is that record. Sections 1 to 12 are
the proposal as it was put to the owner and were not altered on approval.

Date: 2026-09-30. Extends `ADR-01`..`ADR-30` ([PHASE-2-ARCHITECTURE.md](PHASE-2-ARCHITECTURE.md) §28). Supersedes
nothing. Append-only: approve or amend this record by appending a dated section; do not rewrite earlier sections.

State (Constitution §5): everything below is **SPECIFIED**. Nothing is IMPLEMENTED, TESTED or VERIFIED. Facts marked
*checked* were read from this machine or from a package registry on 2026-09-30 and are reproducible with the command
named beside them.

---

## 1. Inputs this ADR does not decide

| Input | Source |
|---|---|
| Node.js + TypeScript backend; Express or Fastify; React frontend | Owner instruction, 2026-09-30 (this ADR chooses between Express and Fastify) |
| PostgreSQL is the central store; no SQLite-as-server | `ADR-03` |
| Local PostgreSQL first, cloud later; `DATABASE_URL` from the environment; no provider-specific features | Owner instruction, 2026-09-30 |
| Migrations live in the repository | Owner instruction, 2026-09-30 |
| Money is integer minor units end to end; `DECIMAL(18,4)` only for quantities and loyalty points | `ADR-04`, `ADR-06` |
| Scan-to-cart under about 100 ms on the local setup | Owner instruction, 2026-09-30. `UX-60` requires that a speed budget exists and is tested; it names none |
| v1 scope; offline sync, RFID/devices, credit, loyalty, multi-store deferred | BUILD-STATUS.md; owner instruction, 2026-09-30 |
| `D-01`..`D-14` | [OWNER-DECISIONS.md](OWNER-DECISIONS.md). Not touched by this ADR |

## 2. What the stack must satisfy

PHASE-2-ARCHITECTURE §4.2 and §28.4 refused to name a framework "for adjectives" and set four constraints. This is
how the proposal answers each.

| Constraint | How it is met | State |
|---|---|---|
| Integer money | `BIGINT` money columns. The `pg` parser for `int8` returns a JS `number` only when `Number.isSafeInteger`, otherwise throws. No float in any money path. `numeric` quantities stay strings in JS | SPECIFIED |
| Strong transactional integrity | One `withTransaction` helper; `SELECT … FOR UPDATE` on contended rows (`ADR-25`); READ COMMITTED (`ADR-26`); bounded retry with jitter on SQLSTATE `40001`/`40P01` (§20.2) | SPECIFIED |
| First-class migration story | Plain-SQL, forward-only migrations run by dbmate (§4.1, §6) | SPECIFIED |
| Supports §20–§22 concurrency, transaction and idempotency | Unique index on `ClientOperationId` checked inside the mutating transaction (§22.2, `SM-04`, `ADR-07`); row locks; no external I/O inside a transaction (`ADR-17`) | SPECIFIED |

## 3. Decision (proposed)

| Concern | Choice | Version and licence, *checked* by `npm view <pkg> version license` |
|---|---|---|
| Runtime | Node.js **26**, an LTS line from 2026-10-28. Supported range `^24 \|\| >=26` | see §4.5 |
| Language | TypeScript, `strict` | typescript 7.0.2, Apache-2.0 |
| HTTP framework | **Fastify 5** | 5.12.5, MIT |
| Database driver | **`pg`** (node-postgres). **No ORM** | 8.23.0, MIT |
| Boundary validation | zod | 4.6.5, MIT |
| Migrations | **dbmate**, plain SQL, forward-only | 2.36.0, MIT |
| Frontend | React + Vite + TypeScript | react 19.3.0, vite 8.3.1, MIT |
| Tests | **Vitest**, against a real PostgreSQL | 5.0.3, MIT |
| Browser timing and smoke (first UI slice only) | Playwright | 1.63.0, Apache-2.0 |
| Dev-time TS runner | tsx | 4.23.15, MIT |

## 4. Trade-offs

Written for one developer who knows JavaScript, React, PHP and Python.

### 4.1 Migration tool: dbmate (recommended)

The schema is the Phase 3 deliverable, and what it is made of is SQL that no DSL models well: `CHECK` constraints,
partial unique indexes, triggers, `REVOKE` on the audit table (§14.1), and `COMMENT ON` lines that carry the
requirement citations. The tool should therefore treat SQL as its primary format.

| Option | For | Against |
|---|---|---|
| **dbmate 2.36** | SQL is the only format. Reads its URL from a named environment variable (`-e`), so the migrator role and the app role can differ. `--strict` fails out-of-order migrations. `transaction:false` per migration. Writes `db/schema.sql`, a one-file view of the whole schema the owner can read. Delivered to npm as per-platform packages including `@dbmate/win32-x64` | A native binary, not JS. No in-process API (tests spawn it once per run). Its dump needs `pg_dump`, which is present |
| node-pg-migrate 9 | `npm install` only. In-process runner API. PostgreSQL-only | Its `.sql` loader is documented as the **legacy SQL loader** (marker comments); JS/TS is the primary format. Using it for pure SQL means using the secondary path |
| Prisma Migrate, Drizzle Kit | Types from the schema | The DSL becomes a second source of truth beside the SQL, and triggers, grants and citation comments end up hand-written anyway. Not evaluated feature by feature |
| Knex migrations | Familiar JS | Same objection as the DSL tools |
| Flyway, Liquibase | Mature | JVM install and no advantage for this team |
| A hand-rolled `psql` loop | Fewest dependencies | Ordering, checksums, locking and half-applied failures are solved problems, and this is a money and inventory system |

Because the migration *content* stays plain SQL, moving to another runner later costs a loader change, not a rewrite.

### 4.2 HTTP framework: Fastify (recommended)

- **For:** built-in JSON-schema validation and Pino logging; `app.inject()` tests a request in-process with no port; and
  an `onRoute` hook lets the server **refuse to start** if any route lacks a declared permission. That turns
  `AC-01` deny-by-default and `ADR-19` (one authorization table) into a boot-time check rather than a review-time
  one.
- **Against:** smaller mindshare than Express; plugin encapsulation is a concept to learn; some Express middleware
  needs adapting.
- **Express 5.2.1 (MIT)** is the alternative. It is the most familiar and has the largest ecosystem, and async
  handler errors now propagate. It has no built-in validation, logging or in-process injection, so "every route
  declares a permission" rests on convention. Both are fast enough that framework overhead is unlikely to decide a
  100 ms budget. That is **UNVERIFIED** until the performance test measures it.

### 4.3 Data access: `pg` plus hand-written SQL, no ORM

- **For:** the correctness core is explicit SQL: lock the balance row, validate, insert the movement, update the
  balance, all in one transaction (§9.2, `ADR-05`). An ORM's job is to hide exactly that. The store predicate (`P6`,
  `ADR-10`) must be visible in the data layer, not inferred.
- **Against:** more SQL by hand, and row types written by hand. The drift risk is covered by integration tests that run
  against the real schema.
- **Reversible:** Kysely 0.29.6 (MIT) can replace a repository function's body later without changing its signature.

### 4.4 Test framework: Vitest, real PostgreSQL

- **For:** TypeScript with no setup; a Jest-like API; one runner for server and web, sharing Vite's configuration
  with React.
- **Against:** a young major version (5.x), so upgrades will churn. `node:test` (stdlib) is the zero-dependency
  alternative but is weaker for React and watch mode and would mean two runners. Jest has a heavier TypeScript setup.
- **Database tests use a real PostgreSQL, never mocks.** Triggers, `CHECK` constraints, row locks and immutable audit
  are the things under test. Migrations are applied once to a template database and each test file gets
  `CREATE DATABASE … TEMPLATE …`. Rolling back a transaction per test is **not** the default, because concurrency
  and commit-time behaviour cannot be observed inside one transaction.

### 4.5 Runtime: Node 26

*Checked:* installed `node --version` is v25.8.2. endoflife.date reports Node 25 **end of life 2026-06-01**, Node 24
in LTS with active support to 2026-10-20 and end of life 2028-04-30, and Node 26 entering LTS 2026-10-28 with end of
life 2029-04-30. Vitest 5.0.3 declares `engines` of `^22.12.0 || ^24.0.0 || >=26.0.0`, which does not include 25.

- **Node 26:** in-place upgrade over the installed 25 (`winget upgrade OpenJS.NodeJS`); the longest support window;
  LTS four weeks from this record. Every tool in §3 declares support for it or for `>=22`.
- **Node 24:** LTS today, and winget's `OpenJS.NodeJS.LTS` currently offers 24.19.0. Installers normally refuse to
  downgrade, so 25 would have to be uninstalled first, and its active support ends in 20 days.
- Both are inside the supported range. Whether the whole toolchain runs on 26 is confirmed at scaffolding; the
  fallback is 24.

## 5. Repository layout

```
D:\SmartStore
├─ docs/
│  ├─ architecture/ADR-31-V1-STACK-AND-TOOLING.md    this record
│  └─ database/          CONVENTIONS.md, then one design doc per domain (Step 2)
├─ db/
│  ├─ migrations/        plain SQL, forward-only; one or more files per domain
│  └─ schema.sql         generated by dbmate, committed, never hand-edited
├─ server/               Fastify + TypeScript
│  ├─ src/
│  │  ├─ main.ts         listen()
│  │  ├─ app.ts          builds the Fastify instance (tests use app.inject)
│  │  ├─ config.ts       reads and validates the environment; fails fast
│  │  ├─ db/             pool, withTransaction (+ deadlock retry), int8 parser
│  │  ├─ http/           the one authorization gate, error shape, session
│  │  └─ modules/<name>/ routes.ts · service.ts · repo.ts · *.test.ts
│  └─ test/              global setup (template database), helpers, perf/
├─ web/                  React + Vite + TypeScript; the till first, back-office later
│  └─ src/               pos/ (cart in memory, keyboard-first), backoffice/, lib/api.ts
├─ scripts/              PowerShell: db-setup.ps1 and similar
├─ .env.example          committed, no secrets       .env   gitignored
├─ package.json          npm workspaces: server, web
└─ .node-version
```

- Module folders follow the §3.4 module map and are created only when built. `§4.3` applies: no module reads
  another module's tables.
- A `shared/` workspace (money formatting, DTO types) is created only when the first thing is actually shared.
- Migrations sit at `db/`, outside `server/`, because they are the schema, not part of the server.

## 6. Database conventions fixed by this ADR

| Topic | Rule | Source |
|---|---|---|
| Two roles | `smartstore_owner` owns objects and runs migrations. `smartstore_app` is the runtime role: DML only, never superuser, and **no `UPDATE`/`DELETE` on append-only tables** (movements, audit, finalized documents) | `ADR-11`, §14.1, `BI-24`, `P5` |
| Environment | `DATABASE_URL` is the runtime (app-role) URL. `MIGRATION_DATABASE_URL` is the owner-role URL, selected with `dbmate -e`. Both come from the environment; `.env` is gitignored | Owner instruction |
| Local setup | `scripts/db-setup.ps1` creates both roles and the development database and prompts for passwords locally. The `postgres` superuser password never enters the repository or a chat | CLAUDE.md, secrets |
| Migration policy | Forward-only: no `-- migrate:down` sections. A mistake is corrected by a new migration. Development and test databases may be dropped and recreated; that is not a migration. Run dbmate with `--strict` | Constitution §14, CLAUDE.md "never delete data or history", §27.2 |
| Citations | Every table, column, constraint and index carries `COMMENT ON … IS 'Cites: <ids> — <why>'`. Test names carry the IDs they prove | CLAUDE.md |
| Extensions | None required. `gen_random_uuid()` is core since PostgreSQL 13. If one is needed later (for example trigram search for `UX-48`) it is recorded in this ADR first | "No provider-specific features" |
| Target | PostgreSQL 17 (*checked*: 17.11 installed, service running). Nothing beyond 17 is used, so 18 stays compatible | `ADR-03` |
| Keys, timestamps, `store_id`, naming | Decided in `docs/database/CONVENTIONS.md`, the first Step 2 deliverable, with the rationale recorded there | — |

## 7. Tests: the gates in TEST-STRATEGY §1

| Gate | Rule | How it is tested | Runs |
|---|---|---|---|
| Ledger rebuild reproduces every balance and `ResultingBalance` | `IV-09` | Post movements, rebuild from the ledger, compare | default suite |
| Payment state-graph assertion | `PY-12`, `PY-54`, `D-14` | Assert on the graph itself: no edge out of `Captured` except a linked `Refund`; none out of `Failed` | default suite |
| Sale status rebuild from line counters | `SP-66` | Rebuild status from counters and compare with the cache | default suite |
| Concurrency suite | inventory §7 | N parallel sales over a fixed item set on separate connections; the ledger reconciles, no deadlock escapes, every failure is a clean retry | `npm run test:concurrency` |
| Negative batch never negative | `BI-36`, `IV-19` | Concurrent decrements against one batch | default suite |
| Idempotency | `SM-04`, `ADR-07` | Repeat a `ClientOperationId`: same result, no second movement or audit row | default suite |
| Idempotency of offline apply; atomic bounded redemptions | `OF-22/23`; `PY-31`, `BI-19`, `BI-06` | **Deferred** with offline sync and credit/loyalty. Recorded in BUILD-STATUS | — |
| Citation coverage | CLAUDE.md | Every table has a `Cites:` comment, and every cited ID exists in `/docs` | default suite |

## 8. Speed design and the performance test

The design, all traceable to existing rules:

- **Scan is one indexed read.** Exact match on a unique index (`PR-08`: unique organization-wide; `PR-12`: the value
  is a string, not a number; `UX-48`: a barcode is exact, a name is fuzzy). The scan reads no stock and takes no lock
  (`UX-25`: a shortfall surfaces at completion).
- **The cart stays in the browser** until checkout. Its running total is for display (`UX-10`).
- **The sale is sent once** with a `ClientOperationId` (`SM-04`). The server recomputes every total and re-validates
  prices (`P1`, §10.1, §10.3); a client total is discarded.
- **Lists are paginated**, by keyset (§18.5).

The measurement (`npm run perf`, kept out of the default suite because timing is machine-dependent):

1. **scan-to-cart:** p50/p95/max over repeated barcode lookups, real HTTP on localhost with keep-alive, against a
   seeded catalogue whose size is stated in the report (starting at 100,000 variants). Budget: **p95 ≤ 100 ms**,
   the owner's figure, on the local setup.
2. **sale-save:** p50/p95/max for a 10-line cart with a cash tender. **No budget is stated by the owner and none is
   assumed.** The first measurement is reported and a budget is proposed for approval.
3. **Browser timing** (Enter keypress to line rendered) with Playwright, added with the first UI slice.

*Known limit:* the 100 ms budget is a local-network figure. A cloud round trip adds latency the server cannot remove;
if the budget must hold in the cloud, a client-side price cache is needed. That is the cache `§5.3` already anticipates
for offline, and it is deferred with it.

## 9. Dependency and licence register (`D-10`, `GATE-Q2-LICENCE`)

The licence column is the `license` field in npm registry metadata on 2026-09-30. **It is not a legal conclusion.**
Transitive dependencies have not been reviewed. Licence compatibility with the SmartStore licence remains the
pre-release requirement in `D-10` and stays with the owner and counsel.

| Package | Version | Licence | Role |
|---|---|---|---|
| fastify | 5.12.5 | MIT | HTTP |
| pg | 8.23.0 | MIT | Driver |
| zod | 4.6.5 | MIT | Validation |
| dbmate | 2.36.0 | MIT | Migrations |
| typescript | 7.0.2 | Apache-2.0 | Types |
| tsx | 4.23.15 | MIT | Dev runner |
| vitest | 5.0.3 | MIT | Tests |
| react | 19.3.0 | MIT | UI |
| vite | 8.3.1 | MIT | Web build |
| @playwright/test | 1.63.0 | Apache-2.0 | Browser timing (later) |

Candidates for later domains, **not chosen here**: `@fastify/cookie` 11.1.2 (MIT) for sessions; `argon2` 0.45.1 or
`@node-rs/argon2` 2.2.1 (MIT) for `ADR-12` password hashing; `@testing-library/react` 16.3.3 (MIT) for web tests. Each is
chosen, and its licence recorded here, when its domain begins.

## 10. Not decided here

Session library and password-hashing library (domain 7; mechanism fixed by `ADR-12`); the payment provider and the
card gateway implementation (an account and secrets, so the owner's call); hosting and cloud provider; hardware;
identifier strategy and other schema conventions (`docs/database/CONVENTIONS.md`); the web router and any client
data-fetching library; tax rates (`D-12`, `GAP-044`) and RPO/RTO (`D-13`, `GAP-038`).

## 11. Risks and unknowns

| Risk | Note |
|---|---|
| TypeScript 7.x is a recent major | Used for type-checking only, so pinning an earlier major is a cheap fallback if a tool lags. UNVERIFIED |
| Node 26 is not LTS for four more weeks | Fallback is Node 24. Toolchain compatibility is confirmed at scaffolding |
| dbmate is a native binary | The npm wrapper ships per-platform packages including `@dbmate/win32-x64` (*checked*). Fallback: `winget install amacneil.dbmate` (*checked*: 2.36.0) |
| Hand-written SQL and row types | Drift is caught by integration tests against the real schema |
| 100 ms holds locally, not necessarily in the cloud | §8 |
| Vitest 5 and Vite 8 are new majors | Versions are pinned by lockfile; `npm ci` in every environment |

## 12. What must be installed

| Item | State on this machine, *checked* | Action |
|---|---|---|
| PostgreSQL | 17.11 installed, service `postgresql-x64-17` running, port 5432 accepting connections, `psql` and `pg_dump` on PATH | None |
| Node.js | v25.8.2 | `winget upgrade OpenJS.NodeJS` (offers 26.7.0), then reopen the terminal |
| Git | 2.53.0; remote `origin` present | None |
| dbmate | Not installed | None: it is an npm devDependency, installed by `npm ci`. Fallback: `winget install amacneil.dbmate` |
| Playwright browsers | Not installed | Later, at the first UI slice: `npx playwright install chromium` |
| Docker | Not installed | Not needed |

## 13. Owner approval

**2026-09-30 — approved by the owner.** The owner's words, recorded verbatim:

> approved which makes my project latency low use it

Interpretation, stated so it can be corrected: the ADR is approved as proposed, and where §4 offered a choice the
owner selects the option that gives the lowest latency.

| Choice | Result | Latency reasoning |
|---|---|---|
| Fastify or Express | **Fastify 5** | Lower per-request overhead by design (serialization compiled from response schemas). The size of the effect on a database-bound request is **UNVERIFIED** until `npm run perf` measures it (§8) |
| Node 26 or Node 24 | **Node 26** | Newer V8. No measured claim. Toolchain compatibility is confirmed at scaffolding; fallback is 24 |
| dbmate or node-pg-migrate | **dbmate** | Not in any request path, so no latency effect. The §4.1 reasoning stands |

The working defaults put to the owner with this ADR were not objected to and are applied:

1. Step 2 designs all seven domains in the owner's order before any application code (CLAUDE.md: no application code
   during Phase 3). Actor foreign keys in domains 3 to 6 are added in domain 7. Step 3 implements in dependency order
   1, 7, 6, 2, 3, 4, 5, because every endpoint needs the authorization gate and every mutation writes an audit row in
   the same transaction (`AC-03`, §14.1).
2. A sale requires a shift (`BI-39`), so a minimal Shift/Drawer is added to the Sale/Payment domain. Nothing else from
   Cash.
3. Movement types are taken from `inventory-domain.md`, which includes `OPENING_BALANCE`, not from the shorter list in
   PHASE-2-ARCHITECTURE §9.3.
4. Card payments are a `PaymentGateway` interface with a simulated implementation. A real acquirer needs an account
   and secrets, which is the owner's call. Tax rates are data, and test fixtures are labelled TEST-ONLY (`D-12`).
5. Work happens on branch `v1-build`, with a commit after each passing step and a push reminder at the end of each
   domain.
6. Migrations are forward-only.
