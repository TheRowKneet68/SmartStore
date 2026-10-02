import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../test/db.ts';
import { onboardingAnswers } from '../test/fixtures.ts';
import { DEFAULT_CURRENCY, onboard } from './onboarding.ts';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.drop();
});

describe('onboarding (organization-model s9, actors-and-roles s3.2 and s4, CONVENTIONS s11)', () => {
  it('ORG-04, MS-17, CON-07, RT-057: one transaction makes the organization, its Owner and a default store ready to stock', async () => {
    const answers = onboardingAnswers();
    const o = await onboard(db.app, answers);

    const owner = await db.app.query<{ status: string; hash: string }>(
      `SELECT e.status, a.password_hash AS hash FROM employee e JOIN user_account a ON a.employee_id = e.id WHERE e.id = $1`,
      [o.ownerEmployeeId],
    );
    expect(owner.rows[0]!.status).toBe('Active');
    expect(owner.rows[0]!.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(owner.rows[0]!.hash).not.toContain(answers.owner.password);

    const store = await db.app.query(
      `SELECT s.currency_code, s.time_zone, v.tax_mode, v.negative_stock_policy, v.return_window_days, v.default_return_disposition
       FROM store s JOIN store_setting_version v ON v.store_id = s.id WHERE s.id = $1`,
      [o.storeId],
    );
    expect(store.rows).toEqual([
      {
        currency_code: 'XTS',
        time_zone: 'UTC',
        tax_mode: 'Inclusive',
        negative_stock_policy: 'AllowNegative',
        return_window_days: 30,
        default_return_disposition: 'Quarantine',
      },
    ]);

    const locations = await db.app.query(
      'SELECT id, location_type, is_sellable FROM storage_location WHERE warehouse_id = $1',
      [o.warehouseId],
    );
    expect(locations.rows).toEqual([{ id: o.defaultLocationId, location_type: 'Default', is_sellable: true }]);
  });

  it('actors-and-roles s3.2, s4, AC-02: the Owner holds every catalogue key, in the store and organization-wide, through one role', async () => {
    const o = await onboard(db.app, onboardingAnswers());
    const held = await db.app.query<{ in_store: number; organization_wide: number; catalogue: number }>(
      `SELECT count(*) FILTER (WHERE employee_holds_permission($1, $2, key))::int AS in_store,
              count(*) FILTER (WHERE employee_holds_permission($1, NULL, key))::int AS organization_wide,
              count(*)::int AS catalogue
       FROM permission`,
      [o.ownerEmployeeId, o.storeId],
    );
    expect(held.rows[0]).toEqual({ in_store: 124, organization_wide: 124, catalogue: 124 });
    const roles = await db.app.query(
      `SELECT r.name, a.store_id FROM employee_role_assignment a JOIN role r ON r.id = a.role_id WHERE a.employee_id = $1`,
      [o.ownerEmployeeId],
    );
    expect(roles.rows).toEqual([{ name: 'Owner', store_id: null }]);
  });

  it('D7 s5, AU-05, RT-020: the Owner is recorded as creating themselves, from a job', async () => {
    const o = await onboard(db.app, onboardingAnswers());
    const events = await db.app.query<{ event_type: string; actor_id: string; source: string }>(
      `SELECT event_type, actor_id, source FROM audit_event
       WHERE organization_id = $1 AND event_type IN ('Employee.StateChange', 'Security.Role.Assign') ORDER BY seq`,
      [o.organizationId],
    );
    expect(events.rows).toEqual([
      { event_type: 'Employee.StateChange', actor_id: o.ownerEmployeeId, source: 'Job' },
      { event_type: 'Security.Role.Assign', actor_id: o.ownerEmployeeId, source: 'Job' },
    ]);
  });

  it('D-15: the deployment default is NPR with two decimal places, and it is a default, not a constraint', async () => {
    expect(DEFAULT_CURRENCY).toEqual({ code: 'NPR', minorUnitExponent: 2 });

    // A blank answer takes the default, and onboarding writes it as data.
    const blank = onboardingAnswers();
    blank.organization.currencyCode = DEFAULT_CURRENCY.code;
    blank.organization.minorUnitExponent = DEFAULT_CURRENCY.minorUnitExponent;
    const o = await onboard(db.app, blank);
    const currency = await db.app.query<{ code: string; minor_unit_exponent: number }>(
      'SELECT code, minor_unit_exponent FROM currency WHERE code = $1',
      [DEFAULT_CURRENCY.code],
    );
    expect(currency.rows).toEqual([{ code: 'NPR', minor_unit_exponent: 2 }]);

    // Another currency is still onboardable: a zero-decimal one must not be refused for disagreeing with the default.
    const other = await onboard(db.app, onboardingAnswers());
    expect(other.organizationId).not.toBe(o.organizationId);
  });

  it("ADR-04, BI-01: a currency's decimal places are never changed, and a refused onboarding writes nothing", async () => {
    const answers = onboardingAnswers(3);
    await expect(onboard(db.app, answers)).rejects.toMatchObject({ code: 'currency_exponent' });
    const { rows } = await db.app.query('SELECT 1 FROM organization WHERE legal_name = $1', [answers.organization.legalName]);
    expect(rows).toHaveLength(0);
  });
});
