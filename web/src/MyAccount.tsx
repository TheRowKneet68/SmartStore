import { useState, type FormEvent } from 'react';
import { Announcer } from './lib/Announcer.tsx';
import { api } from './lib/api.ts';
import { check, problemOf, ProblemNotice, type Problem } from './lib/Problem.tsx';

/**
 * A person's own account: who they are signed in as, and a new password for themselves.
 *
 * There is nothing to choose here. Changing your own password takes no permission and names no employee, because the
 * actor is the session (`EM-03`): a cashier cannot reach a colleague's account by changing an id, as there is no id in
 * the request. It is offered to everyone, at the till as well as away from it.
 *
 * What it says, and why:
 * - a password is never visible to anyone afterwards, including an administrator (`EM-04`), so nothing here reads the
 *   old one back;
 * - the current password must be right, and a wrong one is recorded as a failed sign-in (`SM-49`), so a borrowed
 *   session cannot be used to guess it. That is why the form says to be careful rather than inviting attempts;
 * - the new password is typed twice, so a mistyped one cannot lock the person out of their own sign-in. The server
 *   asks only for the two fields and sets no rule about the shape of a password, so neither does this screen.
 *
 * Other sessions are not ended by a change here, and this does not claim they are.
 */
export function MyAccount({ name }: { name: string }) {
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [again, setAgain] = useState('');
  const [said, setSaid] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaid('');
    if (current === '' || fresh === '') return setProblem(check('Fill in your current password and the new one.'));
    if (fresh !== again) return setProblem(check('The new password is not the same in both boxes. Type it again.'));
    setProblem(null);
    try {
      await api('PUT', '/session/password', { currentPassword: current, newPassword: fresh });
      // Nothing about a password stays on screen after it has been used (`EM-04`).
      setCurrent('');
      setFresh('');
      setAgain('');
      setSaid('Your password was changed. Use the new one next time you sign in.');
    } catch (e) {
      setProblem(problemOf(e));
    }
  };

  return (
    <section className="panel narrow" aria-labelledby="account-title">
      <h1 id="account-title">My account</h1>
      <p className="lede">
        Signed in as <strong>{name}</strong>. This is your own account: it changes nothing about anyone else.
      </p>
      <h2>Change my password</h2>
      <p className="hint">
        Your current password has to be right, and a wrong one counts as a failed sign-in, so check it rather than
        guessing. Your new password is never shown to anyone afterwards, not even a manager.
      </p>
      <form onSubmit={submit} aria-labelledby="own-password-title">
        <h3 id="own-password-title" className="visually-hidden">
          Change my password
        </h3>
        <label>
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          New password
          <input type="password" autoComplete="new-password" value={fresh} onChange={(e) => setFresh(e.target.value)} />
        </label>
        <label>
          New password again
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        <button type="submit">Change my password</button>
      </form>
      <ProblemNotice problem={problem} />
      <Announcer text={said} />
    </section>
  );
}
