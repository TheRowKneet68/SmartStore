import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { formatMoney, type Currency } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

/** A shift as the shift screen answers for it (`CD-30`): the figures come only from a submitted count (`CD-31`). */
export interface ShiftAnswers {
  id: string;
  status: string;
  terminalLabel: string;
  openedByName: string;
  openedAt: string;
  closedByName: string | null;
  closedAt: string | null;
  expected: number | null;
  counted: number | null;
  variance: number | null;
  tolerance: number;
  why: { reason: string; acknowledgedByName: string; acknowledgedAt: string } | null;
  next: string | null;
}

interface PassRow {
  id: string;
  passNumber: number;
  countedAmount: number;
  expectedAmount: number;
  variance: number;
  countedByName: string;
  acknowledgedByName: string | null;
  reason: string | null;
}

interface Reason {
  id: string;
  name: string;
}

const STATUS: Record<string, Look> = {
  Open: ['open', '●', 'Trading'],
  Reconciling: ['counting', '◐', 'Counting'],
  Closed: ['none', '○', 'Closed'],
};

const Status = ({ status }: { status: string }) => <StatusChip status={status} looks={STATUS} />;

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** What happens now, in words (`CD-30`'s fourth answer); `next` is the server's. */
function nextStep(shift: ShiftAnswers): string {
  switch (shift.next) {
    case 'begin count':
      return 'Trading. The count has not begun.';
    case 'count':
      return 'The count has begun. Waiting for the drawer to be counted.';
    case 'acknowledge':
      return 'The difference needs an acknowledgement with a reason before the shift can close.';
    case 'close':
      return 'Ready to close at the till.';
    default:
      return shift.closedByName === null ? 'Closed.' : `Closed by ${shift.closedByName}.`;
  }
}

/**
 * The store's shifts, for someone who may "see counts and variance history" (`Cash.Count.View`, actors-and-roles
 * §2.10). Each answers the shift screen's four questions (`CD-30`, `RT-527`): what should be here, what is here, the
 * difference against its allowance, and why, with what happens now. A difference waiting for an acknowledgement can be
 * acknowledged here by someone allowed to (`CD-23`, `BI-25`), so a cashier without the key is not stuck at the till.
 */
export function ShiftReview({ storeId, currency, canAcknowledge }: { storeId: string; currency: Currency; canAcknowledge: boolean }) {
  const [filter, setFilter] = useState('');
  const [shifts, setShifts] = useState<ShiftAnswers[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const money = (amount: number) => formatMoney(amount, currency.code, currency.exponent);

  useEffect(() => {
    if (open !== null) return;
    setShifts(null);
    api<{ items: ShiftAnswers[] }>('GET', `/stores/${storeId}/shifts${filter === '' ? '' : `?status=${filter}`}`).then(
      (r) => setShifts(r.items),
      (e: unknown) => setProblem(problemOf(e)),
    );
  }, [storeId, filter, open]);

  if (open !== null) {
    return <ShiftDetail storeId={storeId} shiftId={open} money={money} canAcknowledge={canAcknowledge} onBack={() => setOpen(null)} />;
  }

  return (
    <section className="panel" aria-labelledby="shifts-title">
      <h1 id="shifts-title">Shifts</h1>
      <label>
        Show
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All shifts</option>
          <option value="Open">Trading</option>
          <option value="Reconciling">Counting</option>
          <option value="Closed">Closed</option>
        </select>
      </label>
      <ProblemNotice problem={problem} />
      {shifts === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : shifts.length === 0 ? (
        <p>No shifts to show.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Till</th>
              <th scope="col">Opened</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Expected
              </th>
              <th scope="col" className="num">
                Counted
              </th>
              <th scope="col">Difference</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>{s.terminalLabel}</td>
                <td>
                  {when(s.openedAt)}
                  <br />
                  <span className="hint">{s.openedByName}</span>
                </td>
                <td>
                  <Status status={s.status} />
                </td>
                <td className="num">{s.expected === null ? '—' : money(s.expected)}</td>
                <td className="num">{s.counted === null ? '—' : money(s.counted)}</td>
                <td>{difference(s, money)}</td>
                <td>
                  <button type="button" onClick={() => setOpen(s.id)} aria-label={`Open the shift on ${s.terminalLabel} opened ${when(s.openedAt)}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The difference in words: "Balanced", "Short by NPR 0.50", "Over by NPR 0.50", or a dash before any count. */
function difference(s: { variance: number | null }, money: (amount: number) => string): string {
  if (s.variance === null) return '—';
  if (s.variance === 0) return 'Balanced';
  return s.variance < 0 ? `Short by ${money(-s.variance)}` : `Over by ${money(s.variance)}`;
}

function ShiftDetail({
  storeId,
  shiftId,
  money,
  canAcknowledge,
  onBack,
}: {
  storeId: string;
  shiftId: string;
  money: (amount: number) => string;
  canAcknowledge: boolean;
  onBack: () => void;
}) {
  const [shift, setShift] = useState<(ShiftAnswers & { passes: PassRow[] }) | null>(null);
  const [reasons, setReasons] = useState<Reason[] | null>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  // Bumped to read the shift again after a change made here.
  const [version, setVersion] = useState(0);
  const asks = shift !== null && shift.next === 'acknowledge' && canAcknowledge;

  useEffect(() => {
    api<ShiftAnswers & { passes: PassRow[] }>('GET', `/stores/${storeId}/shifts/${shiftId}`).then(setShift, (e: unknown) => setProblem(problemOf(e)));
  }, [storeId, shiftId, version]);
  useEffect(() => {
    if (asks && reasons === null) api<{ items: Reason[] }>('GET', '/reason-codes').then((r) => setReasons(r.items), (e: unknown) => setProblem(problemOf(e)));
  }, [asks, reasons]);

  const acknowledge = async (event: FormEvent) => {
    event.preventDefault();
    if (shift === null) return;
    if (reason === '') {
      setProblem(check('Choose the reason for the difference.'));
      return;
    }
    const latest = shift.passes[shift.passes.length - 1]!;
    setBusy(true);
    try {
      await api('POST', `/stores/${storeId}/shifts/${shiftId}/counts/${latest.id}/acknowledge`, { reasonCodeId: reason });
      setProblem(null);
      setSaid('Difference acknowledged. The shift can now be closed at the till.');
      setVersion((v) => v + 1);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <button type="button" className="quiet" onClick={onBack}>
      Back to the shifts
    </button>
  );
  if (shift === null) {
    return (
      <section className="panel">
        {back}
        {problem !== null ? (
          <ProblemNotice problem={problem} />
        ) : (
          <p role="status">Loading…</p>
        )}
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="shift-title">
      {back}
      <h1 id="shift-title">
        {shift.terminalLabel}, opened {when(shift.openedAt)}
      </h1>
      <p>
        <Status status={shift.status} /> Opened by {shift.openedByName}
      </p>
      <dl className="figures">
        <dt>Expected</dt>
        <dd>{shift.expected === null ? 'Not counted yet' : money(shift.expected)}</dd>
        <dt>Counted</dt>
        <dd>{shift.counted === null ? 'Not counted yet' : money(shift.counted)}</dd>
        <dt>Difference</dt>
        <dd>{difference(shift, money)}</dd>
        <dt>Allowed difference</dt>
        <dd>{money(shift.tolerance)}</dd>
        <dt>Why</dt>
        <dd>{shift.why === null ? '—' : `${shift.why.reason}, acknowledged by ${shift.why.acknowledgedByName}, ${when(shift.why.acknowledgedAt)}`}</dd>
      </dl>
      <p className="notice" data-tone={shift.next === 'acknowledge' ? 'warn' : 'info'}>
        <span className="symbol" aria-hidden="true">
          {shift.next === 'acknowledge' ? '⚠' : '→'}
        </span>
        <span>{nextStep(shift)}</span>
      </p>
      {asks && (
        <form onSubmit={acknowledge}>
          <label>
            Reason for the difference
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
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
      <ProblemNotice problem={problem} />
      <h2>Counts</h2>
      {shift.passes.length === 0 ? (
        <p>No count yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Count</th>
              <th scope="col" className="num">
                Counted
              </th>
              <th scope="col" className="num">
                Expected
              </th>
              <th scope="col">Difference</th>
              <th scope="col">Counted by</th>
              <th scope="col">Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {shift.passes.map((p) => (
              <tr key={p.id}>
                <td>{p.passNumber}</td>
                <td className="num">{money(p.countedAmount)}</td>
                <td className="num">{money(p.expectedAmount)}</td>
                <td>{difference(p, money)}</td>
                <td>{p.countedByName}</td>
                <td>{p.acknowledgedByName === null ? '—' : `${p.reason}, by ${p.acknowledgedByName}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Announcer text={said} />
    </section>
  );
}
