import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { useList, useOne, useProductHits, when } from '../lib/form.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

interface Line {
  id: string;
  product: string;
  variant: string | null;
  movementType: string;
  direction: 'In' | 'Out';
  quantity: string;
  countedQuantity: string | null;
  systemQuantity: string | null;
}

interface Document {
  id: string;
  documentNumber: string;
  status: string;
  reason: string;
  note: string | null;
  createdBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  statusChangedAt: string;
  lines: Line[];
}

interface Row {
  id: string;
  documentNumber: string;
  status: string;
  reason: string;
  statusChangedAt: string;
  lines: number;
}

interface Location {
  id: string;
  code: string;
  name: string;
}

interface Reason {
  id: string;
  name: string;
}

interface Variant {
  id: string;
  name: string | null;
  archivedAt: string | null;
}

/** The StockAdjustment states of §22.17, as words beside a symbol (`UX-52`). */
const LOOKS: Record<string, Look> = {
  Draft: ['counting', '◐', 'Draft'],
  PendingApproval: ['counting', '◐', 'Waiting for approval'],
  Approved: ['open', '●', 'Approved'],
  Posted: ['open', '●', 'Posted'],
  Cancelled: ['none', '○', 'Cancelled'],
  Reversed: ['none', '○', 'Reversed'],
};

/** What may happen next, as an event on the StockAdjustment machine; the server decides the edge (`SM-06`). */
const NEXT: Record<string, [event: string, label: string][]> = {
  Draft: [
    ['submit', 'Send for approval'],
    ['cancel', 'Cancel this document'],
  ],
  PendingApproval: [['approve', 'Approve it']],
  Approved: [['post', 'Post it, moving the stock']],
  Posted: [['reverse', 'Reverse it']],
  Cancelled: [],
  Reversed: [],
};

type Said = (outcome: string) => void;

/**
 * Corrections and write-offs, then opening stock: the only way stock moves without a sale (`IV-14`, `IV-15`). Corrections
 * and write-offs take `Inventory.Adjust`, opening stock `Config.Organization` (inventory-domain §5); both need
 * `Inventory.View` to read.
 *
 * Lines are entered two ways and the screen keeps them apart (`UX-36`, `UX-37`): a **correction** is what you counted, and
 * the server works out the difference beside the system's own quantity; a **write-off** says what happened — damaged,
 * expired, lost, found.
 */
export function Adjustments({
  storeId,
  permissions,
  startOn = 'adjustments',
}: {
  storeId: string;
  permissions: string[];
  /** Which kind to open on, because the navigation offers corrections and opening stock as separate entries. */
  startOn?: 'adjustments' | 'opening-balances';
}) {
  const [view, setView] = useState<'adjustments' | 'opening-balances'>(startOn);
  const kinds = [
    { path: 'adjustments', label: 'Corrections and write-offs', key: 'Inventory.Adjust', quantity: 'How much' },
    { path: 'opening-balances', label: 'Opening stock', key: 'Config.Organization', quantity: 'How much is there' },
  ] as const;
  const mine = kinds.find((k) => k.path === view)!;

  return (
    <section className="panel" aria-labelledby="adjustments-title">
      <h1 id="adjustments-title">Stock adjustments</h1>
      <nav className="subtabs" aria-label="Stock adjustments">
        {kinds.map((k) => (
          <button key={k.path} type="button" aria-current={view === k.path ? 'page' : undefined} onClick={() => setView(k.path)}>
            {k.label}
          </button>
        ))}
      </nav>
      {!permissions.includes(mine.key) ? (
        <p>
          You can read these documents but not start one. <code>{mine.key}</code> starts them, and your role does not have it
          (`UX-05`).
        </p>
      ) : (
        <Documents storeId={storeId} path={mine.path} quantityLabel={mine.quantity} onSaid={() => {}} />
      )}
    </section>
  );
}

function Documents({
  storeId,
  path,
  quantityLabel,
  onSaid,
}: {
  storeId: string;
  path: string;
  quantityLabel: string;
  onSaid: Said;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const announce = (outcome: string) => {
    setSaid(outcome);
    onSaid(outcome);
  };
  if (open !== null) {
    return (
      <>
        <Announcer text={said} />
        <DocumentScreen
          storeId={storeId}
          path={path}
          id={open}
          quantityLabel={quantityLabel}
          onBack={() => setOpen(null)}
          onSaid={announce}
        />
      </>
    );
  }
  return (
    <>
      <Announcer text={said} />
      <Listing storeId={storeId} path={path} onOpen={setOpen} />
      <NewDocument storeId={storeId} path={path} onAdded={setOpen} onSaid={announce} />
    </>
  );
}

function Listing({ storeId, path, onOpen }: { storeId: string; path: string; onOpen: (id: string) => void }) {
  const { items, problem } = useList<Row>(`/stores/${storeId}/${path}`);
  return (
    <>
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>There is no document here yet.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Stock adjustment documents, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Status</th>
              <th scope="col">Reason</th>
              <th scope="col" className="num">
                Lines
              </th>
              <th scope="col">Last changed</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.documentNumber}</td>
                <td>
                  <StatusChip status={d.status} looks={LOOKS} />
                </td>
                <td>{d.reason}</td>
                <td className="num">{d.lines}</td>
                <td>{when(d.statusChangedAt)}</td>
                <td>
                  <button type="button" onClick={() => onOpen(d.id)} aria-label={`Open document ${d.documentNumber}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** A new document with its reason, which is always required (`IV-33`, `BI-42`). The number is the server's. */
function NewDocument({ storeId, path, onAdded, onSaid }: { storeId: string; path: string; onAdded: (id: string) => void; onSaid: Said }) {
  const reasons = useList<Reason>('/reason-codes');
  const [reasonCodeId, setReason] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (reasonCodeId === '') return setProblem(check('Choose the reason this document exists.'));
    try {
      const made = await api<Document>('POST', `/stores/${storeId}/${path}`, {
        reasonCodeId,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setProblem(null);
      onSaid(`Document ${made.documentNumber} was started.`);
      onAdded(made.id);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-labelledby="new-document-title">
      <h2 id="new-document-title">Start a document</h2>
      <p className="hint">It starts as a draft. Nothing moves until it is posted.</p>
      <label>
        Reason
        <select value={reasonCodeId} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {(reasons.items ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note (optional)
        <input autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit">Start the document</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

function DocumentScreen({
  storeId,
  path,
  id,
  quantityLabel,
  onBack,
  onSaid,
}: {
  storeId: string;
  path: string;
  id: string;
  quantityLabel: string;
  onBack: () => void;
  onSaid: Said;
}) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [reload, setReload] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);

  // Read again after any change made here. The trigger is the reload counter, never the document itself: depending on
  // what this sets would fetch again for as long as the status kept differing, which is a loop and not a refresh.
  useEffect(() => {
    let live = true;
    api<Document>('GET', `/stores/${storeId}/${path}/${id}`)
      .then((next) => live && setDoc(next), (e: unknown) => live && setProblem(problemOf(e)));
    return () => {
      live = false;
    };
  }, [storeId, path, id, reload]);

  const changed = (next: Document) => {
    setDoc(next);
    onSaid(`The document now has ${next.lines.length} lines.`);
  };
  const failed = (e: unknown) => setProblem(problemOf(e));

  return (
    <>
      <button type="button" className="quiet" onClick={onBack}>
        Back to the documents
      </button>
      <ProblemNotice problem={problem} />
      {doc === null ? (
        <p role="status">Loading…</p>
      ) : (
        <section aria-labelledby="document-title">
          <h2 id="document-title">{doc.documentNumber}</h2>
          <p>
            <StatusChip status={doc.status} looks={LOOKS} /> Reason: {doc.reason}. Last changed {when(doc.statusChangedAt)}.
          </p>
          <p className="hint">
            Started by {doc.createdBy}
            {doc.submittedBy !== null && `, sent by ${doc.submittedBy}`}
            {doc.approvedBy !== null && `, approved by ${doc.approvedBy}`}.
            {doc.status === 'PendingApproval' && ' A different employee has to approve it (`BI-26`).'}
          </p>
          {doc.note !== null && <p>{doc.note}</p>}

          <Lines storeId={storeId} path={path} id={doc.id} doc={doc} quantityLabel={quantityLabel} onChanged={changed} onProblem={failed} />

          <Moves doc={doc} onSaid={onSaid} onProblem={failed} onDone={() => setReload((n) => n + 1)} />
        </section>
      )}
    </>
  );
}

function Lines({
  storeId,
  path,
  id,
  doc,
  quantityLabel,
  onChanged,
  onProblem,
}: {
  storeId: string;
  path: string;
  id: string;
  doc: Document;
  quantityLabel: string;
  onChanged: (d: Document) => void;
  onProblem: (e: unknown) => void;
}) {
  const locations = useList<Location>(`/stores/${storeId}/locations`);
  const [variantId, setVariant] = useState('');
  const [locationId, setLocation] = useState('');
  const [amount, setAmount] = useState('');
  const [movementType, setMovementType] = useState('DAMAGE');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  // Opening stock only ever counts what is there; the other two ways are corrections and write-offs (`UX-36`).
  const [kind, setKind] = useState<'correction' | 'write-off' | 'opening'>(path === 'adjustments' ? 'correction' : 'opening');
  const draft = doc.status === 'Draft';
  const quantity = /^\d{1,14}(\.\d{1,4})?$/.test(amount.trim()) ? amount.trim() : null;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (variantId === '') return setProblem(check('Find the product this line is about, then choose its variant.'));
    if (locationId === '') return setProblem(check('Choose the location the stock is at.'));
    if (quantity === null) return setProblem(check('Enter the quantity as a plain number, with no sign and up to four decimal places.'));
    setBusy(true);
    try {
      // A correction sends the counted quantity and the server reads the difference beside the system's own. The others
      // send what happened. Never both, and never a signed quantity.
      const line =
        kind === 'correction'
          ? { variantId, locationId, countedQuantity: quantity }
          : path === 'opening-balances'
            ? { variantId, locationId, quantity }
            : { variantId, locationId, movementType, quantity };
      const next = await api<Document>('POST', `/stores/${storeId}/${path}/${id}/lines`, line);
      setProblem(null);
      setAmount('');
      onChanged(next);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (lineId: string) => {
    try {
      onChanged(await api<Document>('DELETE', `/stores/${storeId}/${path}/${id}/lines/${lineId}`));
    } catch (e) {
      onProblem(e);
    }
  };

  return (
    <>
      <h3>Lines</h3>
      {doc.lines.length === 0 ? (
        <p>No lines yet.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Lines on this document</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">What</th>
              <th scope="col" className="num">
                How much
              </th>
              <th scope="col" className="num">
                Counted
              </th>
              <th scope="col" className="num">
                System had
              </th>
              {draft && (
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.variant === null ? l.product : `${l.product} — ${l.variant}`}</td>
                <td>{l.movementType.replaceAll('_', ' ').toLowerCase()}</td>
                <td className="num">
                  {l.direction === 'In' ? '+' : '−'}
                  {l.quantity}
                </td>
                <td className="num">{l.countedQuantity ?? '—'}</td>
                <td className="num">{l.systemQuantity ?? '—'}</td>
                {draft && (
                  <td>
                    <button type="button" onClick={() => void drop(l.id)} aria-label={`Remove the line for ${l.product}`}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {draft ? (
        <form onSubmit={add} aria-labelledby="add-line-title">
          <h3 id="add-line-title">Add a line</h3>
          {path === 'adjustments' && (
            <fieldset>
              <legend>What kind of line is this?</legend>
              <label className="check">
                <input type="radio" name="line-kind" checked={kind === 'correction'} onChange={() => setKind('correction')} />
                A correction: I counted this quantity, and the stock should agree with it
              </label>
              <label className="check">
                <input type="radio" name="line-kind" checked={kind === 'write-off'} onChange={() => setKind('write-off')} />
                A write-off or a find: this is what happened
              </label>
            </fieldset>
          )}
          <VariantPicker value={variantId} onChange={setVariant} />
          <label>
            Location
            <select value={locationId} onChange={(e) => setLocation(e.target.value)}>
              <option value="">Choose a location</option>
              {(locations.items ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {kind === 'correction' ? 'What you counted' : quantityLabel}
            <input inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {kind === 'write-off' && (
            <label>
              What happened
              <select value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                <option value="DAMAGE">Damaged</option>
                <option value="EXPIRY">Expired</option>
                <option value="LOSS">Lost</option>
                <option value="FOUND">Found</option>
              </select>
            </label>
          )}
          {kind === 'correction' && (
            <p className="hint">The difference from what the system holds is worked out for you. A count that matches changes nothing.</p>
          )}
          <button type="submit" disabled={busy}>
            Add the line
          </button>
          <ProblemNotice problem={problem} />
        </form>
      ) : (
        <p className="hint">Lines can only be added or removed while the document is a draft (`SS018`).</p>
      )}
    </>
  );
}

/**
 * A product by name, then its variant. Scanning needs `Sale.Create` at a till, which a stock correction does not imply,
 * so this finds the variant by name (`UX-48`).
 */
function VariantPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const hits = useProductHits();
  const [productId, setProduct] = useState('');
  const product = useOne<{ name: string; variants: Variant[] }>(productId === '' ? null : `/products/${productId}`);

  return (
    <>
      <label>
        Find the product
        <input
          autoComplete="off"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            hits.find(e.target.value);
          }}
        />
      </label>
      {hits.items !== null && hits.items.length > 0 && (
        <label>
          Product
          <select
            value={productId}
            onChange={(e) => {
              setProduct(e.target.value);
              onChange('');
            }}
          >
            <option value="">Choose from what was found</option>
            {hits.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {product.body !== null && product.body.variants.filter((v) => v.archivedAt === null).length > 0 && (
        <label>
          Variant
          <select value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose a variant</option>
            {product.body.variants
              .filter((v) => v.archivedAt === null)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name === null ? product.body!.name : `${product.body!.name} — ${v.name}`}
                </option>
              ))}
          </select>
        </label>
      )}
      <ProblemNotice problem={hits.problem ?? product.problem} />
    </>
  );
}

/**
 * The document's moves, as events on the StockAdjustment machine (§22.17). Posting writes the movements and reversing
 * compensates them, both in the same transaction as the status change, and the database checks at commit that exactly
 * those were written (`SS022`). Approval must be a different employee from the one who sent it (`BI-26`), and the
 * screen says so rather than offering a way round it.
 */
function Moves({ doc, onSaid, onProblem, onDone }: { doc: Document; onSaid: Said; onProblem: (e: unknown) => void; onDone: () => void }) {
  const moves = NEXT[doc.status] ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  if (moves.length === 0) {
    return (
      <p className="hint">
        This document has ended.{' '}
        {doc.status === 'Cancelled' ? 'Nothing moved.' : doc.status === 'Reversed' ? 'Its movements were compensated by reversals, not edited (`IV-12`).' : ''}
      </p>
    );
  }
  const move = async (event: string, label: string) => {
    setBusy(event);
    try {
      await api('POST', '/transitions', { machine: 'StockAdjustment', event, subject: doc.id });
      onSaid(`${doc.documentNumber}: ${label.toLowerCase()}.`);
      onDone();
    } catch (e) {
      onProblem(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="actions">
      {moves.map(([event, label]) => (
        <button key={event} type="button" disabled={busy !== null} onClick={() => void move(event, label)}>
          {label}
        </button>
      ))}
    </div>
  );
}
