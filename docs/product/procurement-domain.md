# SmartStore — Procurement Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `PurchaseRequisition`, `PurchaseOrder`, `GoodsReceipt` (GRN), `PurchaseInvoice`, `PurchaseReturn`,
`SupplierPayment` (structure only — payment execution is in [payment-domain.md](payment-domain.md)). `Supplier`
itself is in [supplier-domain.md](supplier-domain.md).

---

## 1. The flow

```
Requisition ──submit──▶ [approval] ──▶ converts to ──▶ PurchaseOrder (Draft)
                                                          │
                                                     submit│approve (by value)
                                                          ▼
                                                    PurchaseOrder (Approved)
                                                          │  send to supplier
                                                          ▼
                                                   PurchaseOrder (Ordered)
                                                          │  goods arrive
                                                          ▼
                                              GoodsReceipt (one per delivery)
                                                          │
                                              stock created, batch captured
                                                          ▼
                                                   PurchaseOrder (PartiallyReceived / Received)
                                                          │  supplier invoices
                                                          ▼
                                                   PurchaseInvoice ──▶ three-way match
                                                          │  approve
                                                          ▼
                                              SupplierLedgerEntry (payable created)
                                                          │  Accountant pays
                                                          ▼
                                                    PurchaseOrder (Closed)
```

**Every arrow is a state transition on a document, validated against the state machine in
[state-machines.md](state-machines.md).** A purchase order cannot jump from Draft to Received, because there is
no transition that allows it and a goods receipt requires an `Ordered` purchase order.

---

## 2. Purchase requisition

An internal request to buy. Its purpose is **authorisation and prioritisation**, not ordering.

`PurchaseRequisition` holds: requesting store, requester, needed-by date, justification, one or more
`RequisitionLine` items, and — where enabled — a suggested supplier from `SupplierProduct` (PR-49).

**Rule PR-Q01.** A requisition may exist for a variant with no `SupplierProduct`, and a supplier may be chosen
manually. The suggested supplier is a convenience, never a constraint.

**Rule PR-Q02.** Requisition approval threshold is by **total value**, per organization and overridable per
store. A low-value requisition auto-approves; a high-value one needs `Purchase.Requisition.Submit` plus an
approver who is not the requester (BI-26).

**Rule PR-Q03.** One requisition may convert to one purchase order. Partial conversion creates multiple purchase
orders, and the requisition tracks `ConvertedQuantity` per line so a line cannot be ordered twice by accident.
The same conditional-increment pattern as BI-06 applies.

**Rule PR-Q04.** A requisition is a request, so it moves no stock and creates no payable until it becomes a
purchase order (BI-27). Approving a requisition approves *the intent to buy*, not a financial commitment.

---

## 3. Purchase order

The commitment document. It is a contract with a supplier, and it is the **authorisation limit for what may
arrive** (BI-38).

`PurchaseOrder` holds: PO number, supplier, ordering store, order date, expected delivery date, currency,
payment terms, delivery address, status, subtotal, tax total, grand total, and notes.
`PurchaseOrderLine` holds: variant, description snapshot, ordered quantity **in the supplier's unit**, the unit,
**unit price**, line total, tax rate, **received quantity**, and the **over-receipt tolerance override** for
this line if any.

**Rule PR-Q05 — the line stores a description snapshot.** Product names, descriptions, and units change. A PO
issued in March must still show in September what was ordered, and a supplier disputing a delivery needs the
document as issued. The snapshot is written at issue and is immutable (BI-08).

**Rule PR-Q06 — the PO is a draft until sent.** A PO's effect on nothing — no stock, no payable — until it is
`Approved` and then `Ordered` (sent to the supplier). A `Draft` PO may be freely edited and **cancelled**,
because it has no history worth preserving. A PO that has left the building may never be deleted (BI-40).

**Rule PR-Q06a — a PO is never deleted, in any state, including `Draft`.** Deletion is not offered on a PO at
any state. A `Draft` PO is **cancelled**, which is a reasoned state transition that leaves the record, its number,
and its history visible (SM-08, SM-24, RT-117). The original wording of PR-Q06 said a `Draft` PO "may be freely
edited and deleted"; that contradicted RT-117 (MUST: "A PO is never deleted") and PR-Q08, which already provides
cancellation from `Draft`. **The MUST governs and the wording was the defect.** Cancelling rather than deleting
costs nothing operationally — a `Draft` PO has no stock, no payable, and no counterparty dependency — and it
preserves the numbering sequence, which a deleted draft would silently break.

**Rule PR-Q07 — prices are recorded, not derived.** A PO line's unit price is what was negotiated. It is never
recalculated from the current price list at any later point, including at receipt or invoice.

**Rule PR-Q08 — cancellation.** A PO may be cancelled from `Draft`, `PendingApproval`, `Approved`, and `Ordered` —
**provided no goods receipt exists against it**. Once a goods has been received, cancellation is refused (BI-41)
and the resolution is a purchase return for what was received, plus a cancellation for the unreceived remainder,
which is a real and common retail outcome.

**Rule PR-Q09 — the close-short-close path.** A PO may be closed with an unreceived remainder, with a reason.
This is the normal end state for a supplier who delivered 60 of 100 units and is not going to deliver the rest.
The system makes it one action rather than a series of awkward edits, and it records the shortfall.

**Rule PR-Q10 — multi-store purchasing.** A PO belongs to one ordering store. Cross-store consolidation of POs is
**OUT OF SCOPE** for v1, and the model does not prevent it. A central warehouse orders on behalf of the
organization; which store bears the cost is a distribution decision, recorded in the review as an open item.

---

## 4. Goods receipt (GRN)

**The document that creates stock.** Everything in the inventory domain happens because of this document.

`GoodsReceipt` holds: GRN number, supplier, receiving store, receiving warehouse, PO reference (or none, for a
non-PO delivery), received date, receiver, status, and notes. `GoodsReceiptLine` holds: variant, received
quantity in base units, **quantity as counted in the supplier's unit**, unit cost, batch data, expiry data,
line total, and discrepancy flags.

**Rule PR-Q11 — a goods receipt requires a PO or a documented reason.** A delivery with no PO is a real event
(direct-to-store, emergency delivery, a supplier's mistake), and it is supported — but it requires a reason code
and is reported, because un-PO'd stock arriving is how a store ends up with stock nobody ordered and nobody
investigates.

**Rule PR-Q12 — receiving is partially permitted, at the line level.** Some lines may be received in full, some
not at all, and each is independent. This is normal: a delivery of 20 items with 3 damaged is a partial receipt,
not a rejection.

**Rule PR-Q13 — over-receipt is bounded (BI-38).** Received quantity per line may not exceed
`OrderedQuantity × (1 + tolerance)`. Tolerance defaults to **zero** and is configurable per organization and per
PO. Within tolerance, receiving proceeds and is reported. Beyond tolerance, receiving is **refused** unless the
operator holds the approval and supplies a reason. Both the over-receipt and its reason are retained.

**Rule PR-Q14 — under-receipt is always permitted.** Receiving fewer than ordered is a normal occurrence and
never requires a reason. A "short receipt" is a legitimate state, not an error.

**Rule PR-Q15 — damaged goods on receipt.** A line may be received as `Accepted`, `Damaged`, or `Rejected`. Only
`Accepted` quantity creates **sellable** stock. `Damaged` and `Rejected` quantities are recorded on the GRN as
discrepancy counts but create **no** stock. The damaged quantity becomes stock only if a warehouse decision
later puts it into damaged stock, which is a separate reasoned operation.

**This matters:** receiving "20 units, 3 damaged" must not put 20 sellable units on the shelf. A GRN that records
the damage and creates 17 is right; one that creates 20 and relies on someone noticing is the common failure.

**Rule PR-Q16 — expired goods on receipt.** A batch received already expired is refused, or accepted into a
non-sellable location with `Return.Dispose` and a reason (BE-11). The GRN records the quantity as a discrepancy
and the supplier is notified.

**Rule PR-Q17 — the counted quantity is authoritative; the expected is not.** The GRN records both. A GRN whose
count differs from the PO quantity records the difference, and the difference is the discrepancy report's raw
data. The system never "corrects" the count to match the PO.

**Rule PR-Q18 — a receipt may be posted partially, in stages.** A supplier delivering 3 times against one PO
creates 3 GRNs, each reducing the PO's remaining quantity. This is why `ReceivedQuantity` is a counter on the PO
line with a conditional update (IV-38, BI-38).

**Rule PR-Q19 — a non-PO receipt needs a source.** Direct delivery, customer return, transfer, opening balance, or
`Other` with a reason (IV-51).

**Rule PR-Q20 — the GRN is a permanent document.** It is the evidence behind the stock, the batch data, and the
cost. It is never edited after posting, and a correction is a reversing GRN or a reasoned adjustment
(BI-08, IV-32).

**Rule PR-Q21 — returns-to-supplier from a receipt.** A rejected line may be returned to the supplier without
ever entering stock, via `PurchaseReturn` in `NotReceived` disposition. This is the correct handling of goods
refused at the dock, and it creates no stock movement at all.

---

## 5. Purchase invoice

The supplier's bill. It creates a **payable**, not stock.

`PurchaseInvoice` holds: invoice number, supplier, PO/GRN references, invoice date, due date, currency, subtotal,
tax total, grand total, status, and match result.

**Rule PR-Q22 — an invoice does not create stock.** Stock is created by the GRN, once. An invoice arriving
without a GRN cannot create stock; it is an **invoice-only** purchase, used for services and for invoices that
arrive before the goods. An invoice-only purchase is permitted, requires a reason, and is reported.

**Rule PR-Q23 — quantity billed is bounded by quantity received**, within tolerance, exactly as over-receipt is
(BI-38). Billing more than was received is a supplier over-billing, and the system detects and refuses it. This
is a **direct financial control** and the reason the received-quantity counter exists on both the PO line and the
GRN line.

**Rule PR-Q24.** The invoice's unit cost becomes the **batch's actual purchase cost** where a batch is created by
the referenced GRN (BE-14). Where they disagree, the discrepancy is flagged and the GRN cost stands for valuation
until resolved — because the goods physically arrived at the GRN cost, and a corrected invoice is a financial
event, not a restatement of history (BE-44).

---

## 6. Three-way match

Compare the three documents. This is the core financial control of procurement.

| Compare | PO says | GRN says | Invoice says | Meaning |
|---|---|---|---|---|
| Quantity | ordered | received | billed | Under- or over-delivery, over-billing |
| Unit price | negotiated | costed | charged | Price change or overcharge |
| Description | ordered | received | billed | Wrong item billed |
| Tax | PO tax | — | invoice tax | Tax rate change |
| Terms | payment terms | — | invoice terms | Terms change |

**Rule PR-Q25 — the match result is a computed status, not a stored opinion.** `Matched`, `QuantityVariance`,
`PriceVariance`, `DescriptionVariance`, `TaxVariance`, or `NoMatch`. It is recomputed whenever any of the three
documents changes state, and the result at approval time is stored on the invoice for audit.

**Rule PR-Q26 — variance tolerance is configured and explicit.** Within tolerance: auto-approved. Beyond
tolerance: approval required, with the variance amounts shown. A zero default is correct for a new system; a
retailer who wants operational speed raises it knowingly, and the setting is recorded.

**Rule PR-Q27 — the three-way match is configurable to two-way.** Some small retailers invoice on delivery with
no PO discipline. A store may configure matching to `PO vs Invoice` or `GRN vs Invoice`, and may disable matching
entirely. The choice is a **store setting**, visible on the invoice, and printed on the matched report, so a
reader always knows what standard was applied.

**Rule PR-Q28 — a disabled match is a reported risk.** When a store disables three-way matching, the
configuration change is audited and the store appears on a standing "controls disabled" report. Disabling a
control should be possible — a small shop must be able to trade — and visible.

---

## 7. Purchase return

Goods going back to a supplier. `PurchaseReturn` and `PurchaseReturnLine` mirror the customer return structure
but with different bounds and effects.

**Rule PR-Q29 — a purchase return is bounded by quantity received, not by quantity ordered.** You cannot return
goods you never received. The bound is on the GRN line, and it is enforced with the same conditional-counter
pattern (BI-06 shape).

**Rule PR-Q30 — a purchase return only removes stock that is still in the returnable disposition.** Returning
stock that has already been sold is not a purchase return; it is a **stock loss** with a reason. The system
refuses a purchase return that would drive a batch or item negative, and points to the loss route.

**Rule PR-Q31 — a purchase return creates a purchase credit.** It produces a `SupplierLedgerEntry` of type
`CreditNote`, reducing the payable. The supplier's balance moves, and the movement is auditable. A purchase return
that nobody ever gets credited for is a working-capital leak.

**Rule PR-Q32 — approval by value.** A purchase return beyond the store's threshold requires
`Purchase.Return.Approve` by a different employee (BI-26), and requires a reason code (BI-25). Returning goods to
a supplier is a commercial negotiation and should not be unilateral at scale.

**Rule PR-Q33 — a return against a PO may be "no-credit".** Sometimes goods go back with no financial adjustment
in mind — faulty goods replaced free, samples. The return is recorded, stock is removed, and no ledger entry is
created. The reason code distinguishes these, because a return with no credit and no reason is unattributable
value leaving the business.

---

## 8. Supplier payment

Structurally part of [payment-domain.md](payment-domain.md); the procurement-side rules are:

**Rule PR-Q34 — a payment is bounded by the outstanding payable.** It may be a partial payment. It may not exceed
the balance without `Supplier.Credit.Adjust` and a reason.

**Rule PR-Q35 — payment is the Accountant's, not the Procurement Officer's** (actors-and-roles §3.8). Committing
and disbursing are separate permissions.

**Rule PR-Q36 — a payment references the invoice(s) it settles.** An unapplied payment — a bank transfer with no
invoice reference — requires a reason and creates an unapplied-credit balance, which is reported. A supplier
ledger with a large unapplied balance is where duplicate invoices hide.

**Rule PR-Q37 — early-payment discount is recorded when taken.** Suppliers offer "2% if paid within 10 days".
Whether SmartStore models the terms or merely records the payment is an open decision; what is not optional is
that the **discount actually taken** is recorded, so the payable and the payment reconcile. Recorded in the
review as an open item.

---

## 9. Tax in procurement

**Rule PR-Q38.** Purchase tax is calculated per the store's tax mode, using the tax rate effective on the
**invoice date** (BI-18), and the rate is stored on the line. A tax-rate change mid-period does not restate a
posted invoice.

**Rule PR-Q39.** Purchase tax and sales tax are **separate**, and neither offsets the other in v1. Full input-tax
recovery and reporting is **OUT OF SCOPE** — that is accounting-ERP territory (§31 of the product overview). What
v1 provides is correct, per-document, per-line tax figures that an accountant can export.

**Rule PR-Q40 — tax-inclusive purchasing.** Where a supplier quotes tax-inclusive, the base is extracted the same
way as on the sales side (PR-39), so both sides use one extraction routine. Two different extraction
implementations would produce irreconcilable figures.

---

## 10. Reorder and shortage — COULD, and its boundary

**Reorder suggestions are OUT OF SCOPE for v1.** Ordering is a judgment activity in most retail businesses, and
automatic reorder is supply-chain planning (§31).

**What v1 does provide, because it is a report and not a plan:**

| Report | What it answers |
|---|---|
| Below reorder point | Which items are at or below their reorder level, with the level and the supplier's lead time |
| Open PO coverage | Which items are ordered but not received, and when they are expected |
| Outstanding shortage | Items on a PO that were not received, and are now overdue |
| Supplier on-time rate | Delivered when promised, by supplier |
| Supplier fill rate | Ordered versus delivered, by supplier |

**Rule PR-Q41 — a reorder level is optional metadata, not a trigger.** `ProductVariant.ReorderPoint` may be set.
Setting it produces reports. It never creates a requisition automatically. If a customer requires automatic
replenishment, that is a Phase 3+ feature with its own specification, because it needs forecast data the system
does not have.

---

## 11. Purchase state machine summary

Full detail in [state-machines.md](state-machines.md) section 4. Transitions, exhaustively:

| From | Event | To |
|---|---|---|
| `Draft` | submit | `PendingApproval` |
| `Draft` | cancel | `Cancelled` |
| `PendingApproval` | approve | `Approved` |
| `PendingApproval` | reject | `Rejected` |
| `PendingApproval` | cancel | `Cancelled` |
| `Approved` | send to supplier | `Ordered` |
| `Approved` | cancel | `Cancelled` |
| `Ordered` | GRN for some lines | `PartiallyReceived` |
| `Ordered` | GRN for every line | `Received` |
| `Ordered` | close short, with a reason (PR-Q09) | `Closed` |
| `Ordered` | cancel, only while no GRN exists (PR-Q08) | `Cancelled` |
| `PartiallyReceived` | further GRN covers every line | `Received` |
| `PartiallyReceived` | close short, with a reason (PR-Q09) | `Closed` |
| `Received` | invoiced and paid, or written off (SM-22) | `Closed` |

Terminal states: `Rejected`, `Cancelled`, `Closed`. Only `Draft` is editable (SM-20).

---
## 12. Procurement rules index

| ID | Rule |
|---|---|
| PR-Q01 | A suggested supplier is a convenience, never a constraint |
| PR-Q02 | Requisition approval is by value; the requester cannot approve |
| PR-Q03 | A requisition line's converted quantity is counter-bounded |
| PR-Q04 | A requisition moves no stock and creates no payable |
| PR-Q05 | PO lines store an immutable description snapshot |
| PR-Q06 | A `Draft` PO is freely editable and deletable; an issued PO is never deleted |
| PR-Q07 | PO prices are recorded, never recalculated |
| PR-Q08 | Cancellation is refused once a goods receipt exists |
| PR-Q09 | Close-short-close is a first-class path with a reason |
| PR-Q10 | A PO belongs to one ordering store; cross-store consolidation is out of scope in v1 |
| PR-Q11 | A receipt without a PO requires a reason and is reported |
| PR-Q12 | Receiving is partial at the line level |
| PR-Q13 | Over-receipt is bounded by tolerance; beyond it needs approval and a reason |
| PR-Q14 | Under-receipt is always permitted, with no reason |
| PR-Q15 | Damaged goods on receipt create no sellable stock |
| PR-Q16 | Already-expired goods are refused, or accepted non-sellable with a reason |
| PR-Q17 | The counted quantity is authoritative; the expected is never substituted for it |
| PR-Q18 | A PO may be received in several staged GRNs |
| PR-Q19 | A non-PO receipt requires a source or a reason |
| PR-Q20 | A posted GRN is immutable; corrections are reversals or reasoned adjustments |
| PR-Q21 | A rejected line is returned without ever entering stock |
| PR-Q22 | An invoice does not create stock. Invoice-only purchases need a reason |
| PR-Q23 | Billed quantity is bounded by received quantity (a direct financial control) |
| PR-Q24 | The GRN cost stands for valuation; an invoice correction is a financial event |
| PR-Q25 | The match result is computed and recomputed; the approved result is stored |
| PR-Q26 | Match tolerance is configured and explicit; zero default |
| PR-Q27 | Matching mode (three-way, two-way, off) is a store setting, shown on the invoice and report |
| PR-Q28 | A disabled match is audited and reported as a control gap |
| PR-Q29 | A purchase return is bounded by quantity **received** |
| PR-Q30 | A return may not drive stock negative; that is a loss, not a return |
| PR-Q31 | A purchase return creates a supplier credit note by default |
| PR-Q32 | Purchase returns need approval beyond a value threshold, and a reason |
| PR-Q33 | A `no-credit` purchase return is allowed, with a distinguishing reason |
| PR-Q34 | A supplier payment is bounded by the outstanding payable |
| PR-Q35 | Payment is the Accountant's, not the Procurement Officer's |
| PR-Q36 | An unapplied payment requires a reason and creates a reported unapplied balance |
| PR-Q37 | An early-payment discount actually taken is recorded |
| PR-Q38 | Purchase tax uses the rate effective on the invoice date, stored on the line |
| PR-Q39 | Purchase and sales tax are separate; full input-tax recovery is out of scope |
| PR-Q40 | Tax-inclusive extraction uses the same routine as the sales side |
| PR-Q41 | A reorder level produces reports. It never auto-creates a requisition |
