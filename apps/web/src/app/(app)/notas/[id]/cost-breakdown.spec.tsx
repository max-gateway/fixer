import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemCost } from '@/lib/invoice-cost';
import { CostBreakdown } from './cost-breakdown';

const cost = (o: Partial<ItemCost> = {}): ItemCost => ({
  landed: '25.2',
  total: '252',
  profile: 'RESALE',
  components: [
    { code: 'PRODUTO', treatment: 'COST', amount: '200', source: 'vProd', allocated: false },
    { code: 'ICMS_ST', treatment: 'COST', amount: '26.4', source: 'vICMSST', allocated: false },
    { code: 'FCP_ST', treatment: 'COST', amount: '5.6', source: 'vFCPST', allocated: false },
    { code: 'FRETE', treatment: 'COST', amount: '20', source: 'total/vFrete', allocated: true },
    { code: 'DESCONTO', treatment: 'COST', amount: '-10', source: 'vDesc', allocated: false },
    { code: 'CREDITO_ICMS', treatment: 'CREDIT', amount: '8', source: 'vICMS', allocated: false },
    { code: 'ICMS_ST_RETIDO', treatment: 'INFO', amount: '9.99', source: 'vICMSSTRet', allocated: false },
  ],
  ...o,
});

describe('CostBreakdown', () => {
  const html = renderToStaticMarkup(<CostBreakdown cost={cost()} />);

  it('mostra o custo por unidade de estoque no resumo', () => {
    expect(html).toContain('Custo real');
    expect(html).toContain('25,20');
  });

  it('é um details/summary (abre pelo teclado) e lista cada componente com nome de balcão', () => {
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    for (const label of ['Produtos', 'ICMS-ST', 'FCP-ST', 'Frete', 'Desconto', 'Crédito de ICMS (abate o custo)']) expect(html).toContain(label);
  });

  it('sinaliza sinal e natureza: soma, desconto/crédito subtraem, informativo não tem sinal', () => {
    expect(html).toMatch(/\+\s*(<!-- -->)?\s*R\$\s*200,00/);
    expect(html).toMatch(/−\s*(<!-- -->)?\s*R\$\s*10,00/);
    expect(html).toMatch(/−\s*(<!-- -->)?\s*R\$\s*8,00/);
    expect(html).toContain('ICMS-ST já retido antes (não entra)');
  });

  it('marca o que foi rateado do total da nota', () => {
    expect(html).toContain('rateado do total da nota');
  });

  it('avisa quando o item não parece compra para revenda', () => {
    expect(renderToStaticMarkup(<CostBreakdown cost={cost({ profile: 'NOT_RESALE' })} />)).toContain('não parece compra para revenda');
    expect(html).not.toContain('não parece compra para revenda');
  });

  it('sem custo (quantidade zero) não renderiza nada', () => {
    expect(renderToStaticMarkup(<CostBreakdown cost={cost({ landed: null })} />)).toBe('');
  });
});
