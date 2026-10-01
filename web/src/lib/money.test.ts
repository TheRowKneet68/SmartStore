import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money.ts';

/**
 * `money.ts` is the only place the till turns minor units into text and back. The governing text is
 * product-overview.md §3.1: money is an exact decimal and binary floating point is forbidden anywhere money is
 * computed or stored (D-17 records why two surveyed systems could not reconcile their own totals); amounts are held
 * at the currency's minor-unit exponent rather than assuming 2, so zero-decimal and three-decimal currencies are
 * representable; and the rounding mode is half-up under BI-01.
 *
 * No `RT-xxx` row covers displaying or keying an amount, so §3.1, BI-01 and D-17 are the citations here. A rule ID
 * that does cover it belongs in OPEN-QUESTIONS.md, not guessed here.
 */

describe('parseMoney', () => {
  it('keys whole and decimal text into exact minor units (product-overview.md §3.1, D-17)', () => {
    expect(parseMoney('12.50', 2)).toBe(1250);
    expect(parseMoney('12', 2)).toBe(1200);
  });

  it('accepts a comma as the decimal mark, because a locale keypad may produce one (§3.1)', () => {
    expect(parseMoney('12,50', 2)).toBe(1250);
  });

  it('tolerates surrounding whitespace from a paste (§3.1)', () => {
    expect(parseMoney(' 12.5 ', 2)).toBe(1250);
  });

  it('reads a two-decimal text as a one-decimal amount when the currency says so (§3.1 minor-unit exponent)', () => {
    expect(parseMoney('12.5', 1)).toBe(125);
    expect(parseMoney('5', 0)).toBe(5);
  });

  it('refuses more decimals than the currency has, rather than rounding the entry (BI-01, §3.1)', () => {
    expect(parseMoney('12.5', 0)).toBeNull();
    expect(parseMoney('12.345', 2)).toBeNull();
  });

  it('reads a three-decimal amount exactly (§3.1 three-decimal currencies are representable)', () => {
    expect(parseMoney('12.345', 3)).toBe(12345);
  });

  it('does not go through a float: 0.1 at exponent 2 is 10, not 10.000000000000002 (D-17)', () => {
    expect(parseMoney('0.1', 2)).toBe(10);
  });

  it('refuses text that is not a plain amount (§3.1)', () => {
    expect(parseMoney('', 2)).toBeNull();
    expect(parseMoney('abc', 2)).toBeNull();
    expect(parseMoney('12.3.4', 2)).toBeNull();
  });

  it('refuses a sign, because a negative sale amount is not a keyed amount (SP-39, §3.1)', () => {
    expect(parseMoney('-5', 2)).toBeNull();
    expect(parseMoney('+5', 2)).toBeNull();
  });

  it('refuses exponent notation, which would silently change the magnitude (§3.1)', () => {
    expect(parseMoney('1.2e3', 2)).toBeNull();
  });

  it('refuses a leading decimal point, which a till keypad cannot produce (§3.1)', () => {
    expect(parseMoney('.5', 2)).toBeNull();
  });

  it('refuses a magnitude that is no longer a safe integer, rather than returning an inexact amount (D-17)', () => {
    expect(parseMoney('99999999999999999999', 2)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('divides by the exponent once and shows the currency (product-overview.md §3.1)', () => {
    expect(formatMoney(123450, 'USD', 2)).toBe('$1,234.50');
  });

  it('formats zero as an amount, not as an empty string (§3.1)', () => {
    expect(formatMoney(0, 'USD', 2)).toBe('$0.00');
  });

  it('shows a negative amount, because a refund reduces an amount (CD-18, §3.1)', () => {
    expect(formatMoney(-500, 'USD', 2)).toBe('-$5.00');
  });

  it('shows a zero-decimal currency without inventing decimals (§3.1 exponent is recorded, not assumed to be 2)', () => {
    expect(formatMoney(1500, 'JPY', 0)).toBe('¥1,500');
  });

  it('shows a three-decimal currency exactly (§3.1 three-decimal currencies are representable)', () => {
    // ICU puts a non-breaking space between a three-letter code and the number; normalise it so this test asserts
    // the exponent, not ICU's choice of separator.
    expect(formatMoney(1234, 'BHD', 3).replaceAll('\u00a0', ' ')).toBe('BHD 1.234');
  });
});
