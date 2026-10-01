import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Announcer } from './Announcer.tsx';

/**
 * The one live region a screen announces through. RT-339 (MUST): every till action is keyboard-reachable and
 * announced audibly, and its acceptance is that a blind cashier can run a full shift with every confirmation spoken.
 * UX-51 is the rule behind this component.
 *
 * This file exists to prove the DOM harness works before anyone points it at a 164-line screen, and it locks the
 * accessibility contract that is easiest to break silently: drop `aria-live` or swap the class for `display: none`
 * and every screen in the till goes quiet for exactly the users RT-339 is about.
 */

describe('Announcer (RT-339, UX-51)', () => {
  it('is a polite live region (RT-339: every confirmation is spoken)', () => {
    render(<Announcer text="Sale 1042 completed" />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the text it is given, so a changed outcome is re-announced (RT-339)', () => {
    render(<Announcer text="Sale 1042 completed" />);
    expect(screen.getByRole('status').textContent).toBe('Sale 1042 completed');
  });

  it('is hidden from sight by the visually-hidden class, not by display: none (RT-339)', () => {
    render(<Announcer text="Sale 1042 completed" />);
    // `display: none` and `visibility: hidden` both remove an element from the accessibility tree, which would
    // silence the announcement. `.visually-hidden` clips it while leaving it announced.
    expect(screen.getByRole('status').className).toContain('visually-hidden');
    expect(screen.getByRole('status').tagName).toBe('P');
  });
});
