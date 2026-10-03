import { useState } from 'react';
import { useList, when } from '../lib/form.ts';
import { ProblemNotice, type Problem } from '../lib/Problem.tsx';

/** A stock balance at one location (`IV-01`, `IV-02`). Negative quantities are shown as they are (`IV-17`). */
interface Balance {
  variantId: string;
  product: string;
  variant: string | null;
  locationId: string;
  location: string;
  onHand: string;
  movementCount: number;
  lastMovementAt: string | null;
}

/** One movement (`IV-06`). A reversal is its own movement pointing back at the one it compensates (`IV-12`). */
interface Movement {
  seq: number;
  id: string;
  movementType: string;
  direction: 'In' | 'Out';
  quantity: string;
  resultingBalance: string;
  variantId: string;
  locationId: string;
  createdAt: string;
  createdBy: string;
  businessDate: string;
  reversesMovementId: string | null;
  saleId: string | null;
  stockAdjustmentId: string | null;
  customerReturnId: string | null;
}

interface Location {
  id: string;
  code: string;
  name: string;
  locationType: string;
  isSellable: boolean;
  warehouseCode: string;
  warehouseName: string;
}

/**
 * What the store holds and how it got that way (`IV-06`): balances at this store's own locations plus central ones
 * attributed to it (`MS-16`, `MS-17`, `D-03`), then the ledger behind them, then the locations themselves.
 *
 * Stock is read here, never set: a balance moves only when a document is posted (`IV-14`), which is the adjustments
 * screen. Balances take `Inventory.View`; the ledger takes `Inventory.Ledger.View`, separate because it shows who moved
 * what (§2.2). The balances tab is never shown without `Inventory.View`.
 */
export function Stock({
  storeId,
  permissions,
  startOn = 'balances',
}: {
  storeId: string;
  permissions: string[];
  /** Which tab to open on, because the navigation offers balances and the ledger as separate entries. */
  startOn?: 'balances' | 'ledger' | 'locations';
}) {
  const can = (key: string) => permissions.includes(key);
  const views = (
    [
      ['balances', 'Stock on hand', 'Inventory.View'],
      ['ledger', 'Movement ledger', 'Inventory.Ledger.View'],
      ['locations', 'Locations', 'Inventory.View'],
    ] as const
  ).filter(([, , key]) => can(key));
  const [view, setView] = useState<typeof views[number][0]>(views.some(([key]) => key === startOn) ? startOn : (views[0]?.[0] ?? 'balances'));

  if (views.length === 0) {
    return (
      <section className="panel" aria-labelledby="stock-title">
        <h1 id="stock-title">Stock</h1>
        <p>You do not have permission to read stock. A role with `Inventory.View` can (`UX-05`).</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-labelledby="stock-title">
      <h1 id="stock-title">Stock</h1>
      <nav className="subtabs" aria-label="Stock">
        {views.map(([key, label]) => (
          <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </nav>
      {view === 'balances' && <Balances storeId={storeId} />}
      {view === 'ledger' && <Ledger storeId={storeId} />}
      {view === 'locations' && <Locations storeId={storeId} />}
    </section>
  );
}

/** Where to read. A location narrows both balances and the ledger to one place (`MS-17`). */
function AtLocation({ storeId, at, onChange }: { storeId: string; at: string; onChange: (id: string) => void }) {
  const locations = useList<Location>(`/stores/${storeId}/locations`);
  return (
    <label>
      Location
      <select value={at} onChange={(e) => onChange(e.target.value)}>
        <option value="">Every location in this store</option>
        {(locations.items ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} — {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Balances({ storeId }: { storeId: string }) {
  const [at, setAt] = useState('');
  const query = at === '' ? '' : `?locationId=${at}`;
  const { items, problem } = useList<Balance>(`/stores/${storeId}/stock${query}`);
  return (
    <>
      <AtLocation storeId={storeId} at={at} onChange={setAt} />
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>Nothing is held here. Stock appears here when a document is posted.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">On-hand stock by variant and location</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Location</th>
              <th scope="col" className="num">
                On hand
              </th>
              <th scope="col" className="num">
                Movements
              </th>
              <th scope="col">Last moved</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={`${b.variantId}-${b.locationId}`}>
                <td>{b.variant === null ? b.product : `${b.product} — ${b.variant}`}</td>
                <td>{b.location}</td>
                <td className="num">{b.onHand}</td>
                <td className="num">{b.movementCount}</td>
                <td>{b.lastMovementAt === null ? 'Never' : when(b.lastMovementAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * The movement ledger (`IV-06`), newest first, paged by the last sequence number shown (§18.5). It is append-only: a
 * reversal adds a movement rather than editing one, so the history stays whole (`IV-12`).
 */
function Ledger({ storeId }: { storeId: string }) {
  const [at, setAt] = useState('');
  const [before, setBefore] = useState<number | null>(null);
  const query = new URLSearchParams({ ...(at === '' ? {} : { locationId: at }), ...(before === null ? {} : { before: String(before) }) }).toString();
  const { items, body, problem } = useList<Movement>(`/stores/${storeId}/movements${query === '' ? '' : `?${query}`}`);
  const older = body?.before ?? null;
  return (
    <>
      <AtLocation
        storeId={storeId}
        at={at}
        onChange={(id) => {
          setAt(id);
          setBefore(null);
        }}
      />
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>Nothing has moved here.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Inventory movements, newest first</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Which way</th>
              <th scope="col" className="num">
                How much
              </th>
              <th scope="col" className="num">
                Left after it
              </th>
              <th scope="col">Who</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td>{when(m.createdAt)}</td>
                <td>
                  {m.movementType.replaceAll('_', ' ').toLowerCase()}
                  {m.reversesMovementId !== null && <span className="hint"> (reverses an earlier movement)</span>}
                </td>
                <td>{m.direction === 'In' ? 'In — added' : 'Out — removed'}</td>
                <td className="num">{m.quantity}</td>
                <td className="num">{m.resultingBalance}</td>
                <td>{m.createdBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {older !== null && (
        <div className="actions">
          <button type="button" onClick={() => setBefore(older)}>
            Show earlier movements
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The store's locations: those of its own warehouses, and central ones attributed to it (`MS-16`, `MS-17`, `D-03`). A
 * sellable location is one a till may sell from; the rest hold stock only.
 */
function Locations({ storeId }: { storeId: string }) {
  const { items, problem } = useList<Location>(`/stores/${storeId}/locations`);
  return (
    <>
      <p className="hint">A till sells from a sellable location. A central location is shared with other stores.</p>
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>This store has no location yet.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">This store's locations</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Warehouse</th>
              <th scope="col">Kind</th>
              <th scope="col">Sellable</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td>{l.code}</td>
                <td>{l.name}</td>
                <td>
                  {l.warehouseCode} — {l.warehouseName}
                </td>
                <td>{l.locationType}</td>
                <td>{l.isSellable ? 'Yes' : 'No — stock only'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export type { Problem };
