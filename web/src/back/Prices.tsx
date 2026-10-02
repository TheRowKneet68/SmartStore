import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { formatMoney, parseMoney, type Currency } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

interface ProductHit {
  id: string;
  name: string;
  status: string;
}

interface Variant {
  id: string;
  name: string | null;
  archivedAt: string | null;
  barcodes: { value: string; isPrimary: boolean }[];
}

/** One version of a variant's organization default price, as the server answers for it. */
export interface PriceVersion {
  id: string;
  amount: number;
  currencyCode: string;
  minorUnitExponent: number;
  effectiveFrom: string;
  started: boolean;
  setByName: string;
}

const LOOKS: Record<string, Look> = {
  inForce: ['open', '●', 'In force'],
  scheduled: ['counting', '◐', 'Scheduled'],
  replaced: ['none', '○', 'Replaced'],
};

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** Each version's place, newest first: the newest one started is in force, one not started is scheduled, older ones replaced. */
function standing(history: PriceVersion[]): string[] {
  const inForce = history.findIndex((p) => p.started);
  return history.map((p, i) => (!p.started ? 'scheduled' : i === inForce ? 'inForce' : 'replaced'));
}

/**
 * Price history (`PR-32`, `RT-041`): each variant's organization default price, version by version, with who set it.
 * Finding a product takes `Product.View`, reading its prices `Price.View`, and setting one `Price.Edit`, held
 * organization-wide. A store's own price, which wins at that store (`PR-30`), is not shown here.
 */
export function Prices({ permissions, currency }: { permissions: string[]; currency: Currency }) {
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [next, setNext] = useState<{ search: string; after: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  // Products by name, a page at a time (architecture §18.5).
  const find = async (text: string, after: string | null) => {
    const query = new URLSearchParams({ ...(text.trim() === '' ? {} : { search: text.trim() }), ...(after === null ? {} : { after }) }).toString();
    try {
      const page = await api<{ items: ProductHit[]; next: string | null }>('GET', `/products${query === '' ? '' : `?${query}`}`);
      setHits((shown) => [...(after === null ? [] : (shown ?? [])), ...page.items]);
      setNext(page.next === null ? null : { search: text, after: page.next });
      setProblem(null);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  useEffect(() => {
    void find('', null);
  }, []);

  if (open !== null) {
    return <ProductPrices id={open} canSet={permissions.includes('Price.Edit')} currency={currency} onBack={() => setOpen(null)} />;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void find(search, null);
  };
  return (
    <section className="panel" aria-labelledby="prices-title">
      <h1 id="prices-title">Prices</h1>
      <form onSubmit={submit} role="search">
        <label>
          Find a product by name
          <input autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button type="submit">Find</button>
      </form>
      <ProblemNotice problem={problem} />
      {hits === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : hits.length === 0 ? (
        <p>No product has that in its name.</p>
      ) : (
        <ul className="choices">
          {hits.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(p.id)}>
                {p.name} <span className="hint">({p.status})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <div className="actions">
          <button type="button" onClick={() => void find(next.search, next.after)}>
            Show more products
          </button>
        </div>
      )}
    </section>
  );
}

function ProductPrices({ id, canSet, currency, onBack }: { id: string; canSet: boolean; currency: Currency; onBack: () => void }) {
  const [product, setProduct] = useState<{ name: string; variants: Variant[] } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    api<{ name: string; variants: Variant[] }>('GET', `/products/${id}`).then(setProduct, (e: unknown) => setProblem(problemOf(e)));
  }, [id]);
  const back = (
    <button type="button" className="quiet" onClick={onBack}>
      Back to the products
    </button>
  );
  if (product === null) {
    return (
      <section className="panel">
        {back}
        {problem === null ? <p role="status">Loading…</p> : <ProblemNotice problem={problem} />}
      </section>
    );
  }
  const live = product.variants.filter((v) => v.archivedAt === null);
  return (
    <section className="panel" aria-labelledby="product-prices-title">
      {back}
      <h1 id="product-prices-title">{product.name}</h1>
      {live.length === 0 ? (
        <p>This product has no live variant.</p>
      ) : (
        live.map((v) => {
          const label = v.name === null ? product.name : `${product.name} — ${v.name}`;
          return <VariantPrices key={v.id} variant={v} label={label} canSet={canSet} currency={currency} onSaid={setSaid} />;
        })
      )}
      <Announcer text={said} />
    </section>
  );
}

function VariantPrices({ variant, label, canSet, currency, onSaid }: { variant: Variant; label: string; canSet: boolean; currency: Currency; onSaid: (s: string) => void }) {
  const [history, setHistory] = useState<PriceVersion[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api<{ items: PriceVersion[] }>('GET', `/variants/${variant.id}/prices`).then((r) => setHistory(r.items), (e: unknown) => setProblem(problemOf(e)));
  }, [variant.id, version]);
  // The price is in the history's currency; with no history yet, in the store's.
  const money: Currency = history?.[0] === undefined ? currency : { code: history[0].currencyCode, exponent: history[0].minorUnitExponent };
  const primary = variant.barcodes.find((b) => b.isPrimary)?.value;
  const places = history === null ? [] : standing(history);
  return (
    <section aria-labelledby={`variant-${variant.id}`}>
      <h2 id={`variant-${variant.id}`}>
        {label}
        {primary !== undefined && <span className="hint"> · {primary}</span>}
      </h2>
      <ProblemNotice problem={problem} />
      {history === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : history.length === 0 ? (
        <p>No price yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col">From</th>
              <th scope="col">Status</th>
              <th scope="col">Set by</th>
            </tr>
          </thead>
          <tbody>
            {history.map((p, i) => (
              <tr key={p.id}>
                <td className="num">{formatMoney(p.amount, p.currencyCode, p.minorUnitExponent)}</td>
                <td>{when(p.effectiveFrom)}</td>
                <td>
                  <StatusChip status={places[i]!} looks={LOOKS} />
                </td>
                <td>{p.setByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canSet && (
        <NewPrice
          variantId={variant.id}
          label={label}
          currency={money}
          onSet={(outcome) => {
            onSaid(outcome);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}

/**
 * A new price version, from now or from a later time (`PR-32`). The server refuses zero, the past, and a price below
 * the standard cost, which needs another employee's approval that v1 does not have (`PR-33`). Each refusal is said in
 * its words.
 */
function NewPrice({ variantId, label, currency, onSet }: { variantId: string; label: string; currency: Currency; onSet: (outcome: string) => void }) {
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const minor = parseMoney(amount, currency.exponent);
    if (minor === null) return setProblem(check(`Enter the new price in ${currency.code}, with at most ${currency.exponent} decimal places.`));
    try {
      await api('POST', `/variants/${variantId}/prices`, { amount: minor, ...(from === '' ? {} : { effectiveFrom: new Date(from).toISOString() }) });
      setProblem(null);
      setAmount('');
      setFrom('');
      onSet(`${label} costs ${formatMoney(minor, currency.code, currency.exponent)} ${from === '' ? 'from now' : `from ${when(new Date(from).toISOString())}`}.`);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-label={`New price for ${label}`}>
      <label>
        New price ({currency.code})
        <input inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>
        Starts (leave empty for now)
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <button type="submit">Set the price</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
