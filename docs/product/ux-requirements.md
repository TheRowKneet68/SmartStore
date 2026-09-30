# SmartStore — UX Requirements

**Phase 1 — Product & Domain Specification.**

Owner of: the interaction requirements that follow from the domain rules. This document specifies **what the
system must do for the person using it**, not how it looks. Visual design, branding, and layout are Phase 2.

Every requirement here is traceable to a domain rule that makes it necessary. **A UX requirement with no domain
rule behind it is decoration**, and decoration is not in v1.

---

## 1. The four principles

**Rule UX-01 — the till is a keyboard-first application.** A barcode scanner is a keyboard. A customer-facing
retail system is used one-handed, at speed, in bad light, by someone who is also talking to a customer. Every
till action has a keyboard route, and the scanner path is the keyboard path.

**Rule UX-02 — the common path is short and the dangerous path is explicit.** Scanning an item, taking money, and
printing is the shortest path in the product. Voiding, refunding, adjusting, and approving are longer, require a
reason, and are visibly different actions.

**Rule UX-03 — nothing is destructive by accident.** A void, a refund, a write-off, and a permission change
require an explicit confirmation that names **what** and **how much**. Not "are you sure?" — the specific
consequence.

**Rule UX-04 — the system says what happened, not what it did.** "Sale 1042 completed. £23.40 by card" is
useful. "Transaction committed" is not.

---

## 2. Roles and the workspace

**Rule UX-05.** The workspace reflects the employee's **store access and role permissions**, and nothing else is
shown. A cashier does not see inventory management; a manager does not see settings they cannot change.

**Rule UX-06.** A person with multiple roles or multiple stores sees a **switcher**, and the switcher is the
only way to change context. **There is no ambient "all stores" mode** — an ambient cross-store view is how EC-54
happens (MS-08, MS-05).

**Rule UX-07.** An employee with no store access sees an **empty workspace with an explanation and who to ask**,
not an error and not a store picker (MS-08).

**Rule UX-08.** Permissions that are absent are **hidden, not disabled-and-visible**. A cashier who cannot void
a sale does not need a greyed-out void button; they need a till that is fast.

---

## 3. The sale

### 3.1 The normal path

**Rule UX-09.** Scan or type → the line appears with description, quantity, price, and line total → the running
total is always visible → take payment → confirm → print.

**Rule UX-10.** The **running total is visible at all times**, from the first line to the receipt (SP-24, SP-30).

**Rule UX-11.** A scan of an unknown barcode is **a distinct state, not an error dialog**: a clear message, a
route to create the product or to enter a price, and the cart is untouched. A cashier mid-queue needs the cart
preserved above all else (SP-43).

**Rule UX-12.** A variant substitution (scan the wrong variant) is a **line edit on the existing line**, not a
void and a re-add. The line keeps its position.

**Rule UX-13.** Quantity adjustment is a single control on the line (weight, quantity, or a keypad), and for
weighted goods the **weight is entered by scale or by hand with a reason** (PR-28, SP-18). A hand-entered
weight says so on the line.

### 3.2 Payment

**Rule UX-14.** The payment step shows the **total due**, the tenders already taken, and the remainder. It never
shows only a "total" (SP-40).

**Rule UX-15 — change is shown as a distinct, prominent figure.** "Change £36.60" is the number the customer is
waiting for. Showing it as a negative line in a total is technically correct and practically useless (SP-39,
CD-07).

**Rule UX-16.** A declined payment **keeps the cart and the tenders already taken** (SP-43, EC-78). The cashier
retries or takes another method. **Nothing is lost and nothing needs re-entering.**

**Rule UX-17.** An underpayment is named as such, and the credit-sale option is explicit (SP-41, PY-18). The
cashier is not left to work out what the system did.

**Rule UX-18.** A **timeout** is shown as "waiting for the card machine", not "declined" (PY-11). A cashier who
tells a customer "declined" when the machine is still thinking creates a dispute the system then has to resolve.

**Rule UX-19.** The offline state is **visible before it is needed**: a clear indication that the terminal is
offline and what that means for cards, stock, and prices (OF-30).

**Rule UX-20.** An offline sale accepted with an adjustment is **shown to the cashier when they next connect**
(OF-36, SM-65). Not buried in a report.

### 3.3 After the sale

**Rule UX-21.** On completion the screen shows the sale id, the total, the tenders, the change, and whether the
receipt printed. **Void is not offered here** — it is a deliberate absence, because the print is the point of no
return (SM-34) and a void button next to "Done" is a void waiting to happen.

**Rule UX-22.** The receipt prints automatically, and a print failure is **reported and queued for reprint**,
never silently swallowed (SP-58).

---

## 4. Suspended sales

**Rule UX-23.** Suspending a cart is one action, and it names what is being held (the customer name if entered,
the item count, and the value). A suspended sale with no identifier is a held cart nobody can find.

**Rule UX-24.** The suspended list is **searchable and shows the age of each** (SP-11). A week-old suspended
sale is a stale record and the list says so.

**Rule UX-25.** Resuming a suspended sale **does not re-reserve stock** (SP-11's rule). If the stock has gone,
the sale tells the cashier at the point of completion, not silently negative.

**Rule UX-26.** A suspended sale can be discarded, with confirmation, and the discard is audited.

---

## 5. Voids, refunds, and returns

**Rule UX-27.** Void, refund, return, and adjustment are on **separate, named screens** with different colours,
different confirmations, and different reasons. They are not four buttons in a row (SP-20, EC-80).

**Rule UX-28.** The void confirmation names the sale, the total, and the reason the customer is standing there.
It requires a reason code (BI-25) and a manager's permission where policy demands it.

**Rule UX-29.** The refund screen shows the **refundable remainder** prominently, not the original amount. A
cashier who sees "refund £45" when £12 is refundable has a bug report, not a customer (BI-10, RP-04's basis
rule applied to a transaction).

**Rule UX-30.** A return's disposition is a **required choice with the consequences shown**: "sellable" and "not
sellable" are labelled by what they do, and the stock effect is stated (RR-17).

**Rule UX-31.** A rejected return tells the customer-facing reason ("outside the 30-day window") in plain
language, and the internal reason separately (RR-42, SM-42).

---

## 6. Cash and shifts

**Rule UX-32.** Opening a shift asks for the **counted float by denomination**, and shows the total as it is
counted. A keypad of digits is not a count.

**Rule UX-33.** The counting screen is a **dedicated mode**: the expected amount is hidden until the count is
submitted (CD-21), and the count cannot be edited after submission without a reopen (CD-25, SM-57).

**Rule UX-34.** The variance screen shows **counted, expected, variance, and the threshold together**, and the
acknowledgement asks for a reason and, above the higher threshold, routes to approval (CD-22, CD-23).

**Rule UX-35.** The drawer state is visible on the till at all times: open, closed, held for counting. A cashier
should never have to ask whether the drawer is open.

---

## 7. Stock and adjustments

**Rule UX-36.** A stock adjustment asks for the **new counted quantity**, not a delta. "Counted: 47" is a fact;
"minus 3" is an opinion about a fact (IV-52).

**Rule UX-37.** The adjustment screen shows the **system's current count beside the counted one**, and asks for a
reason. Blind counts produce honest data (IV-31, CD-21's same principle).

**Rule UX-38.** A low-stock alert names the variant, the current quantity, the threshold, and the reorder
suggestion, and links to the reorder action (NT-11).

**Rule UX-39.** A stock count in progress is **visible to everyone who looks at stock**, with the count's start
time and who is counting (IV-33). A count that silently changes what others see is a count that gets disputed.

---

## 8. Approvals

**Rule UX-40.** The approval queue shows, per item: the subject, the amount, the requester, the reason, the age,
and the SLA (AP-26, AP-27). A queue that needs a click to see the amount cannot be triaged.

**Rule UX-41.** Approve and Reject are **distinct, equally visible actions**, and a rejection requires a reason
in the moment, not afterwards (AP-10).

**Rule UX-42.** An action that needs approval **does not appear to work and then fail** (AP-32). It says "this
needs approval from a manager, request sent", and the cashier sees the state.

**Rule UX-43.** The requester can see **their own request's state** (AP-28) — pending, decided, by whom. This is
what stops "nobody looked at it".

---

## 9. Notifications

**Rule UX-44.** The inbox shows **unacknowledged** items by default, with unread and unacknowledged counts
distinct (NT-27, NT-28).

**Rule UX-45.** Every notification links to the record it is about, and following the link is permission-checked
(NT-31, UX-08's rule).

**Rule UX-46.** Acknowledging a notification is available **only where acknowledging makes sense**, and it never
performs the action (NT-29). A notification with an action has the action, not an "acknowledge" that pretends
to be one.

---

## 10. Search and lookup

**Rule UX-47.** Search is **scope-filtered before it returns** (MS-10, RP-14). A search that returns a result
the user cannot open is a leak, and a search that returns nothing for a store the user cannot see is correct.

**Rule UX-48.** Search is **fuzzy enough for a human and exact enough for a barcode** (PR rules). A barcode is
exact; a name is fuzzy; the two never mix.

**Rule UX-49.** Search suggestions are **limited and scope-filtered**. An autocomplete that queries the whole
catalog to help a cashier is a scope leak with a text box (MS-10).

---

## 11. Accessibility

**Rule UX-50.** Every till action is **keyboard-reachable**, with a visible focus indicator and a logical tab
order.

**Rule UX-51.** Every till action is **announced audibly**, and every confirmation is spoken. A blind or
part-sighted cashier can run a full shift (EC-81).

**Rule UX-52.** Colour is **never the only signal.** A variance, a rejection, an offline state, and a held shift
each have a text label and an icon, not just a colour. Colour-only signalling fails a quarter of the workforce and
fails a monochrome terminal.

**Rule UX-53.** Touch targets are **large enough for a busy shop** (a minimum is specified in Phase 2, but the
requirement is that they are not fingertip-sized, because till work is fast and imprecise).

**Rule UX-54.** Text contrast meets a published ratio, and the till screen is legible at arm's length in a bright
shop. A POS screen that is hard to read is a till that makes mistakes.

---

## 12. Error messages

**Rule UX-55.** An error message says **what happened, why, and what to do next.** Three parts, in that order.
"Invalid request" has none of them.

**Rule UX-56.** An error message is **specific enough to act on**: "Only 2 left — you asked for 5" (EC-01), not
"insufficient stock".

**Rule UX-57.** An error is **never a surprise dialog** mid-transaction. It preserves the cart, preserves the
tenders, and says what is safe to do (SP-43, UX-16).

**Rule UX-58 — a `403` says "you do not have access to X", not "not found"**, and a `404` says "not found". The
distinction is deliberate (MS-07), and the UI must not blur it, because blurring it makes every scope error look
like a missing record and sends the user to the wrong fix.

**Rule UX-59.** A user-caused error is **not styled as a system error.** A declined card is a normal outcome
with a colour and a next step; a server error is a different colour and says the till is still working.

---

## 13. Speed

**Rule UX-60.** The till's normal path has a **measurable budget**, specified in Phase 2 against real hardware.
This document's requirement is that the budget **exists and is tested**, because a POS that is slow is a POS
that is bypassed.

**Rule UX-61.** A slow operation **never silently waits.** It shows progress, or it says it is taking longer, or
it offers the offline path. A frozen screen is interpreted as a crash, and the cashier's response is to press the
void.

**Rule UX-62.** Background work (sync, reports, reconciliation) is **visible as a status, not as a spinner on
the sale.** The sale screen is never blocked by a report (RP-21, UX-61).

---

## 14. Offline UX

**Rule UX-63.** Offline mode is **announced once, clearly, and persistently** (OF-30). A cashier who does not
know they are offline is a cashier who will promise a customer something the system cannot do.

**Rule UX-64.** Offline mode changes what is **knowable**, and the UI is honest about it: the price may change on
sync, stock is the terminal's best knowledge, loyalty cannot be checked, and card payments go to the acquirer
(OF-13, PY-47).

**Rule UX-65.** On reconnect, the cashier is shown the **outcome of every queued sale**: applied, adjusted, or
rejected (OF-35, OF-36). A silent sync is a cashier who does not know whether a sale happened.

**Rule UX-66.** A rejected offline sale is **shown with its reason and what to do** — the customer needs a
refund or a re-ring, and the cashier needs to know which (OF-35).

---

## 15. Deliberately out of scope

**Rule UX-67 — no theming, branding, or white-label in v1.** A store's colours are not a Phase 1 requirement
(overview §6).

**Rule UX-68 — no animated or "delightful" transitions in the till.** A till that animates is a till that
delays a queue. The till is fast and plain; the manager's dashboard may be considered separately.

**Rule UX-69 — no customisable dashboard or widget layout in v1** (RP-30's reasoning applied to screens).

**Rule UX-70 — no in-app help or chat in v1.** The manual is a document; chat is a feature with a staffing cost.

**Rule UX-71 — no multi-language UI in v1.** A store's language is a business decision with a translation cost
per screen, and it is not a Phase 1 requirement. The data model is unaffected by it, which is what makes it
addable.

---

## 16. UX rules index

| ID | Rule |
|---|---|
| UX-01 | The till is keyboard-first; the scanner is the keyboard |
| UX-02 | The common path is short; the dangerous path is explicit and slower |
| UX-03 | Nothing is destructive by accident; confirmation names what and how much |
| UX-04 | The system says what happened, not what it did |
| UX-05 | The workspace shows only what the employee's access and role permit |
| UX-06 | A multi-context user uses a switcher; there is no ambient all-stores mode |
| UX-07 | No store access is an empty workspace with an explanation |
| UX-08 | Absent permissions are hidden, not disabled |
| UX-09 | Scan, add, total, pay, confirm, print |
| UX-10 | The running total is visible at all times |
| UX-11 | An unknown barcode preserves the cart and offers routes forward |
| UX-12 | A variant substitution edits the line in place |
| UX-13 | Quantity and weight are edited on the line; a hand-entered weight is labelled |
| UX-14 | The payment step shows total due, tenders taken, and remainder |
| UX-15 | Change is a prominent, distinct figure |
| UX-16 | A decline keeps the cart and the tenders taken |
| UX-17 | An underpayment is named, and the credit option is explicit |
| UX-18 | A timeout is "waiting", not "declined" |
| UX-19 | The offline state is visible before it is needed |
| UX-20 | An offline adjustment is shown to the cashier on reconnect |
| UX-21 | Completion shows the outcome and does not offer a void |
| UX-22 | A print failure is reported and queued for reprint |
| UX-23 | Suspending names the held cart |
| UX-24 | The suspended list is searchable and shows age |
| UX-25 | Resuming does not re-reserve; a shortfall surfaces at completion |
| UX-26 | Discarding a suspended sale is confirmed and audited |
| UX-27 | Void, refund, return, and adjustment are separate named screens |
| UX-28 | The void names the sale, the total, and needs a reason |
| UX-29 | The refund screen leads with the refundable remainder |
| UX-30 | A disposition is a required choice with its consequences shown |
| UX-31 | A rejected return has a customer-facing and an internal reason |
| UX-32 | Opening a shift counts the float by denomination |
| UX-33 | Counting is a dedicated mode; expected is hidden until submitted |
| UX-34 | The variance screen shows counted, expected, variance, and threshold together |
| UX-35 | The drawer state is always visible on the till |
| UX-36 | An adjustment asks for the counted quantity, not a delta |
| UX-37 | The adjustment shows the system's count and asks for a reason |
| UX-38 | A low-stock alert names the variant, quantity, threshold, and reorder |
| UX-39 | A count in progress is visible to everyone who looks at stock |
| UX-40 | The approval queue shows subject, amount, requester, reason, age, and SLA |
| UX-41 | Approve and Reject are equally visible; a rejection needs a reason in the moment |
| UX-42 | An action needing approval says so and shows the request's state |
| UX-43 | The requester can see their own request's state and decider |
| UX-44 | The inbox leads with unacknowledged; unread and unacknowledged are distinct |
| UX-45 | A notification links to its record, permission-checked |
| UX-46 | Acknowledging never performs the action |
| UX-47 | Search is scope-filtered before it returns |
| UX-48 | Barcode search is exact; name search is fuzzy; they never mix |
| UX-49 | Autocomplete is limited and scope-filtered |
| UX-50 | Every till action is keyboard-reachable with a visible focus |
| UX-51 | Every action and confirmation is announced audibly |
| UX-52 | Colour is never the only signal |
| UX-53 | Touch targets are sized for fast, imprecise till work |
| UX-54 | Contrast and legibility are specified for a bright shop at arm's length |
| UX-55 | An error says what happened, why, and what to do |
| UX-56 | An error is specific enough to act on |
| UX-57 | An error preserves the cart and the tenders |
| UX-58 | A 403 says "no access", a 404 says "not found"; the UI does not blur them |
| UX-59 | A user-caused error is not styled as a system error |
| UX-60 | A till speed budget exists and is tested |
| UX-61 | A slow operation never silently waits |
| UX-62 | Background work is a status, not a spinner on the sale |
| UX-63 | Offline mode is announced once, clearly, persistently |
| UX-64 | Offline mode is honest about what is knowable |
| UX-65 | On reconnect, every queued sale's outcome is shown |
| UX-66 | A rejected offline sale shows its reason and what to do |
| UX-67 | No theming or white-label in v1 |
| UX-68 | No animation in the till |
| UX-69 | No customisable dashboard layout in v1 |
| UX-70 | No in-app help or chat in v1 |
| UX-71 | No multi-language UI in v1 |
