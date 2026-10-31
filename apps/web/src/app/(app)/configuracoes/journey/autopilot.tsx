'use client';

import { ArrowRight, Calculator, Check, CloudDownload, FileCheck2, FileText, Hand, Landmark, PackagePlus, Play, RotateCcw, ScanBarcode, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { daysUntil, relativeTime, type FiscalCredentialView } from '@/lib/fiscal-import';
import { cn } from '@/lib/utils';
import type { TaxReadiness } from '../precificacao/readiness';
import { automations, type StepId } from './model';
import { Slash, Surface } from './ui';

type Stage = {
  id: string;
  icon: LucideIcon;
  title: string;
  auto: string;
  /** Sem a automação, o que fica para a pessoa fazer. */
  manual: string;
  on: boolean;
  /** Onde se liga o que está desligado. */
  fix?: StepId;
  /** Estado da nota de exemplo depois deste passo. */
  invoice: string;
};

const TICK_MS = 1100;

/**
 * O cenário final: o caminho de uma nota de compra pelo Fixer, do fornecedor ao preço de venda, com o que já roda sozinho
 * aceso. "Simular" passa uma nota de exemplo pelo caminho e para onde ainda depende de alguém.
 */
export function Autopilot({ credential, readiness, onGo }: { credential: FiscalCredentialView; readiness: TaxReadiness | null; onGo: (id: StepId) => void }) {
  const reduce = useReducedMotion();
  const on = automations(credential);
  const taxOk = readiness ? readiness.ready : true;

  const stages: Stage[] = [
    { id: 'sefaz', icon: CloudDownload, title: 'Busca na SEFAZ', auto: 'De hora em hora, sem abrir portal nenhum.', manual: 'Alguém baixa o XML e envia.', on: on.sync, fix: 'automacao', invoice: 'Encontrada na SEFAZ' },
    { id: 'ciencia', icon: FileCheck2, title: 'Ciência da operação', auto: 'Registrada sozinha: o XML completo é liberado.', manual: 'Alguém dá a ciência para liberar o XML.', on: on.manifest, fix: 'automacao', invoice: 'XML completo recebido' },
    { id: 'pecas', icon: ScanBarcode, title: 'Peças reconhecidas', auto: 'Pelo código do fornecedor e pelo código de barras; aprende com cada nota.', manual: '', on: true, invoice: 'Itens reconhecidos' },
    { id: 'imposto', icon: Landmark, title: 'Imposto de cada peça', auto: taxOk ? 'ICMS-ST e monofásico pelo XML, com os dados da Receita.' : 'Calculado, mas com estimativa: vale conferir em Tributário.', manual: '', on: true, invoice: taxOk ? 'Imposto calculado' : 'Imposto estimado' },
    { id: 'estoque', icon: PackagePlus, title: 'Entrada no estoque', auto: 'As peças entram sozinhas quando a nota está 100% reconhecida.', manual: 'Alguém confere e lança a entrada.', on: on.stock, fix: 'automacao', invoice: 'Peças no estoque' },
    { id: 'preco', icon: Calculator, title: 'Preço de venda sugerido', auto: 'Custo, imposto e margem da sua regra de preço.', manual: '', on: true, invoice: 'Pronta para vender' },
  ];

  // -1 = parado; 0..n-1 = a nota está neste passo; n = chegou ao fim.
  const [at, setAt] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stuck = at >= 0 && at < stages.length && !stages[at]!.on;
  const running = at >= 0 && at < stages.length && !stuck;

  useEffect(() => {
    if (!running) return;
    timer.current = setTimeout(() => setAt((i) => i + 1), reduce ? 0 : TICK_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [at, running, reduce]);

  const done = at >= stages.length;
  const autoCount = stages.filter((s) => s.on).length;
  const days = daysUntil(credential.notAfter);
  const current = at < 0 ? 'Emitida pelo fornecedor' : done ? stages.at(-1)!.invoice : stuck ? `Parada: ${stages[at]!.manual.toLowerCase()}` : stages[at]!.invoice;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Passos automáticos" value={`${autoCount}/${stages.length}`} tone={autoCount === stages.length ? 'ok' : 'warn'} />
        <Kpi label="Imposto" value={readiness ? (readiness.ready ? 'Confirmado' : 'Estimado') : '—'} tone={taxOk ? 'ok' : 'warn'} />
        <Kpi label="Próxima busca" value={on.sync ? relativeTime(credential.syncState?.nextPollAt ?? null) : 'Desligada'} tone={on.sync ? 'ok' : 'warn'} />
        <Kpi label="Certificado" value={days < 0 ? 'Vencido' : `${days} dias`} tone={days > 30 ? 'ok' : 'warn'} />
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <ol aria-label="Caminho de uma nota de compra" className="relative space-y-2 lg:order-first">
          {stages.map((st, i) => {
            const passed = done || i < at;
            const here = i === at;
            const Icon = st.icon;
            return (
              <li key={st.id} className="relative flex gap-3 sm:gap-4">
                {i < stages.length - 1 && (
                  <span aria-hidden className="absolute top-12 bottom-[-0.5rem] left-[1.375rem] w-0.5 overflow-hidden rounded-full bg-slate-200">
                    <motion.span className="block w-full bg-brand" initial={false} animate={{ height: passed ? '100%' : '0%' }} transition={{ duration: reduce ? 0 : 0.5, ease: 'easeOut' }} />
                  </span>
                )}
                <motion.span
                  aria-hidden
                  initial={false}
                  animate={here && !reduce ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ duration: 0.6, repeat: here && running ? Infinity : 0 }}
                  className={cn(
                    'relative z-10 grid size-11 shrink-0 place-items-center rounded-xl border-2 transition-colors',
                    passed ? 'border-brand bg-brand text-white' : here && stuck ? 'border-amber-400 bg-amber-50 text-amber-700' : here ? 'border-brand bg-brand-soft text-brand' : st.on ? 'border-brand/25 bg-card text-brand' : 'border-dashed border-slate-300 bg-card text-slate-400',
                  )}
                >
                  {passed ? <Check className="size-5" /> : here && stuck ? <Hand className="size-5" /> : <Icon className="size-5" />}
                </motion.span>
                <div className={cn('min-w-0 flex-1 rounded-xl border p-3 transition-colors sm:p-3.5', here && stuck ? 'border-amber-300 bg-amber-50' : here ? 'border-brand/40 bg-brand-soft' : 'border-transparent')}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold">{st.title}</p>
                    {st.on ? (
                      <Badge variant="secondary" className="bg-brand/10 text-brand">
                        Automático
                      </Badge>
                    ) : (
                      <Badge variant="warning">Manual</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{st.on ? st.auto : st.manual}</p>
                  {!st.on && st.fix && (
                    <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0 text-xs" onClick={() => onGo(st.fix!)}>
                      Deixar no automático <ArrowRight aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Surface className="space-y-4 bg-brand-secondary text-white">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-sky-300 uppercase">
              <Slash className="w-5" /> Nota de exemplo
            </p>
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <FileText className="size-5 text-sky-300" />
              </span>
              <div className="min-w-0">
                <p className="font-display truncate font-semibold">NF-e de compra de peças</p>
                <p className="text-xs text-white/60">Fornecedor de autopeças · 12 itens</p>
              </div>
            </div>
            <div aria-live="polite" className="min-h-14 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={current}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className={cn('text-sm font-medium', stuck ? 'text-amber-300' : done ? 'text-emerald-300' : 'text-white')}
                >
                  {current}
                </motion.p>
              </AnimatePresence>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <motion.div className={cn('h-full rounded-full', stuck ? 'bg-amber-400' : 'bg-sky-400')} initial={false} animate={{ width: `${(Math.max(0, Math.min(at, stages.length)) / stages.length) * 100}%` }} />
              </div>
            </div>
            {done && (
              <p className="text-xs text-white/70">
                {autoCount === stages.length ? 'Do fornecedor ao preço de venda sem ninguém digitar nada.' : 'Chegou ao fim, com a ajuda de alguém nos passos manuais.'}
              </p>
            )}
            {stuck ? (
              <div className="flex flex-col gap-2">
                <Button type="button" className="w-full" onClick={() => onGo(stages[at]!.fix ?? 'automacao')}>
                  Ligar a automação <ArrowRight aria-hidden />
                </Button>
                <Button type="button" variant="ghost" className="w-full text-white hover:bg-white/10 hover:text-white" onClick={() => setAt((i) => i + 1)}>
                  Fazer à mão e seguir
                </Button>
              </div>
            ) : (
              <Button type="button" className="w-full" disabled={running} onClick={() => setAt(0)}>
                {done ? <RotateCcw aria-hidden /> : <Play aria-hidden />} {running ? 'Simulando…' : done ? 'Simular de novo' : 'Simular uma nota chegando'}
              </Button>
            )}
          </Surface>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <NextLink href="/notas" title="Ver as notas de compra" detail="As que chegaram e o que espera por você." />
        <NextLink href="/configuracoes/precificacao" title="Ajustar a regra de preço" detail="Margem, arredondamento e exceções." />
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' }) {
  return (
    <div className="surface rounded-2xl border bg-card p-3.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className={cn('size-1.5 rounded-full', tone === 'ok' ? 'bg-emerald-500' : 'bg-amber-500')} />
        {label}
      </dt>
      <dd className="font-display tabular mt-1 truncate text-lg font-semibold">{value}</dd>
    </div>
  );
}

function NextLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link href={href} className="group surface flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-brand/40">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
    </Link>
  );
}
