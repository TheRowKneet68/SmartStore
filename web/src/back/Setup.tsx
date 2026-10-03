import { useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { useList } from '../lib/form.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

interface Reason {
  id: string;
  code: string;
  name: string;
}

interface Method {
  id: string;
  code: string;
  name: string;
  methodType: string;
}

type Said = (outcome: string) => void;

/**
 * The organization's reason codes (`BI-25`, `IV-33`, overview §3.8). None is seeded: the list is the organization's own,
 * kept under `Config.Organization` (§2.12). Every reasoned action picks from it — an adjustment, a receipt reprint, a
 * product change. Reading them needs only a session, because any signed-in employee may need to pick one.
 *
 * An archived code takes no new document (`SS024`) and is never deleted: the documents that name it keep naming it.
 */
export function ReasonCodes({ canConfigure }: { canConfigure: boolean }) {
  const { items, problem, setProblem, reload } = useList<Reason>('/reason-codes');
  const [said, setSaid] = useState('');

  return (
    <section className="panel" aria-labelledby="reasons-title">
      <h1 id="reasons-title">Reason codes</h1>
      <Announcer text={said} />
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>There are no reason codes yet. A stock correction and a receipt reprint both need one.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Reason codes, by code</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">What it is for</th>
              {canConfigure && (
                <th scope="col">
                  <span className="visually-hidden">Change</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                {canConfigure && (
                  <td>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api('POST', `/reason-codes/${r.id}/archive`, {});
                          setSaid(`${r.name} was archived. Documents that already name it keep it.`);
                          reload();
                        } catch (e) {
                          setProblem(problemOf(e));
                        }
                      }}
                      aria-label={`Archive the reason code ${r.name}`}
                    >
                      Archive
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canConfigure && <NewReason onSaid={setSaid} onDone={reload} onProblem={setProblem} />}
    </section>
  );
}

function NewReason({ onSaid, onDone, onProblem }: { onSaid: Said; onDone: () => void; onProblem: (p: Problem) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === '') return setProblem(check('Give the code a short value, like DAMAGED or CUSTOMER_RETURN.'));
    if (name.trim() === '') return setProblem(check('Say what the reason is for.'));
    try {
      await api('POST', '/reason-codes', { code: code.trim(), name: name.trim() });
      setProblem(null);
      setCode('');
      setName('');
      onSaid(`The reason code ${code.trim()} was added.`);
      onDone();
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-labelledby="new-reason-title">
      <h2 id="new-reason-title">Add a reason code</h2>
      <label>
        Code
        <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label>
        What it is for
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Add the reason code</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

/**
 * Payment methods (`PY-03`: typed, and v1's types are Cash and Card) and whether each is on at this store (`PY-05`).
 * The methods are the organization's, under `Payment.Method.Configure` (§2.11); switching one on at a store is checked
 * against that store, so the switch is only offered with the key held there as well. A method switched off is refused at
 * the till (`SS045`), and a method on takes effect for the next sale without any further action.
 *
 * Nothing reads the store's standing back: there is no route for it, so this screen says "not set here" rather than
 * showing a box that looks like a known state and quietly guesses. What it shows is what this session set.
 */
export function PaymentMethods({ storeId, storeName, canSetAtStore }: { storeId: string; storeName: string; canSetAtStore: boolean }) {
  const { items, problem, setProblem, reload } = useList<Method>('/payment-methods');
  const [set, setSet] = useState<Record<string, boolean>>({});
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const choose = async (method: Method, on: boolean) => {
    setBusy(method.id);
    try {
      await api('PUT', `/stores/${storeId}/payment-methods/${method.id}`, { enabled: on });
      setSet((was) => ({ ...was, [method.id]: on }));
      setSaid(`${method.name} is now ${on ? 'accepted' : 'not accepted'} at ${storeName}.`);
      reload();
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel" aria-labelledby="payments-title">
      <h1 id="payments-title">Payment methods</h1>
      <Announcer text={said} />
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>No payment method has been defined yet.</p>
      ) : (
        <>
          <table className="records">
            <caption className="visually-hidden">Payment methods, and what this session set at {storeName}</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">At {storeName}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td>{m.code}</td>
                  <td>{m.name}</td>
                  <td>{m.methodType}</td>
                  <td>
                    {set[m.id] === undefined ? (
                      <span className="hint">Not read — the server has no route that says it</span>
                    ) : set[m.id] ? (
                      <>
                        <span aria-hidden="true">● </span>Accepted here
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">○ </span>Not accepted here
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canSetAtStore ? (
            <fieldset>
              <legend>Set a method at {storeName}</legend>
              {items.map((m) => (
                <div key={m.id} className="actions">
                  <button type="button" disabled={busy !== null} onClick={() => void choose(m, true)} aria-label={`Accept ${m.name} at ${storeName}`}>
                    Accept <span aria-hidden="true">●</span>
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void choose(m, false)} aria-label={`Stop accepting ${m.name} at ${storeName}`}>
                    Stop accepting <span aria-hidden="true">○</span>
                  </button>
                </div>
              ))}
            </fieldset>
          ) : (
            <p className="hint">You may define methods but not set one at {storeName}; that needs the key in this store.</p>
          )}
        </>
      )}
      <NewMethod onSaid={setSaid} onDone={reload} onProblem={setProblem} />
    </section>
  );
}

function NewMethod({ onSaid, onDone, onProblem }: { onSaid: Said; onDone: () => void; onProblem: (p: Problem) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [methodType, setType] = useState('Cash');
  const [problem, setProblem] = useState<Problem | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === '') return setProblem(check('Give the method a short code.'));
    if (name.trim() === '') return setProblem(check('Give the method a name people will recognise at the till.'));
    try {
      await api('POST', '/payment-methods', { code: code.trim(), name: name.trim(), methodType });
      setProblem(null);
      setCode('');
      setName('');
      onSaid(`The payment method ${name.trim()} was added. Switch it on at each store that takes it.`);
      onDone();
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-labelledby="new-method-title">
      <h2 id="new-method-title">Add a payment method</h2>
      <p className="hint">Cash and Card are this version's types (`PY-03`). A card is authorized and captured as one act; no split tender, partial payment or refund is built yet.</p>
      <label>
        Code
        <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label>
        Name
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Kind
        <select value={methodType} onChange={(e) => setType(e.target.value)}>
          <option value="Cash">Cash</option>
          <option value="Card">Card</option>
        </select>
      </label>
      <button type="submit">Add the payment method</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
