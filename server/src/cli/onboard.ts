import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { loadDotEnv } from '../config.ts';
import { createPool } from '../db/pool.ts';
import { onboard, OnboardingInput } from '../onboarding.ts';

/**
 * Onboards the organization, its Owner and its default store (onboarding.ts). Run once, by the operator, with
 * `npm run onboard`. It asks for everything, and reads the password without echoing it, so it never appears in a
 * command line or a shell history (`EM-04`).
 */
loadDotEnv();
const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_URL);
if (!url.success) throw new Error('DATABASE_URL is not set. Run scripts/db-setup.ps1, or see .env.example.');

/** A line typed without echo (a terminal), or read as it comes (a pipe). */
async function secret(prompt: string, lines: AsyncIterator<string> | null): Promise<string> {
  stdout.write(prompt);
  if (lines !== null) return (await lines.next()).value ?? '';
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          done();
          reject(new Error('Cancelled.'));
          return;
        }
        value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
      }
    };
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
const lines = stdin.isTTY ? null : rl[Symbol.asyncIterator]();
const ask = async (question: string): Promise<string> => {
  if (lines === null) return (await rl.question(question)).trim();
  stdout.write(question);
  return ((await lines.next()).value ?? '').trim();
};

stdout.write('SmartStore onboarding: the organization, its Owner, and its default store.\n\n');
const answers = {
  legalName: await ask('Organization legal name: '),
  tradingName: await ask('Trading name (blank if the same): '),
  currencyCode: (await ask('Currency code, ISO 4217 (for example GBP): ')).toUpperCase(),
  minorUnitExponent: Number(await ask('Decimal places of that currency (for example 2): ')),
  timeZone: await ask('Time zone, IANA (for example Europe/London): '),
  storeCode: await ask('Store code: '),
  storeName: await ask('Store name: '),
  taxMode: await ask('Are shelf prices tax-inclusive or tax-exclusive? (Inclusive/Exclusive): '),
  warehouseCode: await ask("Store warehouse code: "),
  warehouseName: await ask('Store warehouse name: '),
  employeeNumber: await ask("Owner's employee number: "),
  firstName: await ask("Owner's first name: "),
  lastName: await ask("Owner's last name: "),
  username: await ask("Owner's username: "),
};
if (lines === null) rl.close();
const password = await secret("Owner's password: ", lines);
const again = await secret('Password again: ', lines);
if (lines !== null) rl.close();
if (password !== again) throw new Error('The two passwords differ. Nothing was saved.');

const input = OnboardingInput.parse({
  organization: {
    legalName: answers.legalName,
    tradingName: answers.tradingName === '' ? null : answers.tradingName,
    currencyCode: answers.currencyCode,
    minorUnitExponent: answers.minorUnitExponent,
    timeZone: answers.timeZone,
  },
  store: { code: answers.storeCode, name: answers.storeName, taxMode: answers.taxMode },
  warehouse: { code: answers.warehouseCode, name: answers.warehouseName },
  owner: {
    employeeNumber: answers.employeeNumber,
    firstName: answers.firstName,
    lastName: answers.lastName,
    username: answers.username,
    password,
  },
});

const pool = createPool(url.data, 1);
try {
  const result = await onboard(pool, input);
  stdout.write(
    `\nOnboarded. Organization ${result.organizationId}, store ${result.storeId}.\n` +
      `${input.owner.username} can now sign in, holding every permission (the Owner role).\n`,
  );
} finally {
  await pool.end();
}
