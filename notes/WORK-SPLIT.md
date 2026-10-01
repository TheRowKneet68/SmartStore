# Work split: what is hard and what is routine

Written 2026-10-01, alongside [MISSING-FEATURES.md](MISSING-FEATURES.md). This file takes that inventory and sorts it
by how much work each item actually is, so effort can be split between two agents without guessing.

Nothing here is approved work, and this file does not change any phase order in `BUILD-STATUS.md`. It exists only to
size things.

## How the split was made

Read in full before sorting:

- every route registration in `server/src` (47 paths across 6 modules);
- `server/src` (41 files) and `server/test` (13 files);
- all 9 migrations in `db/migrations` (5,493 lines);
- `web/` (11 source files; the whole product is `web/src/pos/Sale.tsx`, 164 lines);
- `OPEN-QUESTIONS.md` (OQ-001..OQ-028, plus GAP-038, GAP-044, GATE-Q2-LICENCE);
- `docs/product/requirements-traceability.md` §26.2, the coverage table: **1,161 rules across 25 canonical homes,
  529 requirements, all `mapped`, 0 `inferred`**, of which 50 rules have only `OUT OF SCOPE` owners and are work
  that will never be built.

The two tests used, applied in this order:

1. **Is there an existing pattern to copy?** A route, table, trigger or component that already does the same shape
   of thing. If yes, the item is routine.
2. **Does it touch money, concurrency, or a state machine, or need new tables or triggers, or cross a domain
   boundary?** If yes, it is hard.

Anything with no requirement text is not in either section. It is in section 3.

## Section 1 — Hard: high computation

Sized by rule count and by whether a migration is needed. Sixteen workstreams, roughly **550 rules**.

| Workstream | Rules | Why it is hard | Blocked? |
|---|---|---|---|
| Returns and refunds | `RR` 44 | The D5 schema exists (899 lines, 746 lines of test) but there is no route. Money out, tender settlement, an approval chain, and voids and refunds as signed lines rather than a deduction | **Yes** — OQ-023 (caps, skipped approval, window edges), OQ-025 (a refund cannot be paid until the owner names the `submit to provider` permission key) |
| Customers, loyalty, credit | `CU` 40 | No customer entity exists at all. New migration, personal data and retention, and credit exposure | No |
| Procurement and supplier | `PR-Q` 42 + `SU` 26 | No tables and no routes. PO to receipt to bill is a multi-leg document family | No |
| Batch and expiry, FEFO | `BE` 49 | Serial and lot tracking, quarantine versus sellable, expiry allocation across locations in FEFO order | No |
| Offline POS | `OF` 50 | Sync protocol, conflict resolution, device identity, replay safety. This is an architecture decision, not a feature | No |
| Approval engine | `AP` 40 | A generic approval substrate that refunds, stock adjustments and price override all sit on. Getting it wrong poisons three domains at once | No |
| Notifications | `NT` 37 | Channels, templates, retry, deduplication. Needs infrastructure the repo has made no decision about | Partly |
| RFID | `RF` 38 | Reader protocol, event ingestion, tag-to-variant binding | Needs a hardware decision |
| Hardware devices | `HD` 34 | Scale, printer and cash-drawer drivers; device state; retry | Needs a hardware decision |
| X/Z report | part of `CD`, plus 6 `RP` | Depends on shift close existing. Must read the authoritative figure and never re-derive it (RT-305) | Depends on the close |
| Shift close | `CD-20`..`CD-25` | Money, variance, second approver, and the reopen edge. Three triggers already guard the table, so the design is constrained | **Yes** — OQ-014 (Reconciling to Open, Closed to Reopened), OQ-020 (variance tolerance and the second-approver threshold) |
| Card and other tenders | about 40 of `PY` 54 | Provider integration, refunds as payment, surcharging, DCC | **Yes** — OQ-018 (payment transition permissions) |
| Stock transfer and count sheet | about 25 of `IV` 59 | Two-leg document, who owns stock in transit, recount reconciliation against the system quantity | No |
| Multi-store operations | `MS` 35 | Only store-access grants exist. Transfers, inter-store visibility. 11 of the 35 rules have only `OUT OF SCOPE` owners and are not work at all | Partly |
| Attendance and leave | about 15 of `EM` 32 | New tables, and it feeds the `read_only` branch of the access gate | No |
| Costing and valuation | none stated | **No costing method appears anywhere in `/docs`.** Stock valuation cannot be built without one | **Needs a decision** |

Four of these cannot start at all: returns and refunds, shift close, card tenders, and anything needing a costing
method or hardware.

## Section 2 — Routine: low computation

Every one of these has a working example in the repository to copy. Roughly **100–150 rules** plus about a dozen
screens.

| Task | Copy the pattern from | Size |
|---|---|---|
| Audit log read surface | `modules/audit/chain.ts` (22 lines) — the hash chain is already written and verified; this is query, filter and paging only | `AU` 38 |
| Sale list and search by date, till or cashier | the paging already on `GET /products` | part of `SP` 66 |
| Till disable and retire | `http/transitions.ts` — the `Device` state machine already exists | `PT` 4 |
| Pay-in and pay-out | `cash_transaction` rows that shift open already writes | small part of `CD` |
| Identity admin screens | `modules/identity` is API-complete: roles, permission grants, employees, store access | about 5 screens, pure UI |
| Reference-data edit and archive for brands, units, tax categories | `POST /categories/:id/archive` | 3 gaps |
| Price history on the product page | `GET /variants/:id/prices` already returns it | 1 screen |
| Sell by name at the till | `GET /products` name search plus the existing cart insert | 1 screen |
| Manual weigh entry for `Measurable` units | the existing line insert | 1 input. **Scale integration is not on this list — it is `HD` and belongs in section 1** |
| Receipt render and reprint flow | `web/src/pos/Sale.tsx` | print CSS, an immutable receipt document, and a reason on every reprint |
| Web onboarding wrapper | `server/src/onboarding.ts` (109 lines) | 1 screen |
| Health, readiness and request-log endpoints | nothing to copy, but about 40 lines of Fastify | no rules |
| Housekeeping jobs (audit retention, quote expiry, session cleanup) | once a scheduler is chosen | no rules |
| Consistent paging, sorting and filtering on every existing list | already done on `/products` | mechanical |

## Section 3 — Neither: needs an owner decision first

No requirement text exists for any of these. Under `CLAUDE.md` they go to `OPEN-QUESTIONS.md` and stop there.

- Discounts and price override at the till. I could not find a rule ID and will not assert one.
- Held or parked sales across shifts.
- Cash rounding and any user-settable rounding.
- Foreign exchange and multi-currency.
- Data import. `docs/product/data-import.md` is prose and defines **zero** rules.
- Retention and deletion. `docs/domain/retention-and-deletion.md` defines **zero** rules.
- Hardware purchasing, and whether the till is headless.
- `GATE-Q2-LICENCE` — licence naming and OSS terms.

## Three caveats that would skew this split

1. **Verification cost does not follow size.** Every item in both sections needs requirement citations, and each
   domain carries a per-guard mutation check (122 tests at last count, D3 21 of 21 mutations, D5 59 of 59, D7 50 of
   50). A small routine task that skips the mutation pass will be sent back. On this repository the mutation and
   citation passes, not the typing, are what cost.
2. **Section 2 has a serial dependency inside it.** Receipts and sale history look independent, but both need a
   document identity and an audit reason for reprint. Whoever builds the audit read surface sets that pattern, so
   it goes first.
3. **Do not size work from the catalogue's summary tables.** §23 claims 354 requirements; the body has 529. §24 and
   §25 still say 140 rules are inferred where §26.3 says 0. §26.2 is the current table and is the only one used
   here. **Corrected on 2026-10-01:** these stale figures are now named and superseded in
   `docs/product/requirements-traceability.md` §27, appended rather than rewritten. §23, §24 and §25 are unchanged.
