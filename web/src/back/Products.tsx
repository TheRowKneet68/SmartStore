import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { changesOf, useList, useProductHits, when } from '../lib/form.ts';
import { formatMoney, parseMoney, type Currency } from '../lib/money.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

/** The Product machine's states (§22.1), as words beside a symbol (`UX-52`). */
const STATUS: Record<string, Look> = {
  Draft: ['counting', '◐', 'Draft'],
  Active: ['open', '●', 'On sale'],
  Discontinued: ['none', '○', 'Discontinued'],
  Hidden: ['none', '○', 'Hidden'],
  Archived: ['none', '○', 'Archived'],
};

/** What may happen next, as an event on the Product machine. The server decides which edges are legal (`SM-06`). */
const NEXT: Record<string, [event: string, label: string][]> = {
  Draft: [
    ['activate', 'Put on sale'],
    ['archive', 'Archive'],
  ],
  Active: [
    ['hide', 'Hide from the till'],
    ['discontinue', 'Discontinue'],
    ['archive', 'Archive'],
  ],
  Discontinued: [
    ['reactivate', 'Put back on sale'],
    ['archive', 'Archive'],
  ],
  Hidden: [
    ['unhide', 'Show at the till'],
    ['discontinue', 'Discontinue'],
    ['archive', 'Archive'],
  ],
  Archived: [],
};

const BARCODE_KINDS = ['EAN13', 'EAN8', 'UPC_A', 'UPC_E', 'Code128', 'ITF14', 'GS1-128', 'QR', 'PLU', 'Internal'];

interface Barcode {
  id: string;
  value: string;
  kind: string;
  isPrimary: boolean;
}

interface Variant {
  id: string;
  name: string | null;
  baseUnitId: string;
  taxCategoryId: string | null;
  archivedAt: string | null;
  barcodes: Barcode[];
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  status: string;
  categoryId: string;
  brandId: string | null;
  statusChangedAt: string;
  variants: Variant[];
}

interface Named {
  id: string;
  name: string;
}

interface Reference extends Named {
  archivedAt?: string | null;
}

type Said = (outcome: string) => void;

/**
 * The catalogue (`PR-02`..`RT-042`): products by name, each with its variants and barcodes, and the moves its state
 * allows. Prices live on the Prices screen, which owns their history (`PR-32`).
 *
 * Seeing them takes `Product.View`, making them `Product.Create` or `Product.Edit`, and a standard cost needs also
 * `Product.Cost.View`, because cost is deliberately separate from the rest of the catalogue (`PR-36`). All of these
 * keys are held organization-wide, as the server checks (OQ-025 item 6).
 */
export function Products({ permissions, currency }: { permissions: string[]; currency: Currency }) {
  const can = (key: string) => permissions.includes(key);
  const hits = useProductHits();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  if (open !== null) {
    return (
      <ProductDetail
        id={open}
        currency={currency}
        canEdit={can('Product.Edit')}
        canCreate={can('Product.Create')}
        canSeeCost={can('Product.Cost.View')}
        canSetPrice={can('Price.Edit')}
        onBack={() => setOpen(null)}
        onSaid={setSaid}
        said={said}
      />
    );
  }
  return (
    <section className="panel" aria-labelledby="products-title">
      <h1 id="products-title">Products</h1>
      <Announcer text={said} />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          hits.find(search);
        }}
      >
        <label>
          Find a product by name
          <input autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button type="submit">Find</button>
      </form>
      <ProblemNotice problem={hits.problem} />
      {hits.items === null ? (
        hits.problem === null && <p role="status">Loading…</p>
      ) : hits.items.length === 0 ? (
        <p>No product has that in its name.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Products by name</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {hits.items.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <StatusChip status={p.status} looks={STATUS} />
                </td>
                <td>
                  <button type="button" onClick={() => setOpen(p.id)} aria-label={`Open ${p.name}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hits.hasMore && (
        <div className="actions">
          <button type="button" onClick={hits.more}>
            Show more products
          </button>
        </div>
      )}
      {can('Product.Create') && <NewProduct onAdded={setOpen} onSaid={setSaid} />}
    </section>
  );
}

/** A new product, always `Draft` (`PR-02`), in a category it must sit in. */
function NewProduct({ onAdded, onSaid }: { onAdded: (id: string) => void; onSaid: Said }) {
  const categories = useList<Reference>('/categories');
  const brands = useList<Reference>('/brands');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategory] = useState('');
  const [brandId, setBrand] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return setProblem(check('Enter the product name.'));
    if (categoryId === '') return setProblem(check('Choose the category this product sits in.'));
    try {
      const made = await api<{ id: string }>('POST', '/products', {
        name: name.trim(),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        categoryId,
        ...(brandId === '' ? {} : { brandId }),
      });
      setProblem(null);
      onSaid(`${name.trim()} was added as a draft.`);
      onAdded(made.id);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-labelledby="new-product-title">
      <h2 id="new-product-title">Add a product</h2>
      <p className="hint">A new product starts as a draft. It goes on sale once it has a variant with a price.</p>
      <label>
        Name
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Category
        <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose a category</option>
          {(categories.items ?? [])
            .filter((c) => c.archivedAt === null || c.archivedAt === undefined)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Brand (optional)
        <select value={brandId} onChange={(e) => setBrand(e.target.value)}>
          <option value="">No brand</option>
          {(brands.items ?? [])
            .filter((b) => b.archivedAt === null || b.archivedAt === undefined)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Description (optional)
        <input autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit">Add the product</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

function ProductDetail({
  id,
  currency,
  canEdit,
  canCreate,
  canSeeCost,
  canSetPrice,
  onBack,
  onSaid,
  said,
}: {
  id: string;
  currency: Currency;
  canEdit: boolean;
  canCreate: boolean;
  canSeeCost: boolean;
  canSetPrice: boolean;
  onBack: () => void;
  onSaid: Said;
  /** Carried from the list, so an outcome announced there is still announced once this screen is showing. */
  said: string;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [editing, setEditing] = useState(false);
  // Bumped to read the product again after a change made here.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setProduct(null);
    setProblem(null);
    api<Product>('GET', `/products/${id}`).then(setProduct, (e: unknown) => setProblem(problemOf(e)));
  }, [id, version]);

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
    <section className="panel" aria-labelledby="product-title">
      {back}
      <Announcer text={said} />
      <h1 id="product-title">{product.name}</h1>
      <p>
        <StatusChip status={product.status} looks={STATUS} /> Last changed {when(product.statusChangedAt)}
      </p>
      {product.description !== null && <p>{product.description}</p>}
      <ProblemNotice problem={problem} />

      {canEdit && !editing && (
        <div className="actions">
          <button type="button" onClick={() => setEditing(true)}>
            Change this product
          </button>
        </div>
      )}
      {canEdit && editing && (
        <ProductForm
          product={product}
          onSaved={(outcome) => {
            setEditing(false);
            setProblem(null);
            onSaid(outcome);
            setVersion((v) => v + 1);
          }}
          onProblem={setProblem}
          onCancel={() => setEditing(false)}
        />
      )}

      {canEdit && <ProductMoves product={product} onSaid={onSaid} onProblem={setProblem} onDone={() => setVersion((v) => v + 1)} />}

      <h2>Variants</h2>
      {live.length === 0 ? (
        <p>This product has no live variant. A variant holds the unit, the tax category and the barcodes.</p>
      ) : (
        live.map((v) => (
          <VariantPanel
            key={v.id}
            product={product}
            variant={v}
            currency={currency}
            canEdit={canEdit}
            canSeeCost={canSeeCost}
            onSaid={onSaid}
            onProblem={setProblem}
            onDone={() => setVersion((v) => v + 1)}
          />
        ))
      )}
      {canCreate && (
        <NewVariant
          productId={product.id}
          currency={currency}
          canSetPrice={canSetPrice}
          onSaid={onSaid}
          onProblem={setProblem}
          onDone={() => setVersion((v) => v + 1)}
        />
      )}
    </section>
  );
}

/** A change to the product's name, description, category or brand: only what changed (`D2 §4`). */
function ProductForm({
  product,
  onSaved,
  onProblem,
  onCancel,
}: {
  product: Product;
  onSaved: Said;
  onProblem: (p: Problem) => void;
  onCancel: () => void;
}) {
  const categories = useList<Reference>('/categories');
  const brands = useList<Reference>('/brands');
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [categoryId, setCategory] = useState(product.categoryId);
  const [brandId, setBrand] = useState(product.brandId ?? '');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const changes = changesOf(
      { name: product.name, description: product.description, categoryId: product.categoryId, brandId: product.brandId },
      { name: name.trim(), description: description.trim() === '' ? null : description.trim(), categoryId, brandId: brandId === '' ? null : brandId },
    );
    if (Object.keys(changes).length === 0) return onProblem(check('Nothing has changed.'));
    try {
      await api('PATCH', `/products/${product.id}`, changes);
      onSaved(`${name.trim()} was changed.`);
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="change-product-title">
      <h3 id="change-product-title">Change the product</h3>
      <label>
        Name
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <input autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Category
        <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose a category</option>
          {(categories.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Brand
        <select value={brandId} onChange={(e) => setBrand(e.target.value)}>
          <option value="">No brand</option>
          {(brands.items ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit">Save the change</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The Product machine, as the moves available from where it stands (§22.1). A move is posted to the transition endpoint,
 * which decides the edge and checks the permission the edge names, never one the URL carries (`SM-02`, §8.4). Activation
 * is refused by the database unless a live variant has a price in force (`SS008`, `RT-042`), and its words are shown.
 */
function ProductMoves({
  product,
  onSaid,
  onProblem,
  onDone,
}: {
  product: Product;
  onSaid: Said;
  onProblem: (p: Problem) => void;
  onDone: () => void;
}) {
  const moves = NEXT[product.status] ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  if (moves.length === 0) {
    return <p className="hint">This product is archived. Archived is the end of its life; nothing moves it back (`PR-47`).</p>;
  }
  const move = async (event: string, label: string) => {
    setBusy(event);
    try {
      await api('POST', '/transitions', { machine: 'Product', event, subject: product.id });
      onSaid(`${product.name}: ${label.toLowerCase()}.`);
      onDone();
    } catch (e) {
      onProblem(problemOf(e));
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

function VariantPanel({
  product,
  variant,
  currency,
  canEdit,
  canSeeCost,
  onSaid,
  onProblem,
  onDone,
}: {
  product: Product;
  variant: Variant;
  currency: Currency;
  canEdit: boolean;
  canSeeCost: boolean;
  onSaid: Said;
  onProblem: (p: Problem) => void;
  onDone: () => void;
}) {
  const label = variant.name === null ? product.name : `${product.name} — ${variant.name}`;
  const units = useList<Reference>('/units');
  const taxes = useList<Reference>('/tax-categories');
  const unitName = units.items?.find((u) => u.id === variant.baseUnitId)?.name;
  const taxName = variant.taxCategoryId === null ? undefined : taxes.items?.find((t) => t.id === variant.taxCategoryId)?.name;

  return (
    <section aria-labelledby={`variant-${variant.id}`}>
      <h3 id={`variant-${variant.id}`}>{label}</h3>
      <p className="hint">
        Sold by {unitName ?? 'its own unit'}
        {taxName === undefined ? ', with no tax category' : `, taxed as ${taxName}`}
      </p>

      <h4>Barcodes</h4>
      {variant.barcodes.length === 0 ? (
        <p className="hint">No barcode yet, so this variant cannot be scanned.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Barcodes of {label}</caption>
          <thead>
            <tr>
              <th scope="col">Barcode</th>
              <th scope="col">Kind</th>
              <th scope="col">Scanned as</th>
              {canEdit && (
                <th scope="col">
                  <span className="visually-hidden">Change</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {variant.barcodes.map((b) => (
              <tr key={b.id}>
                <td>{b.value}</td>
                <td>{b.kind}</td>
                <td>{b.isPrimary ? 'Primary' : 'Secondary'}</td>
                {canEdit && (
                  <td>
                    <div className="actions">
                      {!b.isPrimary && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await api('POST', `/barcodes/${b.id}/primary`, {});
                              onSaid(`${b.value} is now the primary barcode for ${label}.`);
                              onDone();
                            } catch (e) {
                              onProblem(problemOf(e));
                            }
                          }}
                          aria-label={`Make ${b.value} the primary barcode for ${label}`}
                        >
                          Make primary
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api('POST', `/barcodes/${b.id}/archive`, {});
                            onSaid(`${b.value} was archived, so its value can be issued again (PR-09).`);
                            onDone();
                          } catch (e) {
                            onProblem(problemOf(e));
                          }
                        }}
                        aria-label={`Archive the barcode ${b.value} of ${label}`}
                      >
                        Archive
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && <NewBarcode variantId={variant.id} onSaid={onSaid} onProblem={onProblem} onDone={onDone} />}

      {canSeeCost && canEdit && <Cost variantId={variant.id} label={label} currency={currency} onSaid={onSaid} onProblem={onProblem} />}

      {canEdit && (
        <div className="actions">
          <button
            type="button"
            onClick={async () => {
              try {
                await api('POST', `/variants/${variant.id}/archive`, {});
                onSaid(`${label} was archived. It blocks new use and leaves stock alone (PR-48).`);
                onDone();
              } catch (e) {
                onProblem(problemOf(e));
              }
            }}
            aria-label={`Archive the variant ${label}`}
          >
            Archive this variant
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * A new variant with its first price in one step (`RT-042`): a released product's variant must have a price by commit
 * (`SS008`). Setting that price also needs `Price.Edit`, which the server checks separately, so the field is only shown
 * with it.
 */
function NewVariant({
  productId,
  currency,
  canSetPrice,
  onSaid,
  onProblem,
  onDone,
}: {
  productId: string;
  currency: Currency;
  canSetPrice: boolean;
  onSaid: Said;
  onProblem: (p: Problem) => void;
  onDone: () => void;
}) {
  const units = useList<Reference>('/units');
  const taxes = useList<Reference>('/tax-categories');
  const [name, setName] = useState('');
  const [baseUnitId, setUnit] = useState('');
  const [taxCategoryId, setTax] = useState('');
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (baseUnitId === '') return setProblem(check('Choose the unit this variant is sold by.'));
    const minor = amount.trim() === '' ? null : parseMoney(amount, currency.exponent);
    if (amount.trim() !== '' && minor === null) {
      return setProblem(check(`Enter the price in ${currency.code}, with at most ${currency.exponent} decimal places.`));
    }
    try {
      await api('POST', `/products/${productId}/variants`, {
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        baseUnitId,
        ...(taxCategoryId === '' ? {} : { taxCategoryId }),
        ...(minor === null ? {} : { price: { amount: minor } }),
      });
      setProblem(null);
      setName('');
      setAmount('');
      onSaid(minor === null ? 'The variant was added.' : `The variant was added at ${formatMoney(minor, currency.code, currency.exponent)}.`);
      onDone();
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-labelledby="new-variant-title">
      <h3 id="new-variant-title">Add a variant</h3>
      <p className="hint">A variant is a size, a flavour or a pack. Each has its own barcodes, price and stock.</p>
      <label>
        Variant name (optional, when the product name alone is not enough)
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Sold by
        <select value={baseUnitId} onChange={(e) => setUnit(e.target.value)}>
          <option value="">Choose a unit</option>
          {(units.items ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tax category (optional)
        <select value={taxCategoryId} onChange={(e) => setTax(e.target.value)}>
          <option value="">No tax category</option>
          {(taxes.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {canSetPrice && (
        <label>
          First price ({currency.code}, leave empty to add it later on the Prices screen)
          <input inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}
      <button type="submit">Add the variant</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

function NewBarcode({
  variantId,
  onSaid,
  onProblem,
  onDone,
}: {
  variantId: string;
  onSaid: Said;
  onProblem: (p: Problem) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState('');
  const [kind, setKind] = useState('EAN13');
  const [primary, setPrimary] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() === '') return setProblem(check('Enter the barcode.'));
    try {
      await api('POST', `/variants/${variantId}/barcodes`, { value: value.trim(), kind, ...(primary ? { isPrimary: true } : {}) });
      setProblem(null);
      setValue('');
      setPrimary(false);
      onSaid(`${value.trim()} was added as a ${kind} barcode.`);
      onDone();
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-label="Add a barcode">
      <label>
        Barcode
        <input autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {BARCODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
        Make this the primary barcode, the one the till uses when more than one is scanned
      </label>
      <button type="submit">Add the barcode</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

/**
 * A standard cost version (`PR-35`), shown only with `Product.Cost.View`, for margin and the below-cost check. A price
 * below the cost in force is refused: it needs another employee's approval, which this version does not have (`PR-33`).
 */
function Cost({
  variantId,
  label,
  currency,
  onSaid,
  onProblem,
}: {
  variantId: string;
  label: string;
  currency: Currency;
  onSaid: Said;
  onProblem: (p: Problem) => void;
}) {
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const minor = parseMoney(amount, currency.exponent);
    if (minor === null) return setProblem(check(`Enter the standard cost in ${currency.code}, with at most ${currency.exponent} decimal places.`));
    try {
      await api('POST', `/variants/${variantId}/costs`, { amount: minor });
      setProblem(null);
      setAmount('');
      onSaid(`${label} now has the standard cost ${formatMoney(minor, currency.code, currency.exponent)}. A price below it needs another employee's approval.`);
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-label={`Standard cost for ${label}`}>
      <h4>Standard cost</h4>
      <label>
        What this costs you ({currency.code})
        <input inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button type="submit">Set the standard cost</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
