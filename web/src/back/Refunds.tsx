import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api, ApiError } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { formatMoney, parseMoney, type Currency } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

/**
 * Refunds: money going back, for a sale (`RR-01`) or, since owner decision D-18, for a captured card payment that never
 * became one (`PY-37`). The screen speaks the server's contract exactly (D5 §10 to §14) and decides nothing the server
 * decides: the bounds (`RR-03`, `PY-22`), the tax (`RR-06`), the approver (`BI-26`), the till that pays a drawer refund
 * (D-17) and the hold (`RR-24`) are the database's, and a refusal is said in place with its next step (`UX-55`, `UX-57`).
 *
 * The keys are the server's, and each act is offered only to someone who holds its key (`UX-05`, `UX-08`):
 * - reading is `Refund.View`; drafting, submitting, withdrawing, cancelling and retrying are `Sale.Refund`;
 * - approving is `Sale.Refund.Large.Approve`; paying is `Refund.Pay`;
 * - looking up the sale, its returns and the payments with no sale are `Sale.View`, `Return.View` and `Payment.View`.
 */

interface RefundRow {
  id: string;
  documentNumber: number;
  saleDocumentNumber: number | null;
  returnId: string | null;
  status: string;
  disbursement: string;
  amount: number;
  currencyCode: string;
  simulated: boolean;
  createdAt: string;
}

export interface RefundDoc {
  id: string;
  documentNumber: number;
  saleId: string | null;
  returnId: string | null;
  paymentId: string | null;
  status: string;
  method: string;
  disbursement: string;
  amount: number;
  taxAmount: number;
  currencyCode: string;
  providerOutcome: string | null;
  simulated: boolean;
  lines: { id: string; saleLineId: string; amount: number; taxAmount: number }[];
}

interface SaleLine {
  saleLineId: string;
  lineNumber: number;
  description: string;
  quantity: string;
  returnedQuantity: string;
  settledAmount: number;
  refundedAmount: number;
}

interface SalePayment {
  paymentId: string;
  methodType: string;
  amount: number;
  simulated: boolean;
}

interface SaleDetail {
  saleId: string;
  documentNumber: number;
  lines: SaleLine[];
  payments: SalePayment[];
}

interface Reason {
  id: string;
  name: string;
}

interface PostedReturn {
  id: string;
  documentNumber: number;
}

interface Orphan {
  paymentId: string;
  kind: string;
  amount: number;
  currencyCode: string;
  ageMinutes: number;
  simulated: boolean | null;
  heldBack: number;
  givenBack: number;
}

const STATUS: Record<string, Look> = {
  Draft: ['counting', '◐', 'Draft'],
  PendingApproval: ['counting', '◐', 'Waiting for approval'],
  Approved: ['open', '●', 'Approved, not paid'],
  Processing: ['counting', '◐', 'Being paid'],
  Completed: ['open', '●', 'Paid'],
  Failed: ['none', '○', 'Failed'],
  Cancelled: ['none', '○', 'Cancelled'],
};

const operation = (): string => crypto.randomUUID();
const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
/** "12.50" for 1250 at two decimals, to be typed back through `parseMoney` (`ADR-04`). */
const typed = (amount: number, exponent: number): string => (amount / 10 ** exponent).toFixed(exponent);
const how = (disbursement: string) => (disbursement === 'Drawer' ? 'Cash from the drawer' : 'To the card');
const SIMULATED = 'Simulated card gateway: no real money moved.';

/**
 * `startFromReturn` opens the form for a refund of a posted return (`RR-01`). `atTill` is whether this is a till: a cash
 * refund goes out of one till's drawer, so it is drafted and paid at that till (`PY-27`, D-17), and away from a till only a
 * refund to a card can be drafted or paid.
 */
export function Refunds({
  storeId,
  permissions,
  currency,
  atTill = false,
  startFromReturn = null,
  startFromPayment = null,
  onStarted,
}: {
  storeId: string;
  permissions: string[];
  currency: Currency;
  atTill?: boolean;
  startFromReturn?: string | null;
  /** Opens the refund of a captured card payment with no sale on this payment (D-18), from the report of payments to check. */
  startFromPayment?: string | null;
  onStarted?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<'sale' | 'payment' | null>(startFromReturn !== null ? 'sale' : startFromPayment !== null ? 'payment' : null);
  const can = (key: string) => permissions.includes(key);
  useEffect(() => {
    if (startFromReturn !== null) setCreating('sale');
    else if (startFromPayment !== null) setCreating('payment');
  }, [startFromReturn, startFromPayment]);

  if (open !== null) {
    return <RefundDetail storeId={storeId} refundId={open} permissions={permissions} currency={currency} atTill={atTill} onBack={() => setOpen(null)} />;
  }
  if (creating === 'sale') {
    return (
      <FromSale
        storeId={storeId}
        currency={currency}
        atTill={atTill}
        returnId={startFromReturn}
        canSeeReturns={can('Return.View')}
        onBack={() => (setCreating(null), onStarted?.())}
        onMade={(id) => (setCreating(null), onStarted?.(), setOpen(id))}
      />
    );
  }
  if (creating === 'payment') {
    return (
      <FromPayment
        storeId={storeId}
        currency={currency}
        preselect={startFromPayment}
        onBack={() => (setCreating(null), onStarted?.())}
        onMade={(id) => (setCreating(null), onStarted?.(), setOpen(id))}
      />
    );
  }
  return <RefundList storeId={storeId} currency={currency} canDraft={can('Sale.Refund')} canSeePayments={can('Payment.View')} onOpen={setOpen} onCreate={setCreating} />;
}

function RefundList({
  storeId,
  currency,
  canDraft,
  canSeePayments,
  onOpen,
  onCreate,
}: {
  storeId: string;
  currency: Currency;
  canDraft: boolean;
  canSeePayments: boolean;
  onOpen: (id: string) => void;
  onCreate: (mode: 'sale' | 'payment') => void;
}) {
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<RefundRow[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const load = (after: number | null) =>
    api<{ items: RefundRow[]; next: number | null }>('GET', `/stores/${storeId}/refunds?limit=50${filter === '' ? '' : `&status=${filter}`}${after === null ? '' : `&after=${after}`}`).then(
      (r) => {
        setRows((current) => (after === null || current === null ? r.items : [...current, ...r.items]));
        setNext(r.next);
        setProblem(null);
      },
      (e: unknown) => setProblem(problemOf(e)),
    );
  useEffect(() => {
    setRows(null);
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, filter]);

  return (
    <section className="panel" aria-labelledby="refunds-title">
      <h1 id="refunds-title">Refunds</h1>
      {canDraft && (
        <div className="actions">
          <button type="button" className="primary" autoFocus onClick={() => onCreate('sale')}>
            Refund a sale
          </button>
          {canSeePayments && (
            <button type="button" onClick={() => onCreate('payment')}>
              Refund a card payment with no sale
            </button>
          )}
        </div>
      )}
      <label>
        Show
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All refunds</option>
          <option value="Draft">Drafts</option>
          <option value="PendingApproval">Waiting for approval</option>
          <option value="Approved">Approved, not paid</option>
          <option value="Processing">Being paid</option>
          <option value="Failed">Failed</option>
          <option value="Completed">Paid</option>
          <option value="Cancelled">Cancelled</option>
        </select>
      </label>
      <ProblemNotice problem={problem} />
      {rows === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <p>No refunds to show.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Refund</th>
              <th scope="col">For</th>
              <th scope="col">Status</th>
              <th scope="col">Paid</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col">Date</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.documentNumber}</td>
                <td>{r.saleDocumentNumber === null ? 'A card payment, no sale' : `Sale ${r.saleDocumentNumber}`}</td>
                <td>
                  <StatusChip status={r.status} looks={STATUS} />
                </td>
                <td>
                  {how(r.disbursement)}
                  {r.simulated && (
                    <>
                      <br />
                      <span className="hint">Simulated</span>
                    </>
                  )}
                </td>
                <td className="num">{formatMoney(r.amount, r.currencyCode, currency.exponent)}</td>
                <td>{when(r.createdAt)}</td>
                <td>
                  <button type="button" onClick={() => onOpen(r.id)} aria-label={`Open refund ${r.documentNumber}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next !== null && (
        <button type="button" onClick={() => void load(next)}>
          Show more
        </button>
      )}
    </section>
  );
}

/** What is left to refund of a line: what it settled, less what refunds hold of it (`RR-03`, `PY-22`). The server holds the atomic bound. */
const remainingOf = (line: SaleLine): number => line.settledAmount - line.refundedAmount;

/** A refund of a sale: its lines with what each can still give back, and where the money goes (`RR-22`, `RR-35`). */
function FromSale({
  storeId,
  currency,
  atTill,
  returnId,
  canSeeReturns,
  onBack,
  onMade,
}: {
  storeId: string;
  currency: Currency;
  atTill: boolean;
  returnId: string | null;
  canSeeReturns: boolean;
  onBack: () => void;
  onMade: (id: string) => void;
}) {
  const [number, setNumber] = useState('');
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [returns, setReturns] = useState<PostedReturn[]>([]);
  const [linked, setLinked] = useState<string>(returnId ?? '');
  const [covered, setCovered] = useState<Record<string, string> | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [tender, setTender] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const attempt = useRef(operation());
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);

  const load = async (saleId: string) => {
    const s = await api<SaleDetail>('GET', `/stores/${storeId}/sales/${saleId}`);
    setSale(s);
    if (canSeeReturns) {
      const r = await api<{ items: PostedReturn[] }>('GET', `/stores/${storeId}/returns?saleId=${saleId}&status=Posted`).catch(() => ({ items: [] }));
      setReturns(r.items);
    }
    setAmounts({});
  };

  useEffect(() => {
    api<{ items: Reason[] }>('GET', '/reason-codes').then((r) => setReasons(r.items), () => undefined);
    if (returnId !== null) {
      // A refund of a posted return starts from the return: its sale is the return's (`RR-01`).
      api<{ saleId: string }>('GET', `/stores/${storeId}/returns/${returnId}`).then((d) => load(d.saleId), (e: unknown) => setProblem(problemOf(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, returnId]);

  // A refund for a return pays only the lines that return took back (`SS051`): which they are comes from the return.
  useEffect(() => {
    if (linked === '') return setCovered(null);
    api<{ lines: { saleLineId: string; quantity: string }[] }>('GET', `/stores/${storeId}/returns/${linked}`).then(
      (d) => setCovered(Object.fromEntries(d.lines.map((l) => [l.saleLineId, l.quantity]))),
      (e: unknown) => setProblem(problemOf(e)),
    );
  }, [storeId, linked]);

  const find = async (event: FormEvent) => {
    event.preventDefault();
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) return setProblem(check('Enter the number of the sale, for example 1042.'));
    try {
      const found = await api<{ items: { saleId: string; documentNumber: number }[] }>('GET', `/stores/${storeId}/sales?limit=1&after=${n + 1}`);
      const hit = found.items[0];
      if (hit === undefined || hit.documentNumber !== n) return setProblem(check(`This store has no sale numbered ${n}. Check the number on the receipt.`));
      setProblem(null);
      await load(hit.saleId);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };

  if (sale === null) {
    return (
      <section className="panel narrow" aria-labelledby="from-sale-title">
        <button type="button" className="quiet" onClick={onBack}>
          Back to refunds
        </button>
        <h1 id="from-sale-title">Refund a sale</h1>
        {returnId === null ? (
          <form onSubmit={find}>
            <label>
              Sale number
              <input autoFocus inputMode="numeric" autoComplete="off" value={number} onChange={(e) => (setNumber(e.target.value), setProblem(null))} />
            </label>
            <button type="submit" className="primary">
              Find the sale
            </button>
          </form>
        ) : (
          problem === null && <p role="status">Loading the return…</p>
        )}
        <ProblemNotice problem={problem} />
      </section>
    );
  }

  const lines = sale.lines.filter((l) => remainingOf(l) > 0 && (covered === null || covered[l.saleLineId] !== undefined));
  const toggle = (line: SaleLine, on: boolean) =>
    setAmounts((current) => {
      const { [line.saleLineId]: _dropped, ...rest } = current;
      return on ? { ...rest, [line.saleLineId]: typed(remainingOf(line), currency.exponent) } : rest;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = Object.entries(amounts);
    if (chosen.length === 0) return setProblem(check('Choose at least one item to refund.'));
    const parsed: { saleLineId: string; amount: number }[] = [];
    for (const [saleLineId, text] of chosen) {
      const line = sale.lines.find((l) => l.saleLineId === saleLineId)!;
      const amount = parseMoney(text, currency.exponent);
      if (amount === null || amount < 1) return setProblem(check(`Enter the amount to refund for ${line.description}, with at most ${currency.exponent} decimal places.`));
      // The most is what the server works out; the person may only reduce it (RR-03).
      if (amount > remainingOf(line)) return setProblem(check(`Only ${money(remainingOf(line))} of ${line.description} can still be refunded.`));
      parsed.push({ saleLineId, amount });
    }
    if (tender === '') return setProblem(check('Choose where the money goes.'));
    if (linked === '' && reasonCodeId === '') return setProblem(check('A refund with no return needs a reason. Choose one.'));
    const body = {
      clientOperationId: attempt.current,
      saleId: sale.saleId,
      ...(linked === '' ? {} : { returnId: linked }),
      ...(reasonCodeId === '' ? {} : { reasonCodeId }),
      ...(tender === 'cash' ? { method: 'Cash' } : { method: 'OriginalTender', paymentId: tender }),
      lines: parsed,
    };
    try {
      const made = await api<{ id: string }>('POST', `/stores/${storeId}/refunds`, body);
      attempt.current = operation();
      onMade(made.id);
    } catch (e) {
      if (e instanceof ApiError && typeof e.details.remaining === 'string') {
        setProblem(check(`Only ${money(Number(e.details.remaining))} of that line can still be refunded. Reduce the amount.`));
      } else setProblem(problemOf(e));
    }
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby="from-sale-title">
      <button type="button" className="quiet" onClick={onBack}>
        Back to refunds
      </button>
      <h1 id="from-sale-title">Refund sale {sale.documentNumber}</h1>
      {canSeeReturns && returns.length > 0 && (
        <label>
          For a return
          <select value={linked} onChange={(e) => (setLinked(e.target.value), setAmounts({}))}>
            <option value="">No return: a refund on its own</option>
            {returns.map((r) => (
              <option key={r.id} value={r.id}>
                Return {r.documentNumber}
              </option>
            ))}
          </select>
        </label>
      )}
      {lines.length === 0 ? (
        <p>Nothing on this sale can still be refunded{linked === '' ? '' : ' for that return'}.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">What can be refunded</caption>
          <thead>
            <tr>
              <th scope="col">Refund</th>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Most it can still be refunded
              </th>
              <th scope="col">Amount ({currency.code})</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const on = amounts[l.saleLineId] !== undefined;
              return (
                <tr key={l.saleLineId}>
                  <td>
                    <input type="checkbox" checked={on} onChange={(e) => toggle(l, e.target.checked)} aria-label={`Refund ${l.description}`} />
                  </td>
                  <td>
                    {l.lineNumber}. {l.description}
                    {covered !== null && <span className="hint"> Returned {trimQuantity(covered[l.saleLineId] ?? '0')} of {trimQuantity(l.quantity)}</span>}
                  </td>
                  <td className="num">{money(remainingOf(l))}</td>
                  <td>
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={!on}
                      value={amounts[l.saleLineId] ?? ''}
                      aria-label={`Amount to refund for ${l.description}`}
                      onChange={(e) => setAmounts({ ...amounts, [l.saleLineId]: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <label>
        Where the money goes
        <select value={tender} onChange={(e) => setTender(e.target.value)}>
          <option value="">Choose…</option>
          {sale.payments.map((p) => {
            const cash = p.methodType === 'Cash';
            return (
              <option key={p.paymentId} value={p.paymentId} disabled={cash && !atTill}>
                Back to the {cash ? 'cash' : 'card'} payment of {money(p.amount)}
                {p.simulated ? ' (simulated)' : ''}
                {cash && !atTill ? ' (needs a till)' : ''}
              </option>
            );
          })}
          <option value="cash" disabled={!atTill}>
            Cash from the drawer{atTill ? '' : ' (needs a till)'}
          </option>
        </select>
      </label>
      {!atTill && <p className="hint">A cash refund goes out of one till&rsquo;s drawer, so it is drafted and paid at that till.</p>}
      <label>
        Reason{linked === '' ? ' (required)' : ''}
        <select value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
          <option value="">Choose a reason…</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="primary" disabled={lines.length === 0}>
        Draft the refund
      </button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

const trimQuantity = (quantity: string): string => (quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity);

/** A refund of a card payment that never became a sale (D-18): money taken for nothing, given back to the card (`PY-37`). */
function FromPayment({
  storeId,
  currency,
  preselect,
  onBack,
  onMade,
}: {
  storeId: string;
  currency: Currency;
  preselect: string | null;
  onBack: () => void;
  onMade: (id: string) => void;
}) {
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [chosen, setChosen] = useState<Orphan | null>(null);
  const [amount, setAmount] = useState('');
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const attempt = useRef(operation());
  const money = (value: number) => formatMoney(value, currency.code, currency.exponent);

  useEffect(() => {
    // Every payment taken with no sale, however recently: how long is too long is not this screen's to say (OQ-037).
    api<{ items: Orphan[] }>('GET', `/stores/${storeId}/payments/attention?olderThanMinutes=0&limit=200`).then(
      (r) => {
        const found = r.items.filter((o) => o.kind === 'CapturedNoSale');
        setOrphans(found);
        // Arriving from the report with a payment in mind: it is chosen, or the person is told it is no longer waiting.
        const wanted = preselect === null ? undefined : found.find((o) => o.paymentId === preselect);
        if (wanted !== undefined) {
          setChosen(wanted);
          setAmount(typed(wanted.amount - wanted.heldBack, currency.exponent));
        } else if (preselect !== null) setProblem(check('That payment is not waiting without a sale any more. Choose another, or go back.'));
      },
      (e: unknown) => (setProblem(problemOf(e)), setOrphans([])),
    );
    api<{ items: Reason[] }>('GET', '/reason-codes').then((r) => setReasons(r.items), () => undefined);
  }, [storeId]);

  // What the payment can still give back: what it took, less what refunds hold of it (`PY-22`).
  const left = (o: Orphan) => o.amount - o.heldBack;
  const choose = (o: Orphan) => (setChosen(o), setAmount(typed(left(o), currency.exponent)), setProblem(null));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (chosen === null) return;
    const value = parseMoney(amount, currency.exponent);
    if (value === null || value < 1) return setProblem(check(`Enter the amount to give back, with at most ${currency.exponent} decimal places.`));
    if (value > left(chosen)) return setProblem(check(`Only ${money(left(chosen))} of that payment can still be given back.`));
    if (reasonCodeId === '') return setProblem(check('A refund of a payment with no sale needs a reason. Choose one.'));
    try {
      const made = await api<{ id: string }>('POST', `/stores/${storeId}/refunds`, { clientOperationId: attempt.current, method: 'OriginalTender', paymentId: chosen.paymentId, amount: value, reasonCodeId });
      attempt.current = operation();
      onMade(made.id);
    } catch (e) {
      if (e instanceof ApiError && typeof e.details.remaining === 'string') setProblem(check(`Only ${money(Number(e.details.remaining))} of that payment can still be given back.`));
      else setProblem(problemOf(e));
    }
  };

  return (
    <section className="panel" aria-labelledby="from-payment-title">
      <button type="button" className="quiet" onClick={onBack}>
        Back to refunds
      </button>
      <h1 id="from-payment-title">Refund a card payment with no sale</h1>
      <p className="lede">The card was charged and the sale was never saved. Giving the money back needs a second person to approve it, as any refund does.</p>
      <ProblemNotice problem={problem} />
      {chosen === null ? (
        orphans === null ? (
          <p role="status">Loading…</p>
        ) : orphans.length === 0 ? (
          <p>No card payment is waiting without a sale.</p>
        ) : (
          <table className="records">
            <caption className="visually-hidden">Card payments with no sale</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  Taken
                </th>
                <th scope="col" className="num">
                  Can still go back
                </th>
                <th scope="col">Waiting</th>
                <th scope="col">
                  <span className="visually-hidden">Choose</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((o) => (
                <tr key={o.paymentId}>
                  <td className="num">
                    {money(o.amount)}
                    {o.simulated === true && (
                      <>
                        <br />
                        <span className="hint">Simulated</span>
                      </>
                    )}
                  </td>
                  <td className="num">{money(left(o))}</td>
                  <td>{o.ageMinutes} min</td>
                  <td>
                    <button type="button" disabled={left(o) < 1} onClick={() => choose(o)} aria-label={`Refund the payment of ${money(o.amount)}`}>
                      Refund this
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <form onSubmit={submit} aria-label="Refund this payment">
          <p>
            Payment of {money(chosen.amount)}. It can still give back {money(left(chosen))}.
          </p>
          <label>
            Amount to give back ({currency.code})
            <input autoFocus inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Reason (required)
            <select value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
              <option value="">Choose a reason…</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary">
            Draft the refund
          </button>
        </form>
      )}
    </section>
  );
}

function RefundDetail({
  storeId,
  refundId,
  permissions,
  currency,
  atTill,
  onBack,
}: {
  storeId: string;
  refundId: string;
  permissions: string[];
  currency: Currency;
  atTill: boolean;
  onBack: () => void;
}) {
  const [doc, setDoc] = useState<RefundDoc | null>(null);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  const can = (key: string) => permissions.includes(key);
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);

  const reload = async () => {
    try {
      const d = await api<RefundDoc>('GET', `/stores/${storeId}/refunds/${refundId}`);
      setDoc(d);
      if (d.saleId !== null && can('Sale.View')) setSale(await api<SaleDetail>('GET', `/stores/${storeId}/sales/${d.saleId}`));
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  useEffect(() => {
    void reload();
    api<{ items: Reason[] }>('GET', '/reason-codes').then((r) => setReasons(r.items), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, refundId]);

  if (doc === null) {
    return (
      <section className="panel">
        <button type="button" onClick={onBack}>
          Back to refunds
        </button>
        {problem === null ? <p role="status">Loading…</p> : <ProblemNotice problem={problem} />}
      </section>
    );
  }

  /** One act against the server, answered in place. A card refund the provider fails or leaves open is a state to show, not only an error (`SM-41`, `PY-11`). */
  const act = async (run: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try {
      await run();
      await reload();
      setSaid(done);
    } catch (e) {
      setProblem(problemOf(e));
      if (e instanceof ApiError && (e.code === 'refund_failed' || e.code === 'refund_pending')) await reload();
    }
  };
  const transition = (event: string, extra: object = {}) => api('POST', '/transitions', { machine: 'Refund', event, subject: doc.id, ...extra });
  const card = doc.disbursement === 'Provider';
  const describe = (saleLineId: string) => {
    const l = sale?.lines.find((x) => x.saleLineId === saleLineId);
    return l === undefined ? 'An item of the sale' : `${l.lineNumber}. ${l.description}`;
  };
  const issuer = can('Sale.Refund');

  return (
    <section className="panel" aria-labelledby="refund-title">
      <button type="button" className="quiet" onClick={onBack}>
        Back to refunds
      </button>
      <h1 id="refund-title">
        Refund {doc.documentNumber}
        {sale !== null && ` of sale ${sale.documentNumber}`}
        {doc.saleId === null && ' of a card payment with no sale'}
      </h1>
      <Announcer text={said} />
      <p>
        <StatusChip status={doc.status} looks={STATUS} /> <span className="hint">{how(doc.disbursement)}</span>
      </p>
      {doc.simulated && (
        <p className="notice" data-tone="info" role="note">
          <span className="symbol" aria-hidden="true">
            ⓘ
          </span>
          {SIMULATED}
        </p>
      )}
      <dl className="figures">
        <dt>Amount</dt>
        <dd className="money">{money(doc.amount)}</dd>
        {doc.taxAmount > 0 && (
          <>
            <dt>Of which tax</dt>
            <dd className="money">{money(doc.taxAmount)}</dd>
          </>
        )}
      </dl>
      <ProblemNotice problem={problem} />
      {doc.status === 'Failed' && (
        <p role="note" className="problem" data-kind="user">
          The provider could not pay this refund. The money is still held for it: retry it, or cancel it with a reason to release it.
        </p>
      )}
      {doc.status === 'Processing' && card && (
        <p role="note" className="problem" data-kind="user">
          The provider has not confirmed this refund. Do not refund it again: pay it again to ask the provider what it holds.
        </p>
      )}

      {doc.lines.length > 0 && (
        <table className="records">
          <caption className="visually-hidden">What this refund pays back</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" className="num">
                Tax
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td>{describe(l.saleLineId)}</td>
                <td className="num">{money(l.amount)}</td>
                <td className="num">{money(l.taxAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="actions">
        {doc.status === 'Draft' && issuer && (
          <button type="button" className="primary" onClick={() => void act(() => transition('submit'), `Refund ${doc.documentNumber} sent for approval.`)}>
            Send for approval
          </button>
        )}
        {doc.status === 'PendingApproval' && can('Sale.Refund.Large.Approve') && (
          <button type="button" className="primary" onClick={() => void act(() => transition('approve'), `Refund ${doc.documentNumber} approved.`)}>
            Approve
          </button>
        )}
        {doc.status === 'Approved' && can('Refund.Pay') && (
          <PayButton
            card={card}
            atTill={atTill}
            label="Pay the refund"
            onPay={() =>
              act(() => (card ? api('POST', `/stores/${storeId}/refunds/${doc.id}/pay`) : transition('submit to provider')), `Refund ${doc.documentNumber} paid.`)
            }
          />
        )}
        {doc.status === 'Processing' && card && can('Refund.Pay') && (
          <button type="button" className="primary" onClick={() => void act(() => api('POST', `/stores/${storeId}/refunds/${doc.id}/pay`), `Refund ${doc.documentNumber} checked with the provider.`)}>
            Pay again to check with the provider
          </button>
        )}
        {doc.status === 'Failed' && issuer && (
          <button type="button" className="primary" onClick={() => void act(() => api('POST', `/stores/${storeId}/refunds/${doc.id}/retry`), `Refund ${doc.documentNumber} retried.`)}>
            Retry
          </button>
        )}
      </div>
      {doc.status === 'PendingApproval' && !can('Sale.Refund.Large.Approve') && <p className="hint">Someone other than the person who sent it must approve this refund.</p>}
      {doc.status === 'Approved' && card === false && can('Refund.Pay') && !atTill && <p className="hint">A cash refund is paid at the till it was drafted at.</p>}

      {issuer && ['Draft', 'Approved', 'Processing', 'Failed'].includes(doc.status) && (
        <Reasoned
          label={doc.status === 'Draft' ? 'Withdraw this draft' : 'Cancel this refund'}
          button={doc.status === 'Draft' ? 'Withdraw the draft' : 'Cancel the refund'}
          note={doc.status === 'Failed' || doc.status === 'Processing' ? 'Cancelling releases the money held for it.' : null}
          reasons={reasons}
          onSubmit={(reasonCodeId) => act(() => transition('cancel', { reasonCodeId }), doc.status === 'Draft' ? `Refund ${doc.documentNumber} withdrawn.` : `Refund ${doc.documentNumber} cancelled.`)}
        />
      )}
    </section>
  );
}

function PayButton({ card, atTill, label, onPay }: { card: boolean; atTill: boolean; label: string; onPay: () => void | Promise<void> }) {
  // A drawer refund is paid by someone signed in at its till (D-17): away from a till the server would refuse it.
  const blocked = !card && !atTill;
  return (
    <button type="button" className="primary" disabled={blocked} onClick={() => void onPay()}>
      {label}
    </button>
  );
}

/** An act that needs a reason (`SM-42`, `BI-40`): chosen from the organization's, never typed. */
function Reasoned({ label, button, note, reasons, onSubmit }: { label: string; button: string; note: string | null; reasons: Reason[]; onSubmit: (reasonCodeId: string) => void | Promise<void> }) {
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reasonCodeId === '') return setProblem(check('Choose a reason first.'));
    setProblem(null);
    await onSubmit(reasonCodeId);
    setReasonCodeId('');
  };
  return (
    <form onSubmit={submit} aria-label={label}>
      <h2>{label}</h2>
      {note !== null && <p className="hint">{note}</p>}
      <label>
        Reason
        <select value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
          <option value="">Choose a reason…</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">{button}</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
