import type { ReactNode } from 'react';
import type { CostAlert } from '@/lib/invoice-cost';
import { Callout } from './notices';

/**
 * O que o XML não traz ou não fecha (frete por fora, ICMS de entrada em PE, item que não é revenda), com os itens envolvidos.
 * `action` deixa a tela acrescentar uma ação ao alerta (a página oferece criar a conta a pagar; o painel só informa).
 */
export function CostAlerts({ alerts, action }: { alerts: CostAlert[]; action?: (alert: CostAlert) => ReactNode }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-3">
      {alerts.map((a, i) => (
        <Callout key={`${a.code}-${i}`} tone={a.severity === 'warning' ? 'warning' : 'info'}>
          <p>{a.message}</p>
          {a.itemNumbers.length > 0 && <p className="text-xs">Itens: {a.itemNumbers.join(', ')}</p>}
          {action?.(a)}
        </Callout>
      ))}
    </div>
  );
}
