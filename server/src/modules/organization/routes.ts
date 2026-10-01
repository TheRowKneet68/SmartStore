import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.ts';
import { auditContext, type Access } from '../../http/gate.ts';
import { addSettingsVersion, scheduledSettings, settingsInForce } from './repo.ts';

// Config.Store is the catalogue's key for changing store settings (actors-and-roles §2.12). The catalogue has no
// read-only key for them, and a screen that changes them is the only reader (UX-08).
const CONFIG_STORE: Access = { kind: 'permission', key: 'Config.Store', scope: 'store' };

/**
 * A new settings version: the full set, because a version is a complete snapshot (`REQ-AU-06`). Who made it is the
 * signed-in employee; zod drops any `createdBy` in the body (`AU-05`, `BI-33`).
 */
const NewSettings = z.object({
  taxMode: z.enum(['Inclusive', 'Exclusive']),
  negativeStockPolicy: z.enum(['AllowNegative', 'BlockNegative']),
  returnWindowDays: z.number().int().min(0).max(32_767),
  defaultReturnDisposition: z.enum(['Sellable', 'Quarantine']),
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
});

export async function organizationRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void> {
  const { pool } = options;

  app.get('/stores/:storeId/settings', { config: { access: CONFIG_STORE } }, async (request) => {
    const storeId = request.storeId!;
    const [inForce, scheduled] = await Promise.all([settingsInForce(pool, storeId), scheduledSettings(pool, storeId)]);
    return { inForce, scheduled };
  });

  app.post('/stores/:storeId/settings', { config: { access: CONFIG_STORE } }, async (request, reply) => {
    const body = NewSettings.parse(request.body);
    const version = await withTransaction(pool, auditContext(request), (client) =>
      addSettingsVersion(client, {
        storeId: request.storeId!,
        taxMode: body.taxMode,
        negativeStockPolicy: body.negativeStockPolicy,
        returnWindowDays: body.returnWindowDays,
        defaultReturnDisposition: body.defaultReturnDisposition,
        effectiveFrom: body.effectiveFrom === undefined ? null : new Date(body.effectiveFrom),
        createdBy: request.principal!.employeeId,
      }),
    );
    return reply.status(201).send(version);
  });
}
