// Apresentação única de uma nota de compra: o que dizer sobre a situação dela, os fatos fiscais de cada item e a linha do
// emitente. A lista, o painel (modal) e a página de detalhe leem daqui; nenhum deles tem texto próprio sobre o mesmo fato.

import type { CostComponentCode, CostTreatment, ItemCost, WithCost, WithCostAlerts } from './invoice-cost';
import { FINALITY_LABEL, formatCnpj, IGNORED_REASON, shortDate, type InvoiceDetail, type InvoiceItem } from './invoices';

/** O que a API devolve no detalhe de uma nota: itens com custo real e os alertas de custo (frete por fora, ICMS de entrada...). */
export type InvoiceFull = Omit<InvoiceDetail, 'items'> & WithCostAlerts & { items: WithCost<InvoiceItem>[] };

export type NoticeTone = 'info' | 'warning' | 'danger';

export type InvoiceNotice = {
  id: string;
  tone: NoticeTone;
  /** A frase que resume: sozinha já diz o que fazer ou por que nada. */
  title: string;
  /** O que a frase não cobre; some quando a tela é estreita demais. */
  detail?: string;
};

/**
 * Tudo o que a pessoa precisa saber sobre a situação da nota, em linguagem de balcão, na ordem de importância. O painel
 * mostra o primeiro; a página mostra todos.
 */
export function invoiceNotices(inv: Pick<InvoiceDetail, 'status' | 'exportStatus' | 'needsReview' | 'finality' | 'ignoredReason' | 'manifestError' | 'manifestAttempts' | 'postedAt'>): InvoiceNotice[] {
  const out: InvoiceNotice[] = [];
  if (inv.status === 'CANCELED') {
    out.push(
      inv.exportStatus === 'POSTED'
        ? { id: 'canceled-posted', tone: 'danger', title: 'Cancelada pelo fornecedor depois de entrar no estoque.', detail: 'As peças já estão no estoque. Confira se foram recebidas e, se não, estorne a entrada.' }
        : { id: 'canceled', tone: 'info', title: 'O fornecedor cancelou esta nota.', detail: 'Ela não entra no estoque.' },
    );
  }
  if (inv.status === 'IGNORED') {
    out.push({ id: 'ignored', tone: 'info', title: (inv.ignoredReason && IGNORED_REASON[inv.ignoredReason]) ?? 'Esta nota não é uma compra para a oficina.', detail: 'O XML fica guardado, mas ela não entra no estoque.' });
  }
  if (inv.manifestError && inv.status === 'SUMMARY') {
    out.push({
      id: 'manifest-error',
      tone: 'danger',
      title: 'A SEFAZ recusou a ciência desta nota.',
      detail: `${inv.manifestError}${inv.manifestAttempts >= 5 ? ' Esgotadas as tentativas automáticas: use “Dar ciência e baixar XML” para tentar de novo.' : ''}`,
    });
  }
  if (inv.status === 'SUMMARY') {
    out.push({ id: 'summary', tone: 'warning', title: 'Só chegou o resumo da nota.', detail: 'Dê a ciência da operação para a SEFAZ liberar o XML completo. Isso não confirma o recebimento da mercadoria.' });
  }
  if (inv.status === 'MANIFESTED') {
    out.push({ id: 'manifested', tone: 'info', title: 'Ciência registrada.', detail: 'O XML completo chega na próxima sincronização, em até 1 hora.' });
  }
  if (inv.needsReview && inv.status === 'FULL') {
    out.push({
      id: 'needs-review',
      tone: 'warning',
      title: `Nota de finalidade “${inv.finality ? (FINALITY_LABEL[inv.finality] ?? inv.finality) : '—'}”.`,
      detail: 'O sistema não decide sozinho o efeito dela no estoque. Confira os itens e use “Revisei esta nota” para seguir.',
    });
  }
  if (inv.exportStatus === 'POSTED' && inv.status === 'FULL') {
    out.push({ id: 'posted', tone: 'info', title: `Entrada lançada no estoque em ${shortDate(inv.postedAt)}.` });
  }
  if (inv.exportStatus === 'READY' && inv.status === 'FULL') {
    out.push({ id: 'ready', tone: 'info', title: 'Todos os itens estão vinculados.', detail: 'Confira e lance a entrada: as peças somam ao estoque e o custo é atualizado.' });
  }
  return out;
}

/** Linha do emitente: CNPJ, número da NF e data, igual em qualquer tela. */
export function invoiceMeta(inv: Pick<InvoiceDetail, 'issuerCnpj' | 'number' | 'series' | 'issuedAt'>): string {
  const nf = inv.number != null ? ` · NF ${inv.number}${inv.series != null ? `/${inv.series}` : ''}` : '';
  return `${formatCnpj(inv.issuerCnpj)}${nf} · ${shortDate(inv.issuedAt)}`;
}

/** Os quatro números do topo da nota. `—` quando ainda não há itens (só resumo). */
export function invoiceFacts(inv: Pick<InvoiceDetail, 'status' | 'finality' | 'totalAmount'> & { items: Pick<InvoiceItem, 'resolution'>[] }) {
  const unresolved = inv.items.filter((i) => i.resolution === 'UNRESOLVED').length;
  return {
    total: inv.totalAmount,
    items: inv.items.length ? String(inv.items.length) : '—',
    finality: inv.finality ? (FINALITY_LABEL[inv.finality] ?? String(inv.finality)) : '—',
    unresolved: inv.status === 'FULL' ? String(unresolved) : '—',
    unresolvedCount: inv.status === 'FULL' ? unresolved : 0,
  };
}

/** NCM de 8 dígitos como no documento (8708.99.90); outro formato passa como veio. */
export const formatNcm = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6)}` : v);
/** CEST de 7 dígitos (01.003.00); outro formato passa como veio. */
export const formatCest = (v: string) => (/^\d{7}$/.test(v) ? `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5)}` : v);

/** Dados fiscais do item que vieram no XML, na ordem em que o contador lê: NCM, CEST, CFOP, GTIN. */
export function itemFiscalFacts(item: Pick<InvoiceItem, 'ncm' | 'cest' | 'cfop' | 'ean'>): { label: string; value: string }[] {
  return [
    { label: 'NCM', value: formatNcm(item.ncm) },
    ...(item.cest ? [{ label: 'CEST', value: formatCest(item.cest) }] : []),
    { label: 'CFOP', value: item.cfop },
    ...(item.ean ? [{ label: 'GTIN', value: item.ean }] : []),
  ].filter((f) => f.value);
}

const brl4 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** Custo real por unidade em estoque (frete, IPI, ST e crédito já considerados); null quando a API não calculou. */
export const landedCost = (cost: ItemCost | null | undefined) => (cost?.landed == null ? null : brl4.format(Number(cost.landed)));

// ---------- Impostos que incidem no produto ----------

/** Componentes do custo que são imposto, com o nome de balcão. Os demais (frete, seguro, desconto) não entram no gráfico. */
export const TAX_COMPONENT: Partial<Record<CostComponentCode, string>> = {
  ICMS_PROPRIO: 'ICMS',
  ICMS_ST: 'ICMS-ST',
  FCP_ST: 'FCP-ST',
  IPI: 'IPI',
  PIS: 'PIS',
  COFINS: 'COFINS',
  CREDITO_ICMS: 'Crédito de ICMS',
  ICMS_ST_RETIDO: 'ICMS-ST já retido',
  ICMS_ST_ENTRADA: 'ICMS-ST na entrada (PE)',
  ANTECIPACAO_ICMS: 'ICMS antecipado (PE)',
};

/** Como o imposto pesa no custo da peça, em português de balcão. */
export const TREATMENT_LABEL: Record<CostTreatment, string> = { COST: 'soma ao custo', CREDIT: 'abate o custo', INFO: 'já está no preço' };

export type TaxSlice = { code: CostComponentCode; name: string; amount: number; treatment: CostTreatment };

export type InvoiceTaxes = {
  slices: TaxSlice[];
  /** Soma dos impostos, em R$ (valor absoluto de cada um). */
  total: number;
  /** Valor das linhas consideradas (produtos), para dizer quanto da compra é imposto. */
  base: number;
  byTreatment: Record<CostTreatment, number>;
};

/**
 * Impostos da nota (ou de um item) a partir do livro de custo da API: cada imposto uma vez, somado entre os itens. A mesma
 * conta alimenta o modal e a página.
 */
export function invoiceTaxes(items: WithCost<Pick<InvoiceItem, 'itemNumber' | 'totalPrice'>>[], itemNumber: number | null = null): InvoiceTaxes {
  const pool = itemNumber == null ? items : items.filter((i) => i.itemNumber === itemNumber);
  const by = new Map<CostComponentCode, TaxSlice>();
  let base = 0;
  for (const it of pool) {
    base += Number(it.totalPrice);
    for (const c of it.cost?.components ?? []) {
      const name = TAX_COMPONENT[c.code];
      const amount = Math.abs(Number(c.amount));
      if (!name || !(amount > 0)) continue;
      const prev = by.get(c.code);
      by.set(c.code, { code: c.code, name, treatment: c.treatment, amount: (prev?.amount ?? 0) + amount });
    }
  }
  const slices = [...by.values()].sort((a, b) => b.amount - a.amount);
  const byTreatment: Record<CostTreatment, number> = { COST: 0, CREDIT: 0, INFO: 0 };
  for (const s of slices) byTreatment[s.treatment] += s.amount;
  return { slices, total: slices.reduce((s, x) => s + x.amount, 0), base, byTreatment };
}
