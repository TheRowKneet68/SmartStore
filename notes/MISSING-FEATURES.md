# Missing features

Written 2026-10-01, after the Domain 3 application-layer commit (`133159c`) and the reverted Domain 4 mutation-test
work. This is an inventory of what the system does not do, not a plan. Nothing here is approved work.

Two kinds of item appear below and they are not the same:

- **Specced and unbuilt** — a rule ID exists in `/docs`, or the phase order in `BUILD-STATUS.md` already names it.
  These are backlog.
- **Not specced** — no requirement states it. Per `CLAUDE.md` these are not gaps to fill in silently; each needs an
  entry in `OPEN-QUESTIONS.md` and an owner decision before anyone builds it. They are listed here so the question
  is visible, not because the answer is agreed.

Measured against the routes that exist today: `/session`, catalog (products, variants, barcodes, prices, costs,
reference data), inventory (adjustment documents, stock and movement views, reason codes), identity (roles,
permissions, employees, store access), store settings, payment methods, tills and shifts, `POST /sales`, and
`GET /sales/:saleId`. The web app has one screen, `web/src/pos/Sale.tsx`.

---

## 1. Cash and till — specced, unbuilt

1. **Shift close.** `GET`/`POST /stores/:storeId/shift` exist. There is no count, no variance, no acknowledgement,
   no closing float and no close. `CD-20`..`CD-25` is the next approved item in `BUILD-STATUS.md`. A user cannot
   end a trading day at all.
2. **X/Z report.** No read route and no rendered report. Expected-versus-counted for a shift cannot be shown.
3. **Till disable and retire.** Devices only move through `/transitions` activate. There is no out-of-service or
   retired state at the till level, so a till that should stop trading still accepts sales.
4. **Pay-in / pay-out.** The cash transaction types exist in the schema. No route records a petty-cash movement or a
   mid-shift drawer top-up.
5. **Drawer assignment and swap.** One drawer per till is structural. No route assigns, replaces or reconciles a
   drawer independently of a till.

## 2. Sales

6. **Sale list and search.** Specced (`RP-01`.. and the sale reads), unbuilt. Only `GET /sales/:saleId` exists: no
   by-date, by-till or by-cashier lookup, no paging. Finding yesterday's sale means already knowing its id.
7. **Receipt rendering and reprint.** Specced (`P3`, `P4`, receipt status). No receipt document, no print path, no
   reprint-with-reason. This is the largest day-to-day gap.
8. **Customer on a sale.** Only the walk-in customer exists. No customer entity, no lookup, no attach to the sale.
9. **Discounts.** The sale payload is quantity plus a signed quote. No line discount, no sale-level markdown, no
   price override with a reason at the till. I have not traced a rule ID for this and am not asserting one.
10. **Held / parked sales.** Nothing survives between shifts.
11. **Non-cash tenders.** Card, wallet and gift card are absent. Blocked on OQ-018 (no payment provider named), but
    the user-visible effect is that the till is cash-only.
12. **Measurable items at the till.** `Measurable` units and a scale exist in the schema. No weigh input exists
    anywhere in the till flow.

## 3. Catalogue

13. **Sell by name.** The till can only scan a barcode. `GET /products` name search exists for back-office use, not
    as a till line search.
14. **Reference data is write-once.** Brands can be listed and created but not edited or archived. Units and tax
    categories cannot be edited or archived at all.
15. **Price history is unreachable.** `GET /variants/:id/prices` exists and no product view uses it.

## 4. Inventory

16. **Receiving and goods receipts.** Not built. Batches were deferred to procurement, but there is no receiving path
    at all, so stock can only enter as a manual adjustment.
17. **Stock transfer** between stores or warehouses. No route and no document.
18. **Count sheet / cycle count by location.** A recount of an adjustment document exists. A scheduled count sheet
    does not.
19. **Stock value and margin.** Quantities and movements only. No valuation, no margin.

## 5. People and administration

20. **No UI for any of it.** Roles, permissions, employees and store access are API-only. The entire product has one
    web screen.
21. **Employee lifecycle.** No leave, no termination, no PIN login. Till sign-in is password-only, and there is no
    switch-cashier flow on an open till.
22. **No self-service.** An employee cannot see their own permissions, stores or sessions.

## 6. Reporting and audit

23. **Reports.** `RP-01`..`RP-34` are specced and none is built: sales, stock, tax, labour, variance.
24. **No audit log read.** Domain 6 wrote the audit tables and its vocabulary. Nothing queries them, so "who changed
    this and when" cannot be answered from the product.

## 7. Operations and platform — mostly not specced

25. **Health, readiness and metrics endpoints.** None. Nothing distinguishes "serving" from "up but broken".
26. **Scheduled jobs.** Audit retention and purge, quote expiry housekeeping, session cleanup. Nothing runs on a
    clock.
27. **Backup and restore.** No tooling and no drill. `GAP-038` (RPO/RTO) is undecided, so this is open as a
    decision, not merely unbuilt.
28. **Printer integration.** Cash drawer kick, receipt printers, label printers. None.
29. **Offline behaviour.** `IV-23` answers "another till is busy, try again", but there is no client-side queue, so a
    network blip loses the sale in progress.

## 8. Onboarding and setup

30. **First run is CLI only.** `onboard()` is a script. No web setup and no create-your-store screen.

## 9. Jurisdiction and money

31. **`GAP-044`.** No real tax facts, so a real store cannot be configured for its own jurisdiction.
32. **Rounding and cash rounding are not user-settable.** The store settings route is the only lever and it is
    minimal.
33. **Multi-currency.** One currency per store is assumed. FX and currency switching are absent.

---

## What this means

A working cash-only till with one screen. Everything between "open the till" and "reconcile the drawer" is absent:
customers, discounts, receipts, refunds, transfers, receiving and reporting.

The four largest gaps are blocked on unanswered questions rather than on effort: OQ-018 (card payments), OQ-023 and
OQ-025 (refund caps and the missing permission key), `GAP-044` (jurisdictional tax) and `GAP-038` (RPO/RTO). A
dedicated sales-history UI also has no requirement IDs at all.

## Open questions this file raises

Not yet written to `OPEN-QUESTIONS.md`; recorded here so the list is complete in one place. Each needs an owner
decision before it becomes backlog.

- Do we want discount and price-override behaviour at the till, and if so is it specced anywhere I have not read?
- Do we want held/parked sales across shifts?
- Printer and cash-drawer hardware: is any of it in v1 scope, or is the till headless?
- Health, metrics and log shipping: what does the owner want to run this on?
- Scheduled housekeeping jobs: what runs, on what clock, retained how long?
- Web onboarding, or is CLI-only acceptable for v1?

---

## 2026-10-01 — sorted by effort

These 33 items were sorted into hard and routine on 2026-10-01 so the work can be split between two agents. The full
sorting, the evidence behind it, and the caveats are in [WORK-SPLIT.md](WORK-SPLIT.md); it is not duplicated here.

**Hard (high computation), about 550 rules across 16 workstreams:** shift close, X/Z report, returns and refunds,
customers, procurement and supplier, batch and expiry, offline POS, the approval engine, notifications, RFID,
hardware devices, card tenders, stock transfer and count sheet, multi-store operations, attendance and leave, and
costing and valuation. Four of these are blocked outright — returns and refunds (OQ-023, OQ-025), shift close
(OQ-014, OQ-020), card tenders (OQ-018), and anything needing a costing method.

**Routine (low computation), about 100–150 rules plus about a dozen screens:** the audit log read surface, the sale
list and search, till disable and retire, pay-in and pay-out, the identity admin screens, reference-data edit and
archive, price history, sell by name at the till, manual weigh entry, receipts and reprint, a web onboarding
screen, health and readiness endpoints, housekeeping jobs, and consistent paging on every list.

**Neither:** the items in the section above that have no requirement text. They wait on the owner.
