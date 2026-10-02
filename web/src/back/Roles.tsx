import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api, ApiError } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

/** A role as the server answers for one: the keys it grants now, and whether it is archived (actors-and-roles §1, §6). */
export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  keys: string[];
}

const LOOKS: Record<string, Look> = { live: ['open', '●', 'In use'], archived: ['none', '○', 'Archived'] };

/** The catalogue's keys grouped by their first part, its own areas (actors-and-roles §2): Sale, Shift, Cash and so on. */
function byArea(keys: string[]): [area: string, keys: string[]][] {
  const areas = new Map<string, string[]>();
  for (const key of [...keys].sort()) {
    const area = key.split('.')[0]!;
    areas.set(area, [...(areas.get(area) ?? []), key]);
  }
  return [...areas];
}

const employees = (n: number) => `${n} employee${n === 1 ? '' : 's'}`;

/**
 * The organization's roles and what each grants, for someone who may see them (`Role.View`). Defining a role takes
 * `Role.Create` and changing one `Role.Edit`, as built (OQ-028). Only catalogue keys can be granted (`AC-02`, `D-01`). A
 * change applies from each employee's next action and signs nobody out (`PC-03`).
 */
export function Roles({ permissions }: { permissions: string[] }) {
  const can = (key: string) => permissions.includes(key);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [catalogue, setCatalogue] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  // Bumped to read the roles again after a change made here.
  const [version, setVersion] = useState(0);
  const changes = can('Role.Create') || can('Role.Edit');
  const failed = (e: unknown) => setProblem(problemOf(e));

  useEffect(() => {
    api<{ items: RoleRow[] }>('GET', '/roles').then((r) => setRoles(r.items), failed);
  }, [version]);
  useEffect(() => {
    if (changes) api<{ items: string[] }>('GET', '/permissions').then((r) => setCatalogue(r.items), failed);
  }, [changes]);

  const changed = (outcome: string) => {
    setProblem(null);
    setSaid(outcome);
    setVersion((v) => v + 1);
  };
  const notices = (
    <>
      <ProblemNotice problem={problem} />
      <Announcer text={said} />
    </>
  );

  const role = roles?.find((r) => r.id === open);
  if (role !== undefined) {
    return (
      <RoleDetail role={role} catalogue={catalogue} canEdit={can('Role.Edit')} onChanged={changed} onProblem={failed} onBack={() => setOpen(null)}>
        {notices}
      </RoleDetail>
    );
  }
  return (
    <section className="panel" aria-labelledby="roles-title">
      <h1 id="roles-title">Roles</h1>
      {notices}
      {roles === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : roles.length === 0 ? (
        <p>No roles yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col" className="num">
                Permissions
              </th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {r.description !== null && (
                    <>
                      <br />
                      <span className="hint">{r.description}</span>
                    </>
                  )}
                </td>
                <td className="num">{r.keys.length}</td>
                <td>
                  <StatusChip status={r.archivedAt === null ? 'live' : 'archived'} looks={LOOKS} />
                </td>
                <td>
                  <button type="button" onClick={() => setOpen(r.id)} aria-label={`Open the role ${r.name}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {can('Role.Create') && <NewRole catalogue={catalogue} onCreated={changed} />}
    </section>
  );
}

/** A new role, granting the catalogue keys chosen, grouped by area. */
function NewRole({ catalogue, onCreated }: { catalogue: string[]; onCreated: (outcome: string) => void }) {
  const [name, setName] = useState('');
  const [keys, setKeys] = useState<string[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return setProblem(check('Enter a name for the role.'));
    try {
      await api('POST', '/roles', { name, keys });
      setProblem(null);
      setName('');
      setKeys([]);
      onCreated(`The role ${name.trim()} was created. It grants ${keys.length} permission${keys.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={create} aria-labelledby="new-role-title">
      <h2 id="new-role-title">New role</h2>
      <label>
        Name
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {byArea(catalogue).map(([area, inArea]) => (
        <fieldset key={area}>
          <legend>{area}</legend>
          <div className="keys">
            {inArea.map((key) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={keys.includes(key)}
                  onChange={(e) => setKeys((chosen) => (e.target.checked ? [...chosen, key] : chosen.filter((k) => k !== key)))}
                />
                {key}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button type="submit">Create the role</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

function RoleDetail({
  role,
  catalogue,
  canEdit,
  onChanged,
  onProblem,
  onBack,
  children,
}: {
  role: RoleRow;
  catalogue: string[];
  canEdit: boolean;
  onChanged: (outcome: string) => void;
  onProblem: (e: unknown) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const [adding, setAdding] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  // A removal the server has counted and is waiting to hear confirmed with that count (PC-02).
  const [pending, setPending] = useState<{ key: string; affected: number } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const editable = canEdit && role.archivedAt === null;
  const missing = catalogue.filter((key) => !role.keys.includes(key));

  const grant = async (event: FormEvent) => {
    event.preventDefault();
    if (adding === '') return setProblem(check('Choose the permission to add.'));
    setProblem(null);
    try {
      await api('PUT', `/roles/${role.id}/permissions/${encodeURIComponent(adding)}`);
      setAdding('');
      onChanged(`${role.name} now grants ${adding}. It applies from each employee's next action.`);
    } catch (e) {
      onProblem(e);
    }
  };

  /**
   * PC-02: the server refuses a removal until it is told how many employees lose the key, and says that number. Asked
   * once without it, the answer is the number to show; the removal goes ahead only when confirmed with it.
   */
  const remove = async (key: string, affected?: number) => {
    try {
      await api('DELETE', `/roles/${role.id}/permissions/${encodeURIComponent(key)}${affected === undefined ? '' : `?confirmAffected=${affected}`}`);
      setPending(null);
      onChanged(`${role.name} no longer grants ${key}. It applies from each employee's next action; nobody was signed out.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_affected') setPending({ key, affected: Number(e.details.affected) });
      else onProblem(e);
    }
  };

  const archive = async () => {
    try {
      await api('POST', `/roles/${role.id}/archive`, {});
      setArchiving(false);
      onChanged(`${role.name} is archived. It grants nothing from now on, and stays on record.`);
    } catch (e) {
      onProblem(e);
    }
  };

  return (
    <section className="panel" aria-labelledby="role-title">
      <button type="button" className="quiet" onClick={onBack}>
        Back to the roles
      </button>
      <h1 id="role-title">{role.name}</h1>
      <p>
        <StatusChip status={role.archivedAt === null ? 'live' : 'archived'} looks={LOOKS} />
        {role.description !== null && ` ${role.description}`}
      </p>
      {children}
      {pending !== null && (
        <div className="notice" data-tone="warn" role="alert">
          <span className="symbol" aria-hidden="true">
            ⚠
          </span>
          <div>
            <p>
              {pending.affected === 0
                ? `No one holds ${role.name}, so no one loses ${pending.key}.`
                : `This takes ${pending.key} from ${employees(pending.affected)}. It applies from their next action; nobody is signed out.`}
            </p>
            <div className="actions">
              <button type="button" className="primary" onClick={() => void remove(pending.key, pending.affected)}>
                {pending.affected === 0 ? `Remove ${pending.key}` : `Remove it from ${employees(pending.affected)}`}
              </button>
              <button type="button" onClick={() => setPending(null)}>
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
      <h2>Permissions</h2>
      {role.keys.length === 0 ? (
        <p>This role grants nothing yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {editable && (
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {[...role.keys].sort().map((key) => (
              <tr key={key}>
                <td>{key}</td>
                {editable && (
                  <td>
                    <button type="button" onClick={() => void remove(key)} aria-label={`Remove ${key} from ${role.name}`}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editable && missing.length > 0 && (
        <form onSubmit={grant} aria-labelledby="grant-key-title">
          <h3 id="grant-key-title">Add a permission</h3>
          <label>
            Permission
            <select value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Choose a permission</option>
              {byArea(missing).map(([area, keys]) => (
                <optgroup key={area} label={area}>
                  {keys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button type="submit">Add the permission</button>
          <ProblemNotice problem={problem} />
        </form>
      )}
      {editable &&
        (archiving ? (
          <div className="notice" data-tone="warn">
            <span className="symbol" aria-hidden="true">
              ⚠
            </span>
            <div>
              <p>Archive {role.name}? It grants nothing from now on, and stays on record.</p>
              <div className="actions">
                <button type="button" className="primary" onClick={() => void archive()}>
                  Archive the role
                </button>
                <button type="button" onClick={() => setArchiving(false)}>
                  Keep it
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button type="button" onClick={() => setArchiving(true)}>
              Archive this role…
            </button>
          </div>
        ))}
    </section>
  );
}
