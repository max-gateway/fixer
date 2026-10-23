import { ArrowRight, CircleAlert, CircleCheck, Landmark, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { REGIME_LABEL } from '@/lib/fiscal-autofill';
import { money } from '@/lib/invoices';
import { cn } from '@/lib/utils';
import type { TaxReadiness } from '../precificacao/readiness';
import { brDate, pct, period, TAX_LABEL, type TaxOverview } from './model';

export function Card({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('space-y-4 rounded-xl border bg-card p-5 shadow-xs', className)}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

type Verdict = { tone: 'ok' | 'warn'; title: string; detail: string; cta?: { href: string; label: string } };

/** Uma frase sobre a confiança do imposto: confirmado, só falta o contador, ou ainda estimado. */
function verdict(readiness: TaxReadiness | null): Verdict | null {
  if (!readiness) return null;
  if (!readiness.supported) return { tone: 'warn', title: 'Lucro Real', detail: 'O imposto incide sobre o lucro e admite crédito. O preço usa o percentual que você define na regra de preço.', cta: { href: '/configuracoes/precificacao', label: 'Ir para a regra de preço' } };
  const pending = readiness.steps.filter((s) => !s.done && !s.optional);
  if (readiness.ready) return { tone: 'ok', title: 'Imposto confirmado', detail: 'Dados de fonte oficial ou validados pelo contador. O preço sugerido usa este imposto.' };
  const onlyAccountant = pending.length > 0 && pending.every((s) => s.needsAccountant);
  return {
    tone: 'warn',
    title: onlyAccountant ? 'Falta só o contador conferir' : 'Imposto ainda estimado',
    detail: onlyAccountant ? pending.map((s) => s.detail).join(' ') : readiness.summary,
    cta: { href: '#ajustes', label: onlyAccountant ? 'Registrar validação' : 'Completar dados' },
  };
}

function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-white/60">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums leading-tight break-words">{value}</dd>
      {note && <dd className="text-xs text-white/70">{note}</dd>}
    </div>
  );
}

/** Cabeçalho da área: regime, quanto de imposto cai em cada venda e o selo de confiança. */
export function TaxHero({ overview, readiness, rbt12Note }: { overview: TaxOverview; readiness: TaxReadiness | null; rbt12Note: string | null }) {
  const issRate = overview.iss.saved ?? overview.iss.engine?.ratePct ?? null;
  const issFromEngine = overview.iss.saved == null && overview.iss.engine?.ratePct != null;
  const regime = overview.regime;
  const v = verdict(readiness);
  const s = overview.simples;
  const p = overview.presumido;

  // Serviços: Anexo III no Simples (o ISS pago está dentro do DAS); no Presumido, federais mais ISS; o ISS da nota vai na nota.
  const sv = overview.services;
  const issNote = issRate == null ? 'ISS do município não informado.' : `ISS de ${pct(issRate)} na nota${issFromEngine ? ' (tabela do município)' : ''}.`;
  let svcTax: ReactNode = <span className="text-white/60">—</span>;
  let svcNote: ReactNode = 'Informe o regime e a receita para calcular.';
  if (regime === 'REAL') {
    svcTax = 'Sob lucro';
    svcNote = `Só o ISS incide sobre o serviço. ${issNote}`;
  } else if (sv.simples) {
    svcTax = pct(sv.simples.dasPct);
    svcNote = `Mão de obra (Anexo III), faixa ${sv.simples.bracket} de 6. ${issNote}`;
  } else if (s?.outsideSimples) {
    svcTax = 'Fora do Simples';
    svcNote = 'A receita passou do teto de R$ 4,8 milhões.';
  } else if (sv.presumido) {
    svcTax = pct(Number(sv.presumido.totalPct) + Number(issRate ?? 0));
    svcNote = `Mão de obra: IRPJ, CSLL, PIS, COFINS${issRate != null ? ' e ISS' : ''}. ${issNote}`;
  }

  let saleTax: ReactNode = <span className="text-white/60">—</span>;
  let saleNote: ReactNode = 'Informe o regime e a receita para calcular.';
  if (regime === 'REAL') {
    saleTax = 'Sob lucro';
    saleNote = 'Sem percentual fixo sobre a venda de peças.';
  } else if (s && !s.outsideSimples) {
    saleTax = pct(s.dasPct);
    const icmsShare = s.components.find((c) => c.key === 'icms');
    const stNote = icmsShare && Number(icmsShare.pct) > 0 ? ` Peça com ICMS já recolhido por ST paga ${pct(Number(s.dasPct) - Number(icmsShare.pct))} (sai a parcela do ICMS, ${pct(icmsShare.pct)}).` : '';
    saleNote = `Alíquota cheia sobre peças e produtos (Anexo I), faixa ${s.bracket} de 6${s.stateTaxesOutsideDas ? '. ICMS e ISS saem do DAS.' : '.'}${stNote}`;
  } else if (s?.outsideSimples) {
    saleTax = 'Fora do Simples';
    saleNote = 'A receita passou do teto de R$ 4,8 milhões.';
  } else if (p) {
    saleTax = pct(p.totalPct);
    saleNote = 'Sobre peças e produtos: IRPJ, CSLL, PIS e COFINS, fora o ICMS da venda.';
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-brand-secondary text-white shadow-sm">
      <div className="space-y-6 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-white/10">
              <Landmark className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-white/60">Regime tributário</p>
              <p className="text-xl font-semibold">{regime ? REGIME_LABEL[regime] : 'Ainda não informado'}</p>
            </div>
          </div>
          {v && (
            <span role="status" className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium', v.tone === 'ok' ? 'bg-emerald-400/20 text-emerald-100' : 'bg-amber-400/20 text-amber-100')}>
              {v.tone === 'ok' ? <CircleCheck aria-hidden className="size-4" /> : <CircleAlert aria-hidden className="size-4" />}
              {v.title}
            </span>
          )}
        </div>

        <dl className="grid gap-6 sm:grid-cols-3">
          <Kpi label="Imposto na venda de peças" value={saleTax} note={saleNote} />
          <Kpi label="Imposto sobre serviços" value={svcTax} note={svcNote} />
          <Kpi label="Receita dos últimos 12 meses" value={s ? money(s.rbt12) : <span className="text-white/60">—</span>} note={rbt12Note} />
        </dl>

        {v && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-sm">
            <p className="max-w-2xl text-white/80">{v.detail}</p>
            {v.cta && (
              <Link href={v.cta.href} className="inline-flex items-center gap-1.5 rounded-md bg-card px-3 py-1.5 font-medium text-brand-secondary outline-none hover:bg-white/90 focus-visible:ring-[3px] focus-visible:ring-white/50">
                {v.cta.label} <ArrowRight aria-hidden className="size-4" />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Régua do Simples: onde a receita está entre zero, o sublimite (R$ 3,6 mi) e o teto (R$ 4,8 mi). */
export function SimplesLimit({ simples }: { simples: NonNullable<TaxOverview['simples']> }) {
  const used = Math.min(100, simples.ceilingUsedPct);
  const sublimitAt = 75; // 3,6 / 4,8
  const toNext = simples.nextBracketAtCents ? Number(simples.nextBracketAtCents) / 100 - Number(simples.rbt12) : null;
  const danger = simples.outsideSimples;
  const warn = !danger && simples.stateTaxesOutsideDas;
  return (
    <Card title="Seu limite no Simples" hint="A receita dos últimos 12 meses define a faixa e a alíquota.">
      <div className="space-y-2">
        <div className="relative pt-1">
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full', danger ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-brand')} style={{ width: `${used}%` }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used)} aria-label="Uso do limite do Simples" />
          </div>
          <span aria-hidden className="absolute top-0 h-5 w-px bg-foreground/40" style={{ left: `${sublimitAt}%` }} />
        </div>
        <div className="relative flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>R$ 0</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${sublimitAt}%` }}>
            R$ 3,6 mi
          </span>
          <span>R$ 4,8 mi</span>
        </div>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Faixa</dt>
          <dd className="text-lg font-semibold">{simples.outsideSimples ? 'Acima do teto' : `${simples.bracket} de 6`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Limite usado</dt>
          <dd className="text-lg font-semibold tabular-nums">{pct(used, 0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Próxima faixa</dt>
          <dd className="text-lg font-semibold tabular-nums">{toNext != null && toNext > 0 ? `em ${money(toNext)}` : '—'}</dd>
        </div>
      </dl>
      {(danger || warn) && (
        <p role="alert" className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', danger ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-950')}>
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {danger ? 'A receita passou do teto do Simples (R$ 4,8 milhões). O Anexo I não vale: fale com o contador sobre o regime.' : 'A receita passou do sublimite (R$ 3,6 milhões): ICMS e ISS passam a ser pagos fora do DAS, e a alíquota do Anexo I deixa de valer para o preço. Alguns estados adotam sublimite menor.'}
        </p>
      )}
    </Card>
  );
}

/** O motor contra a Receita: a alíquota que a tabela do Fixer calcula bate com a da última declaração (PGDAS-D)? */
export function EngineCheck({ conferencia, receitaAvailable, consent }: { conferencia: TaxOverview['conferencia']; receitaAvailable: boolean; consent: boolean }) {
  const status = conferencia?.status ?? 'SEM_COMPARAVEL';
  const view =
    status === 'CONFERE'
      ? { Icon: ShieldCheck, tone: 'text-emerald-700', title: 'O Fixer calcula igual à Receita', detail: `A alíquota calculada pelo motor bate com a da sua declaração${conferencia?.periodoDeclaracao ? ` de ${period(conferencia.periodoDeclaracao)}` : ''}, atividade por atividade.` }
      : status === 'DIVERGE'
        ? { Icon: TriangleAlert, tone: 'text-amber-700', title: 'Diferença com a declaração', detail: 'A alíquota do motor não bate com a da última declaração. Peça ao contador para conferir antes de confiar no preço.' }
        : { Icon: CircleAlert, tone: 'text-muted-foreground', title: 'Ainda sem declaração para comparar', detail: !receitaAvailable ? 'A leitura da Receita não está disponível neste ambiente.' : !consent ? 'Autorize a leitura da Receita abaixo para o Fixer conferir o cálculo com a sua declaração.' : 'A Receita ainda não trouxe uma declaração com atividades comparáveis.' };
  const diverging = conferencia?.itens.filter((i) => !i.confere) ?? [];
  return (
    <Card title="Conferência com a Receita" hint="O motor refaz a conta da sua última declaração do Simples (PGDAS-D).">
      <div className="flex items-start gap-3">
        <view.Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', view.tone)} />
        <div className="space-y-1 text-sm">
          <p className="font-semibold">{view.title}</p>
          <p className="text-muted-foreground">{view.detail}</p>
        </div>
      </div>
      {status === 'DIVERGE' && diverging.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {diverging.map((i) => (
            <li key={`${i.anexo}-${i.receita}`}>
              Anexo {i.anexo}: Receita {pct(i.declaradaPct, 4)} × Fixer {pct(i.tabelaPct, 4)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Onde a reforma tributária está hoje e o que isso muda no cálculo. */
export function ReformCard({ transition }: { transition: NonNullable<TaxOverview['transition']> }) {
  const year = transition.from.slice(0, 4);
  const items = [
    { label: 'PIS e COFINS', value: transition.pisCofinsInForce ? 'Em vigor' : 'Extintos' },
    { label: 'ICMS', value: `${pct(transition.icmsRemainingPct, 0)} do atual` },
    { label: 'ISS', value: `${pct(transition.issRemainingPct, 0)} do atual` },
    { label: 'IBS/CBS no Simples', value: transition.simplesOptantesCharged ? 'Cobrados' : 'Ainda não cobrados' },
  ];
  return (
    <Card title="Reforma tributária" hint={`Fase atual: ${year}${transition.to.slice(0, 4) !== year ? ` a ${transition.to.slice(0, 4)}` : ''} (de ${brDate(transition.from)} a ${brDate(transition.to)}).`}>
      <dl className="grid grid-cols-2 gap-3">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg bg-muted/60 p-3">
            <dt className="text-xs text-muted-foreground">{i.label}</dt>
            <dd className="text-sm font-semibold">{i.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">O Fixer acompanha o calendário da lei e troca as regras sozinho a cada fase. Onde falta definição oficial, ele avisa em vez de estimar.</p>
    </Card>
  );
}
