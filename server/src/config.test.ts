import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const DATABASE_URL = 'postgres://smartstore_app:TEST-ONLY-secret@localhost:5432/x';

describe('the environment (ADR-31 s5, OQ-027)', () => {
  it('OQ-027: the security settings /docs does not state are required, never defaulted, and errors never print a value', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(
      'Invalid or missing environment variables: SESSION_LIFETIME_MINUTES, SIGN_IN_FAILURE_LIMIT, SIGN_IN_FAILURE_WINDOW_MINUTES, QUOTE_MAX_AGE_MINUTES.',
    );
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x:TEST-ONLY-secret@h/d' })).toThrow(/^(?!.*TEST-ONLY-secret).*DATABASE_URL/);
  });

  it('ADR-31 s5: a complete environment is read as numbers', () => {
    expect(
      loadConfig({ DATABASE_URL, SESSION_LIFETIME_MINUTES: '480', SIGN_IN_FAILURE_LIMIT: '5', SIGN_IN_FAILURE_WINDOW_MINUTES: '15', QUOTE_MAX_AGE_MINUTES: '30' }),
    ).toEqual({
      DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: 3000,
      SESSION_LIFETIME_MINUTES: 480,
      SIGN_IN_FAILURE_LIMIT: 5,
      SIGN_IN_FAILURE_WINDOW_MINUTES: 15,
      QUOTE_MAX_AGE_MINUTES: 30,
    });
  });
});
