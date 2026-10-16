import { COMPONENT_LABEL, type ItemCost } from '@/lib/invoice-cost';

const brl4 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Custo real da compra do item: o que a nota realmente custou (frete, IPI, ST, crédito de imposto), por unidade
 * de estoque. A cascata abre com o teclado (details/summary) e mostra de onde veio cada valor.
 */
export function CostBreakdown({ cost }: { cost: ItemCost }) {
  if (cost.landed === null) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
        Custo real: <strong className="tabular text-foreground">{brl4.format(Number(cost.landed))}</strong> por unidade em estoque
      </summary>
      <div className="mt-2 space-y-1 rounded-lg border bg-muted/40 p-3">
        <ul className="space-y-0.5">
          {cost.components.map((c, i) => {
            const n = Number(c.amount);
            const sign = c.treatment === 'INFO' ? '' : c.treatment === 'CREDIT' || n < 0 ? '−' : '+';
            return (
              <li key={`${c.code}-${i}`} className={`flex justify-between gap-4 ${c.treatment === 'INFO' ? 'text-muted-foreground' : ''}`}>
                <span>
                  {COMPONENT_LABEL[c.code]}
                  {c.allocated && c.source !== 'MANUAL' && <span className="text-muted-foreground"> · rateado do total da nota</span>}
                </span>
                <span className="tabular shrink-0">
                  {sign} {brl2.format(Math.abs(n))}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="tabular flex justify-between gap-4 border-t pt-1 font-medium">
          <span>Custo da linha</span>
          <span>{brl2.format(Number(cost.total))}</span>
        </p>
        <p className="text-muted-foreground">Dividido pelas unidades que entram no estoque. Linhas em cinza só informam e não mudam o custo.</p>
        {cost.profile === 'NOT_RESALE' && (
          <p className="font-medium text-amber-900">Este item não parece compra para revenda: não use este custo para precificar.</p>
        )}
      </div>
    </details>
  );
}
