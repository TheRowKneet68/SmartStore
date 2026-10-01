import { z } from 'zod';
import { AppError } from './errors.ts';

/** The most items one page answers, and what a short configuration list answers when no limit is asked. */
export const MAX_PAGE = 200;

/**
 * One way to page every list (architecture §18.5: lists are "paginated and bounded by construction"). A request may give
 * `limit`, from 1 to 200, and `after`, the `next` of the page before. The answer is `{ items, next }`, where `next` is
 * null on the last page. A cursor is opaque to the client.
 */
export const PageQuery = z.object({ after: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(MAX_PAGE) });

export interface Page {
  limit: number;
  offset: number;
}

/**
 * The page a request asks for. ponytail: the cursor is a position in the list's fixed order, so a row added or
 * removed between two pages can shift the rest by one. These are short configuration lists. The long ones (sales,
 * movements, products, employees) page by key instead.
 */
export function pageOf(query: unknown): Page {
  const { after, limit } = PageQuery.parse(query);
  if (after === undefined) return { limit, offset: 0 };
  const offset = Number(Buffer.from(after, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError(400, 'invalid_request', 'The page cursor is not valid.');
  return { limit, offset };
}

/** One page of a list: its rows, and the cursor of the next page while this one is full. */
export function paged<T>(rows: T[], page: Page): { items: T[]; next: string | null } {
  return { items: rows, next: rows.length === page.limit ? Buffer.from(String(page.offset + page.limit)).toString('base64url') : null };
}
