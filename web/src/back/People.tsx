import { useEffect, useState, type FormEvent } from 'react';
import { Announcer } from '../lib/Announcer.tsx';
import { api } from '../lib/api.ts';
import { StatusChip, type Look } from '../lib/Chip.tsx';
import { when } from '../lib/form.ts';
import { Moves, type Move } from '../lib/Moves.tsx';
import { check, problemOf, ProblemNotice, type Problem } from '../lib/Problem.tsx';

/** An employee as the server answers for one (employee-domain §2). */
export interface Person {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  status: string;
  statusChangedAt: string | null;
  hasLogin: boolean;
}

interface Assignment {
  id: string;
  roleId: string;
  roleName: string;
  storeId: string | null;
}

interface StoreAccess {
  id: string;
  storeId: string;
}

interface RoleChoice {
  id: string;
  name: string;
  archivedAt: string | null;
}

/** A store this screen can name: those of the signed-in person's workspace. */
export interface StoreChoice {
  id: string;
  name: string;
}

/** Runs one change; on success it says what happened and reads the person again. True if it went through. */
type Change = (work: () => Promise<unknown>, outcome: string) => Promise<boolean>;

// The Employee machine's states (state-machines §22.9).
const STATUS: Record<string, Look> = {
  Active: ['open', '●', 'Active'],
  OnLeave: ['counting', '◐', 'On leave'],
  Suspended: ['none', '○', 'Suspended'],
  Terminated: ['none', '○', 'Terminated'],
  Archived: ['none', '○', 'Archived'],
};

const nameOf = (p: Person) => `${p.preferredName ?? p.firstName} ${p.lastName}`;

/**
 * What may happen to a person's employment, as events on the Employee machine (§22.9). The server decides which edge is
 * legal (`SM-06`) and checks the key each edge names.
 *
 * Coming back is `reactivate` on two edges, each with its own key (owner decision D-16, Q4 and Q5): back from leave is
 * `Employee.Edit` and records no reason; reactivating after a suspension is `Employee.Reactivate`, a key of its own so that
 * delegating ordinary editing does not delegate restoring suspended access, and it records a reason (`SS055`, `SM-50`).
 * `UX-08` says an absent permission is hidden, not shown greyed out.
 *
 * Suspending ends their sessions at once, and terminating does too (EM-16, architecture §7.1): the outcome says so, so
 * nobody is surprised by being signed out.
 */
const NEXT: Record<string, Move[]> = {
  Active: [
    {
      event: 'leave',
      label: 'Put on leave',
      key_: 'Employee.Edit',
      reason: true,
      ask: 'Put this person on leave? Their sign-in becomes read-only until they come back.',
      outcome: 'They are on leave. Their sign-in is now read-only.',
    },
    {
      event: 'suspend',
      label: 'Suspend',
      key_: 'Employee.Edit',
      ask: 'Suspend this person? They are signed out at once and cannot sign in again.',
      outcome: 'They are suspended and were signed out.',
    },
    {
      event: 'terminate',
      label: 'End their employment',
      key_: 'Employee.Terminate',
      ask: 'End this employment? It cannot be undone from here; the record is archived afterwards.',
      outcome: 'Their employment is ended. They were signed out.',
    },
  ],
  OnLeave: [
    {
      event: 'reactivate',
      label: 'Bring back from leave',
      key_: 'Employee.Edit',
      ask: 'Bring this person back from leave? Their sign-in works fully again.',
      outcome: 'They are back from leave. Their sign-in works fully again.',
    },
    {
      event: 'terminate',
      label: 'End their employment',
      key_: 'Employee.Terminate',
      ask: 'End this employment? It cannot be undone from here; the record is archived afterwards.',
      outcome: 'Their employment is ended. They were signed out.',
    },
  ],
  Suspended: [
    {
      event: 'reactivate',
      label: 'Reactivate',
      key_: 'Employee.Reactivate',
      reason: true,
      ask: 'Reactivate this person? They can sign in again.',
      outcome: 'They are active again and can sign in.',
    },
  ],
  Terminated: [
    {
      event: 'archive',
      label: 'Archive the record',
      key_: 'Employee.Edit',
      reason: true,
      ask: 'Archive this person’s record? It is the end of their life in SmartStore; nothing moves it back.',
      outcome: 'The record is archived.',
    },
  ],
  Archived: [],
};

/**
 * The organization's people, for someone who may see employee records (`Employee.View`). Employees are organization-wide,
 * so the keys here are those held organization-wide, as the server checks them. Each change is offered only to someone
 * allowed to make it (`UX-05`, `UX-08`), and the server checks it again.
 */
export function People({ permissions, stores }: { permissions: string[]; stores: StoreChoice[] }) {
  const can = (key: string) => permissions.includes(key);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  // A page at a time, by employee number (architecture §18.5).
  const load = async (after: string | null) => {
    try {
      const page = await api<{ items: Person[]; next: string | null }>('GET', `/employees${after === null ? '' : `?after=${encodeURIComponent(after)}`}`);
      setPeople((shown) => [...(after === null ? [] : (shown ?? [])), ...page.items]);
      setNext(page.next);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  useEffect(() => {
    if (open === null) void load(null);
  }, [open]);

  if (open !== null) return <PersonDetail id={open} can={can} stores={stores} onBack={() => setOpen(null)} />;
  return (
    <section className="panel" aria-labelledby="people-title">
      <h1 id="people-title">People</h1>
      <ProblemNotice problem={problem} />
      {people === null ? (
        problem === null && <p role="status">Loading…</p>
      ) : people.length === 0 ? (
        <p>No one has been added yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Sign-in</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.employeeNumber}</td>
                <td>{nameOf(p)}</td>
                <td>
                  <StatusChip status={p.status} looks={STATUS} />
                </td>
                <td>{p.hasLogin ? 'Yes' : 'Not yet'}</td>
                <td>
                  <button type="button" onClick={() => setOpen(p.id)} aria-label={`Open ${nameOf(p)}`}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next !== null && (
        <div className="actions">
          <button type="button" onClick={() => void load(next)}>
            Show more people
          </button>
        </div>
      )}
      {can('Employee.Create') && <AddPerson onAdded={setOpen} />}
    </section>
  );
}

/** Adds someone, Active (§22.9 creation, `Employee.Create`), and opens them to give a sign-in, roles and stores. */
function AddPerson({ onAdded }: { onAdded: (id: string) => void }) {
  const [employeeNumber, setNumber] = useState('');
  const [firstName, setFirst] = useState('');
  const [lastName, setLast] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if ([employeeNumber, firstName, lastName].some((value) => value.trim() === '')) {
      return setProblem(check('Enter the employee number, the first name and the last name.'));
    }
    try {
      onAdded((await api<{ id: string }>('POST', '/employees', { employeeNumber, firstName, lastName })).id);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };
  return (
    <form onSubmit={add} aria-labelledby="add-person-title">
      <h2 id="add-person-title">Add a person</h2>
      <label>
        Employee number
        <input autoComplete="off" value={employeeNumber} onChange={(e) => setNumber(e.target.value)} />
      </label>
      <label>
        First name
        <input autoComplete="off" value={firstName} onChange={(e) => setFirst(e.target.value)} />
      </label>
      <label>
        Last name
        <input autoComplete="off" value={lastName} onChange={(e) => setLast(e.target.value)} />
      </label>
      <button type="submit">Add the person</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

function PersonDetail({ id, can, stores, onBack }: { id: string; can: (key: string) => boolean; stores: StoreChoice[]; onBack: () => void }) {
  const [person, setPerson] = useState<Person | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [access, setAccess] = useState<StoreAccess[] | null>(null);
  const [roles, setRoles] = useState<RoleChoice[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [said, setSaid] = useState('');
  // Bumped to read the person again after a change made here.
  const [version, setVersion] = useState(0);
  const seesRoles = can('Role.View');
  const assigns = seesRoles && can('Role.Assign');
  const grants = can('Employee.StoreAccess.Grant');
  const failed = (e: unknown) => setProblem(problemOf(e));

  useEffect(() => {
    api<Person>('GET', `/employees/${id}`).then(setPerson, failed);
    api<{ items: StoreAccess[] }>('GET', `/employees/${id}/stores`).then((r) => setAccess(r.items), failed);
    if (seesRoles) api<{ items: Assignment[] }>('GET', `/employees/${id}/roles`).then((r) => setAssignments(r.items), failed);
  }, [id, version, seesRoles]);
  useEffect(() => {
    if (assigns) api<{ items: RoleChoice[] }>('GET', '/roles').then((r) => setRoles(r.items.filter((role) => role.archivedAt === null)), failed);
  }, [assigns]);

  const change: Change = async (work, outcome) => {
    try {
      await work();
      setProblem(null);
      setSaid(outcome);
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      failed(e);
      return false;
    }
  };

  const back = (
    <button type="button" className="quiet" onClick={onBack}>
      Back to the people
    </button>
  );
  if (person === null) {
    return (
      <section className="panel">
        {back}
        {problem === null ? <p role="status">Loading…</p> : <ProblemNotice problem={problem} />}
      </section>
    );
  }
  const name = nameOf(person);
  const storeName = (storeId: string | null) => (storeId === null ? 'All stores' : (stores.find((s) => s.id === storeId)?.name ?? 'Another store'));
  const ungranted = stores.filter((s) => !(access ?? []).some((a) => a.storeId === s.id));
  // A role or store change ends the person's sessions, so it applies at once (architecture §7.1, EM-16).
  const signedOut = 'They were signed out, so it applies at once.';

  return (
    <section className="panel" aria-labelledby="person-title">
      {back}
      <h1 id="person-title">{name}</h1>
      <p>
        <StatusChip status={person.status} looks={STATUS} /> Employee number {person.employeeNumber}
        {person.statusChangedAt !== null && ` · status last changed ${when(person.statusChangedAt)}`}
      </p>
      <ProblemNotice problem={problem} />

      <h2>Employment</h2>
      <p className="hint">
        These change whether this person can work here. Putting someone on leave makes their sign-in read-only; suspending
        or ending their employment signs them out at once, and their shift must be closed first.
      </p>
      <Moves
        machine="Employee"
        subject={person.id}
        name={name}
        moves={NEXT[person.status] ?? []}
        can={can}
        onSaid={(outcome) => {
          setSaid(outcome);
          setProblem(null);
          setVersion((v) => v + 1);
        }}
        onProblem={setProblem}
        onDone={() => setVersion((v) => v + 1)}
      />
      {person.status === 'Suspended' && !can('Employee.Reactivate') && (
        <p className="hint">Reactivating a suspended person needs its own permission, Employee.Reactivate. Ask someone who holds it.</p>
      )}
      {person.status === 'Archived' && <p className="hint">Archived is the end of their record. Nothing moves it back.</p>}

      {can('Employee.Password.Reset') && <SignInForm person={person} change={change} />}

      {seesRoles && (
        <>
          <h2>Roles</h2>
          {assignments === null ? (
            <p role="status">Loading…</p>
          ) : assignments.length === 0 ? (
            <p>No role yet, so they can do nothing.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Where</th>
                  {assigns && (
                    <th scope="col">
                      <span className="visually-hidden">Remove</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.roleName}</td>
                    <td>{storeName(a.storeId)}</td>
                    {assigns && (
                      <td>
                        <button
                          type="button"
                          aria-label={`Remove the role ${a.roleName} from ${name}`}
                          onClick={() => void change(() => api('DELETE', `/role-assignments/${a.id}`), `The role ${a.roleName} was removed from ${name}. ${signedOut}`)}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {assigns && <AssignRole person={person} roles={roles} stores={stores} change={change} signedOut={signedOut} />}
        </>
      )}

      <h2>Store access</h2>
      <p className="hint">A role works only in the stores someone can access.</p>
      {access === null ? (
        <p role="status">Loading…</p>
      ) : access.length === 0 ? (
        <p>No store yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">Store</th>
              {grants && (
                <th scope="col">
                  <span className="visually-hidden">Take away</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {access.map((a) => (
              <tr key={a.id}>
                <td>{storeName(a.storeId)}</td>
                {grants && (
                  <td>
                    <button
                      type="button"
                      aria-label={`Take away ${name}'s access to ${storeName(a.storeId)}`}
                      onClick={() => void change(() => api('DELETE', `/store-access/${a.id}`), `${name} can no longer work in ${storeName(a.storeId)}. ${signedOut}`)}
                    >
                      Take away
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {grants && ungranted.length > 0 && <GrantStore person={person} stores={ungranted} change={change} signedOut={signedOut} />}
      <Announcer text={said} />
    </section>
  );
}

/**
 * Gives someone a sign-in, or sets a new password on theirs (`EM-02`, `EM-04`: the old password is never shown). It
 * takes `Employee.Password.Reset`, because it sets another person's credential.
 */
function SignInForm({ person, change }: { person: Person; change: Change }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (username.trim() === '' || password === '') return setProblem(check('Enter a username and a password.'));
    setProblem(null);
    if (await change(() => api('PUT', `/employees/${person.id}/login`, { username, password }), `${nameOf(person)} can now sign in as ${username.trim()}.`)) {
      setPassword('');
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="sign-in-title">
      <h2 id="sign-in-title">Sign-in</h2>
      <p className="hint">
        {person.hasLogin ? 'They can sign in. A new password replaces the old one, which is never shown.' : 'They cannot sign in yet.'}
      </p>
      <label>
        Username
        <input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit">{person.hasLogin ? 'Set the new password' : 'Give a sign-in'}</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

/** Assigns a role organization-wide or in one store (`MS-11`). */
function AssignRole({ person, roles, stores, change, signedOut }: { person: Person; roles: RoleChoice[]; stores: StoreChoice[]; change: Change; signedOut: string }) {
  const [role, setRole] = useState('');
  const [where, setWhere] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const assign = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = roles.find((r) => r.id === role);
    if (chosen === undefined) return setProblem(check('Choose the role to give.'));
    setProblem(null);
    const place = where === '' ? 'in all stores' : `in ${stores.find((s) => s.id === where)?.name ?? 'the store'}`;
    if (await change(() => api('POST', `/employees/${person.id}/roles`, { roleId: role, storeId: where === '' ? null : where }), `${nameOf(person)} now has the role ${chosen.name} ${place}. ${signedOut}`)) {
      setRole('');
    }
  };
  return (
    <form onSubmit={assign} aria-labelledby="assign-title">
      <h3 id="assign-title">Give a role</h3>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Choose a role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Where
        <select value={where} onChange={(e) => setWhere(e.target.value)}>
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} only
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Give the role</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}

/** Grants access to a store (`EM-12`, `EM-14`): without it, a role grants nothing there (`EM-13`). */
function GrantStore({ person, stores, change, signedOut }: { person: Person; stores: StoreChoice[]; change: Change; signedOut: string }) {
  const [store, setStore] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const grant = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = stores.find((s) => s.id === store);
    if (chosen === undefined) return setProblem(check('Choose the store.'));
    setProblem(null);
    if (await change(() => api('POST', `/employees/${person.id}/stores`, { storeId: store }), `${nameOf(person)} can now work in ${chosen.name}. ${signedOut}`)) {
      setStore('');
    }
  };
  return (
    <form onSubmit={grant} aria-labelledby="grant-title">
      <h3 id="grant-title">Give access to a store</h3>
      <label>
        Store
        <select value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">Choose a store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Give access</button>
      <ProblemNotice problem={problem} />
    </form>
  );
}
