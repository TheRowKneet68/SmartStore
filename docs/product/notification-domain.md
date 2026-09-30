# SmartStore — Notification Domain

**Phase 1 — Product & Domain Specification.**

Owner of: the notification event vocabulary, the preference model, delivery channels, and the retry policy. The
permission catalogue is in [actors-and-roles.md](actors-and-roles.md) §3; the offline sync notice is
[offline-pos-domain.md](offline-pos-domain.md) §7.

---

## 1. A notification is not a message

| | **Notification (this document)** | Message |
|---|---|---|
| Purpose | Tell a role that something needs attention | Converse with a person |
| Trigger | A domain event | A person |
| Delivery | Push, in-app, email, SMS | In-app, with replies |
| State | Read / unread, acknowledged | Threads, read receipts |
| Retention | Short, configurable | Long |

**Rule NT-01.** A notification is a consequence of an event, not a thing a user writes. Anything a user writes
to another user is a message, and messages are OUT OF SCOPE in v1 (overview §6). **v1 has notifications, not
messaging**, and conflating them is how a "notification" system acquires threads, unread counts, and a spam
problem.

**Rule NT-02.** A notification is derived from the domain event that caused it, with no user-authored content.
The text is templated from the event. A templated statement of fact cannot be used to phish an employee, and this
is the reason templates are fixed per event type rather than per notification.

---

## 2. What generates a notification

**Rule NT-03.** The v1 event vocabulary:

| Event | Recipients | Why |
|---|---|---|
| `LowStock` | Buyer, manager | Reorder before a stockout (PR-Q01) |
| `OutOfStock` | Buyer, manager, store manager | A variant just reached zero and can no longer be promised (BE-22) |
| `NEAR_EXPIRY` | Manager | Sell or write off before it expires (BE-20) |
| `BATCH_EXPIRED` | Manager | It is now past expiry and must be written off (BE-22) |
| `PurchaseOrderApproved` / `ReceivedLate` | Buyer, manager | PO progress |
| `StockCountVariance` | Counter, manager | A count disagreed with the system (IV-31) |
| `StockAdjustmentLarge` | Manager | Adjustment beyond a threshold (IV-53) |
| `ShiftVarianceExceedsTolerance` | Cashier, manager | Money was not where it should be (CD-23) |
| `ShiftReopened` | Manager | A closed money record was revisited (CD-26) |
| `PaymentProviderUnreachable` | Terminal operator, manager | Cards cannot be taken (PY-41) |
| `PaymentPendingTooLong` | Manager, provider contact | Money may be unresolved (PY-40) |
| `RefundFailed` | Cashier, manager | The customer was not refunded (PY-25) |
| `RefundLarge` | Manager, and the approver if it is over the approval limit | A large refund needs a human eye (RR-35) |
| `CreditLimitExceeded` | Cashier, manager | A sale would exceed the limit (CU-15) |
| `ApprovalRequested` | Approver | Awaiting a decision (AP-04) |
| `ApprovalOverdue` | Approver, manager | The decision is late (AP-11) |
| `OfflineSyncRejected` | Cashier, manager | A sale was not accepted (OF-35) |
| `OfflineSyncAdjustment` | Cashier, manager | Accepted, but different (OF-36) |
| `OfflineQueueDepthHigh` | Manager | Sync is falling behind (OF-23) |
| `DeviceOffline` / `DeviceFault` | Manager | Hardware is down (HD-16) |
| `Security.LoginFailedRepeated` | Manager, the account holder | Credential guessing (RF-20) |
| `Security.PermissionDeniedRepeated` | Manager | Privilege probing (RF-21) |
| `Security.ImpersonationUsed` | Both parties' managers | Support access (AU-06) |
| `ReportReady` | Requester | A background export finished (RP-20) |
| `RetentionPurgeExecuted` | Administrator | Records were expired (AU-20) |

**Rule NT-37 - the "before" event and the "after" event are different events.** `LowStock` and `OutOfStock`
are not the same alert with a different number, and neither are `NEAR_EXPIRY` and `BATCH_EXPIRED`. The first
pair asks a human to *act in advance*; the second pair reports that the window has *closed* and something is
now wrong. Collapsing them into one type means either a permanent stream of stale warnings or a silent miss
after the fact, so each pair is two entries in NT-03. An event type is added only when a rule requires it:
`CreditOverdue` is deliberately **absent**, because no rule anywhere in Phase 1 gives a customer balance a due
date. If store credit is meant to be repayable by a date, that is a missing business decision, not a missing
notification - see PHASE-1-REVIEW.

**Rule NT-04.** Every entry in NT-03 is an event type, not a message type, and the vocabulary is closed and
versioned like the audit vocabulary (AU-11). A notification type added ad hoc is a template nobody reviewed.

**Rule NT-05 — a notification is generated in the same transaction as the event**, or by a job that reads the
event, and is **at-least-once, never exactly-once** (HD-19). A duplicate notification is better than a missed
one, and the recipient deduplicates naturally because a repeated alert is visibly a repeat.

**Rule NT-06 — notification generation never fails the business transaction.** A notification system that can
roll back a sale is a notification system that will eventually do so (BI-04, BI-24). A failed notification is a
retryable job, and an unsent notification is reportable (RP-18's approval report).

---

## 3. Who receives it

**Rule NT-07.** Recipients are resolved by **role and store scope**, not by a person. A `LowStock` notification
goes to every employee whose role holds the relevant permission in the relevant store, and to nobody else.

**Rule NT-08 — no notification crosses a store boundary** (MS-06). A Store A event notifies Store A roles. A
multi-store manager is notified once, with the store named in the text, not once per store.

**Rule NT-09 — the same event notifies each recipient once.** A manager who holds two roles that both match gets
one notification. A user who is both the buyer and the manager gets one, not two.

**Rule NT-10 — a notification is not delivered to a role with no store access**, and an employee with no store
access receives nothing but the workspace explanation (MS-08). Notifications are not a way around the scope
model.

**Rule NT-11 — a notification never contains data the recipient could not read directly.** A `LowStock` alert
shows the variant and the quantity (IV-57), not a margin, and a `CreditLimitExceeded` alert shows the limit and
the balance (CU-15), not the customer's full statement. The notification is a pointer to a fact the recipient is
permitted to see, and it says where to see it (CU-34).

**Rule NT-12 — PII in a notification is minimised and redacted** (CU-35, PY-44). A push notification on a lock
screen says "Low stock: Widget" and not the supplier's name and price.

---

## 4. Channels

| Channel | Delivery | Use |
|---|---|---|
| `InApp` | Immediate, in the workspace | Everything, always on |
| `Push` | Terminal or device | Urgent operational alerts |
| `Email` | External | Digest and non-urgent |
| `SMS` | External | **Only** for the defined critical set |

**Rule NT-13 — `InApp` is always on and is the source of truth for delivery.** Every other channel is a
convenience. A channel that is the only record of a notification has failed.

**Rule NT-14 — `SMS` is limited to a small, configured critical set**: `PaymentProviderUnreachable`,
`Security.LoginFailedRepeated` above a threshold, and a `ShiftVarianceExceedsTolerance` above the high
threshold. An SMS costs money, cannot be replied to meaningfully, and will be read at 2am by whoever it wakes.
**A threshold is required for every SMS-sending event**, and an unthresholded SMS rule is not configurable.

**Rule NT-15 — email is a digest for anything non-urgent.** A store that receives forty emails a day has an
email system that will be filtered, and a filter silently removes the one that mattered.

**Rule NT-16 — a channel is per event type and per user, with a store-level default.** A manager may turn off
`SMS` for `LowStock` and turn it on for a critical event, and a store may set the default. There is no global
notification switch, because turning notifications off globally is how an incident goes unnoticed.

**Rule NT-17 — an external channel requires a verified destination** and consent (CU-08's rules, applied to
notifications). An unverified phone number cannot receive SMS. A notification is not a marketing channel and
carries no marketing content, which is precisely why consent is manageable.

**Rule NT-18 — a channel's failure does not affect another channel or the domain.** A push provider that is down
means the alert is in-app only, and the delivery record says which channels were attempted (HD-17, PY-41's
reasoning).

---

## 5. Preferences and quiet

**Rule NT-19.** Preferences are per user, per event type, per channel, and are bounded: a user may silence a
channel for an event type, and may **not** silence a critical event type. `Security.*`, `Payment.*` failure, and
`ApprovalOverdue` are not silenceable. **A critical alert that a user can switch off is an alert that will be
switched off.**

**Rule NT-20 — a user may escalate, not silence.** Where someone silences a noisy event, the manager's default
still delivers. A preference is a personal filter, never a suppression.

**Rule NT-21 — no notification is sent outside configured business hours, except the critical set** and the
channel's own quiet rules. A `LowStock` alert at 3am is a 3am problem for no one. **Delivery is deferred, not
dropped**, and the deferral is visible so a 9am alert is not mistaken for a 3am one.

**Rule NT-22 — deferred notifications are delivered when business hours resume**, in order, and the ordering
survives the deferral.

---

## 6. Escalation

**Rule NT-23.** An event that needs a decision has a deadline, and the deadline escalates. A `LowStock` for a
variant with no buyer escalates to the manager after a configured interval. An `ApprovalRequested` that is not
decided escalates at its SLA (AP-11).

**Rule NT-24 — escalation stops at a named role, not at a person.** "Escalate to the manager" is a role; "escalate
to Dave" is a person who changes jobs.

**Rule NT-25 — an escalation chain is per event type and is bounded** (a maximum of two escalations, then the
item is surfaced on a report). An unbounded escalation loop is a notification storm, and a storm trains everyone
to ignore notifications.

**Rule NT-26 — an unresolved escalated event appears on a report** (RP-18). A notification that nobody acted on
and that nobody can see later has failed both halves of its job.

---

## 7. The inbox

**Rule NT-27.** The inbox is a list of unacknowledged notifications, newest first, filterable by type and store,
with an unread count.

**Rule NT-28 — reading is not acknowledging.** A notification may be read and still need an action. The
distinction is the difference between "I saw it" and "I dealt with it", and an inbox that conflates them reports
zero outstanding for a store that has a hundred unhandled stockouts.

**Rule NT-29 — acknowledging a notification does not perform the action it describes.** Acknowledging
`ApprovalRequested` does not approve anything. The action is a separate, permissioned step
(AP-05), and the notification links to it.

**Rule NT-30 — a notification is retained for a configured short period and then expires** (NT-19's retention
line, AU-17's consent reasoning). A notification is a pointer, not a record; the record is the event it derives
from, which is retained under AU-18.

**Rule NT-31 — the notification carries a link to the underlying record**, and following the link is
permission-checked. A notification is not a data channel; opening it checks the permission again (MS-06).

**Notification states (owner decision D-08, 2026-09-29).** This document owns exactly three states, enumerated
here from the rules above:

| State | Meaning | Source |
|---|---|---|
| `Unread` | Created, not yet opened. Creation enters this state | NT-27 (unread count), §22.16 |
| `Read` | The recipient opened it; it may still need action | NT-28 |
| `Acknowledged` | The recipient dealt with it; it leaves the inbox | NT-27, NT-28 |

- **`Unread` → `Read`** is the recipient reading the notification. **Reading is not acknowledging** (NT-28).
- **`Unread` → `Acknowledged`** and **`Read` → `Acknowledged`** are acknowledgement — the two were never a
  sequence (NT-28, SM-72, RT-324). **Acknowledging never executes the notification's underlying action** (NT-29,
  SM-73); the action is a separate, permissioned step.
- **Expiry is not a state.** A notification expires by retention — it is a pointer, not a record (NT-30, SM-74).
  There is **no `Expired` notification state**.
- **`Read` is not collapsed into `Acknowledged`, and is not a bare flag** — they are independent states (NT-28,
  RT-324).
- Transitions carry no server business audit event: reads and acknowledgements are not audited (AU-14, D-06).

---

## 8. Deliberately out of scope

**Rule NT-32 — no in-app messaging, no direct user-to-user messages, no threads in v1** (NT-01, overview §6).
Manager-to-cashier communication is verbal or through the handover the shift record already holds.

**Rule NT-33 — no push-to-talk, no broadcast announcement, no store-wide wall display in v1.** A broadcast
channel is a messaging feature with an audience problem.

**Rule NT-34 — no marketing or campaign notifications in v1.** SmartStore notifies about operations; it does not
market, and it does not hold a marketing consent model (NT-17).

**Rule NT-35 — no custom notification templates by store in v1.** A template is a controlled string with
versioning, and a store-editable template is a phishing vector against the store's own staff (NT-02).

**Rule NT-36 — no webhook or third-party push in v1.** Where a store's systems need an event, that is an
integration, and integration is Phase 2 (RP-29).

---

## 9. Notification rules index

| ID | Rule |
|---|---|
| NT-01 | A notification derives from an event; messaging is out of scope in v1 |
| NT-02 | Text is templated from the event, never user-authored |
| NT-03 | The v1 event vocabulary is a fixed, listed set |
| NT-04 | Notification types are closed and versioned like audit events |
| NT-05 | Delivery is at-least-once; duplicates beat misses |
| NT-06 | Notification failure never fails the business transaction |
| NT-07 | Recipients are resolved by role and store scope, not by person |
| NT-08 | No notification crosses a store boundary; a multi-store role is notified once |
| NT-09 | Each recipient is notified once per event |
| NT-10 | No notification goes to a role with no store access |
| NT-11 | A notification contains only data the recipient could read directly |
| NT-12 | PII is minimised and redacted in notifications |
| NT-13 | `InApp` is always on and is the delivery source of truth |
| NT-14 | SMS is limited to a configured, thresholded critical set |
| NT-15 | Email is a digest for non-urgent events |
| NT-16 | Channels are per event type and per user, with a store default and no global switch |
| NT-17 | An external channel requires a verified destination and consent |
| NT-18 | A channel failure does not affect other channels or the domain |
| NT-19 | Preferences are bounded; critical events are not silenceable |
| NT-20 | A user may escalate, not silence |
| NT-21 | Non-critical notifications outside business hours are deferred, not dropped |
| NT-22 | Deferred notifications are delivered in order on resumption |
| NT-23 | Deadlines escalate |
| NT-24 | Escalation targets a role, never a person |
| NT-25 | Escalation chains are bounded; unresolved items go to a report |
| NT-26 | An unresolved escalated event appears on a report |
| NT-27 | The inbox is unacknowledged notifications, filterable, with an unread count |
| NT-28 | Read and acknowledged are distinct states |
| NT-29 | Acknowledging a notification never performs the action it describes |
| NT-30 | Notifications expire on a configured short schedule; the event is the record |
| NT-31 | A notification links to the record, and the link is permission-checked |
| NT-32 | No user-to-user messaging or threads in v1 |
| NT-33 | No broadcast, announcement, or wall display in v1 |
| NT-34 | No marketing or campaign notifications in v1 |
| NT-35 | No store-editable templates in v1 |
| NT-36 | No webhooks or third-party push in v1 |
| NT-37 | Before and after are separate events; an event type is added only when a rule requires it |
