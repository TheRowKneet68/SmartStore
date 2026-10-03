import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { useList, when } from '../lib/form';
import { Moves, type Move } from '../lib/Moves.tsx';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

interface Terminal {
  id: string;
  code: string;
  label: string;
  mode: string;
  status: string;
  sellFromLocationId: string | null;
  drawerId: string | null;
}

interface Location {
  id: string;
  code: string;
  name: string;
  isSellable: boolean;
}

/** The Device machine on a till (§22.12), as words beside a symbol (`UX-52`). */
const LOOKS: Record<string, Look> = {
  Registered: ['counting', '◐', 'Registered'],
  Active: ['open', '●', 'Active'],
  Disabled: ['none', '○', 'Disabled'],
  Retired: ['none', '○', 'Retired'],
};

/**
 * What may happen next, as an event on the Device machine (§22.12); the server decides the edge (`SM-06`).
 *
 * A disabled till goes back into service with `activate` under `Device.Disable`, the authority that took it out, and a reason
 * (owner decision D-16, Q6; `HD-32`, `SS055`).
 */
const NEXT: Record<string, Move[]> = {
  Registered: [
    { event: 'activate', label: 'Activate it', key_: 'Device.Edit', outcome: 'The till is active and can trade.' },
    {
      event: 'retire',
      label: 'Retire it',
      key_: 'Device.Edit',
      reason: true,
      ask: 'Retire this till for good? It stays on the list, and nothing moves it back.',
      outcome: 'The till is retired. It stays on the list for the record.',
    },
  ],
  Active: [
    {
      event: 'disable',
      label: 'Disable it',
      key_: 'Device.Disable',
      reason: true,
      ask: 'Disable this till? It will sell nothing and open no shift. Its open shift can still be counted and closed.',
      outcome: 'The till is disabled. It sells nothing and opens no shift.',
    },
    {
      event: 'retire',
      label: 'Retire it',
      key_: 'Device.Edit',
      reason: true,
      ask: 'Retire this till for good? It stays on the list, and nothing moves it back.',
      outcome: 'The till is retired. It stays on the list for the record.',
    },
  ],
  Disabled: [
    {
      event: 'activate',
      label: 'Put it back in service',
      key_: 'Device.Disable',
      reason: true,
      ask: 'Put this till back in service? It can sell and open a shift again.',
      outcome: 'The till is back in service. It can sell and open a shift again.',
    },
    {
      event: 'retire',
      label: 'Retire it',
      key_: 'Device.Edit',
      reason: true,
      ask: 'Retire this till for good? It stays on the list, and nothing moves it back.',
      outcome: 'The till is retired. It stays on the list for the record.',
    },
  ],
  Retired: [],
};

type Said = (outcome: string) => void;

/**
 * The store's tills: each with its own cash drawer (`CD-01`: v1 has one drawer per till), selling from a sellable location
 * of this store (`MS-16`, OQ-019). Reading them takes `Device.View`, registering one `Device.Register`, and changing one
 * `Device.Edit` through the transition endpoint (`RT-423`).
 *
 * A registered till cannot trade: it has to be activated first, and only an active till opens a shift or rings up a sale.
 */
export function Tills({ storeId, permissions }: { storeId: string; permissions: string[] }) {
  const can = (key: string) => permissions.includes(key);
  // Nothing is asked of the server without `Device.View`: an unauthorised screen must not call and then be refused.
  const { items, problem: readProblem, reload } = useList<Terminal>(can('Device.View') ? `/stores/${storeId}/terminals` : null);
  const [said, setSaid] = useState('');
  const [moveProblem, setMoveProblem] = useState<Problem | null>(null);
  const problem = readProblem ?? moveProblem;

  if (!can('Device.View')) {
    return (
      <section className="panel" aria-labelledby="tills-title">
        <h1 id="tills-title">Tills</h1>
        <p>You do not have permission to see this store's tills (`UX-05`).</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-labelledby="tills-title">
      <h1 id="tills-title">Tills</h1>
      <Announcer text={said} />
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>This store has no till yet.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">This store's tills</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Label</th>
              <th scope="col">Mode</th>
              <th scope="col">Status</th>
              <th scope="col">Drawer</th>
              <th scope="col">
                <span className="visually-hidden">Change</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.code}</td>
                <td>{t.label}</td>
                <td>{t.mode}</td>
                <td>
                  <StatusChip status={t.status} looks={LOOKS} />
                </td>
                <td>{t.drawerId === null ? 'None yet' : 'Its own'}</td>
                <td>
                  {t.status === 'Retired' ? (
                    <span className="hint">Retired. Nothing moves it back.</span>
                  ) : (
                    <>
                      <Moves
                        machine="Device"
                        subject={t.id}
                        name={t.label}
                        moves={NEXT[t.status] ?? []}
                        can={can}
                        onSaid={setSaid}
                        onProblem={setMoveProblem}
                        onDone={reload}
                      />
                      {t.status === 'Disabled' && !can('Device.Disable') && (
                        <span className="hint">Putting it back in service needs Device.Disable, the permission that took it out.</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {can('Device.Register') && <NewTill storeId={storeId} onSaid={setSaid} onDone={reload} />}
    </section>
  );
}

/**
 * A new till: a code, a label, and the sellable location it sells from. The drawer comes with it. It trades only once
 * activated, which is the button beside it in the list above (`RT-423`).
 */
function NewTill({ storeId, onSaid, onDone }: { storeId: string; onSaid: Said; onDone: () => void }) {
  const locations = useList<Location>(`/stores/${storeId}/locations`);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [locationId, setLocation] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const sellable = (locations.items ?? []).filter((l) => l.isSellable);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === '') return setProblem(check('Give the till a code. It is how the till is known on a receipt.'));
    if (label.trim() === '') return setProblem(check('Give the till a name people will recognise.'));
    try {
      await api('POST', `/stores/${storeId}/terminals`, {
        code: code.trim(),
        label: label.trim(),
        ...(locationId === '' ? {} : { sellFromLocationId: locationId }),
      });
      setProblem(null);
      setCode('');
      setLabel('');
      onSaid(`${label.trim()} was registered. Activate it before it trades.`);
      onDone();
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-labelledby="new-till-title">
      <h2 id="new-till-title">Register a till</h2>
      <label>
        Code
        <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label>
        Name
        <input autoComplete="off" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label>
        Sells from
        <select value={locationId} onChange={(e) => setLocation(e.target.value)}>
          <option value="">The store's only sellable location</option>
          {sellable.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} — {l.name}
            </option>
          ))}
        </select>
      </label>
      {sellable.length > 1 && locationId === '' && (
        <p className="hint">This store has more than one sellable location, so choose which one this till sells from.</p>
      )}
      <button type="submit">Register the till</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

/**
 * Store settings (`REQ-AU-06`): tax mode, what happens when stock would go negative, the return window, and what a
 * returned item becomes. Each change is a complete version, because a version is a snapshot, and it can start later
 * instead of now. There is no separate read-only key: the screen that changes them is the only reader (§2.12).
 */
export function StoreSettings({ storeId, canSet }: { storeId: string; canSet: boolean }) {
  interface Version {
    id: string;
    taxMode: string;
    negativeStockPolicy: string;
    returnWindowDays: number;
    defaultReturnDisposition: string;
    effectiveFrom: string;
    createdBy: string;
  }
  const [inForce, setInForce] = useState<Version | null>(null);
  const [scheduled, setScheduled] = useState<Version[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [version, setVersion] = useState(0);
  const [said, setSaid] = useState('');

  useEffect(() => {
    // Reading them takes the same key that changes them, so without it nothing is asked for at all.
    if (!canSet) return;
    api<{ inForce: Version | null; scheduled: Version[] }>('GET', `/stores/${storeId}/settings`).then(
      (r) => {
        setInForce(r.inForce);
        setScheduled(r.scheduled);
      },
      (e: unknown) => setProblem(problemOf(e)),
    );
  }, [storeId, version, canSet]);

  if (!canSet) {
    return (
      <section className="panel" aria-labelledby="settings-title">
        <h1 id="settings-title">Store settings</h1>
        <p>Reading these settings takes `Config.Store`, the key that changes them, and your role does not have it (§2.12).</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-labelledby="settings-title">
      <h1 id="settings-title">Store settings</h1>
      <Announcer text={said} />
      <ProblemNotice problem={problem} />
      <h2>In force now</h2>
      {inForce === null ? (
        <p>This store has no settings in force. A sale is refused until there are some.</p>
      ) : (
        <SettingsTable version={inForce} />
      )}
      <h2>Scheduled</h2>
      {scheduled === null ? (
        <p role="status">Loading…</p>
      ) : scheduled.length === 0 ? (
        <p>Nothing is scheduled.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Settings versions that start later</caption>
          <thead>
            <tr>
              <th scope="col">Starts</th>
              <th scope="col">Tax</th>
              <th scope="col">Negative stock</th>
              <th scope="col" className="num">
                Return window
              </th>
              <th scope="col">A returned item becomes</th>
              <th scope="col">Set by</th>
            </tr>
          </thead>
          <tbody>
            {scheduled.map((s) => (
              <tr key={s.id}>
                <td>{when(s.effectiveFrom)}</td>
                <td>{s.taxMode === 'Inclusive' ? 'Prices include tax' : 'Tax is added on top'}</td>
                <td>{s.negativeStockPolicy === 'AllowNegative' ? 'Allowed' : 'Refused'}</td>
                <td className="num">{s.returnWindowDays} days</td>
                <td>{s.defaultReturnDisposition === 'Sellable' ? 'Sellable again' : 'Held back as quarantine'}</td>
                <td>{s.createdBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NewVersion
        // Remounted when the version in force changes, so the form always starts from it: without this the fields keep
        // their first-render defaults and a save quietly writes 0-day returns over what the store had.
        key={inForce === null ? 'none' : inForce.effectiveFrom}
        storeId={storeId}
        current={inForce}
        onDone={(outcome) => {
          setSaid(outcome);
          setVersion((v) => v + 1);
        }}
        onProblem={setProblem}
      />
    </section>
  );
}

function SettingsTable({ version }: { version: { taxMode: string; negativeStockPolicy: string; returnWindowDays: number; defaultReturnDisposition: string; effectiveFrom: string; createdBy: string } }) {
  return (
    <table className="records">
      <caption className="visually-hidden">The settings version in force now</caption>
      <tbody>
        <tr>
          <th scope="row">Started</th>
          <td>{when(version.effectiveFrom)}</td>
        </tr>
        <tr>
          <th scope="row">Tax</th>
          <td>{version.taxMode === 'Inclusive' ? 'Prices include tax' : 'Tax is added on top'}</td>
        </tr>
        <tr>
          <th scope="row">Stock going negative</th>
          <td>{version.negativeStockPolicy === 'AllowNegative' ? 'Allowed, and reported' : 'Refused'}</td>
        </tr>
        <tr>
          <th scope="row">Return window</th>
          <td>{version.returnWindowDays} days</td>
        </tr>
        <tr>
          <th scope="row">A returned item becomes</th>
          <td>{version.defaultReturnDisposition === 'Sellable' ? 'Sellable again' : 'Held back as quarantine'}</td>
        </tr>
        <tr>
          <th scope="row">Set by</th>
          <td>{version.createdBy}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** A new settings version: the whole set, because a version is a complete snapshot (`REQ-AU-06`). */
function NewVersion({
  storeId,
  current,
  onDone,
  onProblem,
}: {
  storeId: string;
  current: { taxMode: string; negativeStockPolicy: string; returnWindowDays: number; defaultReturnDisposition: string } | null;
  onDone: Said;
  onProblem: (p: Problem) => void;
}) {
  const [taxMode, setTaxMode] = useState(current?.taxMode ?? 'Exclusive');
  const [negativeStockPolicy, setNegative] = useState(current?.negativeStockPolicy ?? 'BlockNegative');
  const [returnWindowDays, setWindow] = useState(String(current?.returnWindowDays ?? 0));
  const [defaultReturnDisposition, setDisposition] = useState(current?.defaultReturnDisposition ?? 'Sellable');
  const [from, setFrom] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const days = Number(returnWindowDays);
    if (!Number.isInteger(days) || days < 0 || days > 32_767) return setProblem(check('The return window is a whole number of days, between 0 and 32767.'));
    try {
      await api('POST', `/stores/${storeId}/settings`, {
        taxMode,
        negativeStockPolicy,
        returnWindowDays: days,
        defaultReturnDisposition,
        ...(from === '' ? {} : { effectiveFrom: new Date(from).toISOString() }),
      });
      setProblem(null);
      // Read the new version back rather than assuming it took: `onDone` announces and re-reads.
      onDone(`The settings now start ${from === '' ? 'straight away' : `on ${when(new Date(from).toISOString())}`}.`);
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="new-settings-title">
      <h2 id="new-settings-title">New settings</h2>
      <p className="hint">All four are set together. A version is a whole snapshot, never a single change.</p>
      <label>
        Tax
        <select value={taxMode} onChange={(e) => setTaxMode(e.target.value)}>
          <option value="Exclusive">Added on top of the price</option>
          <option value="Inclusive">Already inside the price</option>
        </select>
      </label>
      <label>
        Stock going negative
        <select value={negativeStockPolicy} onChange={(e) => setNegative(e.target.value)}>
          <option value="BlockNegative">Refused</option>
          <option value="AllowNegative">Allowed, and reported</option>
        </select>
      </label>
      <label>
        Return window, in days
        <input inputMode="numeric" autoComplete="off" value={returnWindowDays} onChange={(e) => setWindow(e.target.value)} />
      </label>
      <label>
        A returned item becomes
        <select value={defaultReturnDisposition} onChange={(e) => setDisposition(e.target.value)}>
          <option value="Sellable">Sellable again</option>
          <option value="Quarantine">Held back as quarantine</option>
        </select>
      </label>
      <label>
        Starts (leave empty for now)
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <button type="submit">Set these settings</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
