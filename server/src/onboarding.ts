import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from './db/pool.ts';
import { assignRole, createEmployee, createLogin, createRole, grantStoreAccess } from './modules/identity/repo.ts';
import { hashPassword } from './modules/identity/password.ts';
import {
  createInitialSettings,
  createOrganization,
  createStore,
  createStoreWarehouse,
  ensureCurrency,
} from './modules/organization/repo.ts';

/** What the operator supplies. Everything else is decided by the specification, as noted where it is set. */
export const OnboardingInput = z.object({
  organization: z.object({
    legalName: z.string().trim().min(1),
    tradingName: z.string().trim().min(1).nullable(),
    // The deployment currency is the owner's configuration (OQ-006), so the operator supplies it.
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    minorUnitExponent: z.number().int().min(0).max(18),
    timeZone: z.string().trim().min(1),
  }),
  store: z.object({
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    taxMode: z.enum(['Inclusive', 'Exclusive']),
  }),
  warehouse: z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1) }),
  owner: z.object({
    employeeNumber: z.string().trim().min(1),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    username: z.string().trim().min(1),
    // No password rule is specified (OQ-027): only that one is given.
    password: z.string().min(1).max(1024),
  }),
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

export interface Onboarded {
  organizationId: string;
  ownerEmployeeId: string;
  storeId: string;
  warehouseId: string;
  defaultLocationId: string;
}

/**
 * Onboards an organization in one transaction, in the order CONVENTIONS §11 requires: the organization, then its first
 * employee, then the store and its settings.
 * - The first employee is the organization's Owner: one organization-wide role holding every catalogue key
 *   (actors-and-roles §3.2, §4: "everything in the organization"; bypasses nothing), with access to the store.
 * - They are created before anyone exists to create them, so they are recorded as creating themselves, from a job (D7 §5).
 * - One default store with the organization's currency and time zone (organization-model §9; D1 §2). It allows negative
 *   stock (`CON-07`: the v1 default for stores). Its return window and default disposition are the schema's (D5).
 * - Its warehouse has the Default location, which is sellable (organization-model §5).
 */
export async function onboard(pool: pg.Pool, input: OnboardingInput): Promise<Onboarded> {
  const owner = randomUUID();
  const passwordHash = await hashPassword(input.owner.password);
  return withTransaction(pool, { actorId: owner, source: 'Job', correlationId: randomUUID() }, async (c) => {
    const o = input.organization;
    await ensureCurrency(c, o.currencyCode, o.minorUnitExponent);
    const organizationId = await createOrganization(c, {
      legalName: o.legalName,
      tradingName: o.tradingName,
      currencyCode: o.currencyCode,
      timeZone: o.timeZone,
    });
    await createEmployee(c, {
      id: owner,
      organizationId,
      employeeNumber: input.owner.employeeNumber,
      firstName: input.owner.firstName,
      lastName: input.owner.lastName,
      createdBy: owner,
    });
    await createLogin(c, { organizationId, employeeId: owner, username: input.owner.username, passwordHash });
    const storeId = await createStore(c, {
      organizationId,
      code: input.store.code,
      name: input.store.name,
      timeZone: o.timeZone,
      currencyCode: o.currencyCode,
    });
    await createInitialSettings(c, { storeId, taxMode: input.store.taxMode, createdBy: owner });
    const { warehouseId, defaultLocationId } = await createStoreWarehouse(c, {
      organizationId,
      storeId,
      code: input.warehouse.code,
      name: input.warehouse.name,
    });
    const role = await createRole(c, {
      organizationId,
      name: 'Owner',
      description: 'Everything in the organization (actors-and-roles §4). Bypasses nothing.',
      keys: 'everything',
      grantedBy: owner,
    });
    await assignRole(c, { employeeId: owner, roleId: role, organizationId, storeId: null, assignedBy: owner });
    await grantStoreAccess(c, { employeeId: owner, storeId, organizationId, grantedBy: owner });
    return { organizationId, ownerEmployeeId: owner, storeId, warehouseId, defaultLocationId };
  });
}
