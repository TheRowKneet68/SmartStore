import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { MAX_PAGE, pageOf } from '../../http/paging.ts';
import { voidCardPayment } from './card-payment.ts';
import { paymentsNeedingAttention } from './attention.ts';
import type { PaymentGateway } from './gateway.ts';

const Ref = z.object({ storeId: z.uuid(), id: z.uuid() });
// How long a payment may wait is "a configured window" the specification does not give (PY-40, OQ-037), so the caller says.
const Attention = z.object({ olderThanMinutes: z.coerce.number().int().min(0).max(525_600), limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(MAX_PAGE) });

/** What a person does about a card payment that is not settled (`PY-13`, `PY-40`). */
export async function paymentRoutes(app: FastifyInstance, options: { pool: pg.Pool; gateway: PaymentGateway }): Promise<void> {
  const { pool, gateway } = options;

  /** Voids a `Pending` or `Authorized` card payment (`Payment.Void`, D-16 Q3). A captured one is refunded, never voided (`PY-12`). */
  app.post('/stores/:storeId/payments/:id/void', { config: { access: { kind: 'permission', key: 'Payment.Void', scope: 'store' } } }, async (request) => {
    const { id } = Ref.parse(request.params);
    return voidCardPayment(pool, request, gateway, id);
  });

  /**
   * The card payments that need a person (`PY-40`): waiting on the provider, authorized and never captured, or captured
   * with no sale. Read under `Payment.View`, "see payments and refunds". Nothing here changes anything.
   */
  app.get('/stores/:storeId/payments/attention', { config: { access: { kind: 'permission', key: 'Payment.View', scope: 'store' } } }, async (request) => {
    const { olderThanMinutes } = Attention.parse(request.query);
    const page = pageOf(request.query);
    const found = await paymentsNeedingAttention(pool, { storeId: request.storeId, olderThanMinutes, limit: page.limit, offset: page.offset });
    return { summary: found.summary, items: found.items, next: found.items.length === page.limit ? Buffer.from(String(page.offset + page.limit)).toString('base64url') : null };
  });
}
