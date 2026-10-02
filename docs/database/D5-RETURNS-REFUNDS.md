# Domain 5 — Returns / Refunds

**Phase 3 — database design.** Migration: `db/migrations/20260930170000_d5_returns_refunds.sql`. Conventions:
[CONVENTIONS.md](CONVENTIONS.md). Previous: [D4](D4-SALE-PAYMENT.md).

| State (Constitution §5) | What |
|---|---|
| **DESIGNED** | Everything in this document |
| **IMPLEMENTED** | The migration: tables, constraints, triggers, grants, the CustomerReturn and Refund machines as data |
| **TESTED** | `server/test/d5-returns.test.ts` (38 tests) plus the schema-wide suites; 229 passing |
| **Application layer** | Built 2026-10-02: the return and refund routes and both machines on the transition endpoint (§10), tested through the routes (`server/src/modules/returns/returns.test.ts`, 19) |
| **Not built** | Everything in §9, the returns screen, a read of returns and refunds (OQ-035), and the refund provider call |

Sources: [returns-refunds-domain.md](../product/returns-refunds-domain.md) (`RR-*`),
[payment-domain.md](../product/payment-domain.md) §6 (`PY-21`..`PY-28`), [cash-management.md](../product/cash-management.md)
§3 and §5 (`CD-06`, `RefundFromDrawer`), [batch-expiry-fefo.md](../product/batch-expiry-fefo.md) §6 (dispositions),
[organization-model.md](../product/organization-model.md) §3 and §5, `state-machines.md` §7, §8, §22.6 and §22.7,
[approval-workflows.md](../product/approval-workflows.md) (`AP-03`, `AP-08`), requirements `RT-144`..`RT-161`, `RT-096`,
`RT-258`.

---

## 1. Two documents, one set of counters

A **return** is goods coming back and a **refund** is money going back (`RR-01`). They are separate documents with
separate machines, linked when both exist and never nested (`SM-38`, `SM-39`): a return with no refund is normal
(`RR-36`), and a refund with no return is a goodwill refund (`RR-35`).

Both bounds live on the sold line, in counters that D4 created and that only this domain writes:

| Counter on `sale_line` | Bounded by | Written when |
|---|---|---|
| `returned_quantity` | `quantity` (`BI-06`, `RR-14`) | A return is **posted** |
| `refunded_amount` | `settled_amount` (`RR-03`, `BI-10`) | A refund enters **Processing** (the hold, `RR-24`) |
| `refunded_tax_amount` (new) | `tax_amount` (`RR-06`) | With `refunded_amount` |

Each is incremented by **one conditional `UPDATE`** that affects no row if the bound would be passed. That is the shape
`RR-14` and `PY-22` require. It is atomic without a read-then-write race, because the row lock serialises concurrent
increments and PostgreSQL re-checks the condition on the latest row. The application has no `UPDATE` on `sale_line` or
on `sale.status`. The counters are written by two `SECURITY DEFINER` triggers owned by the schema owner, the one
mutation of a finalized document that CONVENTIONS §9 permits. The sale's status is a cache of the counters (`SP-66`,
`SM-35`) and moves with them, along the contracted edges of §22.6 only. A return that takes everything back at once
therefore passes through `PartiallyReturned` to `Returned` rather than using an uncontracted `Completed → Returned`
edge.

**The per-sale cap follows from the per-line caps.** `PY-22` names two caps: per line (`settled − refunded`) and per
sale (`TotalDue − Σ refunded`). D4 enforces at completion that the settled amounts sum exactly to the total due
(`RR-02`, `SS034`), and every refund is allocated to lines (`SS053`). The per-line bound therefore implies the per-sale
bound. A test refunds a two-line sale completely and shows that nothing further can be refunded on either line.

## 2. Tables

| Table | Scope | Purpose | Key rules |
|---|---|---|---|
| `customer_return` | store | Goods back against **exactly one sale** of the same store (composite key). Numbered per store; `client_operation_id` unique (`RR-15`). Posting records who, when and the business date. A late return records an approver and a reason (`RR-11`); a cancelled one, a reason (`SM-42`) | `RR-08`, `RR-13`, `RR-15` |
| `customer_return_line` | store | One quantity of **one sold line**, proven by key to be a line of the return's own sale with that line's variant (`RR-08`, `BI-16`). A mandatory disposition and its destination location (`RR-17`, `RR-19`). Its own operation id (`RR-16`) | `RR-14`, `RR-16`..`RR-19` |
| `refund` | store | Money back for one sale, optionally linked to one return of that sale (`RR-01`). Method `OriginalTender` (a captured payment of the sale) or `Cash`; disbursement `Drawer` (with the till, drawer and shift it is paid in) or `Provider`. Amount and its own tax total (`RR-43`). Goodwill (no return) requires a reason (`RR-35`). Submitted, approved and cancelled facts, with provider reference and outcome | `RR-22`..`RR-24`, `PY-21`..`PY-27` |
| `refund_line` | store | The refund's allocation to sold lines of the same sale, each with its tax: the refund's own tax lines (`RR-43`). Fixed once submitted (`AP-03`) | `RR-03`, `RR-06` |

Changes to existing tables:

- `inventory_movement` gains the return arc `(customer_return_id, customer_return_line_id, disposition)`. A composite
  key to the line's variant, location **and disposition** means the movement names its disposition (`BE-36`,
  `RT-096`). `ck_inventory_movement_one_cause` counts the return line, and each return line moves once.
- `cash_transaction` gains `RefundFromDrawer` and `refund_id` (`PY-27`), keyed to the refund's own shift.
- `storage_location` gains the type `ExpiredHold` (`BE-24`, batch-expiry-fefo §6), closing the D1 note.
- `store_setting_version` gains `return_window_days` (default 30, `RR-10`) and `default_return_disposition`
  (`Sellable` or `Quarantine`, organization-model §3; default `Quarantine`, which organization-model §5 says holds
  customer returns by default). The default is pre-filled by the screen and never applied by itself (`RR-18`).
- `sale_line` gains `refunded_tax_amount` and two keys that let return and refund lines prove their sale.
- `shift_expected_cash()` now subtracts cash refunded out of the drawer (§4.4).

## 3. The return

**Posting is one transaction** (`BI-04`), in this order:

1. `UPDATE customer_return SET status = 'Posted', posted_by = …`. The server stamps `posted_at` and the business date
   and applies the window check (§3.3). Then, in the owner's trigger, one conditional increment per sold line
   (`RR-14`), in line-id order so concurrent returns lock in the same order, followed by the sale's status.
2. One `inventory_transaction` and one `SALE_RETURN` movement per line, through the D3 write path, into the line's
   dispositioned location and naming the disposition.
3. At commit, `assert_return_posting_complete()` requires that the return has lines and that every line came back
   whole (`SS022`). Nothing moves before posting (`BI-27`, `IV-14`), and a movement for a draft return is refused
   (`SS016`).

### 3.1 Two bounds on quantity, both needed (`RR-14`, §12.1)

- **As built:** a draft never holds more of a line than is still returnable (§12.1: "bounded by RR-14 as it is
  built"). This check is advisory, because two drafts can each fit.
- **At posting:** the conditional increment is the atomic bound. Under 50 concurrent postings of one line, exactly
  the sold quantity comes back (§7). Both refusals name the remainder in the error's `DETAIL` (`RT-148`), which the
  application shows.

`RR-15` and `RR-16` are unique keys on the return's and each line's operation id. As §4 of the domain says, neither
idempotency nor the bound can stand in for the other.

### 3.2 Disposition decides the location (`RR-17`, `RR-19`, batch-expiry-fefo §6)

| Disposition | Must go to | Sellable |
|---|---|---|
| `Sellable` | A sellable location | Yes |
| `Quarantine` | A `Quarantine` location | No |
| `Damaged` | A `Damaged` location | No |
| `Expired` | An `ExpiredHold` location | No |

The check runs at line entry (`SS047`), so the refusal happens "at the boundary" (`RR-19`). A missing or unknown
disposition is refused by the column itself (`23502`, `23514`), since there is no default. That the location is the
store's own is judged when the stock moves (`SS014`, the D3 rule for every movement). Damaged goods are damaged stock
and not yet a loss; the write-off is its own `DAMAGE` adjustment (`RR-21`, D3). `RR-12` holds with no special case:
nothing in the return path looks at product status.

### 3.3 The return window (`RR-10`, `RR-11`)

The window closes on the sale's business date plus `return_window_days`, using the settings version in force when the
return is posted. A return posted after that day needs a late approval, recorded as `late_approved_by` plus
`late_reason_code_id`, together (`RR-11`). Otherwise it is refused with `SS048`, and the error's `DETAIL` carries the
closing date, so "the system names the date the window closed". The late approver is neither the employee who opened
the return nor the one who posts it (`AP-08`, `BI-26`). The window's last day is inside it. That reading, the choice
of settings version, and `RT-150`'s "per category" are recorded in **OQ-023**.

### 3.4 After posting

A posted return keeps its lines and its record: lines change only in `Draft` (`SS018`), and who posted, approved or
cancelled cannot be rewritten (`SS001`). No edge leaves `Posted` in v1. A posted return is never un-posted (`SM-38`),
and a correction is a further reason-bearing movement. `Posted → Settled → Closed` is not built (§8). `Draft →
Cancelled` needs a live reason code (`SM-42`, `BI-40`) and moves nothing.

## 4. The refund

### 4.1 Methods and routing (`RR-22`, `RR-23`, `PY-25`, `PY-27`)

| Method | Disbursement | Requires |
|---|---|---|
| `OriginalTender`, cash payment | `Drawer` | A **captured** payment of the same sale (`SS050`), and the till, drawer and shift it is paid in |
| `OriginalTender`, card payment | `Provider` | A captured payment of the same sale, and no drawer. A new linked transaction with its own round trip and status (`RR-23`) |
| `Cash` | `Drawer` | The till, drawer and shift |

The disbursement is derived by the server, not supplied. `StoreCredit` and `Exchange` wait for customer credit (§9).
A split refund is several refund rows (`RR-22`).

### 4.2 Machine (§22.7)

`Draft → PendingApproval → Approved → Processing → Completed`; `Processing → Failed → Processing` (retry);
`Approved|Processing → Cancelled` (with a reason). Built exactly as contracted:

- **Every refund is approved by a second person**, who is neither the drafter nor the submitter (`BI-26`, `AP-08`).
  §8's table says approval "may be skipped where none is required", but §22.7 contracts no skip edge and the
  `LargeRefund` threshold has no values. This is the same situation as adjustments (OQ-013), recorded in OQ-023.
- The lines are fixed from submission (`AP-03`: the approver approves what is paid), and a refund must equal its lines
  at commit (`SS053`).
- `Completed` and `Cancelled` are frozen (`SS035`); a mistake is corrected by a further linked refund (`BI-09`).
- Three edges have `OPEN DECISION` permissions: `submit to provider` (`Approved → Processing`) and both `cancel`s,
  along with the return's `cancel`, `settle` and `close`. As with payments (OQ-018), the schema carries the edges, and
  under architecture §8.4 the application refuses them until the owner names the keys. **Until then no refund can be
  paid, not even in cash (OQ-023).**

### 4.3 The hold (`RR-24`, `SM-40`, `SM-41`)

Entering `Processing` from `Approved` takes the hold: one conditional increment of each line's refunded amount and tax
(`SS049` names the remainder). The hold stays through `Failed` and `Completed`. A retry does not take it again, and only
a cancellation releases it. So two refunds of the same money cannot both be in flight, and a failed refund that may
still be retried keeps its money reserved (`RT-155`).

A refund linked to a return pays only for lines that the **posted** return took back (`SS051`). Without that, a
goodwill refund could be disguised as a return refund to skip `RR-35`'s reason. How much of a line a partial return
makes refundable (the settled amount prorated by quantity, and its rounding) is not specified, so the bound is the
line's settled amount (OQ-023).

**Tax (`RR-06`, `RR-42`, `RT-161`).** After each refund, a line's refunded tax must equal its stored tax in proportion
to its refunded amount: `round(tax × refunded ÷ settled)`, half away from zero, the one rounding of overview §3.1
(`SS052`). Rounding the cumulative figure rather than each refund means partial refunds always add up to exactly the
tax charged, never more and never less. The price is that a refund drafted against an older total may be refused and
redrafted if another refund of the same line completed first. `RR-44` needs nothing special: an exempt line has tax
0, so its refund's tax is 0.

### 4.4 Cash out of the drawer (`PY-27`, `RT-156`)

A drawer refund's money leaves as a `RefundFromDrawer` cash transaction in the refund's own shift, once. The payout and
the completion are one event: at commit, a payout's refund must be `Completed`, and a completed drawer refund must
have been paid out exactly (`SS053`). Cash is paid only at a till that is in service and not in training (`SS025`,
`PT-03`), during an open shift (`SS026`).

`shift_expected_cash()` subtracts refunds paid out of the drawer. `CD-06` writes that term with a plus sign, but
cash-management §5 gives `RefundFromDrawer` the direction **Out**, and `PY-27` says a refund missing from the drawer
record "means the count at close will be short". Subtracting is the only reading that makes the count balance. OQ-015
flagged this sign in D4, and it is now implemented and tested.

## 5. The counters, rebuilt (`SP-66`, `SM-35a`)

`sale_counter_drift()` rebuilds every line's returned quantity (from posted returns), refunded amount and refunded tax
(from refunds holding money: `Processing`, `Failed`, `Completed`), and every sale's status from the rebuilt counters.
It returns each disagreement and never repairs, on the same principle as `inventory_ledger_drift()`: an empty result is
the proof.

## 6. Error codes

| Code | Meaning | Raised by |
|---|---|---|
| `SS046` | More than is still returnable on the sold line; `DETAIL` is the remainder | `customer_return_line_rules()`, `apply_return_posting()` |
| `SS047` | The disposition does not go to that kind of location | `customer_return_line_rules()` |
| `SS048` | The return window has closed and there is no late approval; `DETAIL` is the closing date | `customer_return_before_write()` |
| `SS049` | More than is still refundable on the sold line; `DETAIL` is the remainder | `apply_refund_hold()` |
| `SS050` | The original tender is not a captured payment of this sale | `refund_before_write()` |
| `SS051` | A refund for a return names a line the posted return did not take back, or the return is not posted | `apply_refund_hold()` |
| `SS052` | The refund's tax is not the line's stored tax in proportion | `apply_refund_hold()` |
| `SS053` | The refund is not whole at commit (its lines, or the drawer payout and completion) | `assert_refund_whole()`, `assert_refund_payout_completes()` |

Reused with the same meaning: `SS001` (who and when are write-once), `SS004`, `SS016` (a return moves stock only as
`SALE_RETURN`, once posted), `SS018` (generalised: document lines change only while the document is a draft), `SS022`,
`SS024` (archived reason), `SS025`, `SS026`, `SS035` (generalised: a payment or refund in a terminal state is never
changed).

## 7. Tests — what proves what

| Rule | Proven by (`d5-returns.test.ts`) |
|---|---|
| `RR-14`, `RR-17`, `SP-66`, `RT-148` | A return brings stock back to the Sellable location, counts it on the line, and moves the sale to `PartiallyReturned`, then `Returned`; zero ledger and counter drift |
| `SP-66`, §22.6 | A return of everything at once reaches `Returned` through the contracted edges |
| **`RR-14`, `RT-148`** | **50 concurrent returns of one five-unit line: exactly 5 succeed, 45 are refused (`SS046`)**; stock and counters exact, zero drift |
| `RR-14`, §12.1 | A draft over the remainder is refused naming it; two drafts that each fit cannot both post |
| `RR-15`, `RR-16`, `RT-149` | Replayed return and replayed line refused by operation id |
| `RR-08`, `RR-13`, `BI-16` | A line of another sale, of another variant, or claiming another sale than its return's, is refused |
| `RR-17`, `RR-19`, `BE-36`, `RT-096` | No disposition, an unknown one, and each disposition to the wrong kind of location are refused; the four right ones land in four locations; a movement with another disposition than its line's is refused |
| `BI-27`, `SM-43`, `RT-153` | No movement for a draft; only `SALE_RETURN`; a posting without movements or without lines fails at commit; a line moves once |
| `SM-38`, `SM-42` | A posted return keeps its lines and record, and is never un-posted; a draft is cancelled only with a live reason and moves nothing |
| `RR-10`, `RR-11`, `RT-150`, `AP-08` | Past the window: refused, naming the closing date; posts with an approver and a reason; the last day is inside; the setting in force decides; the approver is neither the opener nor the poster, and never without a reason |
| `RR-12`, `RR-18` | A discontinued product returns; the pre-filled disposition is `Sellable` or `Quarantine`, and `Quarantine` by default |
| `PY-27`, `RT-156`, `CD-06` | A cash refund is held on its line, paid out once, and reduces expected cash |
| **`RR-03`, `RR-24`, `EC-02`, `RT-145`** | **10 concurrent refunds of the same money: exactly one completes; nine refused naming 0 left** |
| `RR-03`, `BI-10`, `PY-22` | More than a line settled is refused; a fully refunded two-line sale has nothing left on either line |
| `RR-06`, `RR-42`, `RT-161` | A disproportionate tax is refused; three partial refunds sum to exactly the 27 charged |
| `RR-24`, `SM-40`, `SM-41`, `RT-155` | A card refund in flight holds through failure and retry; cancelling (only with a reason) releases it |
| `RR-23`, `PY-25`, `RT-154` | A card refund goes to the provider, never to the drawer; the provider reference is recorded once |
| `RR-22`, `BI-09` | Another sale's tender and a declined attempt are refused; cash goes back through the drawer; the till is named whole or not at all |
| `RR-35`, `PY-26`, `RT-157` | Goodwill refunds need a live reason and move no stock |
| `BI-26`, `AP-08`, `AP-03`, `RR-43` | Approval cannot be skipped; approver is neither drafter nor submitter; who submitted or approved is fixed; lines are fixed after submission; a refund must equal its lines; lines are of its own sale |
| `PY-27`, `BI-04` | Completed without payout, the wrong payout, a payout without completion, and a second payout are each refused |
| `BI-09` | Completed and cancelled refunds are frozen |
| `RR-01`, `RR-35` | A refund for a return pays only lines the posted return took back |
| `PT-03` | No cash payout at a training till or during a count |
| `SP-66`, `SM-35a` | The drift function is empty after real activity and reports tampered counters and status without repairing them; the application cannot write either |

**Mutation check (2026-09-30).** 59 mutations, each removing or weakening one guard of this migration, were applied
one at a time. The migration still applied every time, and every one turned at least one test red. They covered:

- every conditional bound (return quantity, refund amount, refund tax);
- each disposition-to-location rule;
- the draft-only line rules;
- the window check and its last day;
- the write-once facts;
- the sale-status steps;
- each movement, posting and payout invariant;
- the return link;
- the hold's taking and release;
- tender routing;
- each `CHECK` on the two documents;
- the operation-id and payout keys;
- the composite keys that tie lines to their sale;
- the expected-cash term, the drift function, and the settings check.

The harness (`mutate-d5.mjs`, in the session scratch directory) restored the migration byte for byte after each
mutation and verified it at the end.

## 8. Decisions and open questions

- **OQ-023** (new): the `OPEN DECISION` permission keys for refund payment and cancel, and for return cancel, settle
  and close. **The owner must name them before Step 3 can pay any refund.** Also: approval skipping and its threshold;
  settling and a return's refundable amount; the window's per-category form, `EC-66`'s "rejected" against `RR-11`'s
  escalation, the last day and the settings version; refunding a service; the tax rounding.
- **OQ-015** (updated): the cash-refund sign is implemented as a subtraction, for the reasons in §4.4.
- Returns are at the selling store only: a return's sale is proven to be of the same store. Cross-store returns come
  with multi-store.
- A service brings nothing back, so its return movement is refused (`SS012`, D3). Its refund is a goodwill refund with a
  reason (OQ-023).
- `RR-25` holds structurally: a training till cannot sell (`SS025`), so there is no training sale to return, and it
  cannot pay out a refund either.

## 9. Not built in v1

Recorded in BUILD-STATUS with their rules:

- A goodwill return with no sale (`RR-09`, `RT-476`).
- Store credit and gift-card refunds (`RR-07`, `RR-26`..`RR-29`, `PY-28`, `RT-158`, `RT-162`, `RT-522`); these wait for
  customer credit.
- Exchanges (`RR-30`..`RR-34`, `RT-159`).
- Loyalty reversal (`RR-38`, `RR-41`, `RT-160`).
- Promotion recalculation and coupon decrements (`RR-39`, `RR-40`); v1 has no promotions.
- Batch attribution of returns (`RR-20`, `BE-45`, `BE-46`); this comes with batches.
- Settling and closing returns (OQ-023).
- Refund notifications (`SM-41`, `RR-23` "notified"), with the notification outbox.
- The cash-out threshold approval (`CD-15`).
- The goodwill concentration report (`RR-37`, `RT-523`).
- The customer-facing refusal text (`RT-524`, UX phase).
- Restocking fees, which are out of scope per the domain itself.

## 10. The application layer (2026-10-02)

Code: `server/src/modules/returns/returns.ts` and `refunds.ts`; tests `returns.test.ts` (19). The database does the work
(§1 to §5); the application chooses the order and says no early. Every key is one the specification names (D-16,
`state-machines.md` §22.7, `actors-and-roles.md` §2.5).

**Returns** (`/api/v1/stores/:storeId/...`)

| Act | How | Key |
|---|---|---|
| Open a draft against a sale of this store | `POST /returns { clientOperationId, saleId }`; a repeat returns the return already opened (`RR-15`) | `Return.Create` |
| Add a line | `POST /returns/:id/lines { clientOperationId, saleLineId, quantity, disposition, locationId }`. The variant comes from the sold line (`BI-16`). No default disposition (`RR-18`). The location must be the store's own (`MS-16`) | `Return.Create` |
| Remove a draft line | `DELETE /returns/:id/lines/:lineId` | `Return.Create` |
| Approve a late return | `POST /returns/:id/late-approval { reasonCodeId }`, by the approver, in their own session, while the return is a draft (`RR-11`) | `Return.Approve` |
| Post | `POST /transitions` `CustomerReturn` `post`: stamps who posted, writes one `SALE_RETURN` per line into its dispositioned location in `(variant, location)` order, in the same transaction. An empty return is refused first | `Return.Create` (the edge) |
| Cancel | `CustomerReturn` `cancel`, with `reasonCodeId` recorded in `cancel_reason_code_id` (`SM-42`) | `Return.Create` (D-16) |

**Refunds**

| Act | How | Key |
|---|---|---|
| Draft | `POST /refunds { clientOperationId, saleId, returnId?, method, paymentId?, reasonCodeId?, lines: [{ saleLineId, amount }] }`. The server derives the disbursement (§4.1), takes the till and open shift from the session for a drawer refund, and computes each line's tax as the cumulative proportion (`SS052`). The draft is bounded by what is left of each line (`SS049`) | `Sale.Refund` |
| Submit, approve | `Refund` `submit`, `approve`: stamp who did it | `Sale.Refund`, `Sale.Refund.Large.Approve` |
| Pay | `Refund` `submit to provider`: takes the hold, and for a **drawer** refund writes the `RefundFromDrawer` row and completes the refund in the same transaction (`PY-27`). The answer carries the state it is in then: `Completed` | `Refund.Pay` (D-16) |
| Cancel | `Refund` `cancel`, with a reason, from `Approved` or `Processing` (`SM-40`) | `Sale.Refund` (D-16) |
| Retry | `Refund` `retry` (`Failed → Processing`) | `Sale.Refund` (D-16) |

**What the transition endpoint gained.** A machine may name `reasonColumnFor(to)`, the column that records why a subject
entered a state; it is set in the same statement as the state, because the table's own check ties them together, and a
request with no reason is refused first with `SS055`. The answer to a transition is the state read after the use case ran.

**What a sale's detail gained** (`Sale.View`, as before): each line's id, returned quantity, settled amount and refunded
amount; the sale's status; and its captured payments. A return or refund is drafted against these.

**Refused, not built:**
- **A refund to a card.** Paying one calls the payment provider, which does not exist (card payments through the simulated
  gateway are the next piece of Phase E). `submit to provider` on a `Provider` refund answers `provider_not_available`
  and changes nothing. `retry` is the same. `fail` and `complete` are system edges no person can fire, so a refund
  cannot reach `Failed` until the gateway can.
- **Reading returns and refunds.** No catalogue key names a read of them (OQ-035), so there is no list or detail route.
  A write returns the document it made or changed, to someone who holds that write's key.
- `Posted → Settled → Closed` (keys open, OQ-023 item 2), exchange, store credit, goodwill returns, batch attribution,
  loyalty reversal and the notifications (§9).

**Open, recorded in OQ-035:** the key for reading, the keys for creating (not edges), where a late approval is given
from and its audit event, whether the person who pays must be at the refund's till, and a draft that cannot be withdrawn.

**Proved by (`returns.test.ts`):**

| Rule | Test |
|---|---|
| `RR-14`, `RR-15`, `RR-17`, `SP-66`, `SM-38` | A return is opened, filled and posted; the stock comes back; the sold line and the sale's status follow, through `Returned`; a repeat opens nothing; a posted return cannot be cancelled or changed; no drift |
| `RR-14`, `RT-148` | Over-returning is refused as built and at posting, naming the remainder |
| `RR-17`..`RR-19`, `BE-36`, `MS-16` | No default disposition; each disposition only to its kind of location; the movement names it; only the store's own locations |
| `RR-08`, `RR-13`, `BI-16`, `MS-04` | Another store's sale, line or return does not exist to the caller |
| `RR-16`, `SM-04` | A repeated line is added once; a draft line is removed only through its own return |
| `SM-42`, `BI-40`, `D-16` | A cancel needs a live reason and moves nothing; an empty return cannot post |
| `AC-01`, `D-16` | Each act needs its own key and no neighbour's; no session is `401` |
| `RR-10`, `RR-11`, `AP-08` | Past the window: refused naming the day; posts with `Return.Approve` and a reason; the approver is neither opener nor poster; a window's last day is inside |
| `RR-22`, `RR-24`, `PY-27`, `RT-156`, `RR-06` | A refund is drafted, submitted, approved by another and paid from the drawer; the line holds it; the tax adds to exactly what was charged (114 then 113 of 227) |
| `RR-03`, `RR-24`, `PY-22`, `EC-02` | More than is left is refused as drafted and at the hold; two drafts of the same money cannot both be paid |
| `RR-22`, `PY-25`, `BI-09` | Cash names no tender; a tender names a captured payment of this sale; a drawer refund needs a till and an open shift |
| `RR-35`, `PY-26` | A refund with no return needs a reason; a repeat drafts nothing new; a line appears once and is of the sale |
| `RR-01`, `SS051` | A refund for a return pays only the lines the posted return took back |
| `BI-26`, `AP-08`, `AP-03`, `D-16` | The approver is not the submitter; paying is `Refund.Pay`; creating and cancelling are `Sale.Refund`; lines fixed after submission |
| `PY-27`, `PT-03`, `SS025` | A drawer refund is refused whole at a till out of service |
| `RR-23`, `PY-25` | A card refund is refused whole, holding nothing |

## 11. Card refunds, through the simulated gateway (2026-10-02)

Code: `refunds.ts` (`payByProvider`), `payments/`; tests `payments/card.test.ts`. The gateway and its marking are D4 §15. A refund
whose disbursement is `Provider` (§4.1: an original-tender refund of a captured card payment) is now payable.

| Act | Route | Key |
|---|---|---|
| Pay | `POST /stores/:storeId/refunds/:id/pay` | `Refund.Pay` (D-16) |
| Retry a failed one | `POST /stores/:storeId/refunds/:id/retry` | `Sale.Refund` (D-16) |
| Draft, submit, approve, cancel | as §10: the draft route, and the transition endpoint | as §10 |

A card refund is drafted without a till (§4.1: no drawer), so a back-office session may draft it. It is paid by its own routes
and the transition endpoint refuses it (`use_pay_route`), because the provider is never asked inside a transaction (`PY-36`).
Three steps, each committed: (1) `Approved → Processing` (or `Failed → Processing` on a retry), where the owner's trigger
takes the hold, which stays through failure and retry (`RR-24`, `SM-40`, `SM-41`); (2) the provider is asked to refund the
captured payment under the refund's id as the merchant reference, so asking again is never a second refund; (3) the answer
is recorded.

| The provider says | The refund becomes |
|---|---|
| `Approved` | `Completed`, with the provider's reference (`SIM-RF-…`); the line keeps its hold |
| `Declined`, `Failed`, `Errored` (a first answer) | `Failed`: held, retryable, answered `refund_failed` |
| `Timeout`, or does not know a refund it was already asked about | stays `Processing`, answered `refund_pending`; paying again asks the provider what it holds and does not refund twice (`PY-11`, `PY-41`) |

Paying a refund that is `Processing` resumes it; one that is `Completed` returns unchanged and asks the provider nothing
(`SM-04`). A pending refund may be cancelled with a reason, which releases the hold (§4.3).

**A gap this exposed (OQ-036 item 1):** the contract has `Approved|Processing → Cancelled` and `Failed → Processing`, and no cancel
from `Failed`. A refund the provider keeps declining therefore keeps its hold until a retry succeeds; nothing may release it.
Not built around: an edge is the owner's to add.

Not built: the failure **notification** (`SM-41`, `RR-23`), with the notification outbox; the refund **cap per tender**
(OQ-023 item 6); the reconciliation job (`PY-40`).

## 12. Owner decision D-17 (2026-10-02)

Migration `20261002120000_d17_return_refund_view_and_withdraw.sql`; code `returns.ts`, `refunds.ts`; tests in `returns.test.ts`.

- **A draft refund may be withdrawn** (item 5). `Draft → Cancelled` on `cancel`, under `Sale.Refund` (D-16 Q9), with a live reason
  (`SM-42`, `BI-40`), audited as `Refund.StateChange`, through the transition endpoint like the other cancels. A draft holds
  nothing (§4.3: the hold is taken at `Processing`), so nothing is released, and its lines stay as drafted (`AP-03`). It is final:
  a withdrawn refund cannot be submitted. Not offered from `PendingApproval`. A withdrawn draft was never submitted, so
  `ck_refund_submitted_when` gains its one exception, a cancelled refund that was never approved (`SM-03`). The key and reason
  are this design's reading of D-16 Q9, raised for the owner's veto (OWNER-DECISIONS D-17).
- **The payer is at the refund's till** (item 4, `PY-27`). A drawer refund is drafted at a till and goes out of that till's
  drawer and shift (§4.4), so the person who pays it, `submit to provider`, must be signed in at that till. Anyone else, and a
  back-office session, is refused `not_at_refund_till`, whole: nothing is held and nothing is paid. A card refund has no till and
  is not affected. It is an application rule, in the refund machine's before-hook, because the session's till is known only to
  the application.
- **Returns and refunds are read** (items 7 and 8). `GET /stores/:storeId/returns` and `…/returns/:id` under `Return.View`;
  `GET /stores/:storeId/refunds` and `…/refunds/:id` under `Refund.View`. Newest first, a page at a time by document number
  (`limit`, `after`, answering `{ items, next }`), filtered by `status` or `saleId`. A list row carries the document and its
  sale's number; one document carries its lines. Another store's document does not exist to the caller (`MS-04`). Neither key is
  implied by a write key: `Return.Create` does not read, and `Sale.Refund` does not read.

| Rule | Test (`returns.test.ts`) |
|---|---|
| D-17 item 4, `PY-27` | A drawer refund is paid at its till, and refused whole at another till and at the back office |
| D-17 item 5, `SM-42`, `BI-40` | A draft is withdrawn with a reason under `Sale.Refund`; no key is refused; withdrawn is final; one past `Draft` is not withdrawable |
| D-17 items 7 and 8, `MS-02` | Each read is its own key, in the store, paged and filtered; no write key stands in; another store's document is `404`; no session is `401` |
| D-17 | The catalogue is 124; the Owner holds both keys; the edge contract and the audit table name the new edge |

## 13. Owner decision D-18: a refund of a payment that never became a sale (2026-10-02)

Migration `20261002130000_d18_refund_of_a_payment.sql`; code `refunds.ts`, `payments/attention.ts`, `payments/card-payment.ts`; tests in
`payments/card.test.ts`. `OQ-036` item 2, part B, the owner's option 1. The keys are the refund's own, unchanged: draft and submit
`Sale.Refund`, approve `Sale.Refund.Large.Approve`, pay `Refund.Pay`.

**Why.** A card is charged, the sale cannot be saved, and the till never sends it again: money taken for nothing (`PY-37`). A
captured payment's only way out is a linked refund (`PY-12`), and a refund needed a sale (`RR-01`). So a refund may now name a
captured card payment **instead of a sale**. Everything else about a refund is as it was: the machine of §22.7, the second-person
approval (`BI-26`), the hold (`RR-24`), the provider round trip outside the transaction (`PY-36`), the failure, retry and
cancel (§11), the withdrawal of a draft (§12), the audit, and the reads.

| | A refund of a sale | A refund of a payment (D-18) |
|---|---|---|
| Names | A sale, its lines, optionally a return | A captured card payment of the same store and currency, an amount |
| Lines, tax | Allocated to sold lines, each with its proportional tax (`RR-06`) | None: no sale charged any tax, so the tax is 0 |
| Reason | When it has no return (`RR-35`) | Always (it is goodwill in the sense of `RR-35`) |
| Paid | The drawer or the provider, by the tender | The provider, to the card |
| Bounded by | Each line's settled amount, held on the line (`SS049`) | What the payment took less what is held back to it, held on **`payment.refunded_amount`** (`SS058`) |
| The hold | One conditional `UPDATE` on each line, when it enters `Processing` | One conditional `UPDATE` on the payment, at the same moment |

**The counter.** `payment.refunded_amount` is written only by the owner's hold trigger, never more than the payment took
(`ck_payment_refunded`), and only a captured payment gives anything back. The payment stays frozen in every other column (`PY-12`,
`SS035`): `payment_before_write()` lets the hold move that one counter. Entering `Processing` raises it with one conditional increment,
atomic with no read-then-write race, so five refunds of 1,000 against a payment of 3,000 paid at once make exactly three (tested). `Failed`
and `Completed` keep the hold, and only a cancellation releases it (`SM-40`, `SM-41`). `payment_refund_drift()` rebuilds the counter
from the refunds and never repairs, as `sale_counter_drift()` does for the lines.

**The two ways to be paid back cannot both happen (`SS059`).** A payment with a sale is refunded through the sale, never without it. A
payment that is being refunded without one, **even as a draft**, cannot become a sale: `assert_sale_complete()` refuses it. Otherwise
the customer would be given the money back and the goods too (`PY-37`). A withdrawn draft (§12) is no obstacle, and the same sale can
then complete on the money that was taken. A sale made from the payment before any refund is drafted simply ends the matter: it has a sale.

**In the application.** `POST /stores/:storeId/refunds` with no `saleId` takes `{ clientOperationId, method: 'OriginalTender',
paymentId, amount, reasonCodeId }` and nothing else (a return, lines or any other field is refused). It is bounded as drafted by what is
left (`SS058` names it), and the atomic bound is the hold. Paying it, at `POST …/refunds/:id/pay`, **gives its cart up** (the checkout
is abandoned), because the money is going back; the same sale then answers `card_refunded`. The report (D4 §16) keeps a payment until
it has all been given back, and shows what is held and what has been given back.

**Read, not written, by the owner (raised for veto):** only a **card** payment is refunded this way (a cash payment exists only with
its sale); the refund may be **partial**, in parts, up to what the payment took (`PY-24`); a reason is required; and a refund, even a
draft, blocks the sale. Each follows from option 1 and from `PY-37`; none adds a key.

**Not built:** a refund cap per tender for refunds *of sold lines* (`OQ-023` item 6); the failure notification (`SM-41`).

| Code | Meaning | Raised by |
|---|---|---|
| `SS058` | A refund of a payment asks for more than the payment has left to give back; `DETAIL` is the remainder | `apply_refund_hold()` |
| `SS059` | A payment with a sale is refunded through the sale; a payment being refunded cannot make one; only a card payment is taken back without its sale | `refund_before_write()`, `apply_refund_hold()`, `assert_sale_complete()` |

## 14. Owner decision D-19: a failed refund is cancelled (2026-10-02)

Migration `20261002141000_d19_cancel_a_failed_refund.sql`; tests in `payments/card.test.ts`. Supersedes §11's "A gap this exposed" and `OQ-038`.

- **The edge.** `Failed → Cancelled`, on the refund's `cancel` event, under `Sale.Refund` (D-16 Q9), with a live reason (`SM-42`, `BI-40`), audited as `Refund.StateChange`, through the transition endpoint like the other cancels. The same pattern as the withdrawal of a draft (§12). A refund can now be cancelled from `Draft` (withdrawn), `Approved`, `Processing` and `Failed`, and not from `PendingApproval`.
- **The hold is released.** It is taken entering `Processing` and kept through `Failed` (`RR-24`, `SM-41`). A cancellation from `Processing` or from `Failed` releases it: on each sold line, or, for a refund with no sale, on the payment (§13). So a refund the provider keeps declining no longer holds its money for ever, and the same money can be refunded again. `sale_counter_drift()` and `payment_refund_drift()` count a held refund as `Processing`, `Failed` or `Completed` only, so they agree.
- **Final.** A cancelled refund is not retried (`SS035`). Retry remains the other way out of `Failed`.

| Rule | Test (`card.test.ts`) |
|---|---|
| D-19, `SM-42`, `BI-40`, `RR-24` | A failed card refund of a sale is held through the failure; cancelling needs a reason and `Sale.Refund`; the line is free and the drift check empty; it cannot be retried; the money can be refunded again |
| D-19, D-18, `PY-22` | A failed refund of a payment with no sale holds the payment; cancelling releases it, the report shows it as unsettled with nothing held, and the whole payment can be asked for again |
| D-19 | The edge contract and the audit table name `Failed → Cancelled` |
