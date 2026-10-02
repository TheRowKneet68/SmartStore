import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api, ApiError } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

/**
 * Returns: goods back against one sale of the store (`RR-01`, `RR-08`). The screen speaks the server's contract exactly
 * (D5 §10, D-17) and decides nothing the server decides: the bounds (`RR-14`), the window (`RR-10`), the disposition's
 * location (`RR-19`) and the late approver (`RR-11`, `AP-08`) are the database's, and a refusal is shown in place with its
 * next step (`UX-55`, `UX-57`). The keys are the server's: reading is `Return.View`; opening, filling, posting and cancelling
 * are `Return.Create`; the late approval is `Return.Approve`.
 */

interface ReturnRow {
  id: string;
  documentNumber: number;
  saleDocumentNumber: number;
  status: string;
  businessDate: string | null;
  lines: number;
}

interface ReturnLine {
  id: string;
  saleLineId: string;
  quantity: string;
  disposition: string;
  locationId: string;
}

export interface ReturnDoc {
  id: string;
  documentNumber: number;
  saleId: string;
  status: string;
  businessDate: string | null;
  lateApprovedBy: string | null;
  lines: ReturnLine[];
}

interface SaleLine {
  saleLineId: string;
  lineNumber: number;
  description: string;
  quantity: string;
  returnedQuantity: string;
}

interface SaleDetail {
  saleId: string;
  documentNumber: number;
  status: string;
  lines: SaleLine[];
}

interface Location {
  id: string;
  code: string;
  name: string;
  locationType: string;
  isSellable: boolean;
  warehouseName: string;
}

interface Reason {
  id: string;
  name: string;
}

const STATUS: Record<string, Look> = {
  Draft: ['counting', '◐', 'Draft'],
  Posted: ['open', '●', 'Posted'],
  Cancelled: ['none', '○', 'Cancelled'],
};

/** A disposition and the kind of location it goes to (`RR-17`, `RR-19`, batch-expiry-fefo §6). The server judges it again. */
const DISPOSITIONS = ['Sellable', 'Quarantine', 'Damaged', 'Expired'] as const;
const fits = (disposition: string, l: Location): boolean =>
  disposition === 'Sellable' ? l.isSellable : disposition === 'Quarantine' ? l.locationType === 'Quarantine' : disposition === 'Damaged' ? l.locationType === 'Damaged' : l.locationType === 'ExpiredHold';

const trim = (quantity: string): string => (quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity);
const when = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${date}T00:00:00`));
const operation = (): string => crypto.randomUUID();

export function Returns({ storeId, permissions }: { storeId: string; permissions: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const canCreate = permissions.includes('Return.Create');
  if (open !== null) {
    return (
      <ReturnDetail
        storeId={storeId}
        returnId={open}
        canCreate={canCreate}
        canApprove={permissions.includes('Return.Approve')}
        canSeeSales={permissions.includes('Sale.View')}
        canSeeLocations={permissions.includes('Inventory.View')}
        onBack={() => setOpen(null)}
      />
    );
  }
  return <ReturnList storeId={storeId} canCreate={canCreate} onOpen={setOpen} />;
}

function ReturnList({ storeId, canCreate, onOpen }: { storeId: string; canCreate: boolean; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<ReturnRow[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [number, setNumber] = useState('');
  const [finding, setFinding] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  const attempt = useRef(operation());

  const load = (after: number | null) =>
    api<{ items: ReturnRow[]; next: number | null }>('GET', `/stores/${storeId}/returns?limit=50${filter === '' ? '' : `&status=${filter}`}${after === null ? '' : `&after=${after}`}`).then(
      (r) => {
        setRows((current) => (after === null || current === null ? r.items : [...current, ...r.items]));
        setNext(r.next);
        setProblem(null);
      },
      (e: unknown) => setProblem(problemOf(e)),
    );
  useEffect(() => {
    setRows(null);
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, filter]);

  /** A return is opened against a sale by its number. The sales list pages by number, newest first, so the sale numbered N is the first below N + 1. */
  const start = async (event: FormEvent) => {
    event.preventDefault();
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) return setFinding(check('Enter the number of the sale, for example 1042.'));
    try {
      const found = await api<{ items: { saleId: string; documentNumber: number }[] }>('GET', `/stores/${storeId}/sales?limit=1&after=${n + 1}`);
      const sale = found.items[0];
      if (sale === undefined || sale.documentNumber !== n) return setFinding(check(`This store has no sale numbered ${n}. Check the number on the receipt.`));
      const made = await api<ReturnDoc>('POST', `/stores/${storeId}/returns`, { clientOperationId: attempt.current, saleId: sale.saleId });
      attempt.current = operation();
      setSaid(`Return ${made.documentNumber} opened for sale ${n}.`);
      onOpen(made.id);
    } catch (e) {
      setFinding(problemOf(e));
    }
  };

  return (
    <section className="panel" aria-labelledby="returns-title">
      <h1 id="returns-title">Returns</h1>
      <Announcer text={said} />
      {canCreate && (
        <form onSubmit={start} aria-labelledby="new-return-title">
          <h2 id="new-return-title">Take goods back</h2>
          <label>
            Sale number
            <input autoFocus inputMode="numeric" autoComplete="off" value={number} onChange={(e) => (setNumber(e.target.value), setFinding(null))} />
          </label>
          <button type="submit" className="primary">
            Open a return
          </button>
          <ProblemNotice problem={finding} />
        </form>
      )}
      <label>
        Show
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All returns</option>
          <option value="Draft">Drafts</option>
          <option value="Posted">Posted</option>
          <option value="Cancelled">Cancelled</option>
        </select>
      </label>
      <ProblemNotice problem={problem} />
      {rows === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <p>No returns to show.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Return</th>
              <th scope="col">Sale</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Lines
              </th>
              <th scope="col">Date</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.documentNumber}</td>
                <td>{r.saleDocumentNumber}</td>
                <td>
                  <StatusChip status={r.status} looks={STATUS} />
                </td>
                <td className="num">{r.lines}</td>
                <td>{r.businessDate === null ? '' : when(r.businessDate)}</td>
                <td>
                  <button type="button" onClick={() => onOpen(r.id)} aria-label={`Open return ${r.documentNumber}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next !== null && (
        <button type="button" onClick={() => void load(next)}>
          Show more
        </button>
      )}
    </section>
  );
}

function ReturnDetail({
  storeId,
  returnId,
  canCreate,
  canApprove,
  canSeeSales,
  canSeeLocations,
  onBack,
}: {
  storeId: string;
  returnId: string;
  canCreate: boolean;
  canApprove: boolean;
  canSeeSales: boolean;
  canSeeLocations: boolean;
  onBack: () => void;
}) {
  const [doc, setDoc] = useState<ReturnDoc | null>(null);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [late, setLate] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  const reload = async () => {
    try {
      const d = await api<ReturnDoc>('GET', `/stores/${storeId}/returns/${returnId}`);
      setDoc(d);
      if (canSeeSales) setSale(await api<SaleDetail>('GET', `/stores/${storeId}/sales/${d.saleId}`));
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  useEffect(() => {
    void reload();
    if (canSeeLocations) api<{ items: Location[] }>('GET', `/stores/${storeId}/locations`).then((r) => setLocations(r.items), () => undefined);
    api<{ items: Reason[] }>('GET', '/reason-codes').then((r) => setReasons(r.items), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, returnId]);

  if (doc === null) {
    return (
      <section className="panel">
        <button type="button" onClick={onBack}>
          Back to returns
        </button>
        {problem === null ? <p role="status">Loading…</p> : <ProblemNotice problem={problem} />}
      </section>
    );
  }
  const draft = doc.status === 'Draft';
  const describe = (saleLineId: string): string => {
    const line = sale?.lines.find((l) => l.saleLineId === saleLineId);
    return line === undefined ? 'An item of the sale' : `${line.lineNumber}. ${line.description}`;
  };
  const place = (id: string): string => {
    const l = locations.find((x) => x.id === id);
    return l === undefined ? 'A location of this store' : `${l.warehouseName} · ${l.name}`;
  };

  /** One act against the server, answered in place: its outcome is spoken, and a refusal says what to do next (UX-55, UX-57). */
  const act = async (run: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try {
      await run();
      setLate(null);
      await reload();
      // Said once the screen shows what happened, so what is spoken is what is there.
      setSaid(done);
    } catch (e) {
      // RR-10, RR-11: a return past its window names the day it closed and who may approve it.
      if (e instanceof ApiError && e.code === 'SS048') {
        const closed = typeof e.details.windowClosedOn === 'string' ? ` The window closed on ${when(e.details.windowClosedOn)}.` : '';
        setLate(`This sale is past the return window.${closed} Someone holding the late-approval permission must approve it, signed in as themselves, and then it can be posted.`);
      } else setProblem(problemOf(e));
    }
  };
  const transition = (event: string, extra: object = {}) => api('POST', '/transitions', { machine: 'CustomerReturn', event, subject: doc.id, ...extra });

  return (
    <section className="panel" aria-labelledby="return-title">
      <button type="button" className="quiet" onClick={onBack}>
        Back to returns
      </button>
      <h1 id="return-title">
        Return {doc.documentNumber}
        {sale !== null && ` of sale ${sale.documentNumber}`}
      </h1>
      <Announcer text={said} />
      <p>
        <StatusChip status={doc.status} looks={STATUS} />
        {doc.lateApprovedBy !== null && <span className="hint"> Approved late, past the window.</span>}
      </p>
      <ProblemNotice problem={problem} />
      {late !== null && (
        <p role="alert" className="problem" data-kind="user">
          {late}
        </p>
      )}

      {doc.lines.length === 0 ? (
        <p>Nothing on this return yet.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">The goods on this return</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Quantity
              </th>
              <th scope="col">Goes to</th>
              <th scope="col">
                <span className="visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td>{describe(l.saleLineId)}</td>
                <td className="num">{trim(l.quantity)}</td>
                <td>
                  {l.disposition}
                  <br />
                  <span className="hint">{place(l.locationId)}</span>
                </td>
                <td>
                  {draft && canCreate && (
                    <button type="button" onClick={() => void act(() => api('DELETE', `/stores/${storeId}/returns/${doc.id}/lines/${l.id}`), 'Line removed.')} aria-label={`Remove ${describe(l.saleLineId)}`}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {draft && canCreate && <AddLine storeId={storeId} doc={doc} sale={sale} locations={locations} onAdded={() => act(async () => undefined, 'Line added.')} />}
      {draft && canCreate && (
        <div className="actions">
          <button type="button" className="primary" disabled={doc.lines.length === 0} onClick={() => void act(() => transition('post'), `Return ${doc.documentNumber} posted. The goods are back in stock.`)}>
            Post the return
          </button>
        </div>
      )}
      {draft && canApprove && <Reasoned label="Approve this return late" button="Approve late" reasons={reasons} onSubmit={(reasonCodeId) => act(() => api('POST', `/stores/${storeId}/returns/${doc.id}/late-approval`, { reasonCodeId }), 'Late return approved.')} />}
      {draft && canCreate && <Reasoned label="Cancel this return" button="Cancel the return" reasons={reasons} onSubmit={(reasonCodeId) => act(() => transition('cancel', { reasonCodeId }), `Return ${doc.documentNumber} cancelled.`)} />}
    </section>
  );
}

/** A line: one sold item, a quantity, and where it goes. There is no default disposition, only a choice (`RR-17`, `RR-18`). */
function AddLine({ storeId, doc, sale, locations, onAdded }: { storeId: string; doc: ReturnDoc; sale: SaleDetail | null; locations: Location[]; onAdded: () => void | Promise<void> }) {
  const [saleLineId, setSaleLineId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [disposition, setDisposition] = useState('');
  const [locationId, setLocationId] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const attempt = useRef(operation());
  const fieldRef = useRef<HTMLSelectElement>(null);

  // What is left to return of a line: what was sold, less what has come back, less what this draft already holds.
  const left = (line: SaleLine): number => Number(line.quantity) - Number(line.returnedQuantity) - doc.lines.filter((l) => l.saleLineId === line.saleLineId).reduce((sum, l) => sum + Number(l.quantity), 0);
  const where = locations.filter((l) => disposition !== '' && fits(disposition, l));

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (saleLineId === '' || quantity.trim() === '' || disposition === '' || locationId === '') {
      return setProblem(check('Choose the item, the quantity, what state the goods are in, and where they go.'));
    }
    try {
      await api('POST', `/stores/${storeId}/returns/${doc.id}/lines`, { clientOperationId: attempt.current, saleLineId, quantity: quantity.trim(), disposition, locationId });
      attempt.current = operation();
      setQuantity('');
      setProblem(null);
      await onAdded();
      // Back to the first field, the keyboard path (UX-01).
      fieldRef.current?.focus();
    } catch (e) {
      if (e instanceof ApiError && typeof e.details.remaining === 'string') {
        setProblem(check(`Only ${trim(e.details.remaining)} of that item can still be returned.`));
      } else setProblem(problemOf(e));
    }
  };

  return (
    <form onSubmit={add} aria-labelledby="add-line-title">
      <h2 id="add-line-title">Add goods</h2>
      <label>
        Item
        <select ref={fieldRef} autoFocus value={saleLineId} onChange={(e) => setSaleLineId(e.target.value)}>
          <option value="">Choose the item…</option>
          {(sale?.lines ?? []).map((l) => (
            <option key={l.saleLineId} value={l.saleLineId} disabled={left(l) <= 0}>
              {l.lineNumber}. {l.description} (up to {trim(String(Math.max(left(l), 0)))})
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <input inputMode="decimal" autoComplete="off" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label>
        State of the goods
        <select
          value={disposition}
          onChange={(e) => {
            setDisposition(e.target.value);
            setLocationId('');
          }}
        >
          <option value="">Choose…</option>
          {DISPOSITIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label>
        Goes to
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">{disposition === '' ? 'Choose the state first' : where.length === 0 ? 'This store has no such location' : 'Choose a location…'}</option>
          {where.map((l) => (
            <option key={l.id} value={l.id}>
              {l.warehouseName} · {l.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Add to the return</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

/** An act that needs a reason (`SM-42`, `RR-11`, `BI-25`): the reason is chosen from the organization's, never typed. */
function Reasoned({ label, button, reasons, onSubmit }: { label: string; button: string; reasons: Reason[]; onSubmit: (reasonCodeId: string) => void | Promise<void> }) {
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reasonCodeId === '') return setProblem(check('Choose a reason first.'));
    setProblem(null);
    await onSubmit(reasonCodeId);
    setReasonCodeId('');
  };
  return (
    <form onSubmit={submit} aria-label={label}>
      <h2>{label}</h2>
      <label>
        Reason
        <select value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
          <option value="">Choose a reason…</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">{button}</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
