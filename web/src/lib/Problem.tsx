import { ApiError } from './api.ts';

/**
 * A refusal or a failure, said in place and never as a surprise dialog (`UX-57`), and styled by whose it is (`UX-59`):
 * - something the person can act on (a refusal, or a value to correct) is a check, with its next step in the message;
 * - the server failing, or the network, is a system problem, in a different colour and words, and says the till is
 *   still working.
 * Text says which it is, beside a symbol, never colour alone (`UX-52`).
 */
export type Problem = { message: string; system: boolean };

/** What an error was, for the person at the till: the server's own words, and whether it was the system's fault. */
export function problemOf(error: unknown): Problem {
  if (error instanceof ApiError) return { message: error.message, system: error.status === 0 || error.status >= 500 };
  return { message: error instanceof Error ? error.message : String(error), system: true };
}

/** A problem the person caused or can fix: a value to correct, said with what to do. */
export const check = (message: string): Problem => ({ message, system: false });

export function ProblemNotice({ problem }: { problem: Problem | null }) {
  if (problem === null) return null;
  return (
    <p role="alert" className="problem" data-kind={problem.system ? 'system' : 'user'}>
      {problem.message}
      {problem.system && ' The till is still working, and nothing on screen was lost.'}
    </p>
  );
}
