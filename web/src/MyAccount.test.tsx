import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from './test/serve.ts';
import { MyAccount } from './MyAccount.tsx';

/**
 * A person's own password (`EM-03`, `EM-04`, `SM-49`). The request names no employee, because the actor is the session:
 * there is no id to change. A wrong current password is the server's to refuse and counts as a failed sign-in, so what
 * is proved here is what the screen sends, and what it does with what it is told.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const CHANGE = 'PUT /api/v1/session/password';
const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.submit(screen.getByRole('button', { name: 'Change my password' }).closest('form')!);
const fill = (current = 'TEST-ONLY old', fresh = 'TEST-ONLY new') => {
  field('Current password', current);
  field('New password', fresh);
  field('New password again', fresh);
};

describe('my account (EM-03, EM-04, SM-49)', () => {
  it('changes the password with no employee id in the request, because the actor is the session', async () => {
    const calls = serve({ [CHANGE]: { status: 204, body: {} } });
    render(<MyAccount name="Cass Shah" />);
    fill();
    submit();

    await screen.findByText('Your password was changed. Use the new one next time you sign in.');
    expect(calls.map((c) => c.key)).toEqual([CHANGE]);
    expect(calls[0]!.body).toEqual({ currentPassword: 'TEST-ONLY old', newPassword: 'TEST-ONLY new' });
  });

  it('clears every box afterwards, so no password stays on screen (EM-04)', async () => {
    serve({ [CHANGE]: { status: 204, body: {} } });
    render(<MyAccount name="Cass Shah" />);
    fill();
    submit();
    await screen.findByText(/Your password was changed/);

    for (const label of ['Current password', 'New password', 'New password again']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value, label).toBe('');
    }
  });

  it('says what is missing before anything is sent', async () => {
    const calls = serve({ [CHANGE]: { status: 204, body: {} } });
    render(<MyAccount name="Cass Shah" />);
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Fill in your current password and the new one.');
    expect(calls, 'nothing sent').toEqual([]);
  });

  it('two boxes that differ are refused here, so a mistyped password cannot lock anyone out', async () => {
    const calls = serve({ [CHANGE]: { status: 204, body: {} } });
    render(<MyAccount name="Cass Shah" />);
    field('Current password', 'TEST-ONLY old');
    field('New password', 'TEST-ONLY new');
    field('New password again', 'TEST-ONLY typo');
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe('The new password is not the same in both boxes. Type it again.');
    expect(calls, 'nothing sent').toEqual([]);
  });

  it("the server's own refusal is said as it stands, not restated as ours", async () => {
    serve({ [CHANGE]: { status: 403, body: { error: { code: 'wrong_password', message: 'Your current password is not right.' } } } });
    render(<MyAccount name="Cass Shah" />);
    fill();
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe('Your current password is not right.');
    expect(screen.getByText(/a wrong one counts as a failed sign-in/), 'the risk is said before, not after').toBeTruthy();
  });

  it('no permission is asked for: anyone signed in may change their own', () => {
    serve({});
    render(<MyAccount name="Cass Shah" />);
    expect(screen.getByRole('button', { name: 'Change my password' })).toBeTruthy();
    expect(screen.getByText('Cass Shah').closest('.lede')?.textContent).toContain('Signed in as');
  });
});
