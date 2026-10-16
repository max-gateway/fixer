import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PricingPlanView, SaleTaxView } from '@/lib/pricing';
import { TaxBanner, TaxChip } from './tax-banner';

const tax = (o: Partial<SaleTaxView> = {}): SaleTaxView => ({ pct: '5.65', confidence: 'ESTIMADO', unavailable: null, components: [], ...o });
const readiness = (o: Partial<PricingPlanView['taxReadiness']> = {}): PricingPlanView['taxReadiness'] => ({ ready: false, supported: true, regime: 'SIMPLES', summary: '', missing: [], ...o });
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('TaxChip', () => {
  it('um texto para cada estado do imposto (nunca só cor)', () => {
    expect(html(<TaxChip tax={tax()} />)).toContain('Imposto estimado');
    expect(html(<TaxChip tax={tax({ confidence: 'CONFIRMADO' })} />)).toContain('Imposto confirmado');
    expect(html(<TaxChip tax={tax({ confidence: 'DEFINIDO' })} />)).toContain('Definido por você');
    expect(html(<TaxChip tax={tax({ pct: null, unavailable: 'SEM_ALIQUOTA' })} />)).toContain('Imposto indisponível');
  });
});

describe('TaxBanner', () => {
  it('não aparece quando está tudo pronto e todo item tem imposto', () => {
    expect(html(<TaxBanner readiness={readiness({ ready: true })} unavailable={0} />)).toBe('');
  });

  it('lista o que falta e leva à aba do imposto quando faltam dados ou validação do perfil', () => {
    const out = html(<TaxBanner readiness={readiness({ missing: [{ id: 'dados', label: 'Receita dos últimos 12 meses (RBT12)', detail: '', tableId: null }] })} unavailable={0} />);
    expect(out).toContain('Imposto estimado.');
    expect(out).toContain('Falta: receita dos últimos 12 meses (RBT12)');
    expect(out).toContain('/configuracoes/precificacao?aba=imposto');
  });

  it('mostra só o primeiro passo e quantos mais faltam, em uma linha', () => {
    const m = (id: 'dados' | 'perfil' | 'tabela', label: string) => ({ id, label, detail: '', tableId: null });
    const out = html(<TaxBanner readiness={readiness({ missing: [m('dados', 'RBT12'), m('perfil', 'Dados validados'), m('tabela', 'Tabela')] })} unavailable={0} />);
    expect(out).toContain('Falta: rBT12 (e mais 2).');
    expect(out).not.toContain('<ul');
    expect(out).not.toContain('Dados validados');
  });

  it('leva à aba das tabelas quando só falta validar tabela', () => {
    const out = html(<TaxBanner readiness={readiness({ missing: [{ id: 'tabela', label: 'Validação da tabela do Simples Nacional (Anexo I)', detail: '', tableId: 'simples-comercio' }] })} unavailable={0} />);
    expect(out).toContain('?aba=tabelas');
  });

  it('itens sem imposto calculado deixam o aviso em vermelho e contam os itens', () => {
    const out = html(<TaxBanner readiness={readiness({ ready: true })} unavailable={2} />);
    expect(out).toContain('2 itens estão sem imposto calculado.');
    expect(out).toContain('bg-red-50');
    expect(html(<TaxBanner readiness={readiness({ ready: true })} unavailable={1} />)).toContain('1 item está sem imposto calculado.');
  });

  it('Lucro Real: explica que não há percentual, sem link de configuração', () => {
    const out = html(<TaxBanner readiness={readiness({ supported: false, regime: 'REAL' })} unavailable={0} />);
    expect(out).toContain('Lucro Real');
    expect(out).not.toContain('aba=');
  });
});
