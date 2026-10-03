/**
 * A part of the product the specification requires and this build does not have yet.
 *
 * The screen exists so the gap is visible rather than absent (`UX-08`): a person with the permission is told the area is
 * named, what it would do, which rules decide it, and which open question or missing route is holding it — never a form
 * that pretends to work. Nothing here is invented; every line cites the document that requires it.
 */
export interface Planned {
  /** What the area is called in the product. */
  name: string;
  /** The key that would open this area. Without it the area is never shown (`UX-05`); with it, it is listed (`UX-08`). */
  key_: string;
  /** Where the key is held: the catalogue and people are the organization's, the rest are the store's (OQ-025 item 6). */
  scope: 'store' | 'organization';
  /** The document that specifies it. */
  doc: string;
  /** What it does, in the specification's own terms. */
  does: string;
  /** The rules that decide it, which the build must satisfy. */
  rules: string;
  /** Why it cannot be built yet: a missing route, or a question that is the owner's to answer. */
  waiting: string;
}

/**
 * The areas with no route and no screen. Each entry names the gap so the navigation can be complete without a single
 * invented behaviour. Permission keys are those the access model already defines for the area, so a person who lacks
 * them never sees it (`UX-05`).
 */
export const PLANNED: Planned[] = [
  {
    name: 'Customers',
    key_: 'Customer.View',
    scope: 'organization',
    doc: 'customer-domain.md',
    does: 'Customer identity, matching, status, credit account and loyalty. The walk-in customer the till already uses is all that exists.',
    rules: 'CU-01..CU-30, AP-04',
    waiting: 'No route beyond the walk-in. Customer credit and loyalty are open questions (OQ-023).',
  },
  {
    name: 'Suppliers',
    key_: 'Supplier.View',
    scope: 'organization',
    doc: 'supplier-domain.md',
    does: 'The supplier record, contacts, the ledger and payable, and payment terms with due dates.',
    rules: 'SU-01..SU-24',
    waiting: 'No route. Supplier payment terms drive procurement, which is not built either.',
  },
  {
    name: 'Purchasing',
    key_: 'Purchase.View',
    scope: 'organization',
    doc: 'procurement-domain.md',
    does: 'Requisition, purchase order, goods receipt, invoice, the three-way match, purchase return and supplier payment.',
    rules: 'PR-Q01..PR-Q40, SM-22..SM-31',
    waiting: 'No route. Approval of an order is a decision the owner has not settled (OQ-025).',
  },
  {
    name: 'Reports',
    key_: 'Report.View',
    scope: 'organization',
    doc: 'reporting-domain.md',
    does: 'Sales, inventory and financial reporting, with export as a separate audited step.',
    rules: 'BI-01..BI-45, report rules index',
    waiting: 'No route. Margin and cost reports need the costing decision that is still open (OQ-025).',
  },
  {
    name: 'Approvals',
    // No `Approval.*` key exists in the catalogue, so this opens with the key that owns approval thresholds.
    key_: 'Config.Organization',
    scope: 'organization',
    doc: 'approval-workflows.md',
    does: 'A request, a limit, an approver, a decision recorded as an audit event carrying before and after.',
    rules: 'AP-01..AP-14, RT-385',
    waiting:
      'No route, and no `Approval.*` key: the catalogue has none, so this area opens with `Config.Organization`, which owns approval thresholds. Four specific approval workflows are named as open (OQ-025).',
  },
  {
    name: 'Attendance',
    key_: 'Attendance.View',
    scope: 'store',
    doc: 'time-and-attendance-domain.md',
    does: 'Shifts clocked in and out, late and absent, and a correction that an approver signs.',
    rules: 'TA-01..TA-30, AC-01',
    waiting: 'No route. Clock-in needs a device that does not exist, and the correction rule is not settled (OQ-025).',
  },
  {
    name: 'Notifications',
    key_: 'Config.NotificationRule',
    scope: 'organization',
    doc: 'notification-domain.md',
    does: 'What generates a notification, who receives it, the channels, and the inbox. A notification is not a message.',
    rules: 'NT-01..NT-20',
    waiting: 'No route. Routing rules need the provider decision (OQ-020).',
  },
  {
    name: 'Audit trail',
    key_: 'Audit.View',
    scope: 'organization',
    doc: 'audit-domain.md',
    does: 'The read side of the audit trail: who did what, when, from where, under which role.',
    rules: 'AU-01..AU-30, AP-11',
    waiting: 'Events are written and immutable, but there is no route that reads them back for a person.',
  },
  {
    name: 'Stock counts and transfers',
    key_: 'Inventory.Count.Create',
    scope: 'store',
    doc: 'inventory-domain.md',
    does: 'A counted stock document, and a transfer of stock between stores with dispatch and receipt.',
    rules: 'IV-19..IV-45, SM-70..SM-79',
    waiting: 'No route. Corrections and opening balances are built; a counted sheet and a transfer are not.',
  },
  {
    name: 'Batches and expiry',
    // The catalogue has no batch or quarantine key; `Inventory.FEFO.Override` is the FEFO one that exists.
    key_: 'Inventory.FEFO.Override',
    scope: 'store',
    doc: 'batch-expiry-fefo.md',
    does: 'Batch and expiry tracking, First Expiry First Out allocation, quarantine, and the expiry write-off.',
    rules: 'BE-01..BE-45, IV-04',
    waiting: 'No route. Quarantine and Blocked have no permission key in the catalogue at all (architecture §23).',
  },
  {
    name: 'Offline till',
    key_: 'Sale.OfflineQueue.Manage',
    scope: 'store',
    doc: 'offline-pos-domain.md',
    does: 'Trading while the connection is down, with the cached data it needs and a queue that reconciles on return.',
    rules: 'OF-01..OF-48, SM-65',
    waiting: 'No route. Nothing about the offline boundary has been decided (OQ-020).',
  },
  {
    name: 'RFID',
    key_: 'Rfid.View',
    scope: 'store',
    doc: 'rfid-domain.md',
    does: 'Tags and credentials, readers, events without duplicates, and the honest boundary with inventory.',
    rules: 'RF-01..RF-30',
    waiting: 'No route. Hardware is not chosen and no reader exists.',
  },
  {
    name: 'Hardware',
    // No `Hardware.*` key exists; devices are the register this product has, so the key is that one.
    key_: 'Device.View',
    scope: 'store',
    doc: 'hardware-domain.md',
    does: 'Scanners, scales, printers and receipt printers, and what each failure means for the till.',
    rules: 'HD-01..HD-20',
    waiting: 'Printing is recorded by the cashier reporting the outcome; the printer itself is not driven.',
  },
  {
    name: 'Import',
    key_: 'Import.Run',
    scope: 'organization',
    doc: 'data-import.md',
    does: 'Catalogue and stock import, dry run first, row identity preserved, never a silent overwrite.',
    rules: 'PR-51..PR-55, IV-13, IV-51',
    waiting: 'No route. Opening stock is the one import path that exists, as a manual document.',
  },
  {
    name: 'Backup and restore',
    key_: 'Config.Backup',
    scope: 'organization',
    doc: 'backup-and-recovery.md',
    does: 'The backup policy, retention, and the restore path. Restore is the most dangerous permission in the product.',
    rules: 'AU-21, OF-45',
    waiting: 'No route, and deliberately no recovery numbers: RPO and RTO are the owner to give (D-13, GAP-038).',
  },
  {
    name: 'Discounts',
    key_: 'Discount.View',
    scope: 'organization',
    doc: 'payment-domain.md, sales-pos-domain.md',
    does: 'A discount applied at the till and its authorisation, at a level above the cashier.',
    rules: 'Sale and payment discount rules; PY-28..PY-36',
    waiting: 'No route. The seeded catalogue carries both `Discount.Apply` and `Sale.Discount` for one thing (OQ-025).',
  },
  {
    name: 'Clock and calendar',
    key_: 'Config.Store',
    scope: 'store',
    doc: 'cash-management.md, multi-store-domain.md',
    does: 'The trading calendar, and the business date a document is stamped with rather than the wall clock.',
    rules: 'CD-01..CD-30, MS-01..MS-20',
    waiting: 'Business dates are used by every built document, but no calendar is editable and no clock override exists.',
  },
];

/**
 * One area the specification requires and this build does not have. It says what the area is, what it would do, and what
 * is holding it, in that order, so nobody mistakes an unbuilt screen for a broken one.
 */
export function NotYet({ area }: { area: Planned }) {
  return (
    <section className="panel" aria-labelledby="notyet-title">
      <h1 id="notyet-title">{area.name}</h1>
      <p className="warning" role="note">
        <span aria-hidden="true">◐ </span>
        This part of SmartStore is specified but not built yet. Nothing here can be entered or changed, and nothing has
        gone wrong with your request.
      </p>
      <h2>What it is for</h2>
      <p>{area.does}</p>
      <h2>What has to hold for it</h2>
      <p>
        {area.rules} — specified in <code>docs/product/{area.doc}</code>.
      </p>
      <h2>Why it is not here yet</h2>
      <p>{area.waiting}</p>
      <p className="hint">
        The area is listed because the specification requires it and your permissions cover it. It is not a stub that
        pretends to work: a screen that takes input and loses it would be worse than one that says so.
      </p>
    </section>
  );
}
