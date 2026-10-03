import { useState } from 'react';
import { api } from './api.ts';
import { useList } from './form.ts';
import { check, problemOf, ProblemNotice, type Problem } from './Problem.tsx';

/**
 * One edge offered on a screen. The event, the key the edge names, and whether its contract records a reason.
 */
export interface Move {
  event: string;
  /** What the button says, and what the question names (`UX-03`: it names what, never "are you sure?"). */
  label: string;
  /** The permission the edge names in the catalogue. The move is offered only with it (`UX-08`); the server checks it. */
  key_: string;
  /** `SS055`: the edge's contract records a reason, so the question asks for one before anything is sent. */
  reason?: boolean;
  /** `UX-02`, `UX-03`: the dangerous moves are the explicit ones. This is the question, in words. */
  ask?: string;
  /** The words said when it goes through (`UX-04`: what happened, not what was done). */
  outcome: string;
}

interface Reason {
  id: string;
  code: string;
  name: string;
}

/**
 * The moves a record can make, as events on its state machine (§22.1, §22.9, §22.12). The edges, their permissions and
 * whether each needs a reason are data in the database, so the screen offers what the machine allows from where the
 * record stands and the server decides which of them is legal (`SM-06`).
 *
 * Every move asks its question first (`UX-03`), and one whose edge records a reason asks for the reason too (`SS055`).
 * A move nobody holds the key for is never offered (`UX-08`): a cashier who cannot disable a till does not need a
 * greyed-out button.
 */
export function Moves({
  machine,
  subject,
  name,
  moves,
  can,
  onSaid,
  onProblem,
  onDone,
}: {
  machine: string;
  subject: string;
  /** What the person calls this record, so the button says whose it is when a screen lists several. */
  name: string;
  moves: Move[];
  can: (key: string) => boolean;
  onSaid: (outcome: string) => void;
  onProblem: (problem: Problem) => void;
  onDone: () => void;
}) {
  const offered = moves.filter((m) => can(m.key_));
  const [asking, setAsking] = useState<Move | null>(null);
  // The reasons are read when a question that needs one opens, so a screen that never asks fetches nothing.
  const reasons = useList<Reason>(asking?.reason === true ? '/reason-codes' : null);
  const [reasonCodeId, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const close = () => {
    setAsking(null);
    setReason('');
    setProblem(null);
  };

  const send = async (move: Move) => {
    setBusy(true);
    setProblem(null);
    try {
      await api('POST', '/transitions', {
        machine,
        event: move.event,
        subject,
        ...(move.reason === true ? { reasonCodeId } : {}),
      });
      close();
      onSaid(move.outcome);
      onDone();
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (offered.length === 0) return null;
  return (
    <div className="actions">
      {offered.map((move) =>
        asking?.event === move.event ? (
          // The question sits where the button was, so the person can see what they are about to do (`UX-03`).
          <form
            key={move.event}
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (move.reason === true && reasonCodeId === '')
                return setProblem(check('Choose the reason, so the record says why.'));
              void send(move);
            }}
          >
            <p className="lede" role="note">
              <span aria-hidden="true">⚠ </span>
              {move.ask ?? `${move.label} ${name}?`}
            </p>
            {move.reason === true && (
              <label>
                Reason
                <select value={reasonCodeId} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose a reason</option>
                  {(reasons.items ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="actions">
              <button type="submit" disabled={busy}>
                {move.label}
              </button>
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
            </div>
            <ProblemNotice problem={problem} />
          </form>
        ) : (
          <button
            key={move.event}
            type="button"
            disabled={busy}
            onClick={() => {
              setProblem(null);
              setAsking(move);
            }}
            aria-label={`${move.label} — ${name}`}
          >
            {move.label}
          </button>
        ),
      )}
    </div>
  );
}
