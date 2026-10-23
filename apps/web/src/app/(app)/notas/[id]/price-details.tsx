'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, Lock, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfidenceChip } from '@/components/confidence-chip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { getJson, putJson } from '@/lib/client-api';
import { breakEvenPrice, changesSince, OUTCOME_LABEL, priceShares, type EntryView } from '@/lib/entries';
import { COMPONENT_LABEL, type CostComponent } from '@/lib/invoice-cost';
import { money } from '@/lib/invoices';
import { FLAG_INFO, moneyCost, pct1, rowExpenses, RULE_SCOPE_LABEL, type IcmsStStatus, type PriceHistoryEntry, type PricingPlanView, type PricingRowView, type TaxFlagsView } from '@/lib/pricing';
import { TaxChip } from './tax-banner';

const UNAVAILABLE: Record<NonNullable<PricingRowView['saleTax']['unavailable']>, string> = {
  SEM_ALIQUOTA: 'Falta a RBT12 (Simples) ou o ICMS da venda (Lucro Presumido) em Configurações → Precificação → Imposto.',
  RBT12_FORA_DO_SIMPLES: 'A RBT12 informada passa do teto do Simples (R$ 4,8 milhões). Confira com o contador.',
  SUBLIMITE_ESTADUAL: 'A RBT12 passa do sublimite do Simples (R$ 3,6 milhões): o ICMS sai do DAS e é pago à parte. Peça ao contador a alíquota efetiva e informe em Configurações → Precificação → Imposto.',
  REGRA_FORA_DE_VIGENCIA: 'A tributação monofásica de autopeças acaba em 2027. Defina o percentual na regra até haver tabela nova.',
  REFORMA_SEM_ALIQUOTA: 'PIS e COFINS acabaram em 2027 e as alíquotas de CBS e IBS ainda não foram fixadas. Defina o percentual na regra.',
  REPARTICAO_FALTANDO: 'Esta peça precisa da repartição da alíquota (ICMS, PIS, COFINS), que o contador ainda não informou.',
  REGIME_NAO_SUPORTADO: 'O Lucro Real não tem percentual sobre a venda. Defina o percentual na regra.',
};

/**
 * Gaveta "Por que esse preço?": a conta em ordem (custo, imposto, regra, sugestão), o imposto parte a parte, os alertas, o
 * histórico da peça e a confirmação do enquadramento. Mantém a linha da nota enxuta: preço, margem e uma etiqueta.
 */
export function PriceDetails({ plan, row: r, trigger }: { plan: PricingPlanView; row: PricingRowView; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const rule = r.rule ?? plan.rule;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent aria-describedby={`why-${r.itemNumber}-desc`}>
        <header className="space-y-1 border-b px-5 py-4 pr-12">
          <SheetTitle>Por que esse preço?</SheetTitle>
          <SheetDescription id={`why-${r.itemNumber}-desc`}>
            {r.name} · {r.sku}
          </SheetDescription>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <ol className="space-y-3">
            <Step n={1} title="Custo real da compra" value={r.cost ? `${moneyCost(r.cost)} por unidade` : '—'}>
              Já com frete, IPI, ST e créditos, conforme o regime da oficina.
              <CostLines components={r.costComponents ?? []} qty={Number(r.stockQty)} />
            </Step>
            <Step n={2} title="Imposto sobre a venda" value={r.saleTax.pct === null ? 'não calculado' : pct1(r.saleTax.pct)} chip={<TaxChip tax={r.saleTax} />}>
              {r.saleTax.unavailable && <span>{UNAVAILABLE[r.saleTax.unavailable]}</span>}
            </Step>
            <Step n={3} title={`Regra${r.ruleScope ? ` (${RULE_SCOPE_LABEL[r.ruleScope]})` : ''}`} value={rule ? (rule.method === 'MARGIN' ? `margem de ${pct1(rule.value)} sobre a venda` : `markup de ${pct1(rule.value)} sobre o custo`) : 'nenhuma definida'}>
              {rule ? (
                <>{Number(rule.overheadPct) > 0 ? `Mais ${pct1(rule.overheadPct)} de despesas. ` : ''}O resultado é arredondado para cima.</>
              ) : (
                <>
                  Sem regra o Fixer não sugere preço.{' '}
                  <Link href="/configuracoes/precificacao" className="underline underline-offset-2">
                    Definir a regra de preço
                  </Link>
                </>
              )}
            </Step>
            <Step n={4} title="Preço sugerido" value={r.suggested ? money(r.suggested) : '—'}>
              {r.error && <span className="text-destructive">{r.error}</span>}
              {r.draft && <span className="block">Você digitou {money(r.draft)}: é ele que vale ao lançar e é ele que a conta abaixo usa.</span>}
            </Step>
          </ol>

          <PriceSplit row={r} rule={rule} />

          {r.saleTax.components.length > 0 && (
            <section aria-labelledby={`tax-${r.itemNumber}`} className="space-y-1.5">
              <h3 id={`tax-${r.itemNumber}`} className="font-semibold">
                De onde vem o imposto
              </h3>
              <ul className="divide-y rounded-lg border">
                {r.saleTax.components.map((c) => (
                  <li key={c.code} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="text-muted-foreground">{c.reason}</span>
                    <span className="tabular shrink-0 font-medium">{pct1(c.pct)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.taxNotes.length > 0 && (
            <section aria-labelledby={`notes-${r.itemNumber}`} className="space-y-1.5">
              <h3 id={`notes-${r.itemNumber}`} className="font-semibold">
                Para conferir com o contador
              </h3>
              <ul className="space-y-1.5">
                {r.taxNotes.map((n) => (
                  <li key={n.code}>
                    <Alert variant="warning">
                      <TriangleAlert aria-hidden />
                      <AlertDescription>{n.text}</AlertDescription>
                    </Alert>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.flags.some((f) => f !== 'NO_RULE') && (
            <section aria-labelledby={`flags-${r.itemNumber}`} className="space-y-1.5">
              <h3 id={`flags-${r.itemNumber}`} className="font-semibold">
                Alertas
              </h3>
              <ul className="space-y-1 text-muted-foreground">
                {r.flags
                  .filter((f) => f !== 'NO_RULE')
                  .map((f) => (
                    <li key={f}>
                      <strong className="text-foreground">{FLAG_INFO[f].label}:</strong>{' '}
                      {f === 'PRICE_DOWN' && r.currentPrice && r.proposed ? `de ${money(r.currentPrice)} para ${money(r.proposed)}.` : FLAG_INFO[f].hint}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <EntryHistory row={r} enabled={open} />
          <TaxFlagsForm key={JSON.stringify(r.taxFlags ?? null)} partId={r.partId} flags={r.taxFlags ?? null} />
          <TaxFootnote plan={plan} row={r} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Step({ n, title, value, chip, children }: { n: number; title: string; value: string; chip?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
        {n}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-muted-foreground">{title}</p>
        <p className="flex flex-wrap items-center gap-2">
          <strong className="tabular">{value}</strong>
          {chip}
        </p>
        {children && <p className="text-xs text-muted-foreground">{children}</p>}
      </div>
    </li>
  );
}

/**
 * O custo da linha como está na nota (totais da linha, não por unidade): o que soma ou abate, o total e a divisão pelas
 * unidades. Tributos que já vêm dentro do preço do fornecedor ficam à parte, só para informar.
 */
function CostLines({ components, qty }: { components: CostComponent[]; qty?: number }) {
  if (components.length === 0) return null;
  const counted = components.filter((c) => c.treatment !== 'INFO');
  const info = components.filter((c) => c.treatment === 'INFO');
  const signed = (c: CostComponent) => (c.treatment === 'CREDIT' ? -Math.abs(Number(c.amount)) : Number(c.amount));
  const total = counted.reduce((sum, c) => sum + signed(c), 0);
  const line = (c: CostComponent, i: number, muted = false) => {
    const n = signed(c);
    const sign = muted ? '' : n < 0 ? '−' : '+';
    return (
      <span key={`${c.code}-${i}`} className={`tabular flex justify-between gap-3 ${muted ? 'opacity-70' : 'text-foreground'}`}>
        <span>{COMPONENT_LABEL[c.code] ?? c.code}</span>
        <span className="shrink-0">
          {sign} {money(Math.abs(n))}
        </span>
      </span>
    );
  };
  return (
    <span className="mt-1.5 block space-y-1.5">
      {counted.length > 0 && (
        <span className="block space-y-0.5">
          {qty !== undefined && <span className="block font-medium">Na nota{qty > 0 ? `, para ${qty.toLocaleString('pt-BR')} un` : ''}</span>}
          {counted.map((c, i) => line(c, i))}
          {qty !== undefined && qty > 0 && counted.length > 1 && (
            <span className="tabular flex justify-between gap-3 border-t pt-0.5 font-medium text-foreground">
              <span>Total{qty > 1 ? ` ÷ ${qty.toLocaleString('pt-BR')} un` : ''}</span>
              <span className="shrink-0">
                {money(total)}
                {qty > 1 && ` → ${moneyCost(total / qty)}`}
              </span>
            </span>
          )}
        </span>
      )}
      {info.length > 0 && (
        <span className="block space-y-0.5">
          <span className="block font-medium">Já dentro do preço do fornecedor (só para informar)</span>
          {info.map((c, i) => line(c, i, true))}
        </span>
      )}
    </span>
  );
}

/** Rodapé: por que o imposto está confirmado ou estimado, e a versão das tabelas sem despejar a lista inteira. */
function TaxFootnote({ plan, row: r }: { plan: PricingPlanView; row: PricingRowView }) {
  const c = r.saleTax.confidence;
  const confirmedPart = (r.taxFlags?.confirmed ?? false) || (r.taxFlags?.auto ?? false);
  const text =
    c === 'DEFINIDO'
      ? 'O percentual de imposto foi definido na regra de preço.'
      : c === 'CONFIRMADO'
        ? 'Imposto confirmado: perfil e tabelas garantidos pela fonte oficial ou pelo contador, e enquadramento da peça confirmado.'
        : !plan.taxReadiness.ready
          ? `Imposto estimado: ${plan.taxReadiness.missing.map((m) => m.label.charAt(0).toLowerCase() + m.label.slice(1)).join('; ')}${confirmedPart ? '' : '; e confirmar o enquadramento desta peça'}.`
          : 'Imposto estimado: falta confirmar o enquadramento desta peça (acima).';
  const count = plan.rulesVersion.split('+').length;
  return (
    <p className="text-xs text-muted-foreground">
      {text} <span title={plan.rulesVersion}>{count > 1 ? `${count} tabelas de regra na versão em uso.` : `Tabelas de regra: ${plan.rulesVersion}.`}</span>
    </p>
  );
}

const SPLIT_TONE = { cost: 'bg-slate-400', tax: 'bg-sky-400', overhead: 'bg-violet-400', structure: 'bg-amber-400', margin: 'bg-emerald-500' } as const;

/**
 * "De cada R$ 100 do preço" (UI §6.1 e §7): quanto do preço proposto vai para o custo, o imposto, as despesas de venda, a
 * estrutura da oficina (com perfil de custos) e o que sobra. Abaixo, os preços-limite: mínimo sem prejuízo (custo, imposto e
 * despesas de venda), equilíbrio (com a estrutura) e o da margem mínima da regra.
 */
function PriceSplit({ row: r, rule }: { row: PricingRowView; rule: PricingPlanView['rule'] }) {
  const price = Number(r.proposed ?? r.suggested ?? 0);
  const ex = rowExpenses(r, rule);
  const cost = ex.priceCost;
  if (price <= 0 || cost <= 0) return null;
  const tax = r.saleTax.pct === null ? 0 : Number(r.saleTax.pct);
  const shares = priceShares(price, cost, tax, ex.variable + ex.fixed)!;
  const floor = breakEvenPrice(cost, tax, ex.variable);
  const even = ex.fixed > 0 ? breakEvenPrice(cost, tax, ex.variable + ex.fixed) : null;
  const minMargin = Number((r.rule ?? rule)?.minMarginPct ?? 0);
  const minPrice = minMargin > 0 ? breakEvenPrice(cost, tax, ex.variable + ex.fixed, minMargin) : null;
  const parts = [
    { key: 'cost', label: ex.extra > 0 ? 'Custo + extras' : 'Custo', v: shares.cost },
    { key: 'tax', label: 'Imposto', v: shares.tax },
    { key: 'overhead', label: 'Despesas de venda', v: ex.variable },
    ...(ex.fixed > 0 ? [{ key: 'structure', label: 'Estrutura da oficina', v: ex.fixed } as const] : []),
    { key: 'margin', label: shares.margin >= 0 ? 'Margem' : 'Prejuízo', v: shares.margin },
  ] as const;
  const r100 = (v: number) => money(Math.max(0, v));
  return (
    <section aria-labelledby={`split-${r.itemNumber}`} className="space-y-2">
      <h3 id={`split-${r.itemNumber}`} className="font-semibold">
        De cada R$ 100 do {r.draft ? 'seu preço' : r.suggested ? 'preço sugerido' : 'preço'} de {money(price)}
      </h3>
      <div aria-hidden className="flex h-3 overflow-hidden rounded-full bg-muted">
        {parts.map((p) => (p.v > 0 && !(p.key === 'margin' && shares.margin < 0) ? <span key={p.key} className={SPLIT_TONE[p.key]} style={{ width: `${Math.min(100, p.v)}%` }} /> : null))}
      </div>
      <ul className="tabular grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        {parts.map((p) => (
          <li key={p.key} className={`flex items-center justify-between gap-2 ${p.key === 'margin' && shares.margin < 0 ? 'font-medium text-destructive' : ''}`}>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`inline-block size-2 rounded-full ${p.key === 'margin' && shares.margin < 0 ? 'bg-destructive' : SPLIT_TONE[p.key]}`} />
              {p.label}
            </span>
            <span>{p.key === 'margin' && shares.margin < 0 ? `− ${money(-shares.margin)}` : r100(p.v)}</span>
          </li>
        ))}
      </ul>
      <dl className="tabular grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
        <div>
          <dt className="text-muted-foreground">Mínimo sem prejuízo</dt>
          <dd className="font-semibold">{floor === null ? 'não há' : money(floor)}</dd>
        </div>
        {even !== null && (
          <div>
            <dt className="text-muted-foreground">Equilíbrio (cobre a estrutura)</dt>
            <dd className="font-semibold">{money(even)}</dd>
          </div>
        )}
        {minPrice !== null && (
          <div>
            <dt className="text-muted-foreground">Margem mínima ({pct1(minMargin)})</dt>
            <dd className="font-semibold">{money(minPrice)}</dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        {ex.source === 'PROFILE'
          ? `Despesas pelo perfil de custos: estrutura ${pct1(ex.fixed)} e despesas de venda ${pct1(ex.variable)} do preço${ex.extra > 0 ? `, mais ${moneyCost(ex.extra)} por peça` : ''}.`
          : 'As despesas fixas da oficina (aluguel, folha) ainda não entram nesta conta: só as despesas definidas na regra. Publique o perfil em Precificação → Despesas.'}
      </p>
    </section>
  );
}

/**
 * Entradas desta peça no estoque, cada uma com a fotografia do lançamento (UI §6.8): documento, custo antes e depois, o que
 * aconteceu com o preço, a confiança do imposto daquele momento e o que mudou desde então. Sem entradas registradas (notas
 * lançadas antes da fotografia existir), cai no histórico de preço antigo. Só busca quando a gaveta é aberta.
 */
function EntryHistory({ row, enabled }: { row: PricingRowView; enabled: boolean }) {
  const q = useQuery({
    queryKey: ['part-entries', row.partId],
    queryFn: () => getJson<{ entries: EntryView[] }>(`/api/parts/${row.partId}/entries`, 'Não foi possível carregar o histórico.'),
    enabled,
    retry: false,
  });
  if (!enabled || q.isError) return null;
  if (q.isPending) return <p className="text-muted-foreground">Carregando o histórico…</p>;
  if (q.data.entries.length === 0) return <PriceHistory partId={row.partId} enabled={enabled} />;
  return (
    <section aria-labelledby={`entries-${row.partId}`} className="space-y-1.5">
      <h3 id={`entries-${row.partId}`} className="font-semibold">
        Entradas no estoque
      </h3>
      <ul className="space-y-1.5">
        {q.data.entries.map((e) => (
          <EntryItem key={e.id} entry={e} row={row} />
        ))}
      </ul>
    </section>
  );
}

function EntryItem({ entry: e, row }: { entry: EntryView; row: PricingRowView }) {
  const c = e.context;
  const doc = c.document;
  const changes = changesSince(c, row);
  const before = c.stock?.before.costPrice;
  return (
    <li className="rounded-lg border text-xs">
      <details>
        <summary className="cursor-pointer list-none space-y-0.5 px-3 py-2 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2">
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {new Date(e.at).toLocaleDateString('pt-BR')}
              {doc?.number != null && ` · NF ${doc.number}`}
              {doc?.issuer && ` · ${doc.issuer.name}${doc.issuer.uf ? ` (${doc.issuer.uf})` : ''}`}
            </span>
            {c.saleTax && <ConfidenceChip state={c.saleTax.confidence} label={c.saleTax.confidence === 'DEFINIDO' ? undefined : `Imposto ${c.saleTax.confidence === 'CONFIRMADO' ? 'confirmado' : 'estimado'}`} />}
          </p>
          <p className="tabular text-muted-foreground">
            +{Number(e.quantity).toLocaleString('pt-BR')} un · custo {before ? moneyCost(before) : '—'} → {moneyCost(e.unitCost)} · {c.price ? OUTCOME_LABEL[c.price.outcome] : 'preço'}
            {e.priceChanged && c.price?.before && <> {money(c.price.before)} → <strong className="text-foreground">{money(e.sellPriceAfter)}</strong></>}
          </p>
        </summary>
        <div className="space-y-2 border-t px-3 py-2">
          <p className={`flex items-center gap-1.5 ${e.intact ? 'text-emerald-800' : 'font-medium text-destructive'}`}>
            {e.intact ? <Lock aria-hidden className="size-3.5" /> : <TriangleAlert aria-hidden className="size-3.5" />}
            {e.intact ? 'Registro original, sem alterações.' : 'Este registro não confere com o original. Avise o suporte.'}
          </p>
          {c.cost && c.cost.components.length > 0 && (
            <div className="space-y-0.5">
              <p className="font-medium">Como o custo foi calculado ({c.cost.regime.toLowerCase()})</p>
              <CostLines components={c.cost.components as CostComponent[]} />
            </div>
          )}
          {c.price?.rule && (
            <p className="text-muted-foreground">
              Regra: {c.price.rule.method === 'MARGIN' ? 'margem' : 'markup'} {pct1(c.price.rule.value)}
              {c.saleTax?.pct != null && <> · imposto {pct1(c.saleTax.pct)}</>}
              {c.price.suggested && <> · sugerido {money(c.price.suggested)}</>}
            </p>
          )}
          {changes.length > 0 && (
            <div className="space-y-0.5">
              <p className="font-medium">O que mudou desde então</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {changes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground">Tabelas da época: {e.taxRulesVersion.split('+').length} tabelas, versão registrada.</p>
        </div>
      </details>
    </li>
  );
}

/** Histórico antigo (só notas lançadas com preço, antes da fotografia de cada entrada existir). */
function PriceHistory({ partId, enabled }: { partId: string; enabled: boolean }) {
  const q = useQuery({
    queryKey: ['price-history', partId],
    queryFn: () => getJson<{ history: PriceHistoryEntry[] }>(`/api/parts/${partId}/price-history`, 'Não foi possível carregar o histórico.'),
    enabled,
    retry: false,
  });
  if (!enabled || q.isError) return null;
  return (
    <section aria-labelledby={`hist-${partId}`} className="space-y-1.5">
      <h3 id={`hist-${partId}`} className="font-semibold">
        Histórico de custo e preço
      </h3>
      {q.isPending ? (
        <p className="text-muted-foreground">Carregando o histórico…</p>
      ) : q.data.history.length === 0 ? (
        <p className="text-muted-foreground">Esta peça ainda não tem histórico de preço pelo Fixer.</p>
      ) : (
        <ul className="space-y-1">
          {q.data.history.map((h) => (
            <li key={h.at} className="tabular rounded-lg border px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{new Date(h.at).toLocaleDateString('pt-BR')}</p>
              <p>
                custo {h.costBefore ? moneyCost(h.costBefore) : '—'} → {moneyCost(h.costAfter)}
              </p>
              <p>
                preço {h.sellBefore ? money(h.sellBefore) : '—'} → <strong className="text-foreground">{money(h.sellAfter)}</strong>
                {h.marginAfter !== null && <> · margem {pct1(h.marginAfter)}</>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ST_OPTIONS: { value: IcmsStStatus; label: string }[] = [
  { value: 'UNKNOWN', label: 'Não sei' },
  { value: 'NOT_ST', label: 'Sem substituição tributária' },
  { value: 'ST_CHARGED', label: 'ST cobrada na compra' },
  { value: 'ST_PAID_BEFORE', label: 'ST já retida antes' },
];
const MONO_OPTIONS = [
  { value: 'unknown', label: 'Não sei' },
  { value: 'yes', label: 'Sim' },
  { value: 'no', label: 'Não' },
] as const;
const monoValue = (v: boolean | null) => (v === true ? 'yes' : v === false ? 'no' : 'unknown');

/**
 * Confirmação do enquadramento tributário da peça: ato fiscal (permissão "Confirmar dados fiscais"). Abre com o que está
 * salvo, mostra o que a nota indica, e só salva quando algo muda. "Não sei" nas duas desfaz a confirmação; meia resposta
 * não confirma.
 */
function TaxFlagsForm({ partId, flags }: { partId: string; flags: TaxFlagsView | null }) {
  const qc = useQueryClient();
  const initialSt = flags?.icmsStStatus ?? 'UNKNOWN';
  const initialMono = monoValue(flags?.pisCofinsMonofasico ?? null);
  const [st, setSt] = useState<IcmsStStatus>(initialSt);
  const [mono, setMono] = useState<string>(initialMono);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const clearing = st === 'UNKNOWN' && mono === 'unknown';
  const partial = (st === 'UNKNOWN') !== (mono === 'unknown');
  const changed = st !== initialSt || mono !== initialMono;
  const save = useMutation({
    mutationFn: () => putJson(`/api/parts/${partId}/tax-flags`, { icmsStStatus: st, pisCofinsMonofasico: mono === 'unknown' ? null : mono === 'yes' }, 'Não foi possível salvar o enquadramento.'),
    onSuccess: () => {
      setMsg({ tone: 'ok', text: clearing ? 'Confirmação desfeita: o cálculo volta a usar a leitura da nota.' : 'Enquadramento confirmado.' });
      void qc.invalidateQueries({ queryKey: ['pricing'] });
    },
    onError: (e) => setMsg({ tone: 'error', text: e.message }),
  });
  const xml = flags?.xml;
  // Enquadramento resolvido sozinho (e sem confirmação manual): o formulário é só para corrigir, então fica recolhido.
  const Manual = ({ children }: { children: React.ReactNode }) =>
    flags?.auto && !flags.confirmed ? (
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">Corrigir manualmente</summary>
        <div className="mt-3 space-y-3">{children}</div>
      </details>
    ) : (
      <>{children}</>
    );
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 font-semibold">Enquadramento desta peça</legend>
      <p className={`text-xs ${flags?.confirmed || flags?.auto ? 'text-emerald-800' : 'text-muted-foreground'}`}>
        {flags?.confirmed
          ? 'Confirmado: vale mais que a leitura da nota.'
          : flags?.auto
            ? flags.autoMonofasico && !flags.xml.monofasico
              ? 'Confirmado automaticamente pela lei: o NCM está no Anexo I da Lei 10.485 e quem revende tem PIS/COFINS a 0% (art. 3º, § 2º), mesmo que o fornecedor tenha destacado normal na nota dele. Se discordar, escolha abaixo e salve.'
              : 'Confirmado automaticamente: a nota e as tabelas concordam, não há nada a decidir. Se discordar, escolha abaixo e salve.'
            : 'Ainda não confirmado: o cálculo usa a leitura da nota.'}
        {xml && ` A nota indica ${xml.st ? 'ICMS-ST' : 'sem ICMS-ST'} e ${xml.monofasico ? 'PIS/COFINS monofásico' : 'PIS/COFINS normal'}.`}
      </p>
      <Manual>
      <div className="space-y-1.5">
        <p id={`st-${partId}`} className="text-xs font-medium">
          ICMS
        </p>
        <RadioGroup value={st} onValueChange={(v) => setSt(v as IcmsStStatus)} aria-labelledby={`st-${partId}`} className="gap-1.5">
          {ST_OPTIONS.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2">
              <RadioGroupItem value={o.value} />
              {o.label}
            </label>
          ))}
        </RadioGroup>
      </div>
      <div className="space-y-1.5">
        <p id={`mono-${partId}`} className="text-xs font-medium">
          PIS/COFINS monofásico
        </p>
        <RadioGroup value={mono} onValueChange={setMono} aria-labelledby={`mono-${partId}`} className="flex flex-wrap gap-x-4 gap-y-1.5">
          {MONO_OPTIONS.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2">
              <RadioGroupItem value={o.value} />
              {o.label}
            </label>
          ))}
        </RadioGroup>
      </div>
      {partial && <p className="text-xs text-amber-800">Responda as duas perguntas para confirmar, ou marque &quot;não sei&quot; nas duas.</p>}
      <Button type="button" size="sm" variant="outline" disabled={save.isPending || !changed || partial} onClick={() => save.mutate()}>
        {save.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <CircleCheck aria-hidden />} {clearing ? 'Desfazer a confirmação' : 'Confirmar'}
      </Button>
      <p className="text-xs text-muted-foreground">Ato do contador: precisa da permissão &quot;Confirmar dados fiscais&quot;.</p>
      {msg && (
        <p role={msg.tone === 'error' ? 'alert' : 'status'} className={msg.tone === 'error' ? 'font-medium text-destructive' : 'text-emerald-800'}>
          {msg.text}
        </p>
      )}
      </Manual>
    </fieldset>
  );
}
