import { useState } from 'react';
import { Refunds } from '../back/Refunds.tsx';
import { Returns } from '../back/Returns.tsx';
import type { Currency } from '../lib/money.ts';
import { SaleScreen } from './Sale.tsx';

type Panel = 'sale' | 'returns' | 'refunds';

/**
 * What a till does besides sell: take goods back and give money back (`RR-01`). The sale stays mounted, only hidden, so its
 * cart survives a change of mind (`UX-57`). Returns and refunds are the back office's screens, here **at a till**, which is what
 * lets a cash refund be drafted and paid: cash goes out of one till's drawer (`PY-27`, D-17). A tool is offered only to someone
 * who holds the key that reads it (`UX-05`, `UX-08`); each screen offers its acts by its own keys.
 */
export function TillWork({
  storeId,
  currency,
  permissions,
  onCartChange,
}: {
  storeId: string;
  currency: Currency;
  permissions: string[];
  onCartChange?: (lines: number) => void;
}) {
  const [panel, setPanel] = useState<Panel>('sale');
  const [refundFrom, setRefundFrom] = useState<string | null>(null);
  const tools: [Panel, string][] = [
    ...(permissions.includes('Return.View') ? [['returns', 'Returns'] as [Panel, string]] : []),
    ...(permissions.includes('Refund.View') ? [['refunds', 'Refunds'] as [Panel, string]] : []),
  ];
  const back = () => {
    setPanel('sale');
    // Back to the scan field, the keyboard path (UX-01).
    setTimeout(() => document.getElementById('code')?.focus());
  };

  return (
    <>
      {tools.length > 0 && (
        <nav className="till-tools" aria-label="At the till">
          {panel === 'sale' ? (
            tools.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setPanel(key)}>
                {label}
              </button>
            ))
          ) : (
            <button type="button" className="primary" onClick={back}>
              Back to the sale
            </button>
          )}
        </nav>
      )}
      <div hidden={panel !== 'sale'}>
        <SaleScreen storeId={storeId} currency={currency} onCartChange={onCartChange} permissions={permissions} />
      </div>
      {panel === 'returns' && <Returns storeId={storeId} permissions={permissions} onRefund={(id) => (setRefundFrom(id), setPanel('refunds'))} />}
      {panel === 'refunds' && <Refunds storeId={storeId} permissions={permissions} currency={currency} atTill startFromReturn={refundFrom} onStarted={() => setRefundFrom(null)} />}
    </>
  );
}
