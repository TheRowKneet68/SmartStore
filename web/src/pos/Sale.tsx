import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api, ApiError, type Sale, type Scanned } from '../lib/api.ts';
import { formatMoney, type Currency } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';
import { GATEWAY_IS_SIMULATED, SIMULATED_WARNING, Tender, type Payment } from './Tender.tsx';

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
 * The payment step shows the total due, how it is paid, and the change or what is still to pay, as it is typed
 * (`UX-14`, `UX-15`, `UX-17`). A refusal and a system failure are styled apart (`UX-59`). The till learns how many
 * lines the cart has, so the shift cannot be closed over a cart (`UX-57`).
 *
 * A card is taken only by someone holding `Payment.Capture` (D-16 Q2), through the simulated gateway (ADR-31 §13), alone or for
 * part of the total with cash for the rest (`PY-16`). A card payment is resumable by the cart's operation id (`PY-39`): a
 * decline, a failure, a void or a refund ends that attempt, and the cart is kept for another (`SP-43`), under a new id; a
 * timeout, a capture that did not go through, or money taken with the sale not saved is **the same sale sent again**, never a
 * second charge, so the cart and the tender are fixed until it is settled. Voiding a payment that is not settled is
 * `Payment.Void`, and finding it on the report is `Payment.View`.
 */
export function SaleScreen({
  storeId,
  currency,
  onCartChange,
  permissions = [],
}: {
  storeId: string;
  currency: Currency;
  onCartChange?: (lines: number) => void;
  permissions?: string[];
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [code, setCode] = useState('');
  // Finding an item by name: what was typed, and what this store sells by that name (null before a search).
  const [name, setName] = useState('');
  const [found, setFound] = useState<Scanned[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  const [done, setDone] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  // A card payment in flight: the same sale is sent again until it is settled (PY-39). `kind` says what is wrong with it.
  const [resume, setResume] = useState<'pending' | 'captured' | null>(null);
  // One id per cart: a retried save returns the same sale, never a second (SM-04).
  const operation = useRef(crypto.randomUUID());
  const scanField = useRef<HTMLInputElement>(null);
  const cashField = useRef<HTMLInputElement | null>(null);
  const canCard = permissions.includes('Payment.Capture');
  const canVoid = permissions.includes('Payment.Void') && permissions.includes('Payment.View');
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);
  const total = lines.reduce((sum, l) => sum + l.item.price.amount * l.quantity, 0);

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
      add(await api<Scanned>('GET', `/stores/${storeId}/scan/${encodeURIComponent(typed)}`));
    } catch (e) {
      // UX-11: an unknown or unsellable code is a message under the field; the cart is untouched.
      refuse(problemOf(e));
    }
    setCode('');
  };

  const add = (item: Scanned) => {
    setLines((current) => [...current, { key: crypto.randomUUID(), item, quantity: 1 }]);
    setProblem(null);
    setSaid(`Added ${item.description}, ${money(item.price.amount)}. Total ${money(total + item.price.amount)}.`);
  };

  // UX-48: a name is looked up by name only, never as a barcode. The server answers with at most a short list of what
  // this store sells (UX-49), each with its own quote; the cart is untouched whatever the answer.
  const findByName = async (event: FormEvent) => {
    event.preventDefault();
    const typed = name.trim();
    if (typed === '') return;
    try {
      const { items } = await api<{ items: Scanned[] }>('GET', `/stores/${storeId}/items?name=${encodeURIComponent(typed)}`);
      setFound(items);
      setProblem(null);
      setSaid(items.length === 0 ? `Nothing on sale here has ${typed} in its name.` : `${items.length} found. Choose one to add it.`);
    } catch (e) {
      refuse(problemOf(e));
    }
  };

  const choose = (item: Scanned) => {
    add(item);
    setFound(null);
    setName('');
    // Back to the scan field, the keyboard path (UX-01).
    setTimeout(() => scanField.current?.focus());
  };

  const setQuantity = (key: string, quantity: number) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(9999, quantity)) } : l)));
  const remove = (key: string) => setLines((current) => current.filter((l) => l.key !== key));

  const pay = async (payment: Payment) => {
    setBusy(true);
    try {
      const sale = await api<Sale>('POST', `/stores/${storeId}/sales`, {
        clientOperationId: operation.current,
        lines: lines.map((l) => ({ quote: l.item.quote, quantity: l.quantity })),
        ...payment,
      });
      setDone(sale);
      setResume(null);
      setSaid(`Sale ${sale.documentNumber} completed. Total ${money(sale.totalDue)}. Change ${money(sale.change)}.`);
    } catch (e) {
      // UX-57: the cart stays, and the message says what to do.
      refuse(problemOf(e));
      if (e instanceof ApiError) {
        if (e.code === 'card_pending' || e.code === 'card_capture_failed') setResume('pending');
        else if (e.details.cardCaptured === true) setResume('captured');
        else if (['card_declined', 'card_failed', 'card_voided', 'card_refunded', 'SS059'].includes(e.code)) {
          // That attempt is over, and a retry is a new payment on a new operation (PY-54): the cart is kept.
          operation.current = crypto.randomUUID();
          setResume(null);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  /** Voids the card payment this cart left pending or authorized (`Payment.Void`, `PY-13`), found on the report of payments that need a person (`PY-40`). */
  const voidPending = async () => {
    setBusy(true);
    try {
      const report = await api<{ items: { paymentId: string; operationId: string }[] }>('GET', `/stores/${storeId}/payments/attention?olderThanMinutes=0&limit=200`);
      const mine = report.items.find((i) => i.operationId === operation.current);
      if (mine === undefined) return refuse(check('This card payment is not waiting for a person. Send the sale again to check it.'));
      await api('POST', `/stores/${storeId}/payments/${mine.paymentId}/void`);
      // The cart is kept, and another payment is a new one (PY-54).
      operation.current = crypto.randomUUID();
      setResume(null);
      setProblem(null);
      setSaid('The card payment was voided. The cart is kept: take payment again.');
    } catch (e) {
      refuse(problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setDone(null);
    setLines([]);
    setResume(null);
    setProblem(null);
    operation.current = crypto.randomUUID();
    setTimeout(() => scanField.current?.focus());
  };

  if (done !== null) {
    // UX-21: the outcome, and deliberately no void here.
    return (
      <section className="panel outcome" aria-labelledby="done-title">
        <h1 id="done-title">Sale {done.documentNumber} completed</h1>
        {done.payments === undefined ? (
          <p>
            Total {money(done.totalDue)}, cash {money(done.tendered)}
          </p>
        ) : (
          <>
            <p>Total {money(done.totalDue)}</p>
            <ul aria-label="Paid with">
              {done.payments.map((p) => (
                <li key={p.paymentId}>
                  {p.methodType === 'Card' ? 'Card' : 'Cash'} {money(p.amount)}
                  {p.simulated ? ' (simulated)' : ''}
                </li>
              ))}
            </ul>
          </>
        )}
        {GATEWAY_IS_SIMULATED && done.payments?.some((p) => p.simulated) === true && (
          <p className="notice" data-tone="info" role="note">
            <span className="symbol" aria-hidden="true">
              ⓘ
            </span>
            {SIMULATED_WARNING}
          </p>
        )}
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
      <div className="lookup">
        <form onSubmit={scan} className="scan">
          <label htmlFor="code">Scan or type a barcode, then Enter</label>
          <input id="code" ref={scanField} autoFocus autoComplete="off" disabled={resume !== null} value={code} onChange={(e) => setCode(e.target.value)} />
        </form>
        <form onSubmit={findByName} className="find" role="search" aria-label="Find an item by name">
          <label htmlFor="item-name">Or find an item by name</label>
          <div className="find-row">
            <input id="item-name" autoComplete="off" disabled={resume !== null} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" disabled={resume !== null}>
              Find
            </button>
          </div>
        </form>
        {found !== null &&
          (found.length === 0 ? (
            <p className="hint">Nothing on sale here has that in its name.</p>
          ) : (
            <ul className="choices" aria-label="Items found">
              {found.map((item) => (
                <li key={item.variantId}>
                  <button type="button" onClick={() => choose(item)}>
                    {item.description} — {money(item.price.amount)}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
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
                  disabled={resume !== null}
                  value={l.quantity}
                  onChange={(e) => setQuantity(l.key, Number(e.target.value) || 1)}
                />
              </td>
              <td>{money(l.item.price.amount)}</td>
              <td>{money(l.item.price.amount * l.quantity)}</td>
              <td>
                <button type="button" disabled={resume !== null} onClick={() => remove(l.key)} aria-label={`Remove ${l.item.description}`}>
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
      {resume !== null && (
        <p role="note" aria-label="Card payment waiting" className="problem" data-kind="user">
          {resume === 'pending'
            ? 'A card payment is waiting. Do not charge the card again: send this same sale again to check it.'
            : 'The card was charged, but the sale could not be saved. Fix what the message says and send this same sale again: the card will not be charged twice.'}{' '}
          {resume === 'pending' && canVoid
            ? 'Or void the card payment, and take payment again.'
            : resume === 'pending'
              ? 'Someone who may void a payment can cancel it.'
              : 'If it cannot be saved, a manager can give the money back.'}
        </p>
      )}
      <Tender
        total={total}
        currency={currency}
        canCard={canCard}
        busy={busy}
        locked={resume !== null}
        empty={lines.length === 0}
        firstField={cashField}
        resumeLabel={resume === 'pending' ? 'Check the card payment and finish the sale' : 'Send the sale again'}
        onPay={(payment) => void pay(payment)}
        onInvalid={refuse}
      />
      {resume === 'pending' && canVoid && (
        <button type="button" onClick={() => void voidPending()} disabled={busy}>
          Void the card payment
        </button>
      )}
      <Announcer text={said} />
    </section>
  );
}
