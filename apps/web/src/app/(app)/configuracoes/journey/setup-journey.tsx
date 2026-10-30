'use client';

import { ArrowLeft, ArrowRight, Building2, Check, Landmark, Lock, Rocket, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AutofillProvenance } from '@/lib/fiscal-autofill';
import type { FiscalStatus } from '@/lib/fiscal-import';
import { cn } from '@/lib/utils';
import type { TaxSummary } from '../fiscal-overview';
import type { FiscalSettings } from '../fiscal-settings-form';
import { AutomationStep } from './automation-step';
import { Autopilot } from './autopilot';
import { CertificateStep } from './certificate-step';
import { CompanyStep } from './company-step';
import { firstOpen, journeySteps, progress, type JourneyStep, type StepId } from './model';
import { TaxStep } from './tax-step';
import { Slash, StepHeader } from './ui';

const ICON: Record<StepId, LucideIcon> = { certificado: ShieldCheck, empresa: Building2, impostos: Landmark, automacao: Zap, pronto: Rocket };

const DESCRIPTION: Record<StepId, string> = {
  certificado: 'É a única coisa que você precisa enviar. Com ele, o Fixer busca a empresa, os impostos e as notas de compra sozinho.',
  empresa: 'Veio do certificado e da consulta de CNPJ na Receita. Só confira.',
  impostos: 'Regime, ISS e receita vêm da Receita e da prefeitura, e entram no preço sugerido de cada peça.',
  automacao: 'O que a nota de compra faz sozinha quando chega. Cada automação pode ser desligada quando quiser.',
  pronto: 'Assim uma nota de compra passa pelo Fixer agora. Simule para ver onde ela anda sozinha e onde ainda espera alguém.',
};

const IDS = Object.keys(ICON) as StepId[];

type Props = { status: FiscalStatus; fiscal: FiscalSettings | null; provenance: AutofillProvenance; tax: TaxSummary | null };

/**
 * Configuração da oficina como uma jornada: cada etapa diz o que o Fixer fez sozinho e o que (pouco) falta. Ao concluir uma
 * etapa, a próxima abre; no fim, o cenário mostra o caminho de uma nota de compra com tudo o que já roda no automático.
 */
export function SetupJourney({ status, fiscal, provenance, tax }: Props) {
  const steps = journeySteps({ status, fiscal, provenance, tax });
  const [active, setActive] = useState<StepId>(() => firstOpen(steps));
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const prev = useRef(steps);

  // Link direto para uma etapa (#certificado, vindo do aviso de vencimento), também com a página já aberta.
  const lockedIds = steps.filter((s) => s.state === 'locked').map((s) => s.id).join();
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1) as StepId;
      if (!IDS.includes(id) || lockedIds.split(',').includes(id)) return;
      setActive(id);
      // Consumido: sem isso, o avanço automático depois de enviar o certificado voltaria para a etapa do link.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [lockedIds]);

  // Quando a etapa aberta fica pronta (ou some, ao remover o certificado), vai para a próxima que pede ação.
  const signature = steps.map((s) => s.state).join();
  useEffect(() => {
    const before = prev.current.find((s) => s.id === active)?.state;
    const now = steps.find((s) => s.id === active)?.state;
    prev.current = steps;
    if (now === 'locked' || (before === 'todo' && (now === 'done' || now === 'partial'))) setActive(firstOpen(steps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  function go(id: StepId) {
    if (steps.find((s) => s.id === id)?.state === 'locked') return;
    setActive(id);
    // No celular o painel fica abaixo do trilho: leva a pessoa até o começo dele.
    requestAnimationFrame(() => {
      const top = panelRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight * 0.6) panelRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  }

  const index = IDS.indexOf(active);
  const step = steps[index]!;
  const prevStep = steps.slice(0, index).reverse().find((s) => s.state !== 'locked');
  const nextStep = steps.slice(index + 1).find((s) => s.state !== 'locked');

  return (
    <div className="space-y-6">
      <Hero steps={steps} name={status.settings?.legalName ?? null} />

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8">
        <Stepper steps={steps} active={active} onSelect={go} />

        <div ref={panelRef} className="min-w-0 scroll-mt-20">
          <AnimatePresence mode="wait" initial={false}>
            <motion.section
              key={active}
              aria-labelledby={`step-${active}-title`}
              initial={reduce ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -16 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-5"
            >
              <StepHeader id={`step-${active}-title`} index={index + 1} total={IDS.length} title={step.title} description={DESCRIPTION[active]} />
              <StepBody id={active} status={status} fiscal={fiscal} provenance={provenance} tax={tax} onGo={go} />

              {(prevStep || (nextStep && active !== 'pronto')) && (
                <nav aria-label="Etapas" className="flex items-center justify-between gap-3 border-t pt-4">
                  {prevStep ? (
                    <Button type="button" variant="ghost" onClick={() => go(prevStep.id)}>
                      <ArrowLeft aria-hidden /> <span className="sr-only sm:not-sr-only">{prevStep.title}</span>
                    </Button>
                  ) : (
                    <span />
                  )}
                  {nextStep && (
                    <Button type="button" variant={step.state === 'todo' ? 'outline' : 'default'} onClick={() => go(nextStep.id)}>
                      {step.state === 'todo' ? 'Pular por agora' : nextStep.id === 'pronto' ? 'Ver o piloto automático' : `Próxima: ${nextStep.title}`} <ArrowRight aria-hidden />
                    </Button>
                  )}
                </nav>
              )}
            </motion.section>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function StepBody({ id, status, fiscal, provenance, tax, onGo }: Props & { id: StepId; onGo: (id: StepId) => void }) {
  const cred = status.credential;
  const company = status.settings;
  const receita = { available: Boolean(provenance.sources?.receita), enabled: Boolean(provenance.taxDataConsent?.enabled) };
  if (id === 'certificado') return <CertificateStep status={status} receita={receita} />;
  if (id === 'empresa' && company?.cnpj) return <CompanyStep company={company} fiscal={fiscal} provenance={provenance} hasCredential={Boolean(cred)} />;
  if (id === 'impostos' && company?.cnpj) return <TaxStep fiscal={fiscal} provenance={provenance} tax={tax} hasCredential={Boolean(cred)} />;
  if (id === 'automacao' && cred) return <AutomationStep credential={cred} />;
  if (id === 'pronto' && cred) return <Autopilot credential={cred} readiness={tax?.readiness ?? null} onGo={onGo} />;
  return null;
}

/** Abertura da página: quem é a oficina e quanto da configuração já roda sozinho. */
function Hero({ steps, name }: { steps: JourneyStep[]; name: string | null }) {
  const reduce = useReducedMotion();
  const p = progress(steps);
  const doneCount = steps.filter((s) => s.id !== 'pronto' && (s.state === 'done' || s.state === 'partial')).length;
  const total = steps.length - 1;
  const R = 26;
  const C = 2 * Math.PI * R;
  const complete = p === 1;

  return (
    <header className="relative overflow-hidden rounded-2xl bg-brand-secondary px-5 py-6 text-white sm:px-7 sm:py-7">
      <div aria-hidden className="pointer-events-none absolute -top-24 right-0 size-72 rounded-full bg-brand/35 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_left,black,transparent_70%)]" />
      <div className="relative flex items-center gap-5">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-sky-300 uppercase">
            <Slash className="w-5" /> Oficina
          </p>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight break-words sm:text-3xl">{name ?? 'Configure a sua oficina'}</h1>
          <p className="max-w-xl text-sm text-white/70">
            {complete ? 'Tudo configurado. As notas de compra chegam, entram no estoque e ganham preço sem digitação.' : 'Envie o certificado uma vez. O Fixer busca a empresa, os impostos e as notas de compra sozinho.'}
          </p>
        </div>
        <div className="relative grid size-20 shrink-0 place-items-center sm:size-24" role="img" aria-label={`${doneCount} de ${total} etapas concluídas`}>
          <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
            <circle cx="32" cy="32" r={R} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="6" />
            <motion.circle
              cx="32"
              cy="32"
              r={R}
              fill="none"
              stroke={complete ? '#34d399' : 'var(--brand-primary)'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={C}
              initial={reduce ? false : { strokeDashoffset: C }}
              animate={{ strokeDashoffset: C * (1 - p) }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <span className="font-display tabular text-lg font-semibold sm:text-xl">
            {doneCount}
            <span className="text-white/50">/{total}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

/** Trilho das etapas: vertical ao lado no desktop; no celular, uma faixa que rola na horizontal acima do conteúdo. */
function Stepper({ steps, active, onSelect }: { steps: JourneyStep[]; active: StepId; onSelect: (id: StepId) => void }) {
  return (
    <nav aria-label="Etapas da configuração" className="lg:sticky lg:top-24 lg:self-start">
      <ol className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:pb-0">
        {steps.map((s, i) => {
          const Icon = ICON[s.id];
          const current = s.id === active;
          const locked = s.state === 'locked';
          const ok = s.state === 'done';
          const partial = s.state === 'partial';
          return (
            <li key={s.id} className="relative shrink-0 snap-start lg:shrink">
              {i < steps.length - 1 && (
                <span aria-hidden className={cn('absolute top-12 bottom-0 left-[1.6rem] hidden w-0.5 rounded-full lg:block', ok || partial ? 'bg-brand/40' : 'bg-slate-200')} />
              )}
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                disabled={locked}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed lg:border-transparent lg:py-3',
                  current ? 'border-brand/40 bg-card shadow-sm lg:border-brand/30' : 'border-border bg-card/60 hover:bg-card lg:bg-transparent',
                  locked && 'opacity-60',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 grid size-8 shrink-0 place-items-center rounded-lg transition-colors lg:size-9',
                    ok ? 'bg-brand text-white' : partial ? 'bg-amber-100 text-amber-800' : current ? 'bg-brand-soft text-brand ring-2 ring-brand' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {locked ? <Lock className="size-4" /> : ok ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-semibold whitespace-nowrap', current ? 'text-foreground' : 'text-slate-700')}>{s.title}</span>
                  <span className={cn('hidden truncate text-xs lg:block', partial ? 'text-amber-800' : 'text-muted-foreground')}>{s.summary}</span>
                  <span className="sr-only">
                    {' '}
                    ({locked ? 'bloqueada' : ok ? 'concluída' : partial ? 'concluída, com pontos a conferir' : 'pendente'})
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
