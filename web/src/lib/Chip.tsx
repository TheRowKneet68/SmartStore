/** How a status shows: the chip's state (which sets its colour), its symbol, and its words. */
export type Look = [state: string, symbol: string, words: string];

/** A status in words beside a symbol, never colour alone (`UX-52`). A status with no look shows as itself. */
export function StatusChip({ status, looks }: { status: string; looks: Record<string, Look> }) {
  const [state, symbol, words] = looks[status] ?? ['none', '○', status];
  return (
    <span className="chip" data-state={state}>
      <span aria-hidden="true">{symbol}</span>
      <span>{words}</span>
    </span>
  );
}
