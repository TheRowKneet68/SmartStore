import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { People, type Person } from './People.tsx';

/**
 * The people screen (employee-domain; actors-and-roles §1, §6): each change is offered only with its key (`UX-05`,
 * `UX-08`). That the server refuses it without the key is the server's tests' to prove.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALL = ['Employee.View', 'Employee.Create', 'Employee.Password.Reset', 'Role.View', 'Role.Assign', 'Employee.StoreAccess.Grant'];
const STORES = [
  { id: 's1', name: 'Main street' },
  { id: 's2', name: 'Station' },
];
const person = (over: Partial<Person>): Person => ({
  id: 'e1',
  employeeNumber: 'E1',
  firstName: 'Cass',
  lastName: 'Shah',
  preferredName: null,
  status: 'Active',
  hasLogin: false,
  ...over,
});
const cass = person({});
const mona = person({ id: 'e2', employeeNumber: 'E2', firstName: 'Mona', lastName: 'Lee', status: 'OnLeave', hasLogin: true });

const LIST = 'GET /api/v1/employees';
const CASS = 'GET /api/v1/employees/e1';
const CASS_ROLES = 'GET /api/v1/employees/e1/roles';
const CASS_STORES = 'GET /api/v1/employees/e1/stores';
const ROLES = 'GET /api/v1/roles';

const show = (permissions = ALL) => render(<People permissions={permissions} stores={STORES} />);
const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!;
const openCass = async () => fireEvent.click(within(await rowOf('Cass Shah')).getByRole('button', { name: 'Open Cass Shah' }));
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);

describe('the people list (UX-05, UX-52, architecture s18.5)', () => {
  it("UX-52, s18.5: each person shows their number, name, status in words beside a symbol, and whether they can sign in; more come a page at a time", async () => {
    serve({ [LIST]: { body: { items: [cass], next: 'E1' } }, [`${LIST}?after=E1`]: { body: { items: [mona], next: null } } });
    show();
    const first = within(await rowOf('Cass Shah'));
    expect(first.getByText('E1')).toBeTruthy();
    expect(first.getByText('Active').closest('.chip')?.querySelector('[aria-hidden="true"]')?.textContent, 'a symbol, not colour alone').toBe('●');
    expect(first.getByText('Not yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more people' }));
    const second = within(await rowOf('Mona Lee'));
    expect(second.getByText('On leave')).toBeTruthy();
    expect(second.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('Cass Shah'), 'the first page stays').toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more people' }), 'no more pages').toBeNull();
  });

  it('UX-08: someone who may only look is offered no change, and without Role.View sees no roles', async () => {
    serve({ [LIST]: { body: { items: [cass], next: null } }, [CASS]: { body: cass }, [CASS_STORES]: { body: { items: [{ id: 'g1', storeId: 's1' }] } } });
    show(['Employee.View']);
    await rowOf('Cass Shah');
    expect(screen.queryByRole('heading', { name: 'Add a person' })).toBeNull();
    await openCass();
    expect(await screen.findByRole('cell', { name: 'Main street' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sign-in' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Roles' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Take away/ })).toBeNull();
    expect(screen.queryByLabelText('Store')).toBeNull();
  });
});

describe('one person (EM-02, EM-04, EM-12..EM-16, MS-11)', () => {
  it('s22.9, EM-02, EM-04: a person is added and opened, and given a sign-in; missing names are said first, and nothing is sent', async () => {
    const calls = serve({
      [LIST]: { body: { items: [], next: null } },
      'POST /api/v1/employees': { status: 201, body: { id: 'e1' } },
      [CASS]: [{ body: cass }, { body: { ...cass, hasLogin: true } }],
      [CASS_STORES]: { body: { items: [] } },
      [CASS_ROLES]: { body: { items: [] } },
      [ROLES]: { body: { items: [] } },
      'PUT /api/v1/employees/e1/login': { body: { employeeId: 'e1', username: 'cass' } },
    });
    show();
    await screen.findByText('No one has been added yet.');
    submit('Add the person');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the employee number, the first name and the last name.');
    expect(calls.some((c) => c.key === 'POST /api/v1/employees')).toBe(false);
    fireEvent.change(screen.getByLabelText('Employee number'), { target: { value: 'E1' } });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Cass' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Shah' } });
    submit('Add the person');
    expect(await screen.findByRole('heading', { name: 'Cass Shah' })).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/v1/employees')?.body).toEqual({ employeeNumber: 'E1', firstName: 'Cass', lastName: 'Shah' });

    expect(screen.getByText('They cannot sign in yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'cass' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'TEST-ONLY pass' } });
    submit('Give a sign-in');
    expect(await screen.findByText('Cass Shah can now sign in as cass.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'PUT /api/v1/employees/e1/login')?.body).toEqual({ username: 'cass', password: 'TEST-ONLY pass' });
    expect(await screen.findByRole('button', { name: 'Set the new password' }), 'read again: they can sign in now').toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value, 'the password does not stay on screen').toBe('');
  });

  it('MS-11, EM-16: a role is given in all stores or in one, and removed; an archived role is not offered; each change says they were signed out', async () => {
    const everywhere = { id: 'a1', roleId: 'r1', roleName: 'Cashier', storeId: null };
    const atStation = { id: 'a2', roleId: 'r2', roleName: 'Supervisor', storeId: 's2' };
    const calls = serve({
      [LIST]: { body: { items: [cass], next: null } },
      [CASS]: { body: cass },
      [CASS_STORES]: { body: { items: [] } },
      [CASS_ROLES]: [{ body: { items: [] } }, { body: { items: [everywhere] } }, { body: { items: [everywhere, atStation] } }, { body: { items: [atStation] } }],
      [ROLES]: {
        body: {
          items: [
            { id: 'r1', name: 'Cashier', archivedAt: null },
            { id: 'r2', name: 'Supervisor', archivedAt: null },
            { id: 'r0', name: 'Retired role', archivedAt: '2026-09-30T00:00:00.000Z' },
          ],
        },
      },
      'POST /api/v1/employees/e1/roles': { status: 201, body: { id: 'a1' } },
      'DELETE /api/v1/role-assignments/a1': { body: { id: 'a1', revoked: true } },
    });
    show();
    await openCass();
    expect(await screen.findByText('No role yet, so they can do nothing.')).toBeTruthy();
    await screen.findByRole('option', { name: 'Cashier' });
    expect(screen.queryByRole('option', { name: 'Retired role' }), 'an archived role is not offered').toBeNull();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'r1' } });
    submit('Give the role');
    expect(await screen.findByText('Cass Shah now has the role Cashier in all stores. They were signed out, so it applies at once.')).toBeTruthy();
    expect(within((await screen.findByRole('cell', { name: 'Cashier' })).closest('tr')!).getByText('All stores')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'r2' } });
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: 's2' } });
    submit('Give the role');
    expect(await screen.findByText('Cass Shah now has the role Supervisor in Station. They were signed out, so it applies at once.')).toBeTruthy();
    expect(calls.filter((c) => c.key === 'POST /api/v1/employees/e1/roles').map((c) => c.body)).toEqual([
      { roleId: 'r1', storeId: null },
      { roleId: 'r2', storeId: 's2' },
    ]);
    expect(within((await screen.findByRole('cell', { name: 'Supervisor' })).closest('tr')!).getByText('Station')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the role Cashier from Cass Shah' }));
    expect(await screen.findByText('The role Cashier was removed from Cass Shah. They were signed out, so it applies at once.')).toBeTruthy();
    await vi.waitFor(() => expect(screen.queryByRole('cell', { name: 'Cashier' })).toBeNull());
  });

  it('EM-12, EM-13, EM-15: access to a store is given and taken away; only a store not yet given is offered', async () => {
    const main = { id: 'g1', storeId: 's1' };
    const station = { id: 'g2', storeId: 's2' };
    const calls = serve({
      [LIST]: { body: { items: [cass], next: null } },
      [CASS]: { body: cass },
      [CASS_STORES]: [{ body: { items: [main] } }, { body: { items: [main, station] } }, { body: { items: [station] } }],
      [CASS_ROLES]: { body: { items: [] } },
      [ROLES]: { body: { items: [] } },
      'POST /api/v1/employees/e1/stores': { status: 201, body: { id: 'g2' } },
      'DELETE /api/v1/store-access/g1': { body: { id: 'g1', revoked: true } },
    });
    show();
    await openCass();
    await screen.findByRole('cell', { name: 'Main street' });
    expect(screen.getByText('A role works only in the stores someone can access.')).toBeTruthy();
    const offered = within(screen.getByLabelText('Store')).getAllByRole('option').map((o) => o.textContent);
    expect(offered, 'a store already given is not offered').toEqual(['Choose a store', 'Station']);

    fireEvent.change(screen.getByLabelText('Store'), { target: { value: 's2' } });
    submit('Give access');
    expect(await screen.findByText('Cass Shah can now work in Station. They were signed out, so it applies at once.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/v1/employees/e1/stores')?.body).toEqual({ storeId: 's2' });
    await vi.waitFor(() => expect(screen.queryByLabelText('Store'), 'every store given: nothing left to offer').toBeNull());

    fireEvent.click(screen.getByRole('button', { name: "Take away Cass Shah's access to Main street" }));
    expect(await screen.findByText('Cass Shah can no longer work in Main street. They were signed out, so it applies at once.')).toBeTruthy();
    await vi.waitFor(() => expect(screen.queryByRole('cell', { name: 'Main street' })).toBeNull());
  });
});
