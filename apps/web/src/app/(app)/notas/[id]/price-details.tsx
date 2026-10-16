'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { getJson, putJson } from '@/lib/client-api';
import { money } from '@/lib/invoices';
import { FLAG_INFO, moneyCost, pct1, RULE_SCOPE_LABEL, type PriceHistoryEntry, type PricingPlanView, type PricingRowView } from '@/lib/pricing';
import { TaxChip } from './tax-banner';

const UNAVAILABLE: Record<NonNullable<PricingRowView['saleTax']['unavailable']>, string> = {
  SEM_ALIQUOTA: 'Falta a RBT12 (Simples) ou o ICMS da venda (Lucro Presumido) em Configurações → Precificação → Imposto.',
  RBT12_FORA_DO_SIMPLES: 'A RBT12 informada passa do teto do Simples (R$ 4,8 milhões). Confira com o contador.',
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
            </Step>
            <Step n={2} title="Imposto sobre a venda" value={r.saleTax.pct === null ? 'não calculado' : pct1(r.saleTax.pct)} chip={<TaxChip tax={r.saleTax} />}>
              {r.saleTax.unavailable && <span>{UNAVAILABLE[r.saleTax.unavailable]}</span>}
            </Step>
            <Step n={3} title={`Regra${r.ruleScope ? ` (${RULE_SCOPE_LABEL[r.ruleScope]})` : ''}`} value={rule ? (rule.method === 'MARGIN' ? `margem de ${pct1(rule.value)} sobre a venda` : `markup de ${pct1(rule.value)} sobre o custo`) : 'nenhuma definida'}>
              {rule && Number(rule.overheadPct) > 0 ? `Mais ${pct1(rule.overheadPct)} de despesas. ` : ''}O resultado é arredondado para cima.
            </Step>
            <Step n={4} title="Preço sugerido" value={r.suggested ? money(r.suggested) : '—'}>
              {r.error && <span className="text-destructive">{r.error}</span>}
            </Step>
          </ol>

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

          {r.flags.length > 0 && (
            <section aria-labelledby={`flags-${r.itemNumber}`} className="space-y-1.5">
              <h3 id={`flags-${r.itemNumber}`} className="font-semibold">
                Alertas
              </h3>
              <ul className="space-y-1 text-muted-foreground">
                {r.flags.map((f) => (
                  <li key={f}>
                    <strong className="text-foreground">{FLAG_INFO[f].label}:</strong> {FLAG_INFO[f].hint}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <PriceHistory partId={r.partId} enabled={open} />
          <TaxFlagsForm partId={r.partId} />
          <p className="text-xs text-muted-foreground">Tabelas de regra, versão {plan.rulesVersion}. Os percentuais de imposto são estimativas até o contador validar o perfil e as tabelas.</p>
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

/** Últimas mudanças de custo e preço desta peça, de notas lançadas com preço. Só busca quando a gaveta é aberta. */
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

/** Confirmação do enquadramento tributário da peça: ato fiscal, só quem tem a permissão consegue salvar. */
function TaxFlagsForm({ partId }: { partId: string }) {
  const qc = useQueryClient();
  const [st, setSt] = useState('UNKNOWN');
  const [mono, setMono] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => putJson(`/api/parts/${partId}/tax-flags`, { icmsStStatus: st, pisCofinsMonofasico: mono }, 'Não foi possível confirmar o enquadramento.'),
    onSuccess: () => {
      setMsg({ tone: 'ok', text: 'Enquadramento confirmado.' });
      void qc.invalidateQueries({ queryKey: ['pricing'] });
    },
    onError: (e) => setMsg({ tone: 'error', text: e.message }),
  });
  const options = [
    { value: 'UNKNOWN', label: 'Não sei' },
    { value: 'NOT_ST', label: 'Sem substituição tributária' },
    { value: 'ST_CHARGED', label: 'ST cobrada na compra' },
    { value: 'ST_PAID_BEFORE', label: 'ST já retida antes' },
  ];
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 font-semibold">Confirmar o enquadramento desta peça</legend>
      <p className="text-xs text-muted-foreground">Ato do contador: diz se a peça tem ST e se é monofásica. Vale mais que a leitura do XML.</p>
      <div className="space-y-1.5">
        <p id={`st-${partId}`} className="text-xs font-medium">
          ICMS
        </p>
        <RadioGroup value={st} onValueChange={setSt} aria-labelledby={`st-${partId}`} className="gap-1.5">
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2">
              <RadioGroupItem value={o.value} />
              {o.label}
            </label>
          ))}
        </RadioGroup>
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={mono} onCheckedChange={(c) => setMono(c === true)} />
        PIS/COFINS monofásico
      </label>
      <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <CircleCheck aria-hidden />} Confirmar
      </Button>
      {msg && (
        <p role={msg.tone === 'error' ? 'alert' : 'status'} className={msg.tone === 'error' ? 'font-medium text-destructive' : 'text-emerald-800'}>
          {msg.text}
        </p>
      )}
    </fieldset>
  );
}
