import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Workspace } from './lib/api.ts';
import { parseMoney, type Currency } from './lib/money.ts';
import { SaleScreen } from './pos/Sale.tsx';

/**
 * Which till this browser is (architecture §7.4: device credentials are deferred with devices, so a manager sets it once
 * here, and every sign-in on this browser names it; the server checks it).
 */
const TILL_KEY = 'smartstore.till';
const readTill = (): string | null => {
  try {
    return localStorage.getItem(TILL_KEY);
  } catch {
    return null;
  }
};
const writeTill = (id: string | null): void => {
  try {
    if (id === null) localStorage.removeItem(TILL_KEY);
    else localStorage.setItem(TILL_KEY, id);
  } catch {
    // A browser that cannot store it signs in without a till.
  }
};

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  useEffect(() => {
    api<Workspace>('GET', '/session').then(setWorkspace, () => setWorkspace(null));
  }, []);
  if (workspace === undefined) return <p className="panel">Loading…</p>;
  if (workspace === null) return <SignIn onSignedIn={setWorkspace} />;
  return <SignedIn workspace={workspace} onSignedOut={() => setWorkspace(null)} />;
}

function SignIn({ onSignedIn }: { onSignedIn: (w: Workspace) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const till = readTill();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      onSignedIn(await api<Workspace>('POST', '/session', { username, password, ...(till === null ? {} : { terminalId: till }) }));
    } catch (e) {
      setError(e as ApiError);
    }
  };
  return (
    <form className="panel narrow" onSubmit={submit} aria-labelledby="signin-title">
      <h1 id="signin-title">Sign in</h1>
      <label>
        Username
        <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit">Sign in</button>
      {till !== null && <p className="hint">This browser is a till.</p>}
      {error !== null && (
        <div role="alert" className="error">
          {error.message}
          {error.code === 'sign_in_blocked' && till !== null && (
            <button type="button" onClick={() => (writeTill(null), setError(null))}>
              Stop using this browser as a till
            </button>
          )}
        </div>
      )}
    </form>
  );
}

function SignedIn({ workspace, onSignedOut }: { workspace: Workspace; onSignedOut: () => void }) {
  const signOut = async () => {
    await api('DELETE', '/session').catch(() => undefined);
    onSignedOut();
  };
  const store = workspace.terminal === null ? workspace.stores[0] : workspace.stores.find((s) => s.id === workspace.terminal!.storeId);
  return (
    <div className="app">
      <header className="bar">
        <span>{workspace.organization.name}</span>
        {store !== undefined && <span>{store.name}</span>}
        {workspace.terminal !== null && <span>{workspace.terminal.label}</span>}
        <span>{workspace.employee.name}</span>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </header>
      {store === undefined ? (
        // UX-07, MS-05: no store access is an empty workspace with an explanation, not an error.
        <p className="panel">You have no access to a store yet. Ask the owner or a manager to give you access.</p>
      ) : workspace.terminal === null ? (
        <TillSetup storeId={store.id} canSetUp={store.permissions.includes('Device.View')} onDone={signOut} />
      ) : (
        <ShiftGate
          storeId={store.id}
          currency={{ code: store.currencyCode, exponent: store.minorUnitExponent }}
          canOpen={store.permissions.includes('Shift.Open')}
          canSell={store.permissions.includes('Sale.Create')}
        />
      )}
    </div>
  );
}

interface Terminal {
  id: string;
  code: string;
  label: string;
  status: string;
}

function TillSetup({ storeId, canSetUp, onDone }: { storeId: string; canSetUp: boolean; onDone: () => void }) {
  const [tills, setTills] = useState<Terminal[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    if (canSetUp) api<{ items: Terminal[] }>('GET', `/stores/${storeId}/terminals`).then((r) => setTills(r.items), () => setTills([]));
  }, [storeId, canSetUp]);
  if (!canSetUp) return <p className="panel">This browser is not set up as a till. Ask a manager to set it up.</p>;
  if (chosen !== null) {
    return (
      <div className="panel">
        <p>This browser is now a till. Sign in again to use it.</p>
        <button type="button" autoFocus onClick={onDone}>
          Sign out now
        </button>
      </div>
    );
  }
  return (
    <div className="panel">
      <h1>Set up this browser as a till</h1>
      {tills === null ? (
        <p>Loading…</p>
      ) : tills.filter((t) => t.status === 'Active').length === 0 ? (
        <p>This store has no active till. Register and activate one first.</p>
      ) : (
        <ul className="choices">
          {tills
            .filter((t) => t.status === 'Active')
            .map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => (writeTill(t.id), setChosen(t.id))}>
                  {t.label} ({t.code})
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function ShiftGate({ storeId, currency, canOpen, canSell }: { storeId: string; currency: Currency; canOpen: boolean; canSell: boolean }) {
  const [shift, setShift] = useState<{ id: string } | null | undefined>(undefined);
  const [float, setFloat] = useState('0');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (canSell) api<{ shift: { id: string } | null }>('GET', `/stores/${storeId}/shift`).then((r) => setShift(r.shift), (e: ApiError) => setError(e.message));
  }, [storeId, canSell]);
  if (!canSell) return <p className="panel">You cannot sell at this till. Ask a manager for access.</p>;
  if (shift === undefined) return <p className="panel">{error ?? 'Loading…'}</p>;
  if (shift !== null) return <SaleScreen storeId={storeId} currency={currency} />;
  if (!canOpen) return <p className="panel">The shift at this till is not open. Ask someone who can open it.</p>;
  const open = async (event: FormEvent) => {
    event.preventDefault();
    // The float is counted in the store's currency, to its decimal places (BI-01); v1 counts a total (CD-27 deferred).
    const amount = parseMoney(float, currency.exponent);
    if (amount === null) return setError(`Enter the counted float, with at most ${currency.exponent} decimal places.`);
    try {
      setShift((await api<{ shift: { id: string } }>('POST', `/stores/${storeId}/shift`, { openingFloat: amount })).shift);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  return (
    <form className="panel narrow" onSubmit={open}>
      <h1>Open the shift</h1>
      <label>
        Counted opening float
        <input autoFocus inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} />
      </label>
      <button type="submit">Open shift</button>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
