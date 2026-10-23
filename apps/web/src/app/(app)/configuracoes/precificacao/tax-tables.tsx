'use client';

import { useMutation } from '@tanstack/react-query';
import { CircleCheck, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { postJson } from '@/lib/client-api';

export type TaxTableView = {
  id: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sources: { law: string; url: string; retrievedAt: string }[];
  caveats: string[];
  /** Aceite do contador desta organização; `current` é falso quando foi dado a outra versão da tabela. */
  review: { reviewedBy: string; reviewedAt: string; version: string; current: boolean } | null;
  /** Conferência automática da versão em uso com o texto oficial; vale como validação. */
  sourceCheck?: { checkedAt: string; checks: string[] } | null;
  /** Quem garante a tabela hoje: o contador (versão em uso) ou a conferência com a fonte. */
  basis?: 'CONTADOR' | 'FONTE_OFICIAL' | null;
};

const LABEL: Record<string, string> = {
  'simples-comercio': 'Simples Nacional, Anexo I (comércio)',
  'monofasico-autopecas': 'PIS/COFINS monofásico de autopeças',
  'federal-lucro': 'Lucro Presumido e Real: tributos federais',
  'ibs-cbs-transition': 'Calendário da transição (2026 a 2033)',
  'ibs-cbs-referencia': 'Alíquotas de referência e reduções',
  'st-autopecas-anexo-ii': 'ICMS-ST de autopeças: lista de NCM e CEST',
  'st-autopecas-protocolo': 'ICMS-ST de autopeças: UFs do protocolo',
  'icms-interestadual': 'ICMS interestadual (12%, 7% e 4%)',
  cfop: 'CFOP (Confaz)',
  'cst-csosn': 'CST, CSOSN e CRT (Confaz)',
};

const GROUPS: { title: string; hint: string; ids: string[] }[] = [
  { title: 'Cálculo do imposto na venda', hint: 'Entram direto no percentual de imposto do preço.', ids: ['simples-comercio', 'federal-lucro', 'monofasico-autopecas'] },
  { title: 'Reforma tributária (2027 em diante)', hint: 'Ainda não entram no preço: guardam o calendário e esperam as alíquotas do Senado.', ids: ['ibs-cbs-transition', 'ibs-cbs-referencia'] },
  { title: 'Leitura da nota de compra', hint: 'Servem para conferir o XML do fornecedor e gerar avisos. Não mudam o preço.', ids: ['cfop', 'cst-csosn', 'st-autopecas-anexo-ii', 'st-autopecas-protocolo', 'icms-interestadual'] },
];

const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
const isCurrent = (t: TaxTableView) => t.review?.current === true;
/** Garantida pelo contador ou pela conferência com a lei: não precisa de ação. */
const isTrusted = (t: TaxTableView) => isCurrent(t) || Boolean(t.basis ?? t.sourceCheck);

function Status({ t }: { t: TaxTableView }) {
  if (isCurrent(t))
    return (
      <Badge variant="success">
        <ShieldCheck aria-hidden /> Validada por {t.review!.reviewedBy} em {date(t.review!.reviewedAt)}
      </Badge>
    );
  if (t.sourceCheck)
    return (
      <Badge variant="success">
        <CircleCheck aria-hidden /> Conferida com a lei em {date(t.sourceCheck.checkedAt)}
      </Badge>
    );
  if (t.review) return <Badge variant="warning">Validada numa versão anterior</Badge>;
  return <Badge variant="warning">Não conferida</Badge>;
}

/**
 * As tabelas de regra tributária, agrupadas pelo que fazem. O contador digita o nome uma vez e valida as tabelas do regime
 * da oficina de uma só vez; as demais podem ser validadas uma a uma.
 */
export function TaxTables({ tables, rulesVersion, required, canReview }: { tables: TaxTableView[]; rulesVersion: string; required: string[]; canReview: boolean }) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState('');
  const byId = new Map(tables.map((t) => [t.id, t]));
  const toReview = required.map((id) => byId.get(id)).filter((t): t is TaxTableView => !!t && !isTrusted(t));

  const review = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await postJson(`/api/pricing/tax-tables/${id}/review`, { reviewedBy: reviewer }, 'Não foi possível registrar a validação da tabela.');
    },
    onSuccess: () => router.refresh(),
  });
  const nameOk = reviewer.trim().length >= 2;

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        O Fixer calcula o imposto a partir de tabelas copiadas do texto oficial da lei, cada uma com a fonte e a vigência. Toda versão é conferida automaticamente com o texto publicado (Planalto, Confaz): conferida, ela vale como validada. O contador pode validar também; quando a tabela muda, vale de novo a conferência da versão nova.
      </p>

      {canReview && (
        <div className="space-y-2 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Validação do contador (opcional)</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Field id="tables-reviewer" label="Quem validou">
              <Input id="tables-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Nome do contador" className="max-w-64" />
            </Field>
            <Button type="button" disabled={review.isPending || !nameOk || toReview.length === 0} onClick={() => review.mutate(toReview.map((t) => t.id))}>
              {review.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />}
              {toReview.length === 0 ? 'Tabelas do seu regime garantidas' : `Validar as tabelas do seu regime (${toReview.length})`}
            </Button>
          </div>
          {review.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {review.error.message}
            </p>
          )}
        </div>
      )}

      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">{g.title}</h3>
            <p className="text-xs text-muted-foreground">{g.hint}</p>
          </div>
          <Accordion type="multiple" className="rounded-xl border bg-card px-4 shadow-xs">
            {g.ids
              .map((id) => byId.get(id))
              .filter((t): t is TaxTableView => !!t)
              .map((t) => (
                <AccordionItem key={t.id} value={t.id}>
                  <AccordionTrigger className="items-center">
                    <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span>
                        {LABEL[t.id] ?? t.id}
                        {required.includes(t.id) && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">usada no seu regime</span>}
                      </span>
                      <span className="text-xs font-normal">
                        <Status t={t} />
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Versão {t.version} · vale {t.effectiveTo ? `de ${date(t.effectiveFrom)} a ${date(t.effectiveTo)}` : `desde ${date(t.effectiveFrom)}`}
                    </p>
                    <div>
                      <p className="font-medium">Fontes</p>
                      <ul className="space-y-1">
                        {t.sources.map((s) => (
                          <li key={s.url}>
                            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                              {s.law} <ExternalLink aria-hidden className="size-3" />
                            </a>
                            <span className="text-muted-foreground"> (lida em {date(s.retrievedAt)})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium">O que esta tabela não cobre</p>
                      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                        {t.caveats.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                    {canReview && !isCurrent(t) && (
                      <div className="space-y-1">
                        <Button type="button" variant="outline" disabled={review.isPending || !nameOk} onClick={() => review.mutate([t.id])}>
                          <ShieldCheck aria-hidden /> Validar versão {t.version}
                        </Button>
                        {!nameOk && <p className="text-xs text-muted-foreground">Digite o nome de quem validou, acima.</p>}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
          </Accordion>
        </section>
      ))}
      <p className="break-all text-xs text-muted-foreground">Versão do conjunto de tabelas: {rulesVersion}</p>
    </div>
  );
}
