import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { changesOf, useList } from '../lib/form.ts';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

interface Unit {
  id: string;
  code: string;
  name: string;
  pluralName: string | null;
  quantityKind: string;
  scale: number;
}

interface TaxCategory {
  id: string;
  code: string;
  name: string;
  ratesInForce: { jurisdiction: string; ratePercent: string; effectiveFrom: string }[];
}

interface Brand {
  id: string;
  name: string;
}

/** A category as `/categories` returns one: a name, where it sits under, and its order (`PR-04`..`PR-06`). */
export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
}

type Said = (outcome: string) => void;

/**
 * The catalogue's reference data (product-domain §3, §4, §6, §9; D2 §3): units, tax categories with their rates,
 * categories and brands. Each is seen with its view key and changed with its edit key, held organization-wide:
 * `Product.*` for units, categories and brands, `Tax.*` for tax categories (actors-and-roles §2.1). Units, tax categories
 * and brands cannot be archived: `/docs` gives them no archive (OQ-031). A category can, and keeping the row is what
 * lets products still point at it.
 */
export function ReferenceData({ permissions }: { permissions: string[] }) {
  const can = (key: string) => permissions.includes(key);
  const [said, setSaid] = useState('');
  return (
    <section className="panel" aria-labelledby="reference-title">
      <h1 id="reference-title">Units, tax, categories and brands</h1>
      {can('Product.View') && <Units canAdd={can('Product.Create')} canEdit={can('Product.Edit')} onSaid={setSaid} />}
      {can('Tax.View') && <TaxCategories canEdit={can('Tax.Edit')} onSaid={setSaid} />}
      {can('Product.View') && <Categories canAdd={can('Product.Create')} canEdit={can('Product.Edit')} onSaid={setSaid} />}
      {can('Product.View') && <Brands canAdd={can('Product.Create')} canEdit={can('Product.Edit')} onSaid={setSaid} />}
      <Announcer text={said} />
    </section>
  );
}

// ------------------------------------------------------------------ units (PR-14, PR-15, RT-491)

const KINDS = ['Countable', 'Measurable', 'Service'];

function Units({ canAdd, canEdit, onSaid }: { canAdd: boolean; canEdit: boolean; onSaid: Said }) {
  const { items, problem, setProblem, reload } = useList<Unit>('/units');
  const [editing, setEditing] = useState<Unit | 'new' | null>(null);
  const saved = (outcome: string) => (setEditing(null), setProblem(null), onSaid(outcome), reload());
  return (
    <>
      <h2>Units</h2>
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>No units yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col" className="num">
                Decimal places
              </th>
              {canEdit && (
                <th scope="col">
                  <span className="visually-hidden">Change</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td>{u.code}</td>
                <td>{u.name}</td>
                <td>{u.quantityKind}</td>
                <td className="num">{u.scale}</td>
                {canEdit && (
                  <td>
                    <button type="button" onClick={() => setEditing(u)} aria-label={`Change the unit ${u.code}`}>
                      Change
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null ? (
        <UnitForm unit={editing === 'new' ? null : editing} onSaved={saved} onCancel={() => setEditing(null)} />
      ) : (
        canAdd && (
          <div className="actions">
            <button type="button" onClick={() => setEditing('new')}>
              Add a unit
            </button>
          </div>
        )
      )}
    </>
  );
}

/**
 * A new unit, or a change to one. A countable unit has no decimal places (`PR-15`), said here before the server says
 * it. A unit's kind cannot change once anything has used it (`PR-14`, `RT-491`); the server refuses that, naming the
 * first use.
 */
function UnitForm({ unit, onSaved, onCancel }: { unit: Unit | null; onSaved: Said; onCancel: () => void }) {
  const [code, setCode] = useState(unit?.code ?? '');
  const [name, setName] = useState(unit?.name ?? '');
  const [pluralName, setPlural] = useState(unit?.pluralName ?? '');
  const [quantityKind, setKind] = useState(unit?.quantityKind ?? 'Countable');
  const [scale, setScale] = useState(unit?.scale ?? 0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === '' || name.trim() === '') return setProblem(check('Enter the code and the name.'));
    if (quantityKind === 'Countable' && scale !== 0) return setProblem(check('A countable unit has no decimal places.'));
    const fields = { code, name, pluralName: pluralName.trim() === '' ? null : pluralName, quantityKind, scale };
    try {
      if (unit === null) {
        await api('POST', '/units', fields);
        onSaved(`The unit ${code.trim()} was added.`);
      } else {
        const changes = changesOf(unit, fields);
        if (Object.keys(changes).length === 0) return setProblem(check('Nothing has changed.'));
        await api('PATCH', `/units/${unit.id}`, changes);
        onSaved(`The unit ${code.trim()} was changed.`);
      }
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="unit-form-title">
      <h3 id="unit-form-title">{unit === null ? 'Add a unit' : `Change the unit ${unit.code}`}</h3>
      <label>
        Code
        <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label>
        Name
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Plural name (optional)
        <input autoComplete="off" value={pluralName} onChange={(e) => setPlural(e.target.value)} />
      </label>
      <label>
        Kind
        <select value={quantityKind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      <label>
        Decimal places
        <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit">{unit === null ? 'Add the unit' : 'Save the change'}</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ProblemNotice problem={problem} />
    </form>
  );
}

// ------------------------------------------------------------------ tax categories and rates (PR-37, PR-40, RT-047, D-12)

function TaxCategories({ canEdit, onSaid }: { canEdit: boolean; onSaid: Said }) {
  const { items, problem, setProblem, reload } = useList<TaxCategory>('/tax-categories');
  // What is being added or changed: a category (new, or one), or a new rate for one.
  const [editing, setEditing] = useState<{ category: TaxCategory | null; rate: boolean } | null>(null);
  const saved = (outcome: string) => (setEditing(null), setProblem(null), onSaid(outcome), reload());
  return (
    <>
      <h2>Tax categories</h2>
      <p className="hint">No rate is built in: each is entered here, as your jurisdiction sets it.</p>
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>No tax categories yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Rates in force</th>
              {canEdit && (
                <th scope="col">
                  <span className="visually-hidden">Change</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.code}</td>
                <td>{c.name}</td>
                <td>{c.ratesInForce.length === 0 ? 'None yet' : c.ratesInForce.map((r) => `${r.jurisdiction}: ${Number(r.ratePercent)}%`).join(', ')}</td>
                {canEdit && (
                  <td>
                    <div className="actions">
                      <button type="button" onClick={() => setEditing({ category: c, rate: true })} aria-label={`Add a rate to ${c.code}`}>
                        Add a rate
                      </button>
                      <button type="button" onClick={() => setEditing({ category: c, rate: false })} aria-label={`Change the tax category ${c.code}`}>
                        Change
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null ? (
        editing.rate && editing.category !== null ? (
          <RateForm category={editing.category} onSaved={saved} onCancel={() => setEditing(null)} />
        ) : (
          <TaxCategoryForm category={editing.category} onSaved={saved} onCancel={() => setEditing(null)} />
        )
      ) : (
        canEdit && (
          <div className="actions">
            <button type="button" onClick={() => setEditing({ category: null, rate: false })}>
              Add a tax category
            </button>
          </div>
        )
      )}
    </>
  );
}

function TaxCategoryForm({ category, onSaved, onCancel }: { category: TaxCategory | null; onSaved: Said; onCancel: () => void }) {
  const [code, setCode] = useState(category?.code ?? '');
  const [name, setName] = useState(category?.name ?? '');
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === '' || name.trim() === '') return setProblem(check('Enter the code and the name.'));
    try {
      if (category === null) {
        await api('POST', '/tax-categories', { code, name });
        onSaved(`The tax category ${code.trim()} was added. Add its rate before anything in it can be sold.`);
      } else {
        const changes = changesOf({ code: category.code, name: category.name }, { code, name });
        if (Object.keys(changes).length === 0) return setProblem(check('Nothing has changed.'));
        await api('PATCH', `/tax-categories/${category.id}`, changes);
        onSaved(`The tax category ${code.trim()} was changed.`);
      }
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="tax-form-title">
      <h3 id="tax-form-title">{category === null ? 'Add a tax category' : `Change the tax category ${category.code}`}</h3>
      <label>
        Code
        <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label>
        Name
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit">{category === null ? 'Add the tax category' : 'Save the change'}</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ProblemNotice problem={problem} />
    </form>
  );
}

/**
 * A new rate version, from now or from a later time (`RT-047`: a change is a new version, never an edit; `PR-40`: zero
 * is how an exemption is expressed). The rate is sent as the decimal text typed, never as a float.
 */
function RateForm({ category, onSaved, onCancel }: { category: TaxCategory; onSaved: Said; onCancel: () => void }) {
  const [jurisdiction, setJurisdiction] = useState(category.ratesInForce[0]?.jurisdiction ?? '');
  const [ratePercent, setRate] = useState('');
  const [from, setFrom] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (jurisdiction.trim() === '') return setProblem(check('Enter the jurisdiction the rate is for.'));
    if (!/^\d{1,5}(\.\d{1,4})?$/.test(ratePercent.trim())) return setProblem(check('Enter the rate as a percentage, such as 20 or 5.5, with at most 4 decimal places.'));
    try {
      await api('POST', `/tax-categories/${category.id}/rates`, {
        jurisdiction,
        ratePercent: ratePercent.trim(),
        ...(from === '' ? {} : { effectiveFrom: new Date(from).toISOString() }),
      });
      onSaved(`${category.code} has a new rate of ${ratePercent.trim()}% for ${jurisdiction.trim()}, ${from === '' ? 'from now' : 'from the time given'}.`);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="rate-form-title">
      <h3 id="rate-form-title">Add a rate to {category.code}</h3>
      <p className="hint">A rate is never edited: a new rate replaces it from the time it starts, and sales already made keep the rate they had.</p>
      <label>
        Jurisdiction
        <input autoComplete="off" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
      </label>
      <label>
        Rate (%)
        <input inputMode="decimal" autoComplete="off" value={ratePercent} onChange={(e) => setRate(e.target.value)} />
      </label>
      <label>
        Starts (leave empty for now)
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit">Add the rate</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ProblemNotice problem={problem} />
    </form>
  );
}

// ------------------------------------------------------------------ categories (PR-04..PR-06, RT-026)

/**
 * The catalogue's categories: one name, one parent or none, and an explicit order (`PR-04`..`PR-06`, `RT-026`). A cycle is
 * refused by the database (`SS006`), so a category cannot be its own ancestor; the screen does not offer it. Archiving
 * keeps the row, because products still point at it.
 */
function Categories({ canAdd, canEdit, onSaid }: { canAdd: boolean; canEdit: boolean; onSaid: Said }) {
  const { items, problem, setProblem, reload } = useList<Category>('/categories');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const live = (items ?? []).filter((c) => c.archivedAt === null);
  const saved = (outcome: string) => (setEditing(null), setProblem(null), onSaid(outcome), reload());

  return (
    <>
      <h2>Categories</h2>
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : live.length === 0 ? (
        <p>No categories yet. A product needs one.</p>
      ) : (
        <table className="records">
          <caption className="visually-hidden">Categories, with what each sits under and its order</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Under</th>
              <th scope="col" className="num">
                Order
              </th>
              {canEdit && (
                <th scope="col">
                  <span className="visually-hidden">Change</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {live.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.parentId === null ? '—' : (live.find((p) => p.id === c.parentId)?.name ?? 'another category')}</td>
                <td className="num">{c.sortOrder}</td>
                {canEdit && (
                  <td>
                    <button type="button" onClick={() => setEditing(c)} aria-label={`Change the category ${c.name}`}>
                      Change
                    </button>{' '}
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api('POST', `/categories/${c.id}/archive`, {});
                          saved(`${c.name} was archived. Products still pointing at it keep it.`);
                        } catch (e) {
                          setProblem(problemOf(e));
                        }
                      }}
                      aria-label={`Archive the category ${c.name}`}
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
      {editing !== null ? (
        <CategoryForm category={editing === 'new' ? null : editing} others={live} onSaved={saved} onCancel={() => setEditing(null)} />
      ) : (
        canAdd && (
          <div className="actions">
            <button type="button" onClick={() => setEditing('new')}>
              Add a category
            </button>
          </div>
        )
      )}
    </>
  );
}

function CategoryForm({
  category,
  others,
  onSaved,
  onCancel,
}: {
  category: Category | null;
  others: Category[];
  onSaved: Said;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParent] = useState(category?.parentId ?? '');
  const [sortOrder, setOrder] = useState(String(category?.sortOrder ?? 0));
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return setProblem(check('Enter the category name.'));
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) return setProblem(check('The order is a whole number.'));
    const fields = { name: name.trim(), parentId: parentId === '' ? null : parentId, sortOrder: order };
    try {
      if (category === null) {
        await api('POST', '/categories', fields);
        onSaved(`The category ${name.trim()} was added.`);
      } else {
        const changes = changesOf(category, fields);
        if (Object.keys(changes).length === 0) return setProblem(check('Nothing has changed.'));
        await api('PATCH', `/categories/${category.id}`, changes);
        onSaved(`The category ${name.trim()} was changed.`);
      }
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="category-form-title">
      <h3 id="category-form-title">{category === null ? 'Add a category' : `Change the category ${category.name}`}</h3>
      <label>
        Name
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Sits under (leave empty for a top-level category)
        <select value={parentId} onChange={(e) => setParent(e.target.value)}>
          <option value="">Top level</option>
          {others
            .filter((c) => c.id !== category?.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Order among its siblings
        <input inputMode="numeric" autoComplete="off" value={sortOrder} onChange={(e) => setOrder(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit">{category === null ? 'Add the category' : 'Save the change'}</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ProblemNotice problem={problem} />
    </form>
  );
}

// ------------------------------------------------------------------ brands (product-domain §3)

function Brands({ canAdd, canEdit, onSaid }: { canAdd: boolean; canEdit: boolean; onSaid: Said }) {
  const { items, problem, setProblem, reload } = useList<Brand>('/brands');
  const [editing, setEditing] = useState<Brand | 'new' | null>(null);
  const [name, setName] = useState('');
  const [formProblem, setFormProblem] = useState<Problem | null>(null);
  const open = (brand: Brand | 'new') => (setEditing(brand), setName(brand === 'new' ? '' : brand.name), setFormProblem(null));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return setFormProblem(check('Enter the brand name.'));
    try {
      if (editing === 'new') await api('POST', '/brands', { name });
      else if (editing !== null) {
        if (name === editing.name) return setFormProblem(check('Nothing has changed.'));
        await api('PATCH', `/brands/${editing.id}`, { name });
      }
      setEditing(null);
      setProblem(null);
      onSaid(`The brand ${name.trim()} was ${editing === 'new' ? 'added' : 'changed'}.`);
      reload();
    } catch (e) {
      setFormProblem(problemOf(e));
    }
  };
  return (
    <>
      <h2>Brands</h2>
      <ProblemNotice problem={problem} />
      {items === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p>No brands yet. A product needs none.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Name</th>
              {canEdit && (
                <th scope="col">
                  <span className="visually-hidden">Change</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                {canEdit && (
                  <td>
                    <button type="button" onClick={() => open(b)} aria-label={`Change the brand ${b.name}`}>
                      Change
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null ? (
        <form onSubmit={save} aria-labelledby="brand-form-title">
          <h3 id="brand-form-title">{editing === 'new' ? 'Add a brand' : `Change the brand ${editing.name}`}</h3>
          <label>
            Brand name
            <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="actions">
            <button type="submit">{editing === 'new' ? 'Add the brand' : 'Save the change'}</button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <ProblemNotice problem={formProblem} />
        </form>
      ) : (
        canAdd && (
          <div className="actions">
            <button type="button" onClick={() => open('new')}>
              Add a brand
            </button>
          </div>
        )
      )}
    </>
  );
}
