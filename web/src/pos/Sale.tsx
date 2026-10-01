import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api, type Sale, type Scanned } from '../lib/api.ts';
import { formatMoney, parseMoney, type Currency } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

interface Line {
  key: string;
  item: Scanned;
  quantity: number;
}

/**
 * The sale (`UX-09`): scan or type a code and press Enter, and the line appears with its price and line total; the
 * running total is always visible (`UX-10`); take the cash; the outcome says the sale number, the total and the change
 * (`UX-04`, `UX-15`, `UX-21`). The cart lives here, in the browser, until the sale is saved (ADR-31 §8), and it survives
 * every error (`UX-11`, `UX-57`). The server recomputes every amount; this total is for display only (`BI-30`).
 *
 * The payment step shows the total due, the cash given, and the change or what is still to pay, as it is typed
 * (`UX-14`, `UX-15`, `UX-17`). A refusal and a system failure are styled apart (`UX-59`). The till learns how many
 * lines the cart has, so the shift cannot be closed over a cart (`UX-57`).
 */
export function SaleScreen({ storeId, currency, onCartChange }: { storeId: string; currency: Currency; onCartChange?: (lines: number) => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [code, setCode] = useState('');
  const [cash, setCash] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  const [done, setDone] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  // One id per cart: a retried save returns the same sale, never a second (SM-04).
  const operation = useRef(crypto.randomUUID());
  const scanField = useRef<HTMLInputElement>(null);
  const cashField = useRef<HTMLInputElement>(null);
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);
  const total = lines.reduce((sum, l) => sum + l.item.price.amount * l.quantity, 0);
  // An empty cash field means the exact total (UX-01's keyboard path); text that is not an amount gives no figure.
  const given = cash.trim() === '' ? total : parseMoney(cash, currency.exponent);
  const remainder = given === null ? null : total - given;

  useEffect(() => {
    onCartChange?.(done === null ? lines.length : 0);
  }, [lines.length, done, onCartChange]);

  const refuse = (p: Problem) => {
    setProblem(p);
    setSaid(p.message);
  };

  const scan = async (event: FormEvent) => {
    event.preventDefault();
    const typed = code.trim();
    if (typed === '') {
      // Enter on an empty scan field moves to payment: the keyboard path (UX-01).
      if (lines.length > 0) cashField.current?.focus();
      return;
    }
    try {
      const item = await api<Scanned>('GET', `/stores/${storeId}/scan/${encodeURIComponent(typed)}`);
      setLines((current) => [...current, { key: crypto.randomUUID(), item, quantity: 1 }]);
      setProblem(null);
      setSaid(`Added ${item.description}, ${money(item.price.amount)}. Total ${money(total + item.price.amount)}.`);
    } catch (e) {
      // UX-11: an unknown or unsellable code is a message under the field; the cart is untouched.
      refuse(problemOf(e));
    }
    setCode('');
  };

  const setQuantity = (key: string, quantity: number) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(9999, quantity)) } : l)));
  const remove = (key: string) => setLines((current) => current.filter((l) => l.key !== key));

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    if (given === null) return refuse(check(`Enter the cash given, with at most ${currency.exponent} decimal places.`));
    // UX-17: an underpayment is named, with what to do. The server refuses one too (SP-40).
    if (remainder !== null && remainder > 0) return refuse(check(`The cash given is ${money(remainder)} short of the total due. Take more cash.`));
    setBusy(true);
    try {
      const sale = await api<Sale>('POST', `/stores/${storeId}/sales`, {
        clientOperationId: operation.current,
        lines: lines.map((l) => ({ quote: l.item.quote, quantity: l.quantity })),
        cash: { tendered: given },
      });
      setDone(sale);
      setSaid(`Sale ${sale.documentNumber} completed. Total ${money(sale.totalDue)}. Change ${money(sale.change)}.`);
    } catch (e) {
      // UX-57: the cart and the cash typed stay; the message says what to do.
      refuse(problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setDone(null);
    setLines([]);
    setCash('');
    setProblem(null);
    operation.current = crypto.randomUUID();
    setTimeout(() => scanField.current?.focus());
  };

  if (done !== null) {
    // UX-21: the outcome, and deliberately no void here.
    return (
      <section className="panel outcome" aria-labelledby="done-title">
        <h1 id="done-title">Sale {done.documentNumber} completed</h1>
        <p>
          Total {money(done.totalDue)}, cash {money(done.tendered)}
        </p>
        <p className="change">Change {money(done.change)}</p>
        <button type="button" autoFocus onClick={next}>
          Next customer
        </button>
        <Announcer text={said} />
      </section>
    );
  }

  return (
    <section className="sale">
      <form onSubmit={scan} className="scan">
        <label htmlFor="code">Scan or type a barcode, then Enter</label>
        <input id="code" ref={scanField} autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </form>
      <ProblemNotice problem={problem} />
      <table className="cart" aria-label="Cart">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Quantity</th>
            <th scope="col">Price</th>
            <th scope="col">Line total</th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} data-testid="cart-line">
              <td>{l.item.description}</td>
              <td>
                <input
                  aria-label={`Quantity of ${l.item.description}`}
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => setQuantity(l.key, Number(e.target.value) || 1)}
                />
              </td>
              <td>{money(l.item.price.amount)}</td>
              <td>{money(l.item.price.amount * l.quantity)}</td>
              <td>
                <button type="button" onClick={() => remove(l.key)} aria-label={`Remove ${l.item.description}`}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="total" aria-live="off">
        Total <strong data-testid="total">{money(total)}</strong>
      </p>
      <form onSubmit={pay} className="pay" aria-label="Payment">
        <label htmlFor="cash">Cash given (Enter for the exact total)</label>
        <input id="cash" ref={cashField} inputMode="decimal" autoComplete="off" value={cash} onChange={(e) => setCash(e.target.value)} />
        <dl className="tender" aria-label="Payment so far">
          <dt>Total due</dt>
          <dd>{money(total)}</dd>
          <dt>Cash given</dt>
          <dd>{given === null ? '—' : money(given)}</dd>
          {remainder !== null && remainder > 0 ? (
            <>
              <dt className="short">Still to pay</dt>
              <dd className="short" data-testid="still-to-pay">
                {money(remainder)}
              </dd>
            </>
          ) : (
            <>
              <dt>Change</dt>
              <dd className="change-due" data-testid="change-due">
                {remainder === null ? '—' : money(Math.max(0, -remainder))}
              </dd>
            </>
          )}
        </dl>
        <button type="submit" disabled={lines.length === 0 || busy}>
          {busy ? 'Saving…' : 'Complete cash sale'}
        </button>
      </form>
      <Announcer text={said} />
    </section>
  );
}
