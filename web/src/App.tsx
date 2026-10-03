import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Workspace } from './lib/api.ts';
import { parseMoney, type Currency } from './lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from './lib/Problem.tsx';
import { Adjustments } from './back/Adjustments.tsx';
import { People } from './back/People.tsx';
import { Prices } from './back/Prices.tsx';
import { Products } from './back/Products.tsx';
import { PaymentsAttention } from './back/PaymentsAttention.tsx';
import { ReferenceData } from './back/Reference.tsx';
import { Refunds } from './back/Refunds.tsx';
import { Returns } from './back/Returns.tsx';
import { Roles } from './back/Roles.tsx';
import { Sales } from './back/Sales.tsx';
import { ShiftReview } from './back/Shifts.tsx';
import { PaymentMethods, ReasonCodes } from './back/Setup.tsx';
import { Stock } from './back/Stock.tsx';
import { StoreSettings, Tills } from './back/Tills.tsx';
import { NotYet, PLANNED, type Planned } from './back/NotYet.tsx';
import { MyAccount } from './MyAccount.tsx';
import { TillWork } from './pos/TillWork.tsx';
import { BeginCount, CountDrawer } from './pos/ShiftClose.tsx';

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

/** The till's shift as the till sees it: trading, being counted, or none open (UX-35). */
export interface TillShift {
  id: string;
  status: string;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  useEffect(() => {
    api<Workspace>('GET', '/session').then(setWorkspace, () => setWorkspace(null));
  }, []);
  if (workspace === undefined) {
    return (
      <main className="center">
        <p className="card" role="status">
          Loading…
        </p>
      </main>
    );
  }
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
    <main className="center">
      <form className="card signin" onSubmit={submit} aria-labelledby="signin-title">
        <p className="brand">SmartStore</p>
        <h1 id="signin-title">Sign in</h1>
        {till !== null && <p className="lede">This browser is a till.</p>}
        <label>
          Username
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit">Sign in</button>
        {error !== null && (
          <div role="alert" className="problem" data-kind={problemOf(error).system ? 'system' : 'user'}>
            {error.message}
            {error.code === 'sign_in_blocked' && till !== null && (
              <button type="button" onClick={() => (writeTill(null), setError(null))}>
                Stop using this browser as a till
              </button>
            )}
          </div>
        )}
      </form>
    </main>
  );
}

function SignedIn({ workspace, onSignedOut }: { workspace: Workspace; onSignedOut: () => void }) {
  const [shift, setShift] = useState<TillShift | null | undefined>(undefined);
  const [account, setAccount] = useState(false);
  const signOut = async () => {
    await api('DELETE', '/session').catch(() => undefined);
    onSignedOut();
  };
  const store = workspace.terminal === null ? workspace.stores[0] : workspace.stores.find((s) => s.id === workspace.terminal!.storeId);
  const where = [workspace.organization.name, store?.name, workspace.terminal?.label].filter((part) => part !== undefined).join(' · ');
  return (
    <div className="app">
      <header className="bar">
        <span className="brand">SmartStore</span>
        <span className="where">{where}</span>
        {workspace.terminal !== null && <DrawerState shift={shift} />}
        {/* `EM-03`: changing your own password takes no permission, so it is offered to everyone, from anywhere.
            Their own name is the way in, which is what a person recognises as themselves. */}
        <button
          type="button"
          className="quiet who"
          aria-expanded={account}
          aria-label={`My account — ${workspace.employee.name}`}
          onClick={() => setAccount((open) => !open)}
        >
          {workspace.employee.name}
        </button>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main>
        {account ? (
          <MyAccount name={workspace.employee.name} />
        ) : store === undefined ? (
          // UX-07, MS-05: no store access is an empty workspace with an explanation, not an error.
          <section className="panel narrow">
            <h1>No store yet</h1>
            <p>You have no access to a store yet. Ask the owner or a manager to give you access.</p>
          </section>
        ) : workspace.terminal === null ? (
          <BackOffice store={store} organization={workspace.organization.permissions} stores={workspace.stores} onTillSet={signOut} />
        ) : (
          <ShiftGate
            storeId={store.id}
            currency={{ code: store.currencyCode, exponent: store.minorUnitExponent }}
            canOpen={store.permissions.includes('Shift.Open')}
            canSell={store.permissions.includes('Sale.Create')}
            canClose={store.permissions.includes('Shift.Close')}
            canAcknowledge={store.permissions.includes('Cash.Variance.Acknowledge')}
            permissions={store.permissions}
            shift={shift}
            onShift={setShift}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The drawer's state, on the till at all times (UX-35), in words beside a symbol, never colour alone (UX-52): a filled
 * circle while trading, a half circle while the drawer is counted, an empty one when no shift is open or it has closed.
 */
function DrawerState({ shift }: { shift: TillShift | null | undefined }) {
  if (shift === undefined) return null;
  const [state, symbol, words] =
    shift === null
      ? ['none', '○', 'No open shift']
      : shift.status === 'Reconciling'
        ? ['counting', '◐', 'Counting the drawer']
        : shift.status === 'Closed'
          ? ['none', '○', 'Shift closed']
          : ['open', '●', 'Shift open'];
  return (
    <span className="chip" data-state={state}>
      <span aria-hidden="true">{symbol}</span>
      <span>{words}</span>
    </span>
  );
}

type Store = Workspace['stores'][number];

/**
 * Away from a till: only the work this person may do is offered, and nothing they may not (UX-05, UX-08). Reviewing
 * shifts needs Cash.Count.View and setting up a till Device.View, in the store. People and roles are the
 * organization's, so they need Employee.View and Role.View held organization-wide. With none, the page says so.
 */
interface Entry {
  key: string;
  label: string;
  /** The permission whose presence makes this area this person's to have (`UX-05`, `UX-08`). */
  key_: string;
  /** `store` keys are held per store, `organization` keys organization-wide (OQ-025 item 6). */
  scope: 'store' | 'organization';
}

/**
 * The back office, grouped as the specification groups it, each area present only with the permission that opens it.
 * The grouping is: selling, the catalogue, stock, money, people, and setup. A group with nothing this person may do is not
 * shown at all (`UX-08`), and the list is the product's, so an area the specification requires but the build lacks
 * still appears — under "Not built yet", where it says so (`UX-08`, `UX-57`).
 */
const GROUPS: { group: string; entries: Entry[] }[] = [
  {
    group: 'Sell',
    entries: [
      { key: 'till', label: 'Set up this browser as a till', key_: 'Device.View', scope: 'store' },
      { key: 'shifts', label: 'Shifts', key_: 'Cash.Count.View', scope: 'store' },
      { key: 'sales', label: 'Sales and receipts', key_: 'Sale.View', scope: 'store' },
      { key: 'returns', label: 'Returns', key_: 'Return.View', scope: 'store' },
      { key: 'refunds', label: 'Refunds', key_: 'Refund.View', scope: 'store' },
    ],
  },
  {
    group: 'Catalogue',
    entries: [
      { key: 'products', label: 'Products', key_: 'Product.View', scope: 'organization' },
      { key: 'prices', label: 'Prices', key_: 'Price.View', scope: 'organization' },
      { key: 'reference', label: 'Units, tax, categories and brands', key_: 'Product.View', scope: 'organization' },
    ],
  },
  {
    group: 'Stock',
    entries: [
      { key: 'stock', label: 'Stock on hand', key_: 'Inventory.View', scope: 'store' },
      { key: 'ledger', label: 'Movement ledger', key_: 'Inventory.Ledger.View', scope: 'store' },
      { key: 'adjustments', label: 'Corrections and write-offs', key_: 'Inventory.View', scope: 'store' },
      { key: 'opening', label: 'Opening stock', key_: 'Inventory.View', scope: 'store' },
    ],
  },
  {
    group: 'Money',
    entries: [
      { key: 'attention', label: 'Card payments to check', key_: 'Payment.View', scope: 'store' },
      { key: 'payments', label: 'Payment methods', key_: 'Payment.Method.Configure', scope: 'organization' },
    ],
  },
  {
    group: 'People',
    entries: [
      { key: 'people', label: 'People', key_: 'Employee.View', scope: 'organization' },
      { key: 'roles', label: 'Roles', key_: 'Role.View', scope: 'organization' },
    ],
  },
  {
    group: 'Setup',
    entries: [
      { key: 'tills', label: 'Tills', key_: 'Device.View', scope: 'store' },
      { key: 'settings', label: 'Store settings', key_: 'Config.Store', scope: 'store' },
      { key: 'reasons', label: 'Reason codes', key_: 'Config.Organization', scope: 'organization' },
    ],
  },
];



/**
 * Away from a till: only the work this person may do is offered, and nothing they may not (`UX-05`, `UX-08`). The
 * catalogue, the people and the payment methods are the organization's, so they need their keys held organization-wide;
 * the rest are the store's. With no area at all, the page says so rather than showing an empty shell.
 */
function BackOffice({ store, organization, stores, onTillSet }: { store: Store; organization: string[]; stores: Store[]; onTillSet: () => void }) {
  const keys = (scope: Entry['scope']) => (scope === 'store' ? store.permissions : organization);
  const groups = GROUPS.map((g) => ({ ...g, entries: g.entries.filter((e) => keys(e.scope).includes(e.key_)) })).filter((g) => g.entries.length > 0);
  // The areas with no route are listed when this person has the key that would open them, and never otherwise.
  const gaps = PLANNED.filter((a) => keys(a.scope).includes(a.key_));
  const gapKey = (area: Planned) => `gap:${area.name}`;
  const [section, setSection] = useState<string | null>(null);
  // A refund of a posted return starts on the Returns screen and opens on the Refunds screen.
  const [refundFrom, setRefundFrom] = useState<string | null>(null);
  // A refund of a captured payment with no sale starts on the payments report and opens on the Refunds screen (D-18).
  const [refundPayment, setRefundPayment] = useState<string | null>(null);
  const currency = { code: store.currencyCode, exponent: store.minorUnitExponent };
  const shown = section ?? groups[0]?.entries[0]?.key ?? (gaps[0] !== undefined ? gapKey(gaps[0]) : null);
  if (shown === null) {
    return (
      <section className="panel narrow">
        <h1>Nothing here yet</h1>
        <p>
          Your role has none of the keys that open a back-office area, so there is nothing to show. A manager can give you
          access; the list of keys is under Roles.
        </p>
      </section>
    );
  }
  const gap = gaps.find((a) => shown === gapKey(a));
  return (
    <div className="backoffice">
      <nav className="groups" aria-label="Back office">
        {groups.map((g) => (
          <div key={g.group} role="group" aria-label={g.group}>
            <p className="group-name">{g.group}</p>
            {g.entries.map((e) => (
              <button key={e.key} type="button" aria-current={shown === e.key ? 'page' : undefined} onClick={() => setSection(e.key)}>
                {e.label}
              </button>
            ))}
          </div>
        ))}
        {gaps.length > 0 && (
          <div role="group" aria-label="Not built yet">
            <p className="group-name">Not built yet</p>
            {gaps.map((a) => (
              <button key={a.name} type="button" aria-current={shown === gapKey(a) ? 'page' : undefined} onClick={() => setSection(gapKey(a))}>
                {a.name}
                <span className="visually-hidden"> — specified but not built</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      <div className="panel-area">
        {shown === 'till' && <TillSetup storeId={store.id} canSetUp={store.permissions.includes('Device.View')} onDone={onTillSet} />}
        {shown === 'shifts' && <ShiftReview storeId={store.id} currency={currency} canAcknowledge={store.permissions.includes('Cash.Variance.Acknowledge')} />}
        {shown === 'sales' && <Sales storeId={store.id} permissions={store.permissions} currency={currency} />}
        {shown === 'returns' && <Returns storeId={store.id} permissions={store.permissions} onRefund={(id) => (setRefundFrom(id), setSection('refunds'))} />}
        {shown === 'refunds' && <Refunds storeId={store.id} permissions={store.permissions} currency={currency} startFromReturn={refundFrom} startFromPayment={refundPayment} onStarted={() => (setRefundFrom(null), setRefundPayment(null))} />}
        {shown === 'attention' && <PaymentsAttention storeId={store.id} permissions={store.permissions} currency={currency} onRefund={(id) => (setRefundPayment(id), setSection('refunds'))} />}
        {shown === 'products' && <Products permissions={organization} currency={currency} />}
        {shown === 'prices' && <Prices permissions={organization} currency={currency} />}
        {shown === 'reference' && <ReferenceData permissions={organization} />}
        {shown === 'stock' && <Stock storeId={store.id} permissions={store.permissions} startOn="balances" />}
        {shown === 'ledger' && <Stock storeId={store.id} permissions={store.permissions} startOn="ledger" />}
        {shown === 'adjustments' && <Adjustments storeId={store.id} permissions={store.permissions} startOn="adjustments" />}
        {shown === 'opening' && <Adjustments storeId={store.id} permissions={store.permissions} startOn="opening-balances" />}
        {shown === 'payments' && (
          <PaymentMethods storeId={store.id} storeName={store.name} canSetAtStore={store.permissions.includes('Payment.Method.Configure')} />
        )}
        {shown === 'people' && <People permissions={organization} stores={stores} />}
        {shown === 'roles' && <Roles permissions={organization} />}
        {shown === 'tills' && <Tills storeId={store.id} permissions={store.permissions} />}
        {shown === 'settings' && <StoreSettings storeId={store.id} canSet={store.permissions.includes('Config.Store')} />}
        {shown === 'reasons' && <ReasonCodes canConfigure={organization.includes('Config.Organization')} />}
        {gap !== undefined && <NotYet area={gap} />}
      </div>
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
  if (!canSetUp) {
    return (
      <section className="panel narrow">
        <h1>Not a till yet</h1>
        <p>This browser is not set up as a till. Ask a manager to set it up.</p>
      </section>
    );
  }
  if (chosen !== null) {
    return (
      <section className="panel narrow">
        <h1>This browser is now a till</h1>
        <p>Sign in again to use it.</p>
        <button type="button" className="primary" autoFocus onClick={onDone}>
          Sign out now
        </button>
      </section>
    );
  }
  const active = (tills ?? []).filter((t) => t.status === 'Active');
  return (
    <section className="panel narrow">
      <h1>Set up this browser as a till</h1>
      {tills === null ? (
        <p role="status">Loading…</p>
      ) : active.length === 0 ? (
        <p>This store has no active till. Register and activate one first.</p>
      ) : (
        <>
          <p className="lede">Choose the till this browser stands in for.</p>
          <ul className="choices">
            {active.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => (writeTill(t.id), setChosen(t.id))}>
                  {t.label} ({t.code})
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ShiftGate({
  storeId,
  currency,
  canOpen,
  canSell,
  canClose,
  canAcknowledge,
  permissions,
  shift,
  onShift,
}: {
  storeId: string;
  currency: Currency;
  canOpen: boolean;
  canSell: boolean;
  canClose: boolean;
  canAcknowledge: boolean;
  /** The keys held in this store: what the till may take a card with, and which of its tools it offers (D-16, D-17). */
  permissions: string[];
  shift: TillShift | null | undefined;
  onShift: (shift: TillShift | null) => void;
}) {
  const [float, setFloat] = useState('0');
  const [error, setError] = useState<Problem | null>(null);
  const [closing, setClosing] = useState(false);
  // How many lines the sale's cart holds: the shift is not closed over a cart (UX-57).
  const [cartLines, setCartLines] = useState(0);
  useEffect(() => {
    if (canSell) api<{ shift: TillShift | null }>('GET', `/stores/${storeId}/shift`).then((r) => onShift(r.shift), (e: unknown) => setError(problemOf(e)));
  }, [storeId, canSell, onShift]);
  if (!canSell) {
    return (
      <section className="panel narrow">
        <p>You cannot sell at this till. Ask a manager for access.</p>
      </section>
    );
  }
  if (shift === undefined) {
    return error === null ? (
      <p className="panel narrow" role="status">
        Loading…
      </p>
    ) : (
      <section className="panel narrow">
        <ProblemNotice problem={error} />
      </section>
    );
  }
  if (shift !== null && (shift.status === 'Reconciling' || shift.status === 'Closed')) {
    // UX-33: a shift being counted is its own mode, and takes no sale (the server refuses one too: BI-39). It stays on
    // screen once closed, for its summary, until the cashier is done.
    return (
      <CountDrawer
        storeId={storeId}
        shiftId={shift.id}
        currency={currency}
        canAcknowledge={canAcknowledge}
        onClosed={() => onShift({ id: shift.id, status: 'Closed' })}
        onDone={() => onShift(null)}
      />
    );
  }
  if (shift !== null) {
    // The question sits above the sale, which stays mounted, so its cart survives a change of mind (UX-57).
    return (
      <>
        {canClose && (
          <div className="till-tools">
            {closing ? (
              <BeginCount
                shiftId={shift.id}
                cartLines={cartLines}
                onBegun={() => (setClosing(false), onShift({ id: shift.id, status: 'Reconciling' }))}
                onCancel={() => {
                  setClosing(false);
                  // Back to the scan field, the keyboard path (UX-01).
                  setTimeout(() => document.getElementById('code')?.focus());
                }}
              />
            ) : (
              <button type="button" onClick={() => setClosing(true)}>
                Close shift…
              </button>
            )}
          </div>
        )}
        <TillWork storeId={storeId} currency={currency} permissions={permissions} onCartChange={setCartLines} />
      </>
    );
  }
  if (!canOpen) {
    return (
      <section className="panel narrow">
        <p>The shift at this till is not open. Ask someone who can open it.</p>
      </section>
    );
  }
  const open = async (event: FormEvent) => {
    event.preventDefault();
    // The float is counted in the store's currency, to its decimal places (BI-01); v1 counts a total (CD-27 deferred).
    const amount = parseMoney(float, currency.exponent);
    if (amount === null) return setError(check(`Enter the counted float, with at most ${currency.exponent} decimal places.`));
    try {
      onShift((await api<{ shift: TillShift }>('POST', `/stores/${storeId}/shift`, { openingFloat: amount })).shift);
    } catch (e) {
      setError(problemOf(e));
    }
  };
  return (
    <form className="panel narrow" onSubmit={open} aria-labelledby="open-title">
      <h1 id="open-title">Open the shift</h1>
      <p className="lede">Count the cash in the drawer and enter the total. Sales start once the shift is open.</p>
      <label>
        Counted opening float ({currency.code})
        <input autoFocus inputMode="decimal" autoComplete="off" value={float} onChange={(e) => setFloat(e.target.value)} />
      </label>
      <button type="submit">Open shift</button>
      <ProblemNotice problem={error} />
    </form>
  );
}
