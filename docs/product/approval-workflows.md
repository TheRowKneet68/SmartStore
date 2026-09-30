# SmartStore — Approval Workflows Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `ApprovalRequest`, the request/approve/reject path, the SoD self-approval block, and the delegated
approval model. The invariant is BI-26; segregation of duties is SEP-01..SEP-12 in
[actors-and-roles.md](actors-and-roles.md) §5.

---

## 1. One mechanism, several subjects

> **Every approval in SmartStore is the same mechanism with a different subject: an amount exceeds a threshold, a
> reason is recorded, and a different person decides.**

The subjects that need approval in v1:

| Subject | Threshold | Referenced by |
|---|---|---|
| `CashOut` | Per store, per currency | CD-15 |
| `CashVariance` | Per store, with a higher second tier | CD-23 |
| `LargeRefund` | Per store, per currency | BI-10, RR-35 |
| `PriceChange` | Percentage or margin floor | PR-18 |
| `StockAdjustment` | Quantity or value | IV-53 |
| `StockWriteOff` | Any, or by value | BE-36 |
| `PurchaseOrder` | Above the buyer's limit | PR-Q02 |
| `CreditLimitOverride` | Per customer, over the limit | CU-15 |
| `LoyaltyAdjust` | Per adjustment | CU-24 |
| `UserAccessGrant` | Any grant, any scope | EM-14, RF-22 |
| `RetentionPolicyChange` | Any change | AU-22 |
| `PaymentProviderConfig` | Any change | PY-06 |
| `RefundWithoutReturn` | Any | RR-35, PY-26 |

**Rule AP-01.** The approval mechanism is generic: a request references a subject, a payload, a threshold result,
and a policy. It does not branch per subject. **Thirteen bespoke approval workflows is thirteen places to get
SoD, escalation, and audit wrong**, and the one mechanism is auditable in one place.

**Rule AP-02.** The subject owns its threshold and its rule; the approval domain owns the decision. A
`CashOut` over £200 needs approval because the cash domain says so, and the cash domain's rule is not duplicated
in the approval domain.

---

## 2. The request

`ApprovalRequest` holds: organization, store, subject type, subject id, the payload (the proposed change, in
full), the amount and currency where relevant, the requester, the request time, the policy that applied, the
state, the decider, the decision time, the decision reason, and the delegates consulted.

| State | Meaning |
|---|---|
| `Pending` | Awaiting a decision |
| `Approved` | Decided yes |
| `Rejected` | Decided no |
| `Cancelled` | The requester withdrew it, or the subject became moot |
| `Expired` | Past its deadline with no decision |

**Rule AP-03.** A request is **immutable once submitted.** The payload is a snapshot of the proposed change.
Approving a request whose payload has since changed is approving something nobody read, and the payload cannot
change because nothing can.

**Rule AP-04 — the request references the subject, and the subject is suspended or flagged while the request is
pending**, where the domain defines it. A pending cash-out of £5,000 is not available to spend while it waits.
Where a subject cannot be suspended (a void of a completed sale), the request records that it is advisory and
the UI says so.

**Rule AP-05 — the request carries the reason from the start.** An approval without a stated reason is an
approval of an unexplained action, and the reason is the part anyone reads later.

**Rule AP-06.** A request is submitted in the same transaction as the action that triggered it, or immediately
after (BI-04, NT-06's reasoning: the action and its request are one decision, not two).

---

## 3. Deciding

**Rule AP-07 — deciding requires a permission** and is a separate action from requesting (AP-29). The requester
may not decide.

**Rule AP-08 — self-approval is blocked at the data layer**, not by the UI. The decider must not be the requester
(BI-26, SEP-01). A UI-only check is bypassed by the API, and the API is a supported client.

**Rule AP-09 — a role conflict blocks the decision.** A decider holding both sides of a segregation-of-duties
conflict cannot decide, even if not personally the requester. `CashOut.Approve` plus `CashOut.Create` is a
conflict, and the holder deciding their own store's large payouts is the exact case the conflict exists to stop
(SEP-01).

**Rule AP-10 — a decision is reason-bearing, and a rejection always needs a reason.** An approval may proceed
with the requester's reason; a rejection needs the decider's own, because the requester has to act on it.

**Rule AP-11 — a decision is recorded as an audit event** (`Approval.Decided`, AU-12) with the before and after
state of the request, the decider, and the reason. Approvals are the most-asked-about events in any retail
investigation.

**Rule AP-12 — a decision is idempotent by request id.** Two taps decide once.

**Rule AP-13 — a decided request cannot be re-decided.** A second decision is refused, not applied. If the
approved action turns out to be wrong, the correction is a compensating action (BI-24), which is also approved.

---

## 4. Who decides

**Rule AP-14 — the decider is resolved by role and store**, never by name (NT-24's rule, applied here). "The
approver" is a role with a threshold; the person holding it changes without breaking the workflow.

**Rule AP-15 — the approver pool is a role assignment**, and a person with no matching role in the store cannot
decide (MS-06, AP-07). An approver in Store B cannot approve a Store A request.

**Rule AP-16 — the highest eligible approver decides.** A request above a manager's limit goes up, not around.
**A workflow that lets you pick a lower approver for a higher amount is not an approval workflow**, it is a
suggestion box.

**Rule AP-17 — delegation is explicit, time-bounded, and audited.** A manager on leave delegates their approval
authority to a named person, for a date range, with the requests they delegated recorded. Delegation without
dates is a permanent privilege transfer discovered at the worst moment.

**Rule AP-18 — a delegate's decision is recorded as the delegate's, with the original approver.** Both are on the
request. The person who answered is accountable for the answer; the person who was away is accountable for the
delegation.

**Rule AP-19 — self-delegation to decide one's own request is blocked**, by the same data-layer check as AP-08.
Delegating to yourself and then approving is self-approval with extra steps.

**Rule AP-20 — a delegation cannot be a delegation of the requester's own authority.** Where the requester holds
an approval role and delegates it, the delegation does not reach their own request (AP-19's rule).

---

## 5. Deadlines and expiry

**Rule AP-21.** Every policy carries a decision SLA, default 24 hours, configurable per subject per store.

**Rule AP-22 — a request past its SLA escalates** (AP-11, NT-23): to the next approver up, then to a manager, and
then it appears on the approvals report (RP-18). An approval nobody decides is an operation that stopped, and the
store needs to know which.

**Rule AP-23 — an expired request is `Expired`, not `Rejected`.** The difference matters: nothing was denied,
nothing happened, and the requester must resubmit. Conflating them produces a report full of "denials" that were
timeouts.

**Rule AP-24 — expiry does not perform the action.** An expired cash-out is not a cash-out. A system that pays
out on timeout has turned an approval into a suggestion.

**Rule AP-25 — a request whose subject no longer exists is `Cancelled`,** with a reason naming the subject. A
pending refund approval for a voided sale is moot, and leaving it pending forever pollutes the queue.

---

## 6. The queue

**Rule AP-26.** The approvals screen is a work queue: what is waiting, for which store, by which amount, how long
it has waited, and what it is for. The amount and the wait are what make a queue triageable, and a queue without
them is a list.

**Rule AP-27 — the queue is store-scoped and sorted by urgency**, which is age against SLA, then amount. **Not by
arrival time**: a FIFO queue on approvals means a large request waits behind a stream of small ones, which is how
a multi-thousand payout sits for a day.

**Rule AP-28 — the requester sees their own requests and their state**, including who is deciding. The requester
is not blind; they can see it is pending, and that is what stops the "nobody looked at it" escalation.

**Rule AP-29 — approving is a distinct permission from requesting, always.** Even for a single-operator store,
`CashOut.Approve` is a separate key. A store with one employee who holds both has a control they can switch off
when they grow, and a workflow configured from day one.

**Rule AP-30 — the approval report is a projection of the requests** (RP-02): decided, pending, rejected,
expired, by subject, by decider, by store, with the mean wait.

---

## 7. Failures

**Rule AP-31 — an approval service failure does not fail the underlying action's completion.** A cash-out
recorded without its approval having been *notified* is a business fact that exists; the notification retries
(NT-05). The reverse is unacceptable: a completed sale must not be lost because a notification failed.

**Rule AP-32 — where a subject cannot proceed without approval, the subject is refused**, with a message naming
the pending request. The cashier is told "this needs approval", not given a dead end.

**Rule AP-33 — a request submission is idempotent by `ClientOperationId`** (BI-28, PY-39). A retried submission
does not create a second request, and therefore does not create a second decision to make.

**Rule AP-34 — a request survives a restart.** It is a record, not a session. An approval that disappears on
reboot is an approval that will be paid twice, because the operator will resubmit it.

---

## 8. Deliberately out of scope

**Rule AP-35 — no multi-step or sequential approval chains in v1** (overview §6). One decider, with escalation.
A two-step chain is a workflow engine, and thirteen subjects would each need one designed.

**Rule AP-36 — no parallel or quorum approval in v1.** "Any two of three approvers" is a different mechanism.

**Rule AP-37 — no conditional approval rules in v1.** An approval is requested or it is not, based on a
threshold. "If it is over £500 and the customer is over 60 and it is a refund then it needs two approvals" is a
rule engine, and it is a Phase 3 feature.

**Rule AP-38 — no cross-store approval in v1** (MS-32, AP-15). The approver is in the store. A chain's central
approval is a chain feature.

**Rule AP-39 — no approval by email, link, or voice in v1.** An approval is an authenticated action in the
system by a person with the permission. An approval link in an email is a bearer token, and a bearer token for
spending money is not something to ship in v1.

**Rule AP-40 — no self-approval override, ever, at any privilege.** There is no break-glass here. The Owner
cannot approve their own request (AP-08, AP-13). **This is the one control in the document with no override,
and that is deliberate**: a break-glass on self-approval is indistinguishable from the thing it is meant to
enable, and it is the control most likely to be used, because it is the only inconvenient one.

---

## 9. Approval rules index

| ID | Rule |
|---|---|
| AP-01 | One generic mechanism; no per-subject workflow variants |
| AP-02 | The subject owns its threshold; the approval domain owns the decision |
| AP-03 | A request is immutable once submitted |
| AP-04 | A pending request suspends or flags its subject where the domain defines it |
| AP-05 | The request carries a reason from submission |
| AP-06 | The request and the triggering action are one decision |
| AP-07 | Deciding requires a permission, separate from requesting |
| AP-08 | Self-approval is blocked at the data layer |
| AP-09 | A segregation-of-duties conflict blocks the decision |
| AP-10 | A rejection always needs the decider's reason |
| AP-11 | A decision is an audit event with the request's before and after |
| AP-12 | A decision is idempotent by request id |
| AP-13 | A decided request cannot be re-decided; corrections are compensating and approved |
| AP-14 | The decider is resolved by role and store, never by name |
| AP-15 | Only a role holder in the store can decide |
| AP-16 | The highest eligible approver decides; a lower one may not |
| AP-17 | Delegation is explicit, dated, and audited |
| AP-18 | A delegate's decision records both the delegate and the original approver |
| AP-19 | Self-delegation to decide one's own request is blocked |
| AP-20 | A delegation does not reach the requester's own requests |
| AP-21 | Every policy has a decision SLA, default 24 hours |
| AP-22 | A past-SLA request escalates, then appears on the report |
| AP-23 | An expired request is `Expired`, not `Rejected` |
| AP-24 | Expiry never performs the action |
| AP-25 | A request whose subject is gone is `Cancelled` with a reason |
| AP-26 | The queue shows subject, store, amount, and wait |
| AP-27 | The queue is store-scoped, sorted by urgency then amount |
| AP-28 | The requester sees their own requests and their state |
| AP-29 | Approving is always a distinct permission from requesting |
| AP-30 | The approval report is a projection of the requests |
| AP-31 | Approval-notification failure never un-does a completed action |
| AP-32 | Where approval is required, the subject is refused with a message naming the request |
| AP-33 | Request submission is idempotent by `ClientOperationId` |
| AP-34 | A request survives a restart |
| AP-35 | No multi-step approval chains in v1 |
| AP-36 | No parallel or quorum approval in v1 |
| AP-37 | No conditional approval rules in v1 |
| AP-38 | No cross-store approval in v1 |
| AP-39 | No approval by email, link, or voice in v1 |
| AP-40 | No self-approval override, at any privilege, ever |
