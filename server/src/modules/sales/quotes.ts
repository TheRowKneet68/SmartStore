import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../http/errors.ts';

/** What the till's scan quoted: a variant's price at a store, at the server's time (`RT-124`). */
export interface Quote {
  storeId: string;
  variantId: string;
  unitPrice: number;
  currencyCode: string;
  quotedAt: string;
  barcode: string | null;
}

export interface QuoteSigner {
  sign(quote: Quote): string;
  /** The quote, if this server signed it for `storeId`; refused otherwise. Its age is checked at save, on the database's clock. */
  verify(token: string, storeId: string): Quote;
}

const NOT_OURS = 'A line on this cart was not priced by this store. Scan it again.';

/**
 * Signs the scan's quotes so that a sale can carry only prices the server issued (D4 §3, `RT-124`, `BI-30`).
 * ponytail: the key is drawn at start and held in memory, so a restart voids open quotes (the cart is rescanned) and
 * several server processes would need one shared key from configuration.
 */
export function quoteSigner(key: Buffer = randomBytes(32)): QuoteSigner {
  const mac = (body: string): Buffer => createHmac('sha256', key).update(body).digest();
  return {
    sign(quote) {
      const body = Buffer.from(JSON.stringify(quote)).toString('base64url');
      return `${body}.${mac(body).toString('base64url')}`;
    },
    verify(token, storeId) {
      const [body, signature, extra] = token.split('.');
      if (body === undefined || signature === undefined || extra !== undefined) throw new AppError(400, 'invalid_quote', NOT_OURS);
      const given = Buffer.from(signature, 'base64url');
      const expected = mac(body);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AppError(400, 'invalid_quote', NOT_OURS);
      const quote = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Quote;
      if (quote.storeId !== storeId) throw new AppError(400, 'invalid_quote', NOT_OURS);
      return quote;
    },
  };
}
