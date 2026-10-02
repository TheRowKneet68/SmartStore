import type { GatewayResult, PaymentGateway } from './gateway.ts';

/**
 * ============================================================================================================
 *  TEST / SIMULATED. THIS GATEWAY MOVES NO MONEY AND TALKS TO NO PROVIDER.
 * ============================================================================================================
 * ADR-31 §13 item 4: card payments are a `PaymentGateway` with a simulated implementation. A real acquirer needs an
 * account and secrets, which are the owner's call. Everything here is a test double that behaves as the specification
 * says a provider may (`PY-10`, `PY-11`), so the till, the refund and the reconciliation can be built and proved
 * against every outcome before one exists.
 *
 * How it is marked, so it cannot be mistaken for the real thing:
 * - `simulated` is true, and the server says so when it starts;
 * - every reference it issues starts with `SIM-`, and a payment or refund carrying one is reported as simulated;
 * - it accepts only tokens that start with `TEST-`. A real card number put in the token's place is declined, never
 *   used, and is never stored (`PY-43`).
 *
 * The token chooses what happens, so a test can ask for any outcome:
 *
 * | Token                    | Authorize                                | Then                                        |
 * |--------------------------|------------------------------------------|---------------------------------------------|
 * | `TEST-APPROVE`           | Approved                                 | Capture and refund approved                 |
 * | `TEST-DECLINE`           | Declined                                 |                                             |
 * | `TEST-FAIL`              | Failed (a technical failure)             |                                             |
 * | `TEST-ERROR`             | Errored                                  |                                             |
 * | `TEST-TIMEOUT`           | Timeout; the provider did approve it     | Query finds it Approved                     |
 * | `TEST-TIMEOUT-LOST`      | Timeout; the provider never saw it       | Query finds nothing                         |
 * | `TEST-CAPTURE-FAIL`      | Approved                                 | Capture Failed                              |
 * | `TEST-CAPTURE-TIMEOUT`   | Approved                                 | Capture Timeout; the provider did capture   |
 * | `TEST-REFUND-DECLINE`    | Approved                                 | Refund Declined                             |
 * | `TEST-REFUND-FAIL`       | Approved                                 | Refund Failed                               |
 * | `TEST-REFUND-TIMEOUT`    | Approved                                 | Refund Timeout; the provider did refund     |
 *
 * It remembers what the "provider" did, in memory, by merchant reference: a repeated call returns the first answer
 * (the idempotency §13.3 relies on), and `query` finds what a timed-out call really did. A restart forgets it, as a
 * test double may.
 */
const PREFIX = 'SIM-';
const TOKENS = new Set([
  'APPROVE', 'DECLINE', 'FAIL', 'ERROR', 'TIMEOUT', 'TIMEOUT-LOST', 'CAPTURE-FAIL', 'CAPTURE-TIMEOUT',
  'REFUND-DECLINE', 'REFUND-FAIL', 'REFUND-TIMEOUT',
]);

const result = (outcome: GatewayResult['outcome'], providerReference: string | null, rawCode: string | null): GatewayResult => ({
  outcome,
  providerReference,
  rawCode,
});

export class SimulatedGateway implements PaymentGateway {
  readonly simulated = true;
  /** What the provider did, by command and merchant reference: the truth behind a timeout. */
  private readonly done = new Map<string, GatewayResult>();
  /** The last thing the provider did for a merchant reference, for `query`. */
  private readonly latest = new Map<string, GatewayResult>();

  /** Runs a command once per merchant reference. `shown` is what the caller sees when it is not what happened. */
  private once(key: string, merchantReference: string, happen: () => GatewayResult, shown?: GatewayResult): GatewayResult {
    const before = this.done.get(key);
    if (before !== undefined) return before;
    const happened = happen();
    if (happened.outcome === 'Approved') {
      this.done.set(key, happened);
      this.latest.set(merchantReference, happened);
    }
    return shown ?? happened;
  }

  async authorize({ merchantReference, token }: Parameters<PaymentGateway['authorize']>[0]): Promise<GatewayResult> {
    if (!token.startsWith('TEST-')) return result('Declined', null, 'SIM_ONLY_TEST_TOKENS');
    const behaviour = token.slice('TEST-'.length);
    if (!TOKENS.has(behaviour)) return result('Declined', null, 'SIM_UNKNOWN_TEST_TOKEN');
    const reference = `${PREFIX}${merchantReference}.${behaviour}`;
    const approved = result('Approved', reference, 'SIM_APPROVED');
    switch (behaviour) {
      case 'DECLINE':
        return result('Declined', null, 'SIM_DECLINED');
      case 'FAIL':
        return result('Failed', null, 'SIM_FAILED');
      case 'ERROR':
        return result('Errored', null, 'SIM_ERRORED');
      case 'TIMEOUT':
        return this.once(`authorize:${merchantReference}`, merchantReference, () => approved, result('Timeout', null, 'SIM_TIMEOUT'));
      case 'TIMEOUT-LOST':
        return result('Timeout', null, 'SIM_TIMEOUT');
      default:
        return this.once(`authorize:${merchantReference}`, merchantReference, () => approved);
    }
  }

  async capture({ merchantReference, providerReference }: Parameters<PaymentGateway['capture']>[0]): Promise<GatewayResult> {
    if (!providerReference.startsWith(PREFIX)) return result('Failed', null, 'SIM_UNKNOWN_AUTHORIZATION');
    const behaviour = providerReference.slice(providerReference.lastIndexOf('.') + 1);
    const approved = result('Approved', providerReference, 'SIM_CAPTURED');
    if (behaviour === 'CAPTURE-FAIL') return result('Failed', null, 'SIM_CAPTURE_FAILED');
    if (behaviour === 'CAPTURE-TIMEOUT') {
      return this.once(`capture:${merchantReference}`, merchantReference, () => approved, result('Timeout', null, 'SIM_TIMEOUT'));
    }
    return this.once(`capture:${merchantReference}`, merchantReference, () => approved);
  }

  async refund({ merchantReference, capturedReference }: Parameters<PaymentGateway['refund']>[0]): Promise<GatewayResult> {
    if (!capturedReference.startsWith(PREFIX)) return result('Failed', null, 'SIM_UNKNOWN_CAPTURE');
    const behaviour = capturedReference.slice(capturedReference.lastIndexOf('.') + 1);
    const approved = result('Approved', `${PREFIX}RF-${merchantReference}`, 'SIM_REFUNDED');
    if (behaviour === 'REFUND-DECLINE') return result('Declined', null, 'SIM_REFUND_DECLINED');
    if (behaviour === 'REFUND-FAIL') return result('Failed', null, 'SIM_REFUND_FAILED');
    if (behaviour === 'REFUND-TIMEOUT') {
      return this.once(`refund:${merchantReference}`, merchantReference, () => approved, result('Timeout', null, 'SIM_TIMEOUT'));
    }
    return this.once(`refund:${merchantReference}`, merchantReference, () => approved);
  }

  async void({ merchantReference, providerReference }: { merchantReference: string; providerReference: string }): Promise<GatewayResult> {
    if (!providerReference.startsWith(PREFIX)) return result('Failed', null, 'SIM_UNKNOWN_AUTHORIZATION');
    return this.once(`void:${merchantReference}`, merchantReference, () => result('Approved', providerReference, 'SIM_VOIDED'));
  }

  async query({ merchantReference }: { merchantReference: string }): Promise<GatewayResult> {
    return this.latest.get(merchantReference) ?? result('Failed', null, 'SIM_UNKNOWN');
  }
}
