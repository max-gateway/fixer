import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReadinessCard, type TaxReadiness } from './readiness';

const base: TaxReadiness = {
  regime: 'SIMPLES',
  regimeInformed: true,
  supported: true,
  requiredTables: ['simples-comercio', 'monofasico-autopecas'],
  ready: false,
  summary: 'Imposto estimado. Falta: validação da tabela do Simples Nacional (Anexo I).',
  steps: [
    { id: 'regime', label: 'Regime tributário da oficina', done: true, detail: 'Simples Nacional.' },
    { id: 'dados', label: 'Receita dos últimos 12 meses (RBT12)', done: true, detail: 'Informada.' },
    { id: 'perfil', label: 'Dados validados pelo contador', done: true, detail: 'Validados.' },
    { id: 'tabela', label: 'Validação da tabela do Simples Nacional (Anexo I)', done: false, detail: 'O contador ainda não validou esta tabela.', tableId: 'simples-comercio' },
    { id: 'tabela-monofasico', label: 'Validação da tabela de monofásico (peças monofásicas)', done: false, detail: 'O contador ainda não validou esta tabela.', tableId: 'monofasico-autopecas', optional: true },
  ],
};

describe('ReadinessCard', () => {
  it('pendente: título, resumo, cada passo com texto e link para as tabelas', () => {
    const out = renderToStaticMarkup(<ReadinessCard readiness={base} />);
    expect(out).toContain('Imposto ainda estimado');
    expect(out).toContain('Imposto estimado. Falta:');
    expect(out).toContain('Receita dos últimos 12 meses (RBT12)');
    expect(out).toContain('aria-label="pronto"');
    expect(out).toContain('aria-label="pendente"');
    expect(out).toContain('aria-label="opcional, pendente"');
    expect(out).toContain('só para peças monofásicas');
    expect(out).toContain('?aba=tabelas');
  });

  it('pronto: título verde e nenhum link de pendência', () => {
    const out = renderToStaticMarkup(<ReadinessCard readiness={{ ...base, ready: true, summary: 'Pronto.', steps: base.steps.map((s) => ({ ...s, done: true })) }} />);
    expect(out).toContain('Imposto pronto para confirmar');
    expect(out).toContain('bg-emerald-50');
    expect(out).not.toContain('?aba=tabelas');
  });

  it('regime não informado leva a Tributário', () => {
    const out = renderToStaticMarkup(
      <ReadinessCard readiness={{ ...base, regimeInformed: false, steps: [{ id: 'regime', label: 'Regime tributário da oficina', done: false, detail: 'Não informado: o Fixer assume Simples Nacional.' }] }} />,
    );
    expect(out).toContain('href="/configuracoes/tributario"');
    expect(out).toContain('Responder em Tributário');
  });

  it('marca o que a fonte oficial garante e leva à validação quando falta só o contador', () => {
    const out = renderToStaticMarkup(
      <ReadinessCard
        readiness={{
          ...base,
          steps: [
            { id: 'perfil', label: 'Conferência dos dados', done: false, needsAccountant: true, detail: 'O contador precisa conferir: a RBT12 não veio do PGDAS-D.' },
            { id: 'tabela', label: 'Validação da tabela do Simples Nacional (Anexo I)', done: true, basis: 'FONTE_OFICIAL', tableId: 'simples-comercio', detail: 'Conferida automaticamente com o texto da lei em 19/10/2026.' },
          ],
        }}
      />,
    );
    expect(out).toContain('fonte oficial');
    expect(out).toContain('href="#validacao-contador"');
    expect(out).not.toContain('?aba=tabelas');
  });
});
