import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../test/serve.ts';
import { Roles, type RoleRow } from './Roles.tsx';

/**
 * The roles screen (actors-and-roles §1, §2, §6): what each role grants, changed only with its key (`UX-05`, `UX-08`).
 * The server's refusals are the server's tests' to prove.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const CATALOGUE = ['Cash.Count.View', 'Sale.Create', 'Sale.View', 'Shift.Open'];
const cashier: RoleRow = { id: 'r1', name: 'Cashier', description: 'At the till', archivedAt: null, keys: ['Shift.Open', 'Sale.Create'] };
const old: RoleRow = { id: 'r0', name: 'Old', description: null, archivedAt: '2026-09-30T00:00:00.000Z', keys: ['Sale.View'] };
const EDITS = ['Role.View', 'Role.Create', 'Role.Edit'];
const ROLES = 'GET /api/v1/roles';
const PERMISSIONS = 'GET /api/v1/permissions';
const REMOVE = 'DELETE /api/v1/roles/r1/permissions/Sale.Create';

const show = (permissions = EDITS) => render(<Roles permissions={permissions} />);
const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!;
const openCashier = async () => fireEvent.click(within(await rowOf('Cashier')).getByRole('button', { name: 'Open the role Cashier' }));
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);

describe('the roles (AC-01, AC-02, UX-52)', () => {
  it('AC-01, UX-52: each role shows how many permissions it grants, and whether it is archived, in words beside a symbol', async () => {
    serve({ [ROLES]: { body: { items: [cashier, old] } }, [PERMISSIONS]: { body: { items: CATALOGUE } } });
    show();
    const row = within(await rowOf('Cashier'));
    expect(row.getByText('At the till')).toBeTruthy();
    expect(row.getByText('2')).toBeTruthy();
    expect(row.getByText('In use').closest('.chip')?.querySelector('[aria-hidden="true"]')?.textContent, 'a symbol, not colour alone').toBe('●');
    expect(within(await rowOf('Old')).getByText('Archived')).toBeTruthy();
  });

  it('AC-02, D-01: a role is made from catalogue keys, chosen by area; it needs a name, said before anything is sent', async () => {
    const calls = serve({
      [ROLES]: [{ body: { items: [] } }, { body: { items: [cashier] } }],
      [PERMISSIONS]: { body: { items: CATALOGUE } },
      'POST /api/v1/roles': { status: 201, body: { id: 'r1' } },
    });
    show();
    expect(await screen.findByRole('group', { name: 'Sale' }), 'the keys are grouped by area').toBeTruthy();
    submit('Create the role');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a name for the role.');
    expect(calls.some((c) => c.key === 'POST /api/v1/roles')).toBe(false);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cashier' } });
    fireEvent.click(screen.getByLabelText('Sale.Create'));
    fireEvent.click(screen.getByLabelText('Shift.Open'));
    submit('Create the role');
    expect(await screen.findByText('The role Cashier was created. It grants 2 permissions.')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/v1/roles')?.body).toEqual({ name: 'Cashier', keys: ['Sale.Create', 'Shift.Open'] });
    expect(await rowOf('Cashier'), 'read again').toBeTruthy();
  });

  it('UX-08: with Role.View alone, the roles are shown and nothing is offered to change them', async () => {
    const calls = serve({ [ROLES]: { body: { items: [cashier] } } });
    show(['Role.View']);
    await rowOf('Cashier');
    expect(screen.queryByRole('heading', { name: 'New role' })).toBeNull();
    await openCashier();
    expect(await screen.findByRole('cell', { name: 'Sale.Create' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive this role…' })).toBeNull();
    expect(calls.some((c) => c.key === PERMISSIONS), 'the catalogue is not even read').toBe(false);
  });
});

describe("one role's permissions (PC-02, PC-03, AC-02, BI-40)", () => {
  it('PC-02, PC-03: removing a permission says how many employees lose it, and goes ahead only when confirmed with that number', async () => {
    const calls = serve({
      [ROLES]: [{ body: { items: [cashier] } }, { body: { items: [{ ...cashier, keys: ['Shift.Open'] }] } }],
      [PERMISSIONS]: { body: { items: CATALOGUE } },
      [REMOVE]: { status: 409, body: { error: { code: 'confirm_affected', message: 'This takes Sale.Create from 2 employees. Confirm with that number.', affected: 2 } } },
      [`${REMOVE}?confirmAffected=2`]: { body: { roleId: 'r1', key: 'Sale.Create', granted: false } },
    });
    show();
    await openCashier();
    const asked = 'This takes Sale.Create from 2 employees. It applies from their next action; nobody is signed out.';
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sale.Create from Cashier' }));
    expect(await screen.findByText(asked)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByText(asked), 'kept: nothing asked any more').toBeNull();
    expect(screen.getByRole('cell', { name: 'Sale.Create' }), 'nothing removed').toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Sale.Create from Cashier' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove it from 2 employees' }));
    expect(await screen.findByText("Cashier no longer grants Sale.Create. It applies from each employee's next action; nobody was signed out.")).toBeTruthy();
    expect(calls.filter((c) => c.key.startsWith(REMOVE)).map((c) => c.key), 'confirmed once, with the number').toEqual([REMOVE, REMOVE, `${REMOVE}?confirmAffected=2`]);
    await vi.waitFor(() => expect(screen.queryByRole('cell', { name: 'Sale.Create' })).toBeNull());
  });

  it('AC-02: a permission is added from the catalogue, which offers only what the role does not grant yet', async () => {
    const calls = serve({
      [ROLES]: [{ body: { items: [cashier] } }, { body: { items: [{ ...cashier, keys: [...cashier.keys, 'Sale.View'] }] } }],
      [PERMISSIONS]: { body: { items: CATALOGUE } },
      'PUT /api/v1/roles/r1/permissions/Sale.View': { body: { roleId: 'r1', key: 'Sale.View', granted: true } },
    });
    show();
    await openCashier();
    const offered = within(await screen.findByLabelText('Permission')).getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual(['Choose a permission', 'Cash.Count.View', 'Sale.View']);
    submit('Add the permission');
    expect((await screen.findByRole('alert')).textContent).toBe('Choose the permission to add.');
    fireEvent.change(screen.getByLabelText('Permission'), { target: { value: 'Sale.View' } });
    submit('Add the permission');
    expect(await screen.findByText("Cashier now grants Sale.View. It applies from each employee's next action.")).toBeTruthy();
    expect(calls.some((c) => c.key === 'PUT /api/v1/roles/r1/permissions/Sale.View')).toBe(true);
    expect(await screen.findByRole('cell', { name: 'Sale.View' })).toBeTruthy();
  });

  it('AC-01, BI-40: archiving asks first; an archived role stays on record and offers no change', async () => {
    const calls = serve({
      [ROLES]: [{ body: { items: [cashier] } }, { body: { items: [{ ...cashier, archivedAt: '2026-10-01T09:00:00.000Z' }] } }],
      [PERMISSIONS]: { body: { items: CATALOGUE } },
      'POST /api/v1/roles/r1/archive': { body: { id: 'r1', archived: true, changed: true } },
    });
    show();
    await openCashier();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive this role…' }));
    expect(calls.some((c) => c.key === 'POST /api/v1/roles/r1/archive'), 'asked first').toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Archive the role' }));
    expect(await screen.findByText('Cashier is archived. It grants nothing from now on, and stays on record.')).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByText('Archived')).toBeTruthy());
    expect(screen.getByRole('cell', { name: 'Sale.Create' }), 'on record').toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByLabelText('Permission')).toBeNull();
  });
});
