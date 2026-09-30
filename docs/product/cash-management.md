# SmartStore — Cash Management Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `Shift` (the cash shift), `CashTransaction`, opening float, cash in/out, counting, and variance. The
drawer itself is in [organization-model.md](organization-model.md) §7; the rostered employee shift is in
[employee-domain.md](employee-domain.md) §5 and is a **different entity** (EM-17).

---

## 1. Two different shifts, and the naming must make that obvious

| | Rostered shift | **Cash shift (this document)** |
|---|---|---|
| Entity | `Shift` in employee-domain | `Shift` in this document |
| What it schedules | A person's working hours | A till's money |
| Has a drawer | No | **Yes** |
| Has a float | No | **Yes** |
| Can be short | Yes, and it's a staffing matter | **Yes, and it's a money matter** |
| Who opens it | Nobody — it's published | The cashier, at the till |
| Reconciles to | A roster | A bag of cash |

**Rule CD-02.** The two are separate entities and the UI calls them **"Rostered shift"** and **"Till shift"**
(EM-17). Conflating them means a staffing absence opens a drawer.

---

## 2. The cash shift

`Shift` **stores** only: drawer, store, terminal, opening employee, opening timestamp, closing employee, closing
timestamp, and status. Everything else on a shift is **derived**, not entered — the opening float, the
counted total, the expected close, the variance, and the variance status are computed from the shift's
`CashTransaction` rows (CD-11, CD-19, CD-22, CD-27). They are shown on the shift screen; they are not fields on
the shift.

| Status | Meaning |
|---|---|
| `Open` | Counting, trading, money present |
| `Reconciling` | Count in progress, drawer opened for counting |
| `Closed` | Counted, balanced or variance accepted |
| `Reopened` | A closed shift reopened for investigation, with a reason |

**Rule CD-03 — at most one open shift per drawer, and at most one open shift per employee per store** (BI-39,
CD-01). Enforced by a **uniqueness constraint, not a check-then-act.** Two cashiers opening the same drawer
simultaneously is a real event in a busy store, and it must fail deterministically rather than produce two
reconciliations.

**Rule CD-04 — a shift is a money container, and the money is the truth.** The system knows what it *expects*
(what the sales say should be in the drawer). It does not know what *is* in the drawer. Every rule below follows
from that gap being real and unavoidable.

**Rule CD-05 — a terminal without a drawer has no cash shift**, and cash transactions are recorded against the
terminal with a drawer attribution note. Card-only terminals are normal; the model does not require a physical
drawer (organization-model §7).

---

## 3. Expected drawer contents

> **The expected amount is derived, never stored as a running total.**

**Rule CD-06.** At any moment, the expected drawer contents are:

```
Opening float
  + Σ cash payment amounts applied to sales in this shift
  + Σ cash refunds paid from this drawer
  + Σ cash received (Cash.In)
  − Σ cash paid out (Cash.Out)
  − Σ cash removed to safe (Cash.Safe)
  + Σ cash returned from safe (Cash.FromSafe)
  − cash carried in to the next shift (ClosingFloat for the successor)
```

**Rule CD-07.** A sale's cash payment amount is the amount **applied** to the sale, and change is a **disbursement
from the drawer** (SP-39). A £20 note for a £13 sale means £13 was applied, so the drawer received £13 and
disbursed £7. Storing the note value and reconciling the difference is how cash variance reports become
unreconcilable.

**Rule CD-08.** The expected amount is a projection over documents, on the same principle as stock (BI-02) and
receivables (CU-11). A running `DrawerBalance` field would be a third mutable number disagreeing with two
sources. Where one is cached for speed, it is a cache that can be discarded and rebuilt, and the rebuild must
reproduce it (IV-09's rule applied to cash).

**Rule CD-09 — a payment method is only part of the expected amount if it is cash.** Card, store credit, and gift
tenders do not appear in the drawer. Store credit reduces a liability (RR-26), not the cash in the drawer, and
conflating them is how a shop's cash count and its money total diverge.

---

## 4. Opening

**Rule CD-10.** Opening a shift requires `Shift.Open` and records: opening employee, the opening float, and a
counted opening denomination breakdown.

**Rule CD-11 — the opening float is a `Cash.In` transaction of type `OpeningFloat`**, not a field set on the
shift. It is a movement with a cause (BI-03), and it appears in the day's cash-in report alongside every other
money-in. A float set as a field is money that came from nowhere.

**Rule CD-12 — the opening count is verified against the drawer denomination list** where one is configured, and
a mismatch is recorded. Most shops are loose about the float; the system records what was counted so the variance
analysis can separate "the float was wrong" from "the day was short".

**Rule CD-13 — the opening float is an amount the shift is responsible for.** Closing short by the float is
shortage, not rounding. There is no "it was already short when I opened" argument, because the float was counted
at open and recorded.

**Rule CD-14 — a shift may be opened with a zero float**, which is legitimate (a new till, a mid-day start) and
is recorded as such.

---

## 5. Cash in and out

`CashTransaction` holds: shift, drawer, store, type, amount, reason code, free text, actor, timestamp, and —
where applicable — the document it relates to.

| Type | Direction | Requires | Notes |
|---|---|---|---|
| `OpeningFloat` | In | `Shift.Open` | CD-11 |
| `PayIn` | In | `Cash.In` | Reason. Threshold-gated |
| `PayOut` | Out | `Cash.Out` | Reason. Threshold-gated. Approval beyond it (BI-26) |
| `SafeDrop` | Out | `Cash.Out` | Reason. Removed to the safe |
| `SafeRetrieve` | In | `Cash.In` | Reason. Retrieved from the safe |
| `RefundFromDrawer` | Out | `Sale.Refund` + reason if threshold | Linked to a `Refund` (RR-04) |
| `ChangeDisbursed` | Out | None | **Automatic**, from the sale (CD-07) |
| `ClosingFloat` | Out | `Shift.Close` | The float handed to the next shift |
| `Replenishment` | In | `Cash.In` | Manager tops up a busy till mid-shift |
| `Adjustment` | Either | `Cash.Out` + reason | **Always** reported |

**Rule CD-15 — a cash movement beyond a threshold requires approval by a different employee** (BI-26,
`Cash.Out.Approve`). The threshold is per store and configurable (approval-workflows §3).

**Rule CD-16 — `PayOut` and `Adjustment` always require a reason code** (BI-25). Every other type has an
intrinsic reason; these two are the ones that need justifying.

**Rule CD-17 — a cash adjustment is reported by actor, amount, reason, and shift, with concentration analysis**
(IV-36 shape). A drawer adjustment is a direct cash-out capability, and it is the second most-abused operation in
retail after stock adjustment.

**Rule CD-18 — change is recorded as a disbursement, not left implicit.** A drawer that receives £100 and gives
£87 in change has a £13 receipt, and the £87 is visible in the cash-out report. A shift where change is not
recorded cannot have its expected count computed from the sales at all.

**Rule CD-19 — a cash movement is a document row, never a field update.** A drawer balance is a projection
(CD-08), and a cash movement is the ledger row behind it — the same shape as `InventoryMovement` (BI-02).

---

## 6. Counting and closing

**Rule CD-20.** Closing requires `Shift.Close` and: a drawer count, the counted denomination breakdown, and a
declaration of the closing float for the next shift.

**Rule CD-21 — the count is a blind count.** The counter is not shown the expected amount until after the count
is submitted (IV-31's principle, applied to cash). A counter who is shown the expected figure confirms it rather
than counting, and the point of counting is to detect the difference.

**Rule CD-22 — variance is derived, never entered.**

```
Variance = Counted − Expected
```

**Rule CD-23 — variance within tolerance closes automatically and is recorded.** Variance beyond tolerance
requires `Cash.Variance.Acknowledge`, a reason code, and — beyond a higher threshold — a different approver
(BI-26). Acknowledging a variance is an act of accountability, not a form field.

**Rule CD-24 — variance is never adjusted away.** The counted amount is what was in the drawer. A variance is
recorded as a variance and, where it is a loss, as a reasoned `Adjustment` (CD-17). A system that lets a manager
"fix" a variance into balance has destroyed the one number that would have shown the loss.

**Rule CD-25 — a non-zero variance blocks the close until it is acknowledged.** While the shift is
`Reconciling`, it cannot reach `Closed` on an unacknowledged variance (CD-23). `Reopen` is **not** an
alternative path to closing — it is a separate, later, reasoned action that revisits a shift that is
*already* closed (CD-26). The two answer different questions: acknowledgement says "I accept this
difference"; reopening says "let me look again".

**Rule CD-26 — a reopened shift is exceptional and visible.** Reopening changes a closed money record, so it
requires a reason, is audited, is reported, and is included in the "shifts reopened" standing report. **There is
no legitimate weekly occurrence of reopening a shift**, and a store that does it routinely has a process problem
the report should surface.

---

## 7. Denominations

**Rule CD-27.** A drawer may declare a denomination breakdown for its currency. Counts are entered per
denomination where a breakdown is configured, and the total is derived from the denominations — never entered
alongside them, because two numbers for one quantity is a place for them to disagree.

**Rule CD-28 — a denomination breakdown is per currency** (overview §3.1). A zero-decimal currency and a
three-decimal currency are both representable, and a store trading in a currency with coins it does not
physically stock declares a breakdown with zero counts for them.

**Rule CD-29 — a cash difference against a denomination is a coin-mix problem, not a theft.** Coins and small
notes routinely differ from expectation. Where a store configures it, a small per-denomination tolerance exists
so the day-close is not blocked by loose change. **Recorded as configurable, default zero**, because a default
tolerance hides real differences and the decision to allow one is a store's.

---

## 8. What the manager sees

**Rule CD-30 — the shift screen answers four questions, and only these four:**

1. How much should be here? (Expected)
2. How much is here? (Counted)
3. What is the difference? (Variance, with the threshold)
4. Why? (Reason, approver, and what happens now)

**Rule CD-31 — the expected amount is always visible while counting, after submission.** Showing it before makes
the count a confirmation exercise (CD-21). Showing it after makes the variance explicable, which is the point of
recording it at all.

**Rule CD-32 — cash reports separate money by method.** Cash in, cash out, cash expected, cash counted, and
variance — never a single "cash" total. A store that takes a lot of card cash looks cash-rich in a blended
figure and cannot find the shortage.

---

## 9. What this domain deliberately does not do

**Rule CD-33 — no cash office, no banking, no reconciliation to a bank statement** in v1 (overview §6). SmartStore
records what happened in the drawer; where the money went afterwards is the accountant's and the bank's business.
A bank reconciliation feature is a different product with a different regulatory posture.

**Rule CD-34 — no multi-drawer shift in v1** (organization-model §1, 1:0..1). The model allows many drawers per
terminal; v1 uses one.

**Rule CD-35 — no float recommendation or automated float calculation.** The float is an amount the store
decides. **What the system does is show the busiest days' expected cash**, so the decision is informed. That is a
report, not a recommendation engine.

**Rule CD-36 — no multi-currency drawer in v1.** A drawer is single-currency; a second currency is a second
drawer or a different terminal. Multi-currency conversion is out of scope (overview §3.1, §6).

**Rule CD-37 — no cash drawer as a cash office safe-management feature.** The safe is a physical place; SmartStore
records the drops and retrievals (CD-15's table) and does not manage the safe's contents, its access list, or its
own reconciliation.

---

## 10. Cash rules index

| ID | Rule |
|---|---|
| CD-02 | A rostered shift and a till shift are separate entities with different names in the UI |
| CD-03 | One open shift per drawer and per employee per store, by uniqueness constraint |
| CD-04 | The system knows what should be in the drawer, not what is |
| CD-05 | A terminal without a drawer has no cash shift |
| CD-06 | Expected contents are derived from documents |
| CD-07 | A payment records the amount applied; change is a disbursement |
| CD-08 | The expected amount is a projection, never a stored running total |
| CD-09 | Only cash methods appear in the drawer; credit and card do not |
| CD-10 | Opening requires `Shift.Open` and records a counted opening breakdown |
| CD-11 | The opening float is a `CashTransaction`, not a field |
| CD-12 | The opening count is verified against the denomination list and mismatches recorded |
| CD-13 | The opening float is the shift's responsibility; there is no "it was already short" |
| CD-14 | A zero opening float is legitimate and is recorded |
| CD-15 | Cash out beyond a threshold needs a different approver |
| CD-16 | `PayOut` and `Adjustment` always need a reason code |
| CD-17 | Cash adjustments are reported by actor, amount, reason, shift, with concentration analysis |
| CD-18 | Change is recorded as a disbursement, not left implicit |
| CD-19 | A cash movement is a ledger row, never a field update |
| CD-20 | Closing requires `Shift.Close`, a count, a breakdown, and a declared closing float |
| CD-21 | The count is blind; expected is revealed only after submission |
| CD-22 | Variance is derived from counted minus expected, never entered |
| CD-23 | Variance within tolerance auto-closes; beyond it needs acknowledgement, a reason, and possibly a different approver |
| CD-24 | Variance is never adjusted away; a loss is a reasoned adjustment |
| CD-25 | A non-zero variance needs an acknowledgement or a reasoned, audited reopen |
| CD-26 | A reopened shift is exceptional, audited, and standing-reported |
| CD-27 | Counts are per denomination; the total is derived, never entered alongside |
| CD-28 | A breakdown is per currency |
| CD-29 | A per-denomination tolerance is configurable, default zero |
| CD-30 | The shift screen answers exactly four questions |
| CD-31 | Expected is shown after submission, never before |
| CD-32 | Cash reports separate by method, never a blended "cash" total |
| CD-33 | No cash office, banking, or bank reconciliation in v1 |
| CD-34 | No multi-drawer shift in v1 |
| CD-35 | No float recommendation; the expected cash report informs the decision |
| CD-36 | A drawer is single-currency |
| CD-37 | No safe-management feature beyond recording drops and retrievals |
| — | CD-01 is the drawer's one-open-shift rule and is defined in organization-model §7 |
