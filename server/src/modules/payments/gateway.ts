/**
 * The payment provider, as the domain sees it (`PY-07`, `PY-08`, architecture §13.1). Business logic depends on this
 * interface and on nothing a provider owns: no provider name, protocol or SDK appears outside an implementation. A
 * test asserts it (`gateway-boundary.test.ts`), as `HD-02` does for devices.
 *
 * Every call carries a merchant-side reference derived from the payment's or the refund's own id, so a retry after a
 * timeout is the same request to the provider and never a second charge (architecture §13.3). Money crosses as integer
 * minor units, exactly (`ADR-04`, architecture §13.4). Card data does not cross at all: a provider token stands for the
 * card, and nothing here stores it, logs it or puts it in an error (`PY-43`, `PY-44`).
 */

/** The closed set a provider's answer is normalised to (`PY-10`). The raw code is kept beside it. */
export type Outcome = 'Approved' | 'Declined' | 'Pending' | 'Failed' | 'Errored' | 'Timeout';

export interface GatewayResult {
  outcome: Outcome;
  /** The provider's own reference to the transaction. Null when it gave none. */
  providerReference: string | null;
  /** The provider's own code, kept for diagnosis (`PY-10`). It never holds card data. */
  rawCode: string | null;
}

interface Money {
  /** The payment's or refund's own id: the same for every retry of the same call. */
  merchantReference: string;
  amount: number;
  currencyCode: string;
}

export interface PaymentGateway {
  /** True for an implementation that moves no real money. Shown to the operator, and on the payment's record. */
  readonly simulated: boolean;
  /** Funds reserved, not taken (`Authorize`). `token` stands for the card. */
  authorize(request: Money & { token: string }): Promise<GatewayResult>;
  /** Funds taken (`Capture`), against the authorization the provider gave. */
  capture(request: Money & { providerReference: string }): Promise<GatewayResult>;
  /** Money back to the card (`Refund`), against a capture. */
  refund(request: Money & { capturedReference: string }): Promise<GatewayResult>;
  /** A cancellation before capture (`Void`). */
  void(request: { merchantReference: string; providerReference: string }): Promise<GatewayResult>;
  /** What the provider holds for a merchant reference (`Query`): how a `Timeout` is resolved (`PY-11`). */
  query(request: { merchantReference: string }): Promise<GatewayResult>;
}
