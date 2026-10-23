import { simplesDas, simplesNacional, simplesRate } from '@fixer/tax-rules';

// Conferência de fidelidade: a tabela do Simples do Fixer (packages/tax-rules) contra a alíquota que a própria Receita
// calculou na última declaração do PGDAS-D, atividade por atividade (Anexo I). Se as duas batem, o motor reproduz o cálculo da
// Receita para as classes de receita desta empresa (comum, com ST de ICMS, monofásica); se não, algo está errado na tabela, na
// leitura da declaração ou no enquadramento, e o motor não deve dizer "confirmado" sem olhar.
//
// Alíquota esperada de uma atividade do Anexo I = efetiva da faixa − parcela do ICMS (se ST) − parcelas de PIS e Cofins (se
// monofásica). Anexo III (serviços) = efetiva da faixa − parcela do ISS (se retido na fonte, fora do DAS).
// A alíquota "declarada" é derivada de tributos arredondados a centavos (total ÷ receita), então difere da calculada pela tabela
// por arredondamento (6,0681 × 6,0680). O erro máximo é de meio centavo por tributo: com até 7 tributos, 0,035 R$ sobre a receita.

/** Piso de 0,0002 ponto percentual (escala 10^-4), ou o limite de arredondamento a centavos da própria atividade, o que for maior. */
const tolerance = (receita: string): bigint => {
  const bound = BigInt(Math.ceil(35_000 / Math.max(Number(receita), 1))); // 0,035 R$ / receita × 100 pp, em 10^-4 pp
  return bound > 2n ? bound : 2n;
};

export interface ConferenciaItem {
  anexo: 'I' | 'III';
  receita: string;
  declaradaPct: string;
  tabelaPct: string;
  /** declarada − tabela, em pontos percentuais. */
  diferencaPct: string;
  confere: boolean;
}

export interface Conferencia {
  /** SEM_COMPARAVEL: a declaração não traz atividade do Anexo I, ou faltou dado para recalcular. */
  status: 'CONFERE' | 'DIVERGE' | 'SEM_COMPARAVEL';
  periodoDeclaracao: string | null;
  rbt12Base: string | null;
  itens: ConferenciaItem[];
}

interface AtividadeAnexoI {
  receita: string;
  aliquotaDeclaradaPct: string;
  icmsSt: boolean;
  monofasico: string[];
}

interface AtividadeAnexoIII {
  receita: string;
  aliquotaDeclaradaPct: string;
  issRetido: boolean;
}

const SEM: Conferencia = { status: 'SEM_COMPARAVEL', periodoDeclaracao: null, rbt12Base: null, itens: [] };

/** "6.0681" -> 60681n (escala 10^-4). */
const scaled = (pct: string): bigint => {
  const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(pct.trim());
  if (!m) throw new Error(`percentual inválido: ${pct}`);
  const v = BigInt(m[2]!) * 10_000n + BigInt((m[3] ?? '').padEnd(4, '0') || '0');
  return m[1] ? -v : v;
};
const fmt = (v: bigint): string => `${v < 0n ? '-' : ''}${(v < 0n ? -v : v) / 10_000n}.${((v < 0n ? -v : v) % 10_000n).toString().padStart(4, '0')}`;

export function conferirSimples(fatos: Record<string, unknown> | null | undefined): Conferencia {
  const periodo = typeof fatos?.periodoDeclaracao === 'string' && /^\d{6}$/.test(fatos.periodoDeclaracao) ? fatos.periodoDeclaracao : null;
  const base = typeof fatos?.rbt12Base === 'string' ? fatos.rbt12Base : null;
  const atividades = Array.isArray(fatos?.atividadesAnexoI) ? (fatos!.atividadesAnexoI as AtividadeAnexoI[]) : [];
  const servicos = Array.isArray(fatos?.atividadesAnexoIII) ? (fatos!.atividadesAnexoIII as AtividadeAnexoIII[]) : [];
  if (!periodo || !base || atividades.length + servicos.length === 0) return { ...SEM, periodoDeclaracao: periodo, rbt12Base: base };

  // A tabela vigente é a do período da declaração, com a base que a Receita usou nele.
  const asOf = `${periodo.slice(0, 4)}-${periodo.slice(4)}-01`;
  const itens: ConferenciaItem[] = [];
  const item = (anexo: ConferenciaItem['anexo'], receita: string, declaradaPct: string, expected: bigint): ConferenciaItem => {
    const diff = scaled(declaradaPct) - expected;
    return { anexo, receita, declaradaPct, tabelaPct: fmt(expected), diferencaPct: fmt(diff), confere: (diff < 0n ? -diff : diff) <= tolerance(receita) };
  };

  const rate = atividades.length > 0 ? simplesRate(base, asOf) : null;
  if (rate) {
    for (const a of atividades) {
      const c = rate.components;
      let expected = scaled(rate.effectivePct);
      if (a.icmsSt) expected -= scaled(c.icms);
      if (a.monofasico.includes('PIS')) expected -= scaled(c.pis);
      if (a.monofasico.includes('COFINS')) expected -= scaled(c.cofins);
      itens.push(item('I', a.receita, a.aliquotaDeclaradaPct, expected));
    }
  }
  // Anexo III completo (6 faixas, teto do ISS na 5ª, 2027 em diante): packages/tax-rules `simplesNacional`, conferido com o texto da
  // LC 123 e da LC 214. O que sai do DAS (ISS retido, ISS acima do sublimite) já vem em `simplesDas`.
  const servico = servicos.length > 0 ? simplesNacional('III', base, asOf) : null;
  if (servico) {
    for (const a of servicos) {
      const das = simplesDas(servico, { issWithheld: a.issRetido }, asOf);
      if (das.dasPct !== null) itens.push(item('III', a.receita, a.aliquotaDeclaradaPct, scaled(das.dasPct)));
    }
  }

  if (itens.length === 0) return { ...SEM, periodoDeclaracao: periodo, rbt12Base: base };
  return { status: itens.every((i) => i.confere) ? 'CONFERE' : 'DIVERGE', periodoDeclaracao: periodo, rbt12Base: base, itens };
}
