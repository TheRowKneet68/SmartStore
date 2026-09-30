# SmartStore — Payment Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `Payment`, payment methods, the provider abstraction, payment state, refunds, and the credit-versus-
tender distinction. Cash reconciliation is in [cash-management.md](cash-management.md); the refund bound is
BI-10; customer credit is in [customer-domain.md](customer-domain.md) §4.

---

## 1. Tender is not credit

This is the single most consequential distinction in the payment model, and it is stated first because systems
routinely conflate them and produce statements that lie.

| Concept | Meaning | Recorded as |
|---|---|---|
| **Payment** | Money physically tendered, now | A `Payment` row with an amount and a method |
| **Credit** | A balance owed, settled later | A ledger entry and a balance. **Never** a payment of the full amount |

**Rule PY-01 — a credit sale creates an AR document, a customer ledger entry, and a zero-value payment** (overview
§3.5, SP-41, CU-20). It is never represented as a payment of the amount due. A `Payment` row means *money was
tendered*; a zero-value payment with a `CustomerCredit` method means *nothing was tendered and something is now
owed*, and those are different facts that happen to have the same row type.

**Why the row type is the same.** Because they appear in the same place — a list of things that settled a sale —
and a cashier needs one list. The `Method` and the zero amount carry the distinction, and the balance is a
projection of the ledger (CU-11), never of the payment rows.

**Rule PY-02 — a payment's amount is the amount *applied to the sale*, never the amount handed over** (SP-39).
Change given is a separate drawer disbursement (CD-07). This rule prevents the most common double-refund bug in
retail software: a sale whose `TotalTendered` is the note the customer handed over will later refund money the
store never kept.

---

## 2. Payment methods

A `PaymentMethod` is an organization or store configuration: a code, a name, a type, whether it is enabled at
which stores, the currencies accepted, and the configuration its type requires.

| Type | What it is | Provider? |
|---|---|---|
| `Cash` | Notes and coins | No. Reconciled in the drawer (cash-management) |
| `Card` | Credit or debit card | Yes |
| `MobileWallet` | Apple Pay, Google Pay, and equivalents | Yes |
| `StoreCredit` | The customer's own liability | No. A balance (RR-26) |
| `GiftCard` | A store-issued card with a balance | No. A balance |
| `LoyaltyPoints` | Points as value | No. A points balance (CU-24) |
| `Voucher` | A store-issued voucher | No. A balance |
| `BankTransfer` | A transfer with a later settlement | Usually, or manual |
| `OnAccount` | The customer's credit facility | No. A balance (CU-14) |

**Rule PY-03 — methods are typed, and the type determines which settlement logic applies.** A typed method makes
"is this money in the drawer?" a type question rather than a per-method question, and it makes the cash
reconciliation (CD-09) derivable.

**Rule PY-04 — an unknown, retired, or store-disabled method is refused at the till**, with a named message. It is
never silently accepted and never coerced into cash. Coercing an unknown method into cash is how a misconfigured
terminal acquires a drawer full of unreconciled money.

**Rule PY-05 — method enablement is prospective.** A method disabled on a store stops new use; historical
payments render unchanged (BI-08, PR-32's rule applied to methods).

**Rule PY-06 — a method's configuration change is audited and, for a provider, approvaled**
(`Payment.Provider.Configure`, the highest-privilege operational permission in the catalogue). A provider
configuration change is a payment-fraud vector, and the audit entry is what makes it detectable (SU-24's
reasoning applied here).

---

## 3. Provider abstraction

> **The payment domain talks to a provider abstraction, not to a payment gateway.**

**Rule PY-07 — the domain commands are:**

| Command | What it wants |
|---|---|
| `Authorize` | A provider reference and an authorization amount |
| `Capture` | A captured amount and a provider reference |
| `Refund` | A refund against a capture |
| `Void` | A cancellation before capture |
| `Query` | The current state of a provider transaction |

**Rule PY-08 — no provider name, protocol, or SDK appears in business logic.** A build check asserts it, exactly
as HD-02 asserts it for devices. **Same reasoning, same enforcement: a bound-to-one-provider payment module is a
module that cannot change provider, and payment providers are a normal, recurring commercial event.**

**Rule PY-09 — the provider is chosen per store and per method**, so a store can use one acquirer and a
warehouse-terminal another, and a second provider can be added without touching business logic. **A payment
method is not a provider.** One store routinely has two acquirers for two terminals, and a method named
`Card` is the right abstraction level.

**Rule PY-10 — the provider's response is normalised to a small, closed set of outcomes**: `Approved`,
`Declined`, `Pending`, `Failed`, `Errored`, `Timeout`. A provider's forty distinct decline codes are mapped to
`Declined` with the raw code retained, so the domain has one decline path and the diagnostic data survives.

**Rule PY-11 — `Timeout` is a distinct outcome, not a failure** (HD-20). A timeout is `Pending` and is
reconciled by querying the provider. Assuming success loses money; assuming failure double-charges. **This is one
of the most consequential single rules in the document**, because a timeout is the *most likely* outcome during a
network degradation, which is exactly when the store is busiest and least able to handle a duplicate charge.

---

## 4. Payment state machine

```
           ┌──────────► Failed (terminal)
           │
Pending ───┼──► Authorized ──► Captured ──► (no outgoing transition except a linked Refund)
           │          │
           │          └──► Voided
           │
           └──► Declined (retryable)
```

| State | Meaning | Money moved? | Retryable? |
|---|---|---|---|
| `Pending` | Submitted to the provider, no response yet | No | Yes, automatically, with backoff (PY-41) |
| `Authorized` | Funds reserved, not taken | No | Yes, capture or void (PY-13) |
| `Captured` | Funds taken | **Yes** | **No.** The only way out is a linked `Refund` (PY-12) |
| `Declined` | The provider refused | No | Yes, a new attempt on the same sale (PY-14) |
| `Voided` | Cancelled before capture | No | No. Terminal; a new attempt is a new `Payment` |
| `Failed` | A technical failure, not a decline | No | **No.** Terminal for this `Payment` (PY-54) |
| `Refunded` | Reached only via a linked `Refund` (BI-09) | Yes, out | No. Terminal |

**Rule PY-54 - a retry is a new `Payment`, never a reopened one.** A `Declined` or `Pending` payment is
retried by writing another `Payment` against the same sale, and every attempt is recorded (PY-42). `Failed` and
`Voided` are terminal: reopening them would let a settled record change its meaning after the fact, which is the
same class of defect PY-12 forbids on `Captured`. The state graph must have no edge out of either.

**Rule PY-12 — `Captured` has no outgoing transition except a linked `Refund`** (BI-09). Asserted by a test on the
state machine graph itself: no edge out of `Captured` other than to a refund. This is what keeps a captured
payment from being silently modified into a different payment, which desynchronises SmartStore from the
settlement file and is discovered by a customer rather than by the system.

**Rule PY-13 — a payment may be voided only from `Pending` or `Authorized`**, and voiding requires a permissioned
action. From `Captured`, the only path is a refund.

**Rule PY-14 — a decline is retryable; a capture is not.** A declined card is presented again; a captured card is
refunded if it must be reversed. Conflating them is how a "retry" becomes a double charge.

**Rule PY-15 — state is a projection of provider events, plus the local record.** A provider callback and a local
transition are both recorded, and the state is the reconciliation of the two. A callback is idempotent by provider
transaction reference (overview §3.10), and a duplicate callback is acknowledged and recorded once.

---

## 5. Split tender

**Rule PY-16 — a sale may be settled by several payments**, and the sum of applied payments must equal the total
due (SP-40). A customer paying half card and half cash is normal; a customer paying one card for a larger amount
is not, and is a declined payment.

**Rule PY-17 — a partial payment is not a completed sale.** The sale does not complete until its total due is
covered. The cart survives so the cashier can take the rest (SP-43).

**Rule PY-18 — an underpaid sale on an account becomes a credit sale** (SP-41, PY-01). An underpaid sale with no
account is refused, named as an underpayment.

**Rule PY-19 — overpayment is change, not a payment** (SP-39, CD-07). For non-cash methods, an overpayment is
**refused** rather than creating a negative tender; a card cannot be handed back. Where a store allows a
"negative-tender" credit note, it is a store setting, is reason-bearing, and is reported.

**Rule PY-20 — payments on a sale are settled in a deterministic order**, and the order is recorded. Where one
method fails after another has succeeded, the succeeded one is voided if it is voidable, and the failure is
surfaced. **A half-settled sale that appears complete is worse than one that clearly failed**, and the order makes
the recovery path unambiguous.

---

## 6. Refunds

**Rule PY-21 — a refund is a new, linked transaction** (BI-09, RR-23). It has its own state machine (§12.2 of
returns-refunds-domain), its own provider round-trip where relevant, and its own failure modes.

**Rule PY-22 — a refund is bounded by the refundable amount**, which is bounded per line and per sale
(RR-03, BI-10). Both caps are checked in the refund transaction, with the same conditional-counter shape.

**Rule PY-23 — a pending refund holds its amount** (RR-24), so two refunds of the same money cannot both pass
the cap while one is in flight with the provider.

**Rule PY-24 — a partial refund is normal** and is bounded by the remainder, not by the original amount.

**Rule PY-25 — a refund to a card goes to the provider**, with its own network status. A refund that "succeeded"
in SmartStore and failed at the acquirer is a `Failed` refund with a queue and a retry, and it is notified (RR-23).

**Rule PY-26 — a refund with no linked return requires large-refund approval and a reason** (BI-10, RR-35), and
is flagged as goodwill. It creates no stock.

**Rule PY-27 — a cash refund is a drawer disbursement** and is recorded as a `RefundFromDrawer` cash transaction
(cash-management §5). A cash refund that is not in the drawer means the count at close will be short and nobody
will know why.

**Rule PY-28 — a store-credit or gift-card refund returns to that balance, not to cash**, unless the customer
chooses cash and a policy permits it. Refunding a gift card to cash is a real store policy and a real
gift-card-fraud vector, so where it is permitted it requires a reason and is reported.

---

## 7. Balances: store credit, gift cards, vouchers, loyalty

**Rule PY-29 — every non-cash, non-card tender is a balance with a ledger**, not a number. Store credit is
`CustomerAccount` (RR-26), gift cards and vouchers are `StoredValueCard` with their own ledger, and loyalty is
`LoyaltyAccount` (CU-24). The shape is identical: a projection of a ledger, a bounded redemption, an expiry that
is documented, and a statement.

**Rule PY-30 — a stored-value card is a liability, and its balance is a projection** of its own entry log. A
stored-value card balance stored as a mutable field is how a store loses track of its own gift-card liability.

**Rule PY-31 — redemption is bounded atomically** (BI-19, RR-28). Two tills redeeming the same card balance
concurrently cannot both succeed.

**Rule PY-32 — a card may be partially used, repeatedly, with a total bounded by its issue value.** No single
redemption exhausts a gift card.

**Rule PY-33 — a stored-value card's issue, top-up, redemption, refund-to-card, expiry, and write-off are all
audited, and the write-off requires a reason.** It is money, in the store's name, that customers hold.

**Rule PY-34 — a stored-value card is not a payment credential for anything else.** It does not authenticate, it
does not authorise, and it is never linked to an employee (RF-08, BI-33).

**Rule PY-35 — no expiry campaigns or expiry-without-notification in v1** (overview §6). Expiry is a documented,
reported, dated event (RR-29). An expiry campaign is a marketing feature that touches money, and it is out of
scope for a platform v1.

---

## 8. Failure, retry, and reconciliation

**Rule PY-36 — a provider call is never inside a business transaction** (BI-04, HD-17, SP-04). The call happens
first; its outcome is passed in. A transaction held open across a gateway call holds stock locks while a network
call decides.

**Rule PY-37 — the sale commits after the payment is captured, not before.** A committed sale with an uncaptured
payment is a sale given away. A payment captured with no sale is money taken for nothing, and it is *recoverable*
through the provider while the reverse is not.

**Rule PY-38 — the order is: authorize → capture → commit → print** (SP-03). Each step is idempotent, and each
has a defined recovery path:

| Failure at | Recovery |
|---|---|
| `Authorize` | The cart survives; the cashier retries or takes another method (SP-43) |
| `Capture` | The payment is `Pending`; the sale does not complete; the payment is reconciled and voided |
| Commit | The payment is `Pending`; reconciled as captured, and the sale is reconstructed or the payment voided |
| `Print` | The sale is committed; the receipt queues for reprint (SP-58) |

**Rule PY-39 — the commit step is idempotent and carries the same `ClientOperationId` discipline as everything
else** (BI-28, OF-22). A commit retried after a timeout does not create a second sale.

**Rule PY-40 — provider reconciliation is a job, and it is a real one.** Pending payments are queried against the
provider; settled ones are compared to the settlement file; anything unmatched is reported, never auto-adjusted.
A payment that has been `Pending` for more than a configured window is escalated to a person.

**Rule PY-41 — a payment whose provider is unreachable is never marked failed automatically.** It stays `Pending`
and retries with backoff. A payment that timed out and is then marked failed is a charge the customer disputes
with a receipt in hand.

**Rule PY-42 — every payment attempt, success, failure, and retry is recorded**, and a report of failures by
provider, terminal, and time exists. A store that cannot see its decline rate cannot tell a bad terminal from a
bad connection from a bad acquirer.

---

## 9. Security

**Rule PY-43 — no full card number is ever stored** (BI-01, and PCI in the jurisdictions that apply). What is
stored: a provider token, the last four digits where the provider supplies them, the card scheme, and the expiry
month and year where required for display. A SmartStore database that leaks does not leak card numbers.

**Rule PY-44 — card data never appears in logs, in audit entries, in error messages, or in diagnostic detail**
(CU-35, HD-24). A payment log line carries a payment id and a masked reference.

**Rule PY-45 — provider credentials are never in application configuration that a user can read** and are
rotatable without downtime. `Payment.Provider.Configure` is the highest-privilege operational permission
(PY-06).

**Rule PY-46 — a payment is bound to a terminal, a drawer where relevant, a shift, and an employee.** A payment
with no shift attribution cannot be reconciled (SP-07, PT-01, BI-39).

**Rule PY-47 — an offline card payment goes to the acquirer, not to SmartStore** (OF-05). The terminal
authorises locally with the provider; the transaction syncs afterwards. **This is why offline card payment works
at all**, and it is the reason `AllowNegative` is not the only offline consideration.

**Rule PY-48 — offline card settlement is reported as a distinct population** and is reconciled against the
acquirer's own records, because an offline authorisation and an online one fail in different ways. A store
running offline for a day has a different reconciliation problem from one with a bad terminal.

---

## 10. Deliberately out of scope

**Rule PY-49 — no split-tender optimisation, no surcharging, no dynamic currency conversion, no buy-now-pay-later
in v1.** Each is a payment method, a legal posture, or a product; each needs its own specification.

**Rule PY-50 — no payment orchestration, smart routing, or cascading authorisation in v1.** A store with two
terminals and two acquirers does not need routing. A chain that does needs a product.

**Rule PY-51 — no chargeback management in v1.** A chargeback arrives as a provider event and appears in
reconciliation. Working it is a customer-dispute workflow, and a small store handles it in its provider's portal.

**Rule PY-52 — no multi-currency payment in v1** (overview §3.1, §6). The method is single-currency and a
currency conversion is a separate store with its own balance.

**Rule PY-53 — no wallet top-up, no cash-in-cash-out, no remittance in v1.** A store that wants to sell
top-ups sells a stored-value card (PY-29) and treats the top-up as a payment against it.

---

## 11. Payment rules index

| ID | Rule |
|---|---|
| PY-01 | A credit sale is an AR document plus a ledger entry plus a **zero-value** payment |
| PY-02 | A payment's amount is the amount applied, never the amount handed over |
| PY-03 | Methods are typed, and the type determines the settlement logic |
| PY-04 | An unknown or disabled method is refused, never coerced to cash |
| PY-05 | Method enablement is prospective |
| PY-06 | Provider configuration change is audited and approvaled |
| PY-07 | The provider abstraction is `Authorize`, `Capture`, `Refund`, `Void`, `Query` |
| PY-08 | No provider name or SDK in business logic. Build-checked |
| PY-09 | The provider is per store and per method, and a method is not a provider |
| PY-10 | Provider responses normalise to six outcomes, with the raw code retained |
| PY-11 | `Timeout` is `Pending` and is reconciled, never assumed |
| PY-12 | `Captured` has no outgoing transition except a linked refund. Asserted on the graph |
| PY-13 | `Void` is reachable only from `Pending` or `Authorized` |
| PY-14 | A decline is retryable; a capture is not |
| PY-15 | State is a reconciliation of provider events and the local record; callbacks are idempotent |
| PY-16 | Split tender is permitted; applied payments must equal the total due |
| PY-17 | A partial payment does not complete a sale; the cart survives |
| PY-18 | An underpaid sale on an account becomes a credit sale; without one it is refused |
| PY-19 | Overpayment is change; a non-cash overpayment is refused, not negative tender |
| PY-20 | Payments settle in a recorded deterministic order, with a defined recovery path |
| PY-21 | A refund is a new linked transaction with its own lifecycle |
| PY-22 | A refund is bounded per line and per sale, checked atomically |
| PY-23 | A pending refund holds its amount against the bound |
| PY-24 | A partial refund is bounded by the remainder |
| PY-25 | A card refund has its own provider status; a failure is queued, retried, and notified |
| PY-26 | A refund with no return needs large-refund approval and a reason |
| PY-27 | A cash refund is a drawer disbursement and is recorded as one |
| PY-28 | A credit/gift refund returns to the balance; refund-to-cash needs a reason and is reported |
| PY-29 | Every non-cash tender is a balance with a ledger, not a number |
| PY-30 | A stored-value balance is a projection of its own entries |
| PY-31 | Redemption is bounded atomically |
| PY-32 | A card may be used in several partial redemptions, bounded by its issue value |
| PY-33 | Every stored-value event is audited, and a write-off needs a reason |
| PY-34 | A stored-value card is never an identity or an authorisation |
| PY-35 | No expiry campaigns in v1; expiry is dated, documented, reported |
| PY-36 | No provider call inside a business transaction |
| PY-37 | The sale commits after capture, not before |
| PY-38 | The order is authorize → capture → commit → print, each step idempotent with a recovery path |
| PY-39 | The commit step is idempotent with the same `ClientOperationId` discipline |
| PY-40 | Reconciliation is a job; unmatched payments are reported, never auto-adjusted |
| PY-41 | An unreachable provider leaves a payment `Pending`; it is never auto-failed |
| PY-42 | Every attempt, success, failure, and retry is recorded and reportable |
| PY-43 | No full card number is ever stored |
| PY-44 | Card data never appears in logs, audit, errors, or diagnostics |
| PY-45 | Provider credentials are unreadable in configuration and rotatable without downtime |
| PY-46 | A payment is bound to a terminal, drawer, shift, and employee |
| PY-47 | Offline card payment goes to the acquirer, not to SmartStore |
| PY-48 | Offline card settlement is a distinct, separately reconciled population |
| PY-49 | No surcharging, DCC, BNPL, or tender optimisation in v1 |
| PY-50 | No payment orchestration or cascading authorisation in v1 |
| PY-51 | No chargeback management in v1 |
| PY-52 | No multi-currency payment in v1 |
| PY-53 | No wallet top-up, cash-in-cash-out, or remittance in v1 |
| PY-54 | A retry is a new `Payment`; `Failed` and `Voided` are terminal |
