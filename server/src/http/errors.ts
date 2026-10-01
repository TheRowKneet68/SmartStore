import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * A refusal the client can act on. Every error leaves the server as `{ error: { code, message } }`: a stable code to
 * branch on, never the text (architecture §18.4), and a message that says what happened and what to do (`UX-55`).
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Facts the client needs to act on, beside the message (for example PC-02's affected count). */
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface PgError {
  code?: string;
  constraint?: string;
}

/**
 * Messages for the business-rule refusals the database raises (CONVENTIONS §15). A domain adds its own when its routes
 * can meet them. The database's own text names internal ids, so it never reaches the client (architecture §24.3).
 */
const BUSINESS_RULES: Record<string, string> = {
  SS001: 'That has already been done, and who did it and when cannot be changed.',
  SS004: 'That change of state is not allowed.',
  SS005: 'A product needs at least one live variant before it can be activated.',
  SS006: 'A category cannot be placed under itself or under one of its own subcategories.',
  SS007: 'A variant with barcodes needs one primary barcode. Mark another one primary first.',
  SS008: 'Every live variant needs a price in force before the product can be released.',
  SS009: 'This product is archived, so nothing new may refer to it.',
  SS011: 'There is not enough stock for this, and this store does not go below zero.',
  SS012: 'A service item is not stocked, so it cannot be adjusted.',
  SS013: 'A quantity has more decimal places than its unit allows.',
  SS014: 'This store may not move stock at that location.',
  SS016: 'That document is not in a state that moves stock.',
  SS018: 'Lines change only while the document is a draft.',
  SS022: 'The document did not write exactly its stock movements, so nothing was saved.',
  SS024: 'That reason code is archived. Choose a live one.',
  SS025: 'This till is not in service, or is in training mode, so it cannot make a real sale.',
  SS026: 'The shift at this till is not open.',
  SS028: 'An item on this cart is no longer for sale.',
  SS029: 'An item on this cart has no tax rate in force.',
  SS030: 'A price on this cart is no longer the price that was quoted. Scan the items again.',
  SS032: 'This till does not sell from a sellable location of its own store.',
  SS033: 'A scanned barcode does not belong to its item.',
  SS034: 'The sale did not add up, so nothing was saved.',
  SS041: 'A discontinued item sells only from stock on hand, and there is none.',
  SS042: 'A shift needs its opening float counted, and a count before it closes.',
  SS045: 'That payment method is not taken at this store.',
  SS038: 'The tax mode cannot change once the store has made a sale, and a sale must use the settings in force.',
  SS055: 'This needs a reason. Choose one and try again.',
  SS057: 'This employee has a till shift that is not closed. Close it first.',
};

/** Check constraints a client can violate through a route, with what to do instead. */
const CHECKS: Record<string, string> = {
  ck_store_setting_version_prospective: 'New settings take effect now or later, never in the past.',
  ck_category_not_own_parent: 'A category cannot be its own parent.',
  ck_product_barcode_format: 'That is not a valid barcode of that kind. Check the digits, including the check digit.',
  ck_unit_countable_whole: 'A countable unit has no decimal places.',
  ck_unit_scale: 'A unit has between 0 and 4 decimal places.',
  ck_variant_price_positive: 'A price must be more than zero. A free item is a discount, not a zero price.',
  ck_store_variant_price_positive: 'A price must be more than zero. A free item is a discount, not a zero price.',
  ck_variant_price_prospective: 'A price takes effect now or later, never in the past.',
  ck_store_variant_price_prospective: 'A price takes effect now or later, never in the past.',
  ck_variant_standard_cost_non_negative: 'A cost cannot be negative.',
  ck_variant_standard_cost_prospective: 'A cost takes effect now or later, never in the past.',
  ck_tax_rate_non_negative: 'A tax rate cannot be negative. Zero is how an exemption is recorded.',
  ck_tax_rate_prospective: 'A tax rate takes effect now or later, never in the past.',
  ck_stock_adjustment_separation: 'The approver must be someone other than the person who submitted it.',
  ck_stock_adjustment_line_positive: 'A quantity must be more than zero.',
  ck_stock_adjustment_line_type: 'That kind of line does not belong on this kind of document.',
};

/** Uniqueness a client can run into, by constraint or index, with what it means. */
const UNIQUE: Record<string, string> = {
  uq_user_account_username: 'That username is already taken in this organization.',
  uq_employee_number: 'That employee number is already in use.',
  uq_unit_code: 'That unit code is already in use.',
  uq_tax_category_code: 'That tax category code is already in use.',
  uq_brand_name: 'That brand already exists.',
  uq_product_barcode_active_key: 'That barcode is already in use in this organization.',
  uq_product_barcode_one_primary: 'That variant already has a primary barcode.',
  uq_variant_price_effective: 'A price already starts at that moment.',
  uq_store_variant_price_effective: 'A price already starts at that moment.',
  uq_variant_standard_cost_effective: 'A cost already starts at that moment.',
  uq_tax_rate_effective: 'A rate already starts at that moment.',
  uq_cash_shift_open_per_drawer: 'This till already has a shift that is not closed.',
  uq_cash_shift_open_per_employee: 'You already have a shift in this store that is not closed.',
  uq_pos_terminal_code: 'That till code is already in use in this store.',
  uq_payment_method_code: 'That payment method code is already in use.',
  uq_reason_code_code: 'That reason code is already in use.',
};

export function toApiError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || 'body'))].join(', ');
    return new AppError(400, 'invalid_request', `The request is not valid: check ${fields}.`);
  }
  const fastifyError = error as Partial<FastifyError>;
  if (fastifyError.statusCode !== undefined && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
    return new AppError(400, 'invalid_request', 'The request is not valid JSON or is not the expected shape.');
  }
  const pgError = error as PgError;
  const code = pgError.code ?? '';
  if (/^SS\d{3}$/.test(code)) {
    return new AppError(409, code, BUSINESS_RULES[code] ?? `This was refused by a business rule (${code}).`);
  }
  const check = code === '23514' && pgError.constraint !== undefined ? CHECKS[pgError.constraint] : undefined;
  if (check !== undefined) return new AppError(422, 'invalid_value', check);
  if (code === '23505') {
    return new AppError(409, 'duplicate', (pgError.constraint && UNIQUE[pgError.constraint]) ?? 'That already exists.');
  }
  // A key to something missing, or to something of another organization: the same answer for both (§24.3).
  if (code === '23503') return new AppError(422, 'invalid_reference', 'Something this refers to does not exist.');
  if (code === '40001' || code === '40P01') {
    return new AppError(503, 'busy', 'The store is busy. Nothing was saved; try again.');
  }
  // IV-23: a lock timeout is a normal, expected outcome, and the retry is safe.
  if (code === '55P03') {
    return new AppError(409, 'busy_item', 'Another till is using one of these items right now. Nothing was saved; try again.');
  }
  return new AppError(500, 'internal', 'Something went wrong on the server. Nothing was saved; try again.');
}

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const apiError = toApiError(error);
  if (apiError.status >= 500) {
    // Ids, codes and states only: no values, which can be business data (architecture §25.4).
    const pgError = error as PgError & { table?: string; routine?: string };
    request.log.error(
      { code: pgError.code, constraint: pgError.constraint, table: pgError.table, routine: pgError.routine },
      error instanceof Error ? error.message : 'non-error thrown',
    );
  }
  void reply.status(apiError.status).send({ error: { ...apiError.details, code: apiError.code, message: apiError.message } });
}
