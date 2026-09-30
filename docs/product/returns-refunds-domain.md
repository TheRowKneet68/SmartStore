# SmartStore — Returns and Refunds Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `CustomerReturn`, `CustomerReturnLine`, `Refund`, store-credit issuance, and exchanges. The bound that
matters most here — **returned quantity may never exceed sold quantity, atomically** — is BI-06 and BI-16, and it
exists because of Phase 0 finding **S-01**, where an unbounded return endpoint was used to manufacture inventory
in a real business.

---

## 1. The two documents, and why they are not one

| Document | What it is | What it moves |
|---|---|---|
| `CustomerReturn` | Goods coming **back** | Stock (into a dispositioned location) |
| `Refund` | Money going **back** | A refund, or store credit issued |

They are separate because they are genuinely separate events. A return may be accepted with no refund (goodwill
credit only). A refund may exist with no return (manager-approved goodwill refund, BI-10). A store credit may be
issued instead of money. Collapsing them into one "return" document forces a "was there a refund?" boolean and
produces a report that cannot distinguish a customer who returned goods from a manager who gave money away.

**Rule RR-01.** A return and a refund are linked when both exist, and a `Refund` carries its originating return
where one exists. Neither requires the other.

---

## 2. The refund bound, and how it is computed

### 2.1 The obvious approach is wrong

The tempting implementation is "refund what the line cost". It is wrong the moment a sale was part-paid, part
discounted, part loyalty-redeemed, or tax-inclusive, and it fails in the store's favour in a way that shows up
months later as unexplained margin loss.

### 2.2 Settled amount

> **`SaleLine.SettledAmount` is that line's share of the amount the customer actually paid. It is computed once,
> at sale completion, by allocating `TotalDue` across the lines. The sum of all `SettledAmount` values on a sale
> equals `TotalDue` exactly, with no residual.**

**Rule RR-02.** Allocation is by the BI-01 rule: proportional at full precision, each line rounded down, residual
minor units assigned in ascending line-number order. The allocation is **stored on the line at completion**, not
recomputed later, because a later recomputation over a changed tax mode or a re-sorted cart would produce a
different answer (BI-11).

**Rule RR-03 — a refund against a line may never exceed that line's `SettledAmount`, less what has already been
refunded against it.** The check is a conditional counter increment, identical in shape to BI-06, in the same
transaction as the refund.

**Why the caps are two, and both are needed:**

| Cap | Bound | What it stops |
|---|---|---|
| Per line | `SettledAmount − RefundedAmount` | Over-refunding one line against another's payment |
| Per sale | `TotalDue − Σ RefundedAmount` | Over-refunding the sale as a whole (BI-10) |

Both are checked in the refund transaction. A sale where every line is fully refunded has no refundable amount
left, because the allocation leaves nothing over.

**Rule RR-04 — refund at what was paid, not at today's price and not at list price.** A promotional price on the
day of sale is the price refunded. This is what makes the refund bound correct without any special-casing.

**Rule RR-05 — a free item refunds zero and returns stock normally.** A 100% discount line (PR-34) has
`SettledAmount = 0`, so nothing is refundable, and the goods still come back into stock as a `Sellable`
disposition. This is correct: the customer never paid for them.

**Rule RR-06 — tax follows the refund.** Where tax was charged on the returned portion, the refund includes it,
and the refund document's tax component is derived from the line's stored tax at the same proportion as the
settled amount. A refund that silently drops tax is a tax reporting error, and a refund that returns more tax
than was charged is a fraud.

**Rule RR-07 — store credit counts against the same bound.** A store credit is a liability created rather than
money returned; it is not a loophole around the cap.

---

## 3. Return eligibility

**Rule RR-08 — a return references a specific `SaleLine`, always** (BI-16). The customer is identified by the
receipt, the document number, or a barcode on the receipt; the system finds the sale; the return names its lines.

**Rule RR-09 — a return without a sale reference is a goodwill return**, permitted only with `Return.Approve` and
a reason code (BI-16), creates **no stock movement**, and refunds cash only. This is the case of a customer
returning goods bought elsewhere, and it is a real need. It is modelled as an explicit exception, not as a hole
in the quantity bound.

**Rule RR-10 — the return window is a store setting**, default 30 days, measured on the business date
(overview §3.3), not on wall-clock time.

**Rule RR-11 — beyond the window, a return requires `Return.Approve` and a reason.** A hard refusal loses
customers and staff work around it silently; an escalation makes the exception visible and rare. **The refusal
itself is a design decision:** the system names the date the window closed, so a customer argument is about a fact
rather than about the system.

**Rule RR-12 — a return of a `Discontinued` or `Archived` product is allowed** (PR-46, PR-47). The goods were sold,
so the customer may bring them back. Archival is an operational status, not a bar on returns.

**Rule RR-13 — one return references exactly one sale.** A customer with two receipts returning one item from
each gets two returns. This is deliberate: a multi-sale return makes the settled-amount allocation ambiguous and
the document unrenderable. The *reports* aggregate by customer and by day, so the operational need is met
without compromising the document.

---

## 4. Quantity bound and idempotency — the two hard invariants

**Rule RR-14 — cumulative returned quantity per line is bounded by sold quantity, atomically** (BI-06). The sale
line holds a `ReturnedQuantity` counter; the return performs a single conditional update —
`ReturnedQuantity + requested <= SoldQuantity` — and aborts if it affects no row. Under 50 concurrent returns of
the full quantity, exactly the permitted number succeed and the total returned equals the total sold. This is
the single most important concurrency test in the product.

**Rule RR-15 — a return is processed exactly once** (BI-07). Every return carries a client-generated
`ClientOperationId` with a uniqueness constraint. A double-click, a retry, or a sync replay returns the original
return. A second return against the same line with a **different** id is a genuine second return and is subject
to RR-14, not to RR-15.

**Why both, and why they cannot substitute for each other.** With idempotency alone, a determined or buggy client
sends fifty *distinct* ids and manufactures stock. With the quantity bound alone, a double-click is rejected
outright, so a legitimate second return of different goods is refused because of a retry — a duplicate-processing
bug becomes a customer-facing failure. Each rule closes the hole the other leaves.

**Rule RR-16 — returns are idempotent per line too.** Where a return form covers several lines, each line carries
its own operation reference, so a partially-applied form is not re-applied wholesale. The form is one
transaction (BI-04), so partial application should not occur — the per-line reference exists so that a *client*
that retries a line does not re-apply it.

---

## 5. Disposition — always, and never implicit

**Rule RR-17 — every return line resolves to exactly one disposition** (BI-17): `Sellable`, `Quarantine`,
`Damaged`, or `Expired`. It is a required field, written into the resulting movement.

**Rule RR-18 — the store's default is a pre-filled value, not an automatic one** (BI-17). The operator confirms
or changes it. The fast path stays fast and the safety stays real.

**Rule RR-19 — disposition determines the destination location**, and only a `Sellable` disposition targets a
location with `IsSellable = true` (WH-01). A `Sellable` return into a non-sellable location is refused at the
boundary.

**Rule RR-20 — the batch, if tracked, is named on the line, or the return goes to quarantine** (BE-45, BE-46).
An unattributable return of a batch-tracked variant creates no batch-level movement, because there is no batch
to move; it is received into quarantine as a generic receipt with reason `CustomerReturnUnattributed` and resolved
by inspection. Assigning it to "the oldest batch" corrupts a real batch's expiry position, and a customer
receiving a product with the wrong expiry date is not an acceptable outcome.

**Rule RR-21 — damaged goods are removed from stock value only when written off** (IV-56). A return as `Damaged`
is not yet a loss; it is damaged stock. The `DAMAGE` write-off is the loss, and it is its own reason-coded event.

---

## 6. Refund methods

| Method | What it is | Bound beyond the general caps |
|---|---|---|
| `OriginalTender` | Back to the method the customer paid with | Card refunds route to the provider; cash goes to the drawer |
| `StoreCredit` | A liability against the customer | Requires the customer to exist. Bounded by their balance (§7) |
| `Cash` | Cash out of the drawer | Requires `Cash.Out` at the threshold (cash-management) |
| `Exchange` | No money; a linked new sale | The new sale's total may not exceed the return's refundable amount unless the customer pays the difference (§8) |

**Rule RR-22 — refunding to the original tender is the default and is strongly recommended by the UI.** Splitting
a refund across methods is permitted (a customer paid half card, half cash and wants it back on a different card)
and is recorded as multiple `Refund` rows.

**Rule RR-23 — a card refund is a new, linked transaction** (BI-09). It has its own provider round-trip, its own
status, and its own failure modes. A failed card refund is a failed refund with a queue and a retry — never a
completed sale with a silently missing refund.

**Rule RR-24 — a refund in progress holds the amount.** Once a refund is `Pending` against a provider, the amount
is treated as committed for the purposes of the RR-03 bound, so a second refund of the same money cannot be
started while the first is in flight. This closes a race that would otherwise let two refunds both pass the cap.

**Rule RR-25 — refunds on a `Training`-mode sale are impossible** (PT-03), because a training sale is not a sale.

---

## 7. Store credit

**Rule RR-26 — store credit is a `CustomerAccount` balance, not a payment method with a magic number.** Issuing
credit creates a customer ledger entry (`CreditIssued`); redeeming it at the till creates a `Charge` and a
zero-value payment record against the credit (overview §3.5, customer-domain §5).

**Rule RR-27 — issuing store credit is a refund instrument and increments the sale's `RefundedAmount`**
(RR-07). It is bounded exactly as money is.

**Rule RR-28 — credit may not be redeemed below zero and redemption is bounded atomically** (BI-19, BI-06 shape).
Two tills redeeming the same balance concurrently cannot both succeed.

**Rule RR-29 — store credit may be set to expire**, per store, and expiry is a documented, reported event rather
than a silent deletion. The customer's balance history remains.

---

## 8. Exchanges

**Rule RR-30 — an exchange is a return plus a new sale, linked, in one transaction.** It is deliberately **not** a
special document type. An exchange that is a distinct entity would need its own state machine, its own tax
treatment, its own numbering, and would still be a return and a sale underneath.

**Rule RR-31 — the new sale's total is capped by the return's refundable amount** unless the customer pays the
difference. A "free exchange" from a cheaper item down is a real retail courtesy, and it is modelled as a
**new sale with a zero-tender path derived from the return's refundable credit** — with the difference either
tendered or written off by a manager, both recorded. It is never a price of zero on a variant (PR-34).

**Rule RR-32 — the exchange is atomic.** Either both documents post or neither does (BI-04). A return without its
sale leaves stock in the shop and no customer transaction; a sale without its return ships goods that were never
received.

**Rule RR-33 — the exchange receipt shows both sides**, with the return reference on the new sale's receipt. A
customer who exchanges and receives no paper has no record that the return happened.

**Rule RR-34 — stock is not netted.** The return's stock effect and the sale's stock effect are two separate sets
of movements, even on the same variant in the same transaction. Netting them would make the ledger lose the
exchange, and the shelf count would be the only record of it.

---

## 9. Refunds without a return, and returns without a refund

Both are real. Both are controlled.

**Rule RR-35 — a refund with no linked return requires `Sale.Refund.Large.Approve` and a reason code** (BI-10),
and is flagged in reporting as a goodwill refund. It does **not** create stock. Nothing came back.

**Rule RR-36 — a return with no refund is normal** and creates no money movement. A manager may refund out of
goodwill separately (RR-35), or issue store credit (RR-26), or simply restock the goods.

**Rule RR-37 — goodwill movements are reported by actor, value, and reason, with concentration analysis** (SP-56,
IV-36). Goodwill is a legitimate tool. Goodwill at unusual volume from a single operator is a different thing, and
the data to tell them apart exists because the reason codes are mandatory (BI-25).

---

## 10. Loyalty, promotions, and the effects of a return

**Rule RR-38 — loyalty points earned on a returned line are reversed**, bounded by the points actually earned on
that line and not already spent. Where points were spent on the sale and the sale is returned, the spend is
adjusted first and any un-returned spend becomes a debit or a negative balance, reported.

**Rule RR-39 — a promotion's free-item effect is reversed with the item.** A "buy 3 get 1 free" where the free
item is returned re-prices the sale. Because a sale is immutable (BI-08), this is done by a **recalculation
document** linked to the return, never by editing the original sale's totals. The customer's net position is
correct and the original sale remains exactly as rung.

**Rule RR-40 — a coupon's use count is decremented** where the return makes the coupon inapplicable, and this is
reported when it would exceed a campaign's stated usage.

**Rule RR-41 — the loyalty accrual basis is configured, and v1's basis is decided** (overview §7.8, D-11). The
mechanism supports gross, net-of-discount, and net-of-tax bases as configured values, and the **decided v1 basis is
net item subtotal after discount, excluding tax**. Changing the configured value later needs no schema change.

---

## 11. Tax on returns and refunds

**Rule RR-42.** Refund tax is the line's stored tax, taken at the same proportion as its `SettledAmount`, using
the rate that was stored on the original line (BI-18). A tax rate changed since the sale does not change the
refund.

**Rule RR-43.** The refund document carries its own tax lines and its own tax total, so a period's refund tax is
reportable without re-deriving it from sales.

**Rule RR-44.** An exempt customer's return carries no tax, because the original line carried none (PR-40).

---

## 12. State machines

### 12.1 Customer return

```
Draft ──post──▶ Posted ──settle──▶ Settled ──close──▶ Closed
                 │
                 └──▶ Cancelled      (only from Draft; no goods accepted, no money moved)
```

- `Draft` holds the intended lines, bounded by RR-14 as it is built, so a long return form cannot accumulate
  beyond the sold quantity before it is posted.
- `Posted` is when stock moves. Nothing moves before it (BI-27, IV-14).
- `Settled` is when no further refund is expected against it; the refundable amount is zero or the remainder is
  written off with a reason.
- `Cancelled` exists **only** from `Draft`, because a posted return has physical goods in the building and can
  only be corrected by a further reason-bearing movement, never by un-posting it (BI-08, BI-15).

### 12.2 Refund

```
Draft ──submit──▶ PendingApproval (if required) ──approve──▶ Approved
                                                          │
                                                          ▼
                                                    Processing ──▶ Completed
                                                          │
                                                     ──▶ Failed ──retry──▶ Processing
                                                          │
                                                     ──▶ Cancelled
```

- `PendingApproval` has no money effect (BI-27).
- `Processing` is the provider round-trip. RR-24 holds the amount for the whole of this state.
- `Failed` is terminal until a retry or a manual resolution. It is never silently dropped, and it is notified.
- `Completed` is terminal. A completed refund is not edited or deleted; a mistake is corrected by a further
  linked refund with a reason (BI-09, BI-08).

### 12.3 Sale interaction

`Completed → PartiallyReturned → Returned` is computed from the counters (SP-66). `Voided` is refused while any
return against the sale is unreversed (SP-55, BI-41).

---

## 13. What a return must never do

The list of things a returns module is tempted to do wrong, each with the rule that forbids it. This is the
section worth reading before writing any of the code.

| Temptation | Forbidden by |
|---|---|
| Create stock from a return with no upper bound | BI-06, RR-14 |
| Create stock from a return with no sale reference | BI-16, RR-09 |
| Process the same physical goods twice | BI-07, RR-15 |
| Return goods to sellable stock without asking | BI-17, RR-17 |
| Guess a batch for a tracked product's return | BE-46, RR-20 |
| Refund list price on a discounted line | RR-02, RR-04 |
| Refund the full line when the sale was part-paid | RR-03 |
| Allow two concurrent refunds of the same money | RR-24 |
| Let a return race a void | SP-55, BI-41 |
| Drop tax from the refund | RR-06, RR-42 |
| Let a return be un-posted after the goods arrive | §12.1, BI-08 |
| Give a refund to a goodwill return automatically | RR-09, RR-35 |
| Let a coupon or promotion effect survive its item | RR-39, RR-40 |

---

## 14. Returns rules index

| ID | Rule |
|---|---|
| RR-01 | A return and a refund are separate documents, linked when both exist |
| RR-02 | `SettledAmount` is stored per line at completion and sums to `TotalDue` exactly |
| RR-03 | A line refund is bounded by `SettledAmount − Refunded`, checked atomically |
| RR-04 | Refunds use the amount paid, not today's price or list price |
| RR-05 | A free item refunds zero and still returns stock |
| RR-06 | Refund tax follows the returned portion, at the stored rate |
| RR-07 | Store credit counts against the same refund bound |
| RR-08 | Every return references a specific sale line |
| RR-09 | A return with no sale is a goodwill return: approval, reason, cash only, no stock |
| RR-10 | The return window is a store setting on the business date |
| RR-11 | A late return is escalated, not refused, and names the closing date |
| RR-12 | Discontinued and archived products are returnable |
| RR-13 | One return references exactly one sale; reports aggregate |
| RR-14 | Cumulative returned quantity is bounded by sold quantity, atomically (BI-06) |
| RR-15 | A return is processed exactly once, by `ClientOperationId` (BI-07) |
| RR-16 | Returns carry per-line idempotency references |
| RR-17 | Disposition is mandatory on every return line (BI-17) |
| RR-18 | The store's default disposition is pre-filled, not automatic |
| RR-19 | Disposition determines the location, and only sellable targets a sellable location |
| RR-20 | An unattributable tracked-variant return goes to quarantine |
| RR-21 | A damaged return is damaged stock, not yet a loss |
| RR-22 | Refunding to the original tender is the default |
| RR-23 | A card refund is a new linked transaction with its own lifecycle |
| RR-24 | A `Pending` refund holds its amount against the bound |
| RR-25 | A training-mode sale cannot be returned or refunded |
| RR-26 | Store credit is a customer balance with a ledger, not a magic number |
| RR-27 | Issuing store credit increments the sale's refunded counter |
| RR-28 | Credit redemption is bounded atomically and may not go below zero |
| RR-29 | Credit expiry is documented and reported, never silent |
| RR-30 | An exchange is a linked return plus sale, not a document type |
| RR-31 | An exchange is capped by the return's refundable amount unless payment or write-off |
| RR-32 | An exchange is atomic |
| RR-33 | An exchange receipt shows both sides |
| RR-34 | Exchange stock effects are two movement sets, never netted |
| RR-35 | A refund with no return needs large-refund approval and a reason (BI-10) |
| RR-36 | A return with no refund is normal and moves no money |
| RR-37 | Goodwill movements are reported with concentration analysis |
| RR-38 | Loyalty points on returned lines are reversed, bounded |
| RR-39 | Promotion effects reverse via a linked recalculation, never by editing the sale |
| RR-40 | Coupon use counts are decremented and over-reversal is reported |
| RR-41 | Loyalty accrual basis is configurable; decided v1 basis is net of discount, excluding tax (D-11) |
| RR-42 | Refund tax uses the rate stored on the original line |
| RR-43 | The refund carries its own tax lines and total |
| RR-44 | An exempt customer's return carries no tax |
| — | Restocking fees are OUT OF SCOPE in v1: they need a service line and a tax decision, and are modelled later if a customer needs them |
