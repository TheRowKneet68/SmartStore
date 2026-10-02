import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { formatMoney, type Currency } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

/**
 * The card payments that need a person (`PY-40`, `PY-37`, `PY-41`; D4 §16, D5 §13). It reads the existing report and changes
 * nothing by itself. A person may then act on a row, by the key that act needs:
 * - void a payment that is `Pending` or `Authorized` (`Payment.Void`, D-16 Q3, `PY-13`): the server asks the provider outside the
 *   transaction, and a void it cannot confirm leaves the payment as it was;
 * - start a refund of a captured payment that has no sale (`Sale.Refund`, D-18), which is then approved and paid like any refund.
 * Reading is `Payment.View`. How long is too long is "a configured window" the specification does not give (`OQ-037`), so the
 * screen asks for it and never fills it in: the person says how long.
 */

type Kind = 'PendingTooLong' | 'AuthorizedNotCaptured' | 'CapturedNoSale';

interface Item {
  paymentId: string;
  kind: Kind;
  status: string;
  amount: number;
  currencyCode: string;
  ageMinutes: number;
  providerOutcome: string | null;
  simulated: boolean | null;
  heldBack: number;
  givenBack: number;
  operationId: string;
}

interface Report {
  summary: Record<Kind, number>;
  items: Item[];
  next: string | null;
}

const KINDS: Record<Kind, { words: string; look: Look; next: string }> = {
  PendingTooLong: {
    words: 'Waiting on the provider',
    look: ['counting', '◐', 'Waiting on the provider'],
    next: 'The provider has not said yes or no. Send the sale again at the till to ask it, or void the payment.',
  },
  AuthorizedNotCaptured: {
    words: 'Approved, not taken',
    look: ['counting', '◐', 'Approved, not taken'],
    next: 'The card was approved and the money was never taken. Send the sale again at the till to take it, or void the payment.',
  },
  CapturedNoSale: {
    words: 'Taken, no sale',
    look: ['none', '○', 'Taken, no sale'],
    next: 'The card was charged and the sale was never saved. Send the sale again at the till to finish it, or give the money back with a refund.',
  },
};
const LOOKS: Record<string, Look> = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.look]));

/** What the provider last said, in words (`PY-10`). */
const SAID: Record<string, string> = {
  Approved: 'Approved',
  Declined: 'Declined',
  Pending: 'Not answered',
  Timeout: 'Timed out',
  Failed: 'Failed',
  Errored: 'Errored',
};

/** How long, in the largest units that read well: "12 min", "2 h 5 min", "1 d 3 h". */
export function waiting(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} h${minutes % 60 === 0 ? '' : ` ${minutes % 60} min`}`;
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  return `${days} d${hours === 0 ? '' : ` ${hours} h`}`;
}

export function PaymentsAttention({
  storeId,
  permissions,
  currency,
  onRefund,
}: {
  storeId: string;
  permissions: string[];
  currency: Currency;
  /** Starts the refund of a payment with no sale on the refunds screen (D-18). Offered only when that screen is this person's. */
  onRefund?: (paymentId: string) => void;
}) {
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [kind, setKind] = useState<'' | Kind>('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const canVoid = permissions.includes('Payment.Void');
  const canRefund = onRefund !== undefined && permissions.includes('Sale.Refund') && permissions.includes('Refund.View');
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);

  const load = async (window: number, after: string | null = null) => {
    try {
      const r = await api<Report>('GET', `/stores/${storeId}/payments/attention?olderThanMinutes=${window}&limit=50${after === null ? '' : `&after=${after}`}`);
      setReport((current) => (after === null || current === null ? r : { ...r, items: [...current.items, ...r.items] }));
      setProblem(null);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  useEffect(() => {
    if (minutes !== null) {
      setReport(null);
      void load(minutes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, minutes]);

  const show = (event: FormEvent) => {
    event.preventDefault();
    const n = Number(text);
    if (text.trim() === '' || !Number.isInteger(n) || n < 0 || n > 525_600) {
      return setProblem(check('Enter how many minutes a payment may wait before it needs a person, for example 30. Enter 0 to see every one.'));
    }
    setProblem(null);
    if (n === minutes) void load(n);
    else setMinutes(n);
  };

  const voidIt = async (item: Item) => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api<{ providerHeld: boolean }>('POST', `/stores/${storeId}/payments/${item.paymentId}/void`);
      setConfirming(null);
      await load(minutes ?? 0);
      setSaid(r.providerHeld ? `The payment of ${money(item.amount)} was voided at the provider.` : `The payment of ${money(item.amount)} was voided here: the provider held nothing for it.`);
    } catch (e) {
      // `void_failed` and `void_pending` leave the payment as it was; the message says so (PY-11, PY-41).
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = report === null ? [] : report.items.filter((i) => kind === '' || i.kind === kind);

  return (
    <section className="panel" aria-labelledby="attention-title">
      <h1 id="attention-title">Card payments to check</h1>
      <p className="lede">
        Card payments that have not settled: waiting on the provider, approved and never taken, or taken with no sale. This screen changes nothing until you act on one.
      </p>
      <Announcer text={said} />
      <form onSubmit={show} aria-label="How long a payment may wait">
        <label>
          Waiting at least (minutes)
          <input autoFocus inputMode="numeric" autoComplete="off" value={text} onChange={(e) => (setText(e.target.value), setProblem(null))} aria-describedby="window-hint" />
        </label>
        <p id="window-hint" className="hint">
          How long is too long is the owner&rsquo;s to set, so you say it here. Enter 0 to see every payment that has not settled.
        </p>
        <div className="actions">
          <button type="submit" className="primary">
            Show
          </button>
          {minutes !== null && (
            <button type="button" onClick={() => void load(minutes)}>
              Refresh
            </button>
          )}
        </div>
      </form>
      <ProblemNotice problem={problem} />

      {minutes !== null &&
        (report === null ? (
          problem === null && <p role="status">Loading…</p>
        ) : (
          <>
            <dl className="figures" aria-label="How many">
              <dt>Waiting on the provider</dt>
              <dd>{report.summary.PendingTooLong}</dd>
              <dt>Approved, not taken</dt>
              <dd>{report.summary.AuthorizedNotCaptured}</dd>
              <dt>Taken, no sale</dt>
              <dd>{report.summary.CapturedNoSale}</dd>
            </dl>
            <label>
              Show
              <select value={kind} onChange={(e) => setKind(e.target.value as '' | Kind)}>
                <option value="">All that need a person</option>
                <option value="PendingTooLong">Waiting on the provider</option>
                <option value="AuthorizedNotCaptured">Approved, not taken</option>
                <option value="CapturedNoSale">Taken, no sale</option>
              </select>
            </label>
            {shown.length === 0 ? (
              <p>{report.items.length === 0 ? 'No card payment needs a person.' : 'None of those.'}</p>
            ) : (
              <table className="records">
                <caption className="visually-hidden">Card payments that need a person</caption>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Waiting</th>
                    <th scope="col">The provider said</th>
                    <th scope="col">What to do</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => {
                    const left = i.amount - i.heldBack;
                    return (
                      <tr key={i.paymentId}>
                        <td>
                          <StatusChip status={i.kind} looks={LOOKS} />
                          {i.simulated === true && (
                            <>
                              <br />
                              <span className="hint">Simulated</span>
                            </>
                          )}
                        </td>
                        <td className="num">
                          {money(i.amount)}
                          {i.kind === 'CapturedNoSale' && i.heldBack > 0 && (
                            <>
                              <br />
                              <span className="hint">
                                {money(i.givenBack)} given back, {money(i.heldBack)} held
                              </span>
                            </>
                          )}
                        </td>
                        <td>{waiting(i.ageMinutes)}</td>
                        <td>{i.providerOutcome === null ? 'Nothing yet' : (SAID[i.providerOutcome] ?? i.providerOutcome)}</td>
                        <td>
                          <p className="hint">{KINDS[i.kind].next}</p>
                          <p className="hint">Cart reference {i.operationId.slice(0, 8)}</p>
                          {(i.kind === 'PendingTooLong' || i.kind === 'AuthorizedNotCaptured') && canVoid && (
                            confirming === i.paymentId ? (
                              <div className="actions" role="group" aria-label={`Void the payment of ${money(i.amount)}?`}>
                                <button type="button" className="primary" autoFocus disabled={busy} onClick={() => void voidIt(i)}>
                                  Yes, void it
                                </button>
                                <button type="button" onClick={() => setConfirming(null)}>
                                  Keep it
                                </button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setConfirming(i.paymentId)} aria-label={`Void the payment of ${money(i.amount)}`}>
                                Void…
                              </button>
                            )
                          )}
                          {i.kind === 'CapturedNoSale' && canRefund && left > 0 && (
                            <button type="button" onClick={() => onRefund(i.paymentId)} aria-label={`Refund the payment of ${money(i.amount)}`}>
                              Refund this payment
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {report.next !== null && (
              <button type="button" onClick={() => void load(minutes, report.next)}>
                Show more
              </button>
            )}
          </>
        ))}
    </section>
  );
}
