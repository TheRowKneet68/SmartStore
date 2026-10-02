import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { formatMoney, parseMoney, type Currency } from '../lib/money.ts';
import { check, type Problem } from '../lib/Problem.tsx';

/** What the till sends as payment: cash, a card, or both (`PY-16`). The server computes and checks every amount (`BI-30`). */
export type Payment = { cash: { tendered: number } } | { card: { token: string } } | { card: { token: string; amount: number }; cash: { tendered: number } };

export type Mode = 'cash' | 'card' | 'both';

/**
 * The gateway in v1 is simulated (ADR-31 §13 item 4): it moves no money, reads no card, and takes only test tokens. The server
 * says so when it starts and marks every payment it took (`simulated`), but offers the till no way to ask beforehand, so this is
 * a fact of the build. It is a constant to be changed when a real acquirer is connected, and every place that shows the card
 * says it (UX-52: in words, never colour alone).
 */
export const GATEWAY_IS_SIMULATED = true;
export const SIMULATED_WARNING = 'SIMULATED card gateway: type a test card token. No real card is read and no money moves.';
const TEST_CARDS = ['TEST-APPROVE', 'TEST-DECLINE', 'TEST-FAIL', 'TEST-TIMEOUT'];

/**
 * The payment step (`UX-14`, `UX-15`, `UX-17`): the total due, how it is paid, and what is still to pay or the change, as it is
 * typed. Cash alone looks exactly as before. With a card allowed (`Payment.Capture`, D-16 Q2) the till may take a card, or a card
 * for part and cash for the rest (`PY-16`): a card is never charged more than the total, because a card cannot be handed back
 * (`PY-19`), and only cash gives change. While a card payment is in flight the tender is fixed (`locked`): the same sale is sent
 * again, and the card is never charged twice (`PY-39`).
 */
export function Tender({
  total,
  currency,
  canCard,
  busy,
  locked,
  empty,
  firstField,
  resumeLabel,
  onPay,
  onInvalid,
}: {
  total: number;
  currency: Currency;
  canCard: boolean;
  busy: boolean;
  locked: boolean;
  empty: boolean;
  firstField: RefObject<HTMLInputElement | null>;
  resumeLabel: string;
  onPay: (payment: Payment) => void;
  onInvalid: (problem: Problem) => void;
}) {
  const [mode, setMode] = useState<Mode>('cash');
  const [cash, setCash] = useState('');
  const [token, setToken] = useState('');
  const [cardText, setCardText] = useState('');
  const tokenField = useRef<HTMLInputElement>(null);
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);
  const typedAmount = (text: string) => parseMoney(text, currency.exponent);

  // How much goes on the card: all of it for a card sale, what is typed for card and cash (`PY-16`, `PY-19`).
  const card = mode === 'card' ? total : mode === 'both' ? typedAmount(cardText) : 0;
  const owed = card === null ? null : total - card;
  // An empty cash field means exactly what is left to take (UX-01's keyboard path).
  const given = mode === 'card' ? 0 : cash.trim() === '' ? owed : typedAmount(cash);
  const remainder = given === null || owed === null ? null : owed - given;

  const choose = (next: Mode) => {
    setMode(next);
    // The first field of the new way of paying has focus, the keyboard path (UX-01).
    setTimeout(() => (next === 'cash' ? firstField.current : next === 'card' ? tokenField.current : document.getElementById('card-amount'))?.focus());
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (locked) return onPay(mode === 'cash' ? { cash: { tendered: given ?? 0 } } : mode === 'card' ? { card: { token } } : { card: { token, amount: card ?? 0 }, cash: { tendered: given ?? 0 } });
    if (mode === 'cash') {
      if (given === null) return onInvalid(check(`Enter the cash given, with at most ${currency.exponent} decimal places.`));
      // UX-17: an underpayment is named, with what to do. The server refuses one too (SP-40).
      if (remainder !== null && remainder > 0) return onInvalid(check(`The cash given is ${money(remainder)} short of the total due. Take more cash.`));
      return onPay({ cash: { tendered: given } });
    }
    if (token.trim() === '') return onInvalid(check('Type the card token first.'));
    if (mode === 'card') return onPay({ card: { token: token.trim() } });
    if (card === null || card < 1) return onInvalid(check(`Enter how much goes on the card, with at most ${currency.exponent} decimal places.`));
    if (card >= total) return onInvalid(check('The card already covers the total, so take it as a card sale with no cash.'));
    if (given === null) return onInvalid(check(`Enter the cash given, with at most ${currency.exponent} decimal places.`));
    if (remainder !== null && remainder > 0) return onInvalid(check(`The cash given is ${money(remainder)} short of what the card leaves. Take more cash.`));
    return onPay({ card: { token: token.trim(), amount: card }, cash: { tendered: given } });
  };

  const showsCash = mode !== 'card';
  const showsCard = mode !== 'cash';
  const label =
    locked ? resumeLabel : busy ? 'Saving…' : mode === 'cash' ? 'Complete cash sale' : mode === 'card' ? 'Charge the card and complete the sale' : 'Charge the card, take the cash and complete the sale';

  return (
    <form onSubmit={submit} className="pay" aria-label="Payment">
      {canCard && (
        <fieldset disabled={locked}>
          <legend>How is it paid?</legend>
          {(
            [
              ['cash', 'Cash'],
              ['card', 'Card'],
              ['both', 'Card and cash'],
            ] as const
          ).map(([value, words]) => (
            <label key={value} className="choice">
              <input type="radio" name="tender" value={value} checked={mode === value} onChange={() => choose(value)} />
              {words}
            </label>
          ))}
        </fieldset>
      )}
      {showsCard && (
        <>
          {GATEWAY_IS_SIMULATED && (
            <p className="notice" data-tone="info" role="note">
              <span className="symbol" aria-hidden="true">
                ⓘ
              </span>
              {SIMULATED_WARNING}
            </p>
          )}
          {mode === 'both' && (
            <>
              <label htmlFor="card-amount">Amount on the card ({currency.code})</label>
              <input id="card-amount" ref={(el) => void (firstField.current = el)} inputMode="decimal" autoComplete="off" disabled={locked} value={cardText} onChange={(e) => setCardText(e.target.value)} />
            </>
          )}
          <label htmlFor="card-token">Test card token</label>
          <input id="card-token" ref={(el) => void ((tokenField.current = el), mode === 'card' && (firstField.current = el))} list="test-cards" autoComplete="off" spellCheck={false} disabled={locked} value={token} onChange={(e) => setToken(e.target.value)} />
          <datalist id="test-cards">
            {TEST_CARDS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </>
      )}
      {showsCash && (
        <>
          <label htmlFor="cash">{mode === 'cash' ? 'Cash given (Enter for the exact total)' : 'Cash given (Enter for what the card leaves)'}</label>
          <input id="cash" ref={(el) => void (mode === 'cash' && (firstField.current = el))} inputMode="decimal" autoComplete="off" disabled={locked} value={cash} onChange={(e) => setCash(e.target.value)} />
        </>
      )}
      <dl className="tender" aria-label="Payment so far">
        <dt>Total due</dt>
        <dd>{money(total)}</dd>
        {mode !== 'cash' && (
          <>
            <dt>On the card</dt>
            <dd>{card === null ? '—' : money(card)}</dd>
          </>
        )}
        {showsCash && (
          <>
            <dt>Cash given</dt>
            <dd>{given === null ? '—' : money(given)}</dd>
          </>
        )}
        {mode === 'card' ? null : showsCash && remainder !== null && remainder > 0 ? (
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
      <button type="submit" disabled={empty || (busy && !locked)}>
        {label}
      </button>
    </form>
  );
}
