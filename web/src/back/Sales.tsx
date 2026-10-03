import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { useList, when } from '../lib/form.ts';
import { formatMoney } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

interface SaleRow {
  saleId: string;
  documentNumber: number;
  businessDate: string;
  completedAt: string;
  terminalLabel: string;
  cashierName: string;
  currencyCode: string;
  totalDue: number;
  status: string;
  receiptStatus: string | null;
}

interface Sale {
  saleId: string;
  documentNumber: number;
  businessDate: string;
  completedAt: string;
  currencyCode: string;
  subtotal: number;
  taxTotal: number;
  totalDue: number;
  tendered: number;
  change: number;
  receiptStatus: string | null;
  lines: { lineNumber: number; description: string; quantity: string; unitPrice: number; lineTotal: number }[];
}

interface Receipt {
  saleId: string;
  documentNumber: number;
  businessDate: string;
  completedAt: string;
  store: { name: string; code: string; address: string; contactDetails: string };
  currencyCode: string;
  minorUnitExponent: number;
  subtotal: number;
  taxTotal: number;
  totalDue: number;
  change: number;
  receiptStatus: string | null;
  lines: { lineNumber: number; description: string; quantity: string; unitName: string; unitPrice: number; lineTotal: number }[];
  payments: { method: string; amount: number; tendered: number }[];
  reprint: { reprintedAt: string; reason: string } | null;
}

interface Reason {
  id: string;
  name: string;
}

/** An employee as `/employees` returns one: the preferred name if there is one, then the first (`EM-06`). */
interface Person {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
}

const nameOf = (p: Person) => `${p.preferredName ?? p.firstName} ${p.lastName}`;

// The filter is a list, not a search: one page, which is enough to name the cashiers who matter for a given store.
const MAX_CASHIERS = 100;

const LOOKS: Record<string, Look> = {
  Completed: ['open', '●', 'Completed'],
  Voided: ['none', '○', 'Voided'],
  Printed: ['open', '●', 'Receipt printed'],
  Failed: ['none', '○', 'Receipt failed'],
  Reprinted: ['counting', '◐', 'Receipt reprinted'],
};

/** A receipt nobody got (`SP-58`, `RT-140`) needs a reprint, and a reprint needs a reason, by the owner's instruction of 2026-10-01. */
type Said = (outcome: string) => void;

/**
 * The store's sales, newest first, a page at a time (§18.5), under `Sale.View` — "see sales, own store" (`MS-02`), so
 * nothing from another store is here. Filters: business date, till, cashier, and receipt standing, where `Failed` is the
 * reprint queue and `None` is a sale whose first print has not been reported.
 *
 * Opening a sale shows the receipt as the server renders it from the stored sale (`SP-57`), which repeats the original
 * numbers exactly because every value is the sale's own snapshot (`SP-06`, `BI-11`). A receipt carries no cost or
 * margin, because nothing that carries them is read (`SP-60`).
 */
export function Sales({ storeId, permissions, currency }: { storeId: string; permissions: string[]; currency: { code: string; exponent: number } }) {
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  if (!permissions.includes('Sale.View')) {
    return (
      <section className="panel" aria-labelledby="sales-title">
        <h1 id="sales-title">Sales</h1>
        <p>You do not have permission to see this store's sales (`UX-05`).</p>
      </section>
    );
  }
  if (open !== null) {
    return <SaleScreen storeId={storeId} saleId={open} canReprint={permissions.includes('Sale.Create')} onBack={() => setOpen(null)} onSaid={setSaid} said={said} />;
  }
  return (
    <section className="panel" aria-labelledby="sales-title">
      <h1 id="sales-title">Sales</h1>
      <Announcer text={said} />
      <Listing storeId={storeId} permissions={permissions} currency={currency} onOpen={setOpen} />
    </section>
  );
}

/**
 * The two filters whose lookups need a key of their own: tills are `Device.View` and cashiers `Employee.View`, neither of
 * which `Sale.View` implies. Without the key the filter is left out rather than offered and refused (`UX-05`).
 */
function Listing({
  storeId,
  permissions,
  currency,
  onOpen,
}: {
  storeId: string;
  permissions: string[];
  currency: { code: string; exponent: number };
  onOpen: (id: string) => void;
}) {
  const canSeeTills = permissions.includes('Device.View');
  const canSeeStaff = permissions.includes('Employee.View');
  const tills = useList<{ id: string; label: string }>(canSeeTills ? `/stores/${storeId}/terminals` : null);
  const staff = useList<Person>(
    canSeeStaff ? `/employees?limit=${MAX_CASHIERS}` : null,
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [terminalId, setTerminal] = useState('');
  const [employeeId, setEmployee] = useState('');
  const [receipt, setReceipt] = useState('');
  const [before, setBefore] = useState<number | null>(null);
  const query = new URLSearchParams({
    ...(from === '' ? {} : { from }),
    ...(to === '' ? {} : { to }),
    ...(terminalId === '' ? {} : { terminalId }),
    ...(employeeId === '' ? {} : { employeeId }),
    ...(receipt === '' ? {} : { receipt: receipt as 'Printed' | 'Failed' | 'Reprinted' | 'None' }),
    ...(before === null ? {} : { before: String(before) }),
  }).toString();
  const path = `/stores/${storeId}/sales${query === '' ? '' : `?${query}`}`;
  const { items, body, problem } = useList<SaleRow>(path);
  // Any filter change starts again from the newest sale.
  const filtered = [from, to, terminalId, employeeId, receipt];
  useEffect(() => setBefore(null), [filtered.join('|')]);

  return (
    <>
      <fieldset className="filters">
        <legend>Filter the sales</legend>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {canSeeTills && (
          <label>
            Till
            <select value={terminalId} onChange={(e) => setTerminal(e.target.value)}>
              <option value="">Every till</option>
              {(tills.items ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {canSeeStaff && (
          <label>
            Cashier
            <select value={employeeId} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">Every cashier</option>
              {(staff.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {nameOf(s)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Receipt
          <select value={receipt} onChange={(e) => setReceipt(e.target.value)}>
            <option value="">Any</option>
            <option value="None">Not yet reported</option>
            <option value="Printed">Printed</option>
            <option value="Failed">Failed — needs a reprint</option>
            <option value="Reprinted">Reprinted</option>
          </select>
        </label>
      </fieldset>
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>No sale matches that.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">This store's sales, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">When</th>
              <th scope="col">Till</th>
              <th scope="col">Cashier</th>
              <th scope="col" className="num">
                Total
              </th>
              <th scope="col">Receipt</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.saleId}>
                <td>{s.documentNumber}</td>
                <td>{when(s.completedAt)}</td>
                <td>{s.terminalLabel}</td>
                <td>{s.cashierName}</td>
                <td className="num">{formatMoney(s.totalDue, s.currencyCode, currency.exponent)}</td>
                <td>{s.receiptStatus === null ? 'Not reported' : <StatusChip status={s.receiptStatus} looks={LOOKS} />}</td>
                <td>
                  <button type="button" onClick={() => onOpen(s.saleId)} aria-label={`Open sale ${s.documentNumber}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(body?.before ?? null) !== null && (
        <div className="actions">
          <button type="button" onClick={() => setBefore(body!.before!)}>
            Show earlier sales
          </button>
        </div>
      )}
    </>
  );
}

function SaleScreen({
  storeId,
  saleId,
  canReprint,
  onBack,
  onSaid,
  said,
}: {
  storeId: string;
  saleId: string;
  canReprint: boolean;
  onBack: () => void;
  onSaid: Said;
  said: string;
}) {
  const [sale, setSale] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Bumped to read both again after a reprint or a print outcome.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setSale(null);
    api<Sale>('GET', `/stores/${storeId}/sales/${saleId}`).then(
      (s) => {
        setSale(s);
        // Reading a receipt is receipt issuance, the cashier's work: `Sale.Create`, not `Sale.View` (owner decision D-16, Q13).
        // Someone who can only see sales is not made to ask and be refused: the sale's own lines and totals are above.
        if (canReprint) api<Receipt>('GET', `/stores/${storeId}/sales/${saleId}/receipt`).then(setReceipt, (e: unknown) => setProblem(problemOf(e)));
      },
      (e: unknown) => setProblem(problemOf(e)),
    );
  }, [storeId, saleId, version]);

  const money = (amount: number) => formatMoney(amount, receipt?.currencyCode ?? sale?.currencyCode ?? 'NPR', receipt?.minorUnitExponent ?? 2);

  return (
    <section className="panel" aria-labelledby="sale-title">
      <button type="button" className="quiet" onClick={onBack}>
        Back to the sales
      </button>
      <Announcer text={said} />
      <ProblemNotice problem={problem} />
      {sale === null ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          <h1 id="sale-title">Sale {sale.documentNumber}</h1>
          <p>
            {sale.businessDate} at {when(sale.completedAt)}
            {sale.receiptStatus !== null && (
              <>
                {' '}
                · receipt <StatusChip status={sale.receiptStatus} looks={LOOKS} />
              </>
            )}
          </p>

          <h2>Lines</h2>
          <table className="records">
            <caption className="visually-hidden">Lines on this sale</caption>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col" className="num">
                  How much
                </th>
                <th scope="col" className="num">
                  Each
                </th>
                <th scope="col" className="num">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => (
                <tr key={l.lineNumber}>
                  <td>{l.description}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{money(l.unitPrice)}</td>
                  <td className="num">{money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Subtotal
                </th>
                <td className="num">{money(sale.subtotal)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Tax
                </th>
                <td className="num">{money(sale.taxTotal)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Total due
                </th>
                <td className="num">{money(sale.totalDue)}</td>
              </tr>
            </tfoot>
          </table>

          {!canReprint ? (
            <p className="hint">The receipt is read at the till, by someone who can sell (Sale.Create). The sale&rsquo;s own lines and totals are above.</p>
          ) : receipt === null ? (
            <p role="status">Loading the receipt…</p>
          ) : (
            <ReceiptView receipt={receipt} money={money} />
          )}

          {canReprint && (
            <Reprint
              storeId={storeId}
              saleId={saleId}
              onDone={(outcome) => {
                onSaid(outcome);
                setVersion((v) => v + 1);
              }}
              onProblem={setProblem}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * The receipt as the server renders it (`SP-57`, `SP-59`): the store, the number, the date, the lines with prices, the tax,
 * the total, the payments and the change. Every value is the sale's own snapshot, so a reprint years later repeats the
 * original numbers (`SP-06`, `BI-11`).
 */
function ReceiptView({ receipt, money }: { receipt: Receipt; money: (amount: number) => string }) {
  return (
    <section aria-labelledby="receipt-title">
      <h2 id="receipt-title">Receipt</h2>
      {receipt.reprint !== null && (
        <p className="warning" role="note">
          <strong>This is a reprint</strong> of {receipt.reprint.reason}, made {when(receipt.reprint.reprintedAt)}. The numbers are the
          original's.
        </p>
      )}
      <p>
        {receipt.store.name} ({receipt.store.code})
        <br />
        {receipt.store.address}
        <br />
        {receipt.store.contactDetails}
      </p>
      <p>
        Receipt {receipt.documentNumber} · {receipt.businessDate} · {when(receipt.completedAt)}
      </p>
      <table className="records">
        <caption className="visually-hidden">Receipt lines</caption>
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col" className="num">
              How much
            </th>
            <th scope="col" className="num">
              Each
            </th>
            <th scope="col" className="num">
              Line total
            </th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((l) => (
            <tr key={l.lineNumber}>
              <td>
                {l.description} <span className="hint">({l.unitName})</span>
              </td>
              <td className="num">{l.quantity}</td>
              <td className="num">{money(l.unitPrice)}</td>
              <td className="num">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              Subtotal
            </th>
            <td className="num">{money(receipt.subtotal)}</td>
          </tr>
          <tr>
            <th scope="row" colSpan={3}>
              Tax
            </th>
            <td className="num">{money(receipt.taxTotal)}</td>
          </tr>
          {receipt.payments.map((p) => (
            <tr key={p.method}>
              <th scope="row" colSpan={3}>
                {p.method} tendered
              </th>
              <td className="num">{money(p.tendered)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" colSpan={3}>
              Total due
            </th>
            <td className="num">{money(receipt.totalDue)}</td>
          </tr>
          <tr>
            <th scope="row" colSpan={3}>
              Change
            </th>
            <td className="num">{money(receipt.change)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/**
 * A reprint (`SP-57`): the original numbers exactly, under a reprint banner, so the copy and the original are told apart.
 * The reason is mandatory, and the reprint is recorded with who and when.
 */
function Reprint({ storeId, saleId, onDone, onProblem }: { storeId: string; saleId: string; onDone: Said; onProblem: (p: Problem) => void }) {
  const reasons = useList<Reason>('/reason-codes');
  const [reasonCodeId, setReason] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const reprint = async (event: FormEvent) => {
    event.preventDefault();
    if (reasonCodeId === '') return setProblem(check('Choose why this receipt is being reprinted.'));
    try {
      const copy = await api<Receipt>('POST', `/stores/${storeId}/sales/${saleId}/reprints`, { reasonCodeId });
      setProblem(null);
      onDone(`Receipt ${copy.documentNumber} was reprinted: ${copy.reprint?.reason}.`);
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={reprint} aria-labelledby="reprint-title">
      <h2 id="reprint-title">Reprint this receipt</h2>
      <p className="hint">The copy carries the original numbers with a reprint banner, so the two can never be confused.</p>
      <label>
        Why is it being reprinted?
        <select value={reasonCodeId} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {(reasons.items ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Reprint</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
