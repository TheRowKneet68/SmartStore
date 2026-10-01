import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api, ApiError } from '../lib/api.ts';
import { formatMoney, parseMoney, type Currency } from '../lib/money.ts';

/** One counting pass as the server recorded it: the expected amount and the variance are the server's (`CD-22`). */
export interface Pass {
  id: string;
  passNumber: number;
  countedAmount: number;
  expectedAmount: number;
  variance: number;
  /** The difference allowed without an acknowledgement (`UX-34`; zero until the owner sets one, OQ-020). */
  tolerance: number;
  acknowledgedBy: string | null;
  reasonCodeId: string | null;
}

interface Reason {
  id: string;
  code: string;
  name: string;
}

/**
 * Asks before the count begins (`UX-02`): beginning it stops sales at this till until the shift is closed, and there is
 * no way back to trading (OQ-014). It sits above the sale rather than replacing it, so "Keep selling" returns to the
 * cart exactly as it was (`UX-57`), and the safe choice has the focus.
 */
export function BeginCount({ shiftId, onBegun, onCancel }: { shiftId: string; onBegun: () => void; onCancel: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const begin = async () => {
    setBusy(true);
    try {
      await api('POST', '/transitions', { machine: 'Shift', event: 'begin count', subject: shiftId });
      onBegun();
    } catch (e) {
      setProblem((e as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <section className="notice" data-tone="info" aria-labelledby="begin-title">
      <span className="symbol" aria-hidden="true">
        {'ⓘ'}
      </span>
      <div>
        <h2 id="begin-title">Close the shift?</h2>
        <p>
          Closing starts the count of the drawer. This till takes no more sales until the shift is closed, so finish or
          clear the current sale first.
        </p>
        <div className="actions">
          <button type="button" autoFocus onClick={onCancel}>
            Keep selling
          </button>
          <button type="button" className="primary" onClick={begin} disabled={busy}>
            {busy ? 'Starting…' : 'Begin counting'}
          </button>
        </div>
        {problem !== null && (
          <p role="alert" className="error">
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}

type Step = { kind: 'count' } | { kind: 'result'; pass: Pass } | { kind: 'closed'; pass: Pass; float: number };

/**
 * Counting the drawer and closing the shift: its own mode at the till (`UX-33`).
 * - The count is blind: nothing here says what the drawer should hold until a count is submitted (`CD-21`, `CD-31`).
 * - Then the variance screen shows counted, expected, the difference and the allowed difference together (`UX-34`),
 *   and says short, over or balanced in words beside a symbol (`UX-52`).
 * - A difference beyond the allowance is acknowledged with a reason by someone allowed to (`CD-23`, `BI-25`), or the
 *   drawer is counted again as a new pass (`SM-57`). Without the key, the till says who must acknowledge (`UX-08`).
 * - The close declares the float left for the next shift (`CD-20`). The server decides every step, and its refusal
 *   is shown as it says it, with the count still on screen (`UX-55`, `UX-57`).
 */
export function CountDrawer({
  storeId,
  shiftId,
  currency,
  canAcknowledge,
  onClosed,
  onDone,
}: {
  storeId: string;
  shiftId: string;
  currency: Currency;
  canAcknowledge: boolean;
  onClosed: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'count' });
  const [counted, setCounted] = useState('');
  const [float, setFloat] = useState('');
  const [reason, setReason] = useState('');
  const [reasons, setReasons] = useState<Reason[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);

  const pass = step.kind === 'count' ? null : step.pass;
  const beyond = pass !== null && Math.abs(pass.variance) > pass.tolerance;
  const acknowledged = pass !== null && pass.acknowledgedBy !== null;
  const asksReason = step.kind === 'result' && beyond && !acknowledged && canAcknowledge;

  useEffect(() => {
    if (asksReason && reasons === null) {
      api<{ items: Reason[] }>('GET', '/reason-codes').then(
        (r) => setReasons(r.items),
        (e: ApiError) => setProblem(e.message),
      );
    }
  }, [asksReason, reasons]);

  const refuse = (message: string) => {
    setProblem(message);
    setSaid(message);
  };
  const difference = (p: Pass) => (p.variance < 0 ? `Short by ${money(-p.variance)}` : `Over by ${money(p.variance)}`);
  const verdict = (p: Pass) => (p.variance === 0 ? 'The drawer balances.' : `${difference(p)}.`);

  const submitCount = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseMoney(counted, currency.exponent);
    if (amount === null) return refuse(`Enter the cash counted, with at most ${currency.exponent} decimal places.`);
    setBusy(true);
    try {
      const recorded = await api<Pass>('POST', `/stores/${storeId}/shifts/${shiftId}/counts`, { countedAmount: amount });
      setStep({ kind: 'result', pass: recorded });
      setProblem(null);
      setSaid(`Counted ${money(recorded.countedAmount)}. Expected ${money(recorded.expectedAmount)}. ${verdict(recorded)}`);
    } catch (e) {
      refuse((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (event: FormEvent) => {
    event.preventDefault();
    if (pass === null) return;
    if (reason === '') return refuse('Choose the reason for the difference.');
    setBusy(true);
    try {
      const recorded = await api<Pass>('POST', `/stores/${storeId}/shifts/${shiftId}/counts/${pass.id}/acknowledge`, { reasonCodeId: reason });
      setStep({ kind: 'result', pass: recorded });
      setProblem(null);
      setSaid('Difference acknowledged. The shift can now be closed.');
    } catch (e) {
      refuse((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const close = async (event: FormEvent) => {
    event.preventDefault();
    if (pass === null) return;
    const amount = float.trim() === '' ? null : parseMoney(float, currency.exponent);
    if (amount === null) {
      return refuse(`Enter the cash left in the drawer for the next shift, with at most ${currency.exponent} decimal places. Enter 0 if none.`);
    }
    setBusy(true);
    try {
      await api('POST', '/transitions', { machine: 'Shift', event: 'close', subject: shiftId, payload: { closingFloat: amount } });
      setStep({ kind: 'closed', pass, float: amount });
      setProblem(null);
      setSaid(`Shift closed. ${money(amount)} left in the drawer for the next shift.`);
      onClosed();
    } catch (e) {
      refuse((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const countAgain = () => {
    setStep({ kind: 'count' });
    setCounted('');
    setProblem(null);
    setSaid('Count the drawer again. The amount expected is shown after you submit.');
  };

  const shown = problem !== null && (
    <p role="alert" className="error">
      {problem}
    </p>
  );

  if (step.kind === 'count') {
    return (
      <section className="panel narrow" aria-labelledby="count-title">
        <h1 id="count-title">Count the drawer</h1>
        <p className="lede">Count all the cash in the drawer and enter the total. The amount expected is shown after you submit.</p>
        <form onSubmit={submitCount}>
          <label>
            Cash counted in the drawer ({currency.code})
            <input autoFocus inputMode="decimal" autoComplete="off" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Submit count'}
          </button>
        </form>
        {shown}
        <Announcer text={said} />
      </section>
    );
  }

  const figures = (p: Pass, extra?: [string, string]) => (
    <dl className="figures">
      <dt>Counted</dt>
      <dd>{money(p.countedAmount)}</dd>
      <dt>Expected</dt>
      <dd>{money(p.expectedAmount)}</dd>
      <dt>Difference</dt>
      <dd>{money(p.variance)}</dd>
      <dt>Allowed difference</dt>
      <dd>{money(p.tolerance)}</dd>
      {extra !== undefined && (
        <>
          <dt>{extra[0]}</dt>
          <dd>{extra[1]}</dd>
        </>
      )}
    </dl>
  );

  if (step.kind === 'closed') {
    return (
      <section className="panel narrow outcome" aria-labelledby="closed-title">
        <h1 id="closed-title">Shift closed</h1>
        {figures(step.pass, ['Left for the next shift', money(step.float)])}
        <button type="button" autoFocus onClick={onDone}>
          Done
        </button>
        <Announcer text={said} />
      </section>
    );
  }

  const { pass: current } = step;
  const tone = !beyond ? 'ok' : acknowledged ? 'info' : 'warn';
  const symbol = !beyond ? '✓' : acknowledged ? '✓' : '⚠';
  const words = !beyond ? verdict(current) : acknowledged ? `${difference(current)}, acknowledged.` : `${difference(current)}. This needs an acknowledgement before the shift can close.`;
  return (
    <section className="panel narrow" aria-labelledby="result-title">
      <h1 id="result-title">Count {current.passNumber}</h1>
      {figures(current)}
      <p className="notice" data-tone={tone}>
        <span className="symbol" aria-hidden="true">
          {symbol}
        </span>
        <span>{words}</span>
      </p>
      {beyond && !acknowledged && canAcknowledge && (
        <form onSubmit={acknowledge}>
          <label>
            Reason for the difference
            <select autoFocus value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose a reason</option>
              {(reasons ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            Acknowledge the difference
          </button>
        </form>
      )}
      {beyond && !acknowledged && !canAcknowledge && (
        <p className="hint">Ask a manager to acknowledge the difference, then close the shift. Or count the drawer again.</p>
      )}
      {(!beyond || acknowledged || !canAcknowledge) && (
        <form onSubmit={close}>
          <label>
            Cash left in the drawer for the next shift ({currency.code})
            <input autoFocus={!asksReason} inputMode="decimal" autoComplete="off" value={float} onChange={(e) => setFloat(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Closing…' : 'Close shift'}
          </button>
        </form>
      )}
      <div className="actions">
        <button type="button" onClick={countAgain}>
          Count again
        </button>
      </div>
      {shown}
      <Announcer text={said} />
    </section>
  );
}
