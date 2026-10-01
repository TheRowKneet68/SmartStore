/** The one live region a screen announces through, so every action and outcome is spoken (`UX-51`). */
export function Announcer({ text }: { text: string }) {
  return (
    <p className="visually-hidden" aria-live="polite" role="status">
      {text}
    </p>
  );
}
