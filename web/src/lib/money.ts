/** A store's currency: its ISO 4217 code and its decimal places (`BI-01`). */
export interface Currency {
  code: string;
  exponent: number;
}

/**
 * Money is integer minor units end to end (`ADR-04`). These two functions are the only places the till turns minor
 * units into text and back: dividing for display, and parsing typed digits exactly, never through a float.
 */
export function formatMoney(amount: number, currencyCode: string, exponent: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amount / 10 ** exponent);
}

/** "12.5" with exponent 2 is 1250. Null when the text is not an amount with at most `exponent` decimals. */
export function parseMoney(text: string, exponent: number): number | null {
  const match = /^\s*(\d+)(?:[.,](\d*))?\s*$/.exec(text);
  if (match === null) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) return null;
  const minor = Number(match[1]) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}
