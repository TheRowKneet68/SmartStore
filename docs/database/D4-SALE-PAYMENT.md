# Domain 4 — Sale / Payment (with the till, drawer and shift a sale needs)

**Phase 3 — database design.** Migrations: `db/migrations/20260930160000_d4_till_and_cash.sql` and
`20260930161000_d4_sale_and_payment.sql`. Conventions: [CONVENTIONS.md](CONVENTIONS.md). Previous:
[D3](D3-INVENTORY-LEDGER.md).

| State (Constitution §5) | What |
|---|---|
| **DESIGNED** | Everything in this document |
| **IMPLEMENTED** | Both migrations: tables, constraints, triggers, grants, the Sale, Payment, Shift and Device machines as data |
| **TESTED** | `server/test/d4-sale.test.ts` (45 tests) plus the schema-wide suites; 191 passing on 5 consecutive runs |
| **Not built** | Everything in §8, and all application code, including the provider adapter, the scan endpoint and receipts |

Sources: [sales-pos-domain.md](../product/sales-pos-domain.md) (`SP-*`), [payment-domain.md](../product/payment-domain.md)
(`PY-*`), [cash-management.md](../product/cash-management.md) (`CD-*`), [organization-model.md](../product/organization-model.md)
§6–§7 (`PT-*`, `CD-01`), [customer-domain.md](../product/customer-domain.md) (`CU-01`), `state-machines.md` §7, §11–§13,
§22.6, §22.10–§22.12, `D-14`, requirements `RT-118`..`RT-147`, `RT-423`, `RT-480`, `RT-489`, `RT-493`.

---

## 1. The completion order, and why a `checkout` exists

The specification fixes an order and a boundary that seem to conflict:

- `SP-01`: a `Sale` document exists **only once complete**. There is no draft sale.
- `PY-37`, `PY-38`: the order is **authorize → capture → commit → print**. The card is captured *before* the sale
  commits, and each provider call runs outside any transaction (`PY-36`, architecture §13.2).
- `PY-42`, `PY-54`: every attempt is recorded, and a retry is "a new `Payment` against the same sale".

So payment attempts must be recorded against a sale that does not exist yet. **`checkout`** is the record of *settling
one cart at one till*: store, terminal, drawer, open shift, and the cart's client operation id. It holds every
payment attempt. It is not a sale: it has no number, no lines and no ledger effect, so `SP-01` stands. It is `Open`
until it either **completes** into exactly one sale (the sale's insert closes it; a deferred check makes `Completed`
impossible without that sale), or is **abandoned** with the cart. An abandoned checkout's captured payments are
"money taken for nothing" (`PY-37`), and the reconciliation job reports them for voiding or refund (`PY-40`).

This is a structure the specification's order requires, not new business behaviour. The name and its three statuses
are this design's own, not the specification's.

**The completion order in the database:**

1. `checkout` inserted (the till in service and not in training (`PT-03`), the shift open).
2. For a card: each attempt is a `payment` row created `Pending` in its own transaction; the provider is called
   outside the transaction; the result (`Authorized`, `Captured`, `Declined`, `Failed`) is recorded in another
   transaction. A timeout leaves it `Pending` (`PY-11`).
3. **The completion transaction** (`SP-02`): cash tenders (`Pending` → `Authorized` → `Captured`), the `sale`, its
   `sale_line`s, one `inventory_transaction` and a `SALE` movement per stocked line through the D3 write path, and the
   `ChangeDisbursed` cash transaction. At commit, `assert_sale_complete()` verifies the whole: at least one line; totals
   are the sums of lines and follow the tax mode; settled amounts sum to the total due; no tender still `Pending` or
   `Authorized`; captured tenders equal the total due; change equals cash tendered beyond cash applied and is
   disbursed; every stocked line moved exactly its quantity. Anything short rolls the whole transaction back
   (`RT-119`).

**Lock order.** The sale's insert takes the store's document-number counter, and its movements then take the stock
balance rows. Every sale takes them in that order, so sales cannot deadlock one another. A stock adjustment takes only
balance locks. Architecture §20.2 suggests "stock before document", but here the movements' foreign keys to the sale
force the document first; the consistent order is what prevents deadlock, and the concurrency test confirms it.

## 2. Tables

| Table | Scope | Purpose | Key rules |
|---|---|---|---|
| `customer` | organization | Identity only: the walk-in record a sale needs (`CU-01`); one walk-in per organization | `CU-01` |
| `pos_terminal` | store | A registered till: `mode` (Standard/Training/Maintenance) and `status` (the Device lifecycle) as separate axes (`SM-59`, `ADR-27`); `sell_from_location_id` must be a sellable location of its own store | `PT-01`..`PT-03`, `RT-423`, OQ-019 |
| `cash_drawer` | store | At most one per terminal, in the store's currency | `CD-01`, `CD-34`, `CD-36` |
| `cash_shift` | store | The till shift: stores only who, when, where and status (cash-management §2). **One open shift per drawer and per employee per store**, as partial unique indexes | `CD-02`, `CD-03`, `BI-39` |
| `cash_transaction` | store | The drawer ledger, append-only at every privilege. v1 writes `OpeningFloat` (exactly one per shift, possibly zero, `CD-11`, `CD-14`), `ChangeDisbursed` (one per sale with change, `CD-18`) and `ClosingFloat` (`CD-20`) | `CD-19` |
| `payment_method`, `store_payment_method` | organization, store | Typed methods (`PY-03`); v1 types are Cash and Card. Enablement per store is prospective (`PY-05`), and a disabled method is refused (`SS045`) | `PY-03`..`PY-05` |
| `checkout` | store | §1. The cart's `client_operation_id` is unique per terminal (`BI-28`, `PY-39`) | `PY-37`, `PY-38` |
| `payment` | store | One attempt: the **amount applied**; cash also records **tendered** ≥ applied, and any other method has no tendered amount, so it is never overpaid (`PY-02`, `PY-19`). Settlement order recorded (`PY-20`); provider reference unique (`PY-15`); normalised outcome plus raw code (`PY-10`) | `PY-*`, `D-14` |
| `sale` | store | Born `Completed` with a server-allocated number, business date and completion time; bound to checkout, terminal, drawer, shift, employee and customer (`RT-122`); the settings version in force (the snapshot, `REQ-AU-06`) and tax mode; totals; change; receipt status. Never edited: only `receipt_status` is updatable | `SP-01`, `SP-02`, `BI-08` |
| `sale_line` | store | Snapshots description, unit, **quoted price and quote time**, tax rate version and tax, gross, line total, **settled amount** (`RT-146`), cost at sale (`SP-07`), sell-from location, entry method and scanned barcode (`RT-489`), and the **returned and refunded counters**, bounded by `CHECK`s (`BI-06`, `BI-10`) | `SP-06`, `SP-07` |
| `shift_count` | store | One blind counting pass: counted amount; expected amount computed by the server at the count; derived variance; acknowledgement (who, when, reason) written once | `CD-20`..`CD-25` |

`inventory_movement` gains the sale arc: `(sale_id, sale_line_id)`, with a composite FK to the line's variant and
location, and `ck_inventory_movement_one_cause` now counts it. `cash_transaction` gains `sale_id` for the change.

## 3. The server's authority over a line (`BI-30`, `RT-040`)

The cart lives in the browser until checkout (the owner's speed requirement), so the database checks each line
against its own records rather than trusting the client:

| Field | Must equal | Rule | Refusal |
|---|---|---|---|
| `unit_price` | `resolve_price(store, variant, price_quoted_at)`, with `price_quoted_at` not in the future | `RT-124`: the price is fixed at add time; `PR-30` precedence | `SS030` |
| `tax_rate_id` | The rate in force now for the variant's category. No category means unclassified, which is refused | `RT-130`, `RT-493`, `BI-18` | `SS029` |
| `unit_cost` | The standard cost in force now (or null if none is defined) | `SP-07`, `IV-54` | `SS031` |
| `gross_amount` | `round(quantity × unit_price)`, a `CHECK` | overview §3.1, `BI-01` | `23514` |
| variant | Product `Active` or `Discontinued`, variant not archived; a discontinued product sells only from stock on hand | `SP-09`, `PR-48`, `SM-11` | `SS028`, `SS041` |
| location | Sellable, and in the sale's own store | `WH-01`, `RT-004` | `SS032` |
| `scanned_barcode` | A live barcode of this very variant | `RT-489` | `SS033` |

**Price at add time.** `RT-124` and `EC-07` fix a line's price at add time, so a mid-cart price change does not
reprice the line. Architecture §10.3 says the cart re-validates at completion. The product rule outranks the
architecture (Constitution §2), so the line carries the **server-issued quote time**, and the database verifies the
price against price history at that instant. In Step 3 the scan endpoint signs the quote (variant, price, store,
server time, expiry), so the quote time cannot be forged, and the application bounds a quote's age.

`resolve_price()` is **the** resolution rule. The scan uses it to quote and the line check uses it to verify, so the
two cannot disagree. Lines, movements and the change row may be written **only in the sale's completion transaction**
(`sale.completed_at = now()`, the transaction's own start time): a later transaction cannot add to a finalized sale
(`SS036`).

## 4. Payment machine (§22.10, `D-14`)

`Pending → Authorized → Captured`; `Pending|Authorized → Voided`; `Pending → Declined`; `Pending → Failed`. **No edge
leaves `Captured`, `Declined`, `Voided` or `Failed`** (`PY-12`, `PY-54`, `D-14`), asserted on the graph (`RT-345`). A
payment in any of those states is frozen (`SS035`), and a retry is a new row with the next sequence number on the same
checkout. There is no `Refunded` state on the payment: that lives on the refund (domain 5). A timeout is not a state
(`SM-52`).

**The permissions for submit, capture and void are `OPEN DECISION`** (§22.10, `GAP-036`). The schema is unaffected, but
under the architecture's fallback those transitions refuse until the owner names the keys. **OQ-018** is the owner
decision the till's card path needs before Step 3.

## 5. Shift count and close

- `shift_expected_cash(shift)` = opening float + cash **applied** to the shift's completed sales (`CD-06`). The applied
  amount is already net of change, so change is not subtracted again (**OQ-015**). Card never enters the drawer
  (`CD-09`).
- A count is taken only in `Reconciling`, and no sale can run then, because a sale needs an `Open` shift. The server
  numbers the pass and computes the expected amount; the application cannot supply it. The variance is a generated
  column (`CD-22`). A recount is a new pass; earlier passes stand (`SM-57`).
- `Reconciling → Closed` requires the latest count to have a zero variance, or one acknowledged with a reason (`CD-23`,
  `CD-25`), and a declared closing float (`CD-20`). The tolerance is zero, and the "higher threshold, second approver"
  step is unconfigured (**OQ-020**).
- `Closed → Reopened` has an `OPEN DECISION` permission, so it refuses; `Reconciling → Open` is drawn but not
  contracted (**OQ-014**).

## 6. Guards closed

| Rule | Guard |
|---|---|
| `ORG-01`, `ORG-02`, `RT-504`, `RT-505` | Organization currency and time zone are frozen once a sale or payment exists; the refusal names the first document (`SS037`) |
| `SP-33`, `PR-38` | Once a store has sold, no settings version may change its tax mode. A store with a differing tax mode *scheduled* cannot trade until it takes effect. A sale must use the settings version in force (`SS038`) |
| `ORG-05`, `EC-89` | No store deactivation while any shift is not closed (`SS039`) |
| `PR-03`, `RT-030` | A sold variant's name is fixed (`SS040`) |
| `WH-01`, `RT-004` | Sale lines only from sellable locations of the store |
| `RT-457`, `EC-86` | Structural: a sale needs an active terminal, a drawer, an open shift and the settings in force |

Still pending: `PR-10`, reissuing an archived barcode only if no document references it. Sale lines keep the scanned
value, so the guard, if wanted, is a value check at barcode insert.

## 7. Tests — what proves what

| Rule | Proven by (`d4-sale.test.ts`) |
|---|---|
| `RT-132`, `RT-135` | **The exact example**: a 5000 tender for a 1340 sale records 1340 applied, 1340 tendered on the sale, 3660 change, and a 3660 `ChangeDisbursed` row |
| `SP-01`, `BI-42`, `RT-118` | Born `Completed`, numbered 1, 2; dated by the server; checkout `Completed` |
| `IV-15`, `RT-119` | Stock moved in the same transaction; zero drift |
| `RT-133`, `PY-16`, `PY-20` | Card then cash, in recorded order, settling exactly |
| `BI-28`, `PY-39`, `RT-121` | A retried commit with the same operation id creates no second sale |
| `SP-40`, `PY-17`, `RT-119` | An underpaid sale is refused, and no stock movement or cash payment survives |
| `RT-136`, `PY-11` | A card left `Pending` never completes a sale |
| `RT-124`, `BI-30` | The old quote stands after a price change; a doctored price and a future quote are refused |
| `SP-07`, `RT-130`, `RT-493` | A client cost or rate is refused; an unclassified variant cannot be sold |
| `SP-09`, `PR-48`, `SM-11` | Hidden and archived refused; discontinued sells its stock on hand, then refuses |
| `WH-01`, `RT-004`, `RT-489`, `PR-11` | Quarantine location refused; a barcode of another variant refused; a selection is recorded as `Selected` |
| `SP-02`, `IV-15`, `CD-18` | Totals off by one, unmoved stock and undisbursed change are each refused at commit; a line cannot be added later |
| `BI-08`, `SP-58` | A sale and its lines cannot be edited or deleted; only the receipt status updates |
| **`BI-36`, `RT-067`** | **6 concurrent checkouts of the last unit under `BlockNegative`, 5 runs: exactly one sale completes each time**; stock 0; zero drift |
| `IV-16`, `RT-119` | Under `BlockNegative` a sale beyond stock is refused whole, with no sale row |
| `PT-01`, `BI-39`, `PT-03` | A reconciling shift sells nothing; a training till cannot take payment |
| `PY-12`, `PY-54`, `D-14`, `RT-345` | No edge out of the four terminal states; a `Failed` payment frozen; the retry is a new row |
| `PY-02`, `PY-19`, `PY-04`, `PY-15` | Tendered rules for cash and card; zero refused; disabled method refused; provider reference once |
| `BI-39`, `CD-03`, `CD-11`, `CD-14` | **4 concurrent opens of one drawer: exactly one succeeds**; one open shift per cashier per store; exactly one float; a zero float is legitimate |
| `CD-06`, `CD-20`..`CD-25`, `RT-135` | Expected = float + cash applied (card excluded); count only while reconciling; the server computes expected and the application cannot forge it; close needs a count, a zero or acknowledged variance, and a closing float; acknowledged once |
| §6 guards | Tax mode frozen after a sale; a scheduled tax-mode change blocks trading; a stale settings version refused; organization zone frozen; open shift blocks deactivation; sold variant's name frozen |

**Mutation check (2026-09-30).** Each of these turned its test red: skipping the quoted-price check; unfreezing
terminal payments; skipping captured-equals-total; skipping the discontinued-stock check; and dropping the
one-open-shift-per-drawer index. Removing the commit-idempotency unique on the sale alone does not turn its test red,
because the checkout's unique catches the retry first. The two are deliberate double protection, and the test proves
the combination.

## 8. Not built in v1

Recorded in BUILD-STATUS with their rules: voiding a completed sale (**OQ-017**; refused, `SS044`); suspended sales
(`SP-44`..`SP-49`: the cart stays in the browser); credit sales and the zero-value payment (`SP-41`, `PY-01`, deferred
with credit); stored-value, loyalty, wallet and bank-transfer methods (`PY-29`..`PY-35`); price overrides (`SP-22`..`SP-24`);
cash rounding (`SP-25`, `SP-26`); weighed lines (`SP-16`..`SP-20`); `NoSale` (`RT-143`); other cash transaction types
and their thresholds (`CD-15`..`CD-17`); denomination counts (`CD-27`..`CD-29`, `UX-32`); shift reopen (`CD-26`);
customer management (`CU-02`..`CU-38`); device telemetry (`SM-60a`, `PT-04`); the provider adapter, reconciliation job
and receipt rendering (application, Step 3).

## 9. Application layer: the shift close (Step 3, 2026-10-01)

This section covers the shift close only. The rest of Domain 4's application code adds its own section.

| State | What |
|---|---|
| **IMPLEMENTED** | `CD-20`..`CD-25`: begin count, the blind count, acknowledging a variance, and the close with its declared float. Also the shift screen that answers them (`CD-30`, `CD-31`). Code: `server/src/modules/sales/shift-close.ts`, and two options of the transition endpoint (`server/src/http/transitions.ts`) |
| **TESTED** | `server/src/modules/sales/shift-close.test.ts` (25 tests). 403 server tests pass in all |
| **Not built** | See "Not built" below |

| Step | Route | Key |
|---|---|---|
| Begin count, `Open → Reconciling` | `POST /transitions { machine: "Shift", event: "begin count", subject }` | `Shift.Close`, from the edge (§22.11) |
| Count one pass | `POST /stores/:storeId/shifts/:shiftId/counts { countedAmount }` | `Shift.Close` (`CD-20`) |
| Acknowledge a pass's variance | `POST /stores/:storeId/shifts/:shiftId/counts/:countId/acknowledge { reasonCodeId }` | `Cash.Variance.Acknowledge` (`CD-23`) |
| Close, `Reconciling → Closed` | `POST /transitions { machine: "Shift", event: "close", subject, payload: { closingFloat } }` | `Shift.Close`, from the edge (§22.11) |
| The shift screen | `GET /stores/:storeId/shifts/:shiftId`; `GET /stores/:storeId/shifts?status=&limit=` | `Cash.Count.View` (actors-and-roles §2.10) |

- **The count is blind** (`CD-21`, `CD-31`, `RT-243`). Nothing reveals the expected amount before a pass is
  submitted. The pass's own response is the first place it appears, as the database computed it at the count
  (`CD-22`). The shift screen's figures come only from submitted passes.
- **A recount is a new pass** (`SM-57`). Earlier passes stand. The close, the screen's answers and its next step all
  follow the latest pass. Counts and acknowledgements lock the shift and happen only while it is `Reconciling`.
- **Acknowledgement** (`CD-23`, `BI-25`, `RT-245`):
  - only a non-zero variance is acknowledged;
  - it needs a live reason code of the organization, and is written once (`SS001`);
  - the variance stays as counted (`CD-24`);
  - under OQ-020 the tolerance is zero and no second approver is required.

  It is recorded on the count row: who, when and why. The AU-12 vocabulary has no event type for it, AU-03's floor
  does not require one, and AU-12c forbids adding one opportunistically, so no audit event is written.
- **The close** (`CD-20`, `CD-25`, `RT-526`):
  - the latest pass must exist (`not_counted`);
  - its variance must be zero or acknowledged (`variance_unacknowledged`, which carries the count's id);
  - then the declared float is written as a `ClosingFloat` movement out of the drawer, by the closer, and
    `closed_by` is the closer.

  The database checks all three conditions again (`SS042`), stamps `closed_at`, and audits `Shift.Close`. Closing
  again changes nothing and writes no second float (`SM-04`).
- **Payloads on the transition endpoint** (architecture §18.1):
  - a binding declares the payload an event carries. It is validated before the subject is read or the permission
    checked, so a malformed close is a 400 whoever sends it (§24.2);
  - work the edge needs runs after the permission check, so someone who may not close learns nothing about the count
    (§8.4, §24.3).
- **The shift screen** (`CD-30`, `RT-527`) gives four answers:
  - `expected`;
  - `counted`;
  - `variance`, with `tolerance` (0 under OQ-020);
  - `why`: the reason, who acknowledged it and when, and `next`: `begin count`, `count`, `acknowledge`, `close`, or
    nothing once closed.

  The detail adds every pass. The opening and closing floats are not shown, because `CD-30` limits the screen to its
  four answers.
- **OQ-014.** `reopen` and `Reconciling → Open` have no edge row, so the endpoint refuses both (`illegal_transition`),
  even for the Owner. `CD-26` is not built.

**Decisions, stated so they can be reversed:**
- Counting and closing go by key, not by person: anyone with `Shift.Close` in the store may count or close a shift,
  not only the cashier who opened it. `CD-20` names the key.
- The declared closing float has no upper bound (OQ-029).
- One person holding both keys may count and acknowledge the same pass. No second approver applies until a threshold
  exists (OQ-020).
- **Added with the UI, 2026-10-01:** the shift screen names its till and its people, where it had given ids:
  - who opened and who closed the shift;
  - who counted each pass;
  - who acknowledged a difference, which is `CD-30`'s "approver".

  Anyone with `Cash.Count.View` in the store sees these names, using the same name form as the workspace. No rule
  restricts names on an operational record. `Employee.View` covers managing employee records.

**Not built:**
- The denomination breakdown that `RT-526` asks for. §8 defers `CD-27`..`CD-29`, and building it needs a migration.
- Auto-close within a tolerance, and the second approver (OQ-020). The numbers do not exist.
- A loss recorded as a cash `Adjustment` (`CD-24`). §8 defers the other cash transaction types (`CD-15`..`CD-17`).
- Reopen (`CD-26`, OQ-014).

**Found in the schema, reported and not changed** (the shift-close brief excluded migrations). A temporary probe,
run once and removed, verified both:
- **A closed shift's actor columns can be rewritten.** The runtime role can change `closed_by` and
  `status_changed_by` on a `Closed` shift, and no audit event records it (2 events before the change, 2 after). No
  trigger freezes them. `SM-57` makes a closed shift immutable, and `AU-05` takes the actor from the authenticated
  identity.
- **An archived reason is accepted at the database.** `shift_count_before_write` does not call
  `assert_reason_code_live`, as other reasoned rows do. The route's `SS024` check is the only guard, and mutant C22
  proves it is tested.

**Both closed on 2026-10-01**, once the owner authorized migrations for finishing Domain 4. Each is a forward-only
migration:
- `20261001120000_d4_shift_actors_fixed.sql` adds `tg_cash_shift_actors_fixed`. `status_changed_by` and `closed_by`
  change only together with the status, so a closed shift's actors are fixed at any privilege (`SS001`; `SM-57`,
  `AU-05`).
- `20261001120100_d4_count_reason_live.sql` adds `tg_shift_count_reason_live`. An acknowledgement's reason must be
  live (`SS024`; `CD-23`, `BI-40`).

The route's own archived check became a second copy of the database's, with the same code and message, so it was
removed. The route still finds the reason in the caller's organization first. Without that, the database's liveness
check would answer first, and would say whether another organization's reason was archived (§24.3).

**Mutation check (2026-10-01).** 47 mutations, one per guard, all detected on the final code, and every file was
restored byte for byte:
- the transition endpoint's two options (5): the payload is validated, before authorization; the edge's work runs,
  only after the permission check; a shift's organization is its store's;
- the close (12): a count is required, by name; an unacknowledged variance blocks and an acknowledged one does not;
  the latest pass decides; the float is written, as declared, by the closer; `closed_by`; the float's schema and the
  payload's declaration;
- counting and acknowledging (11): this store's shift; `Open` and other states refused by name; the count's schema;
  the counter; this shift's count; nothing to acknowledge; the organization's live reason; the acknowledger;
- the shift screen (15): the latest pass; each next step; `why`; the tolerance; the list's store, status, order and
  limit; the detail's store; the history's shift and order;
- each route's key (4).

Planning found 9 gaps, and a test was strengthened for each before the first run:
- each route asks for its own key, and is refused to someone holding every other key of the feature;
- another organization's shift, count and archived reason are refused through a real store;
- a closer who is not the opener is recorded as the closer;
- the permission is checked before anything about the count is said.

The first run detected 45 of 47. The 2 survivors removed `.int()` from `z.number().int().safe()`. They were equivalent
mutants, not missing tests: in zod 4.6.5 `int()` and `safe()` are the same check, as verified on 12.5 and 2^53.
Dropping the repeated `.safe()` made each schema one check, and the second run detected all 47.
