'use client';

import { Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DashboardOverview, DashboardRange } from '@/lib/dashboard';
import { cn } from '@/lib/utils';
import { Card, CardHeader } from './card';
import { ActivityFeed, AttentionList, Insights } from './feeds';
import { KpiCard } from './kpi-card';
import { Funnel, Heatmap, MechanicsLoad, StatusBars, TopServices } from './panels';
import { RevenueChart } from './revenue-chart';

const RANGES: { value: DashboardRange; label: string; key: string }[] = [
  { value: '7d', label: '7 dias', key: '1' },
  { value: '30d', label: '30 dias', key: '2' },
  { value: '90d', label: '90 dias', key: '3' },
];

export function DashboardView({ data }: { data: DashboardOverview }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const setRange = (range: DashboardRange) =>
    startTransition(() => router.replace(`${pathname}?range=${range}`, { scroll: false }));

  // Atalhos 1/2/3 trocam o período; ignorados enquanto o usuário digita ou usa modificadores.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const hit = RANGES.find((r) => r.key === e.key);
      if (hit && hit.value !== data.range) startTransition(() => router.replace(`${pathname}?range=${hit.value}`, { scroll: false }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data.range, pathname, router]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{data.headline.title}</h1>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">Dados de demonstração</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{data.headline.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href="/ordens/nova">
              <Plus /> Nova ordem
            </Link>
          </Button>
        </div>
      </header>

      {/* Filtro único acima de tudo: escopa todos os blocos abaixo. */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={data.range} onValueChange={(v) => setRange(v as DashboardRange)}>
          <TabsList aria-label="Período">
            {RANGES.map((r) => (
              <TabsTrigger key={r.value} value={r.value} className="gap-2 px-3">
                {r.label}
                <kbd className="hidden rounded border bg-card px-1 font-sans text-[10px] text-muted-foreground sm:inline">{r.key}</kbd>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-sm text-muted-foreground">{data.periodLabel}</p>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Atualizar dados" onClick={() => startTransition(() => router.refresh())}>
          <RefreshCw className={cn(pending && 'animate-spin')} />
        </Button>
      </div>

      {/* Reload mantém o quadro: o conteúdo antigo fica esmaecido em vez de piscar um skeleton. */}
      <div aria-busy={pending} className={cn('space-y-6 transition-opacity duration-200', pending && 'pointer-events-none opacity-60')}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.kpis.map((k, i) => (
            <KpiCard key={k.id} kpi={k} index={i} />
          ))}
        </div>

        <Card index={4}>
          <CardHeader title="Desempenho diário" description="Passe o mouse ou use as setas ← → para ver cada dia." />
          <RevenueChart key={data.range} chart={data.chart} previousLabel={data.previousLabel} />
        </Card>

        <Insights items={data.insights} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card index={5}>
            <CardHeader title="Ordens por status" description="Distribuição das ordens abertas no período" />
            <StatusBars rows={data.status} />
          </Card>
          <Card index={6}>
            <CardHeader title="Funil de ordens" description="Do orçamento à entrega" />
            <Funnel stages={data.funnel} />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <Card index={7} className="lg:col-span-3">
            <CardHeader title="Ocupação do pátio" description="Veículos simultâneos, média por dia da semana e hora" />
            <Heatmap data={data.heatmap} />
          </Card>
          <Card index={8} className="lg:col-span-2">
            <CardHeader title="Serviços que mais faturam" />
            <TopServices rows={data.topServices} />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card index={9}>
            <CardHeader title="Carga da equipe" description="Ordens ativas por mecânico agora" />
            <MechanicsLoad rows={data.mechanics} />
          </Card>
          <Card index={10}>
            <CardHeader title="Pede atenção" />
            <AttentionList items={data.attention} />
          </Card>
          <Card index={11}>
            <CardHeader title="Atividade recente" />
            <ActivityFeed items={data.activity} />
          </Card>
        </div>
      </div>
    </div>
  );
}
