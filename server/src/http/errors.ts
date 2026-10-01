import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * A refusal the client can act on. Every error leaves the server as `{ error: { code, message } }`: a stable code to
 * branch on, never the text (architecture §18.4), and a message that says what happened and what to do (`UX-55`).
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
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
  SS038: 'The tax mode cannot change once the store has made a sale, and a sale must use the settings in force.',
  SS055: 'This needs a reason. Choose one and try again.',
  SS057: 'This employee has a till shift that is not closed. Close it first.',
};

/** Check constraints a client can violate through a route, with what to do instead. */
const CHECKS: Record<string, string> = {
  ck_store_setting_version_prospective: 'New settings take effect now or later, never in the past.',
};

/** Uniqueness a client can run into, by constraint or index, with what it means. */
const UNIQUE: Record<string, string> = {
  uq_user_account_username: 'That username is already taken in this organization.',
  uq_employee_number: 'That employee number is already in use.',
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
  void reply.status(apiError.status).send({ error: { code: apiError.code, message: apiError.message } });
}
