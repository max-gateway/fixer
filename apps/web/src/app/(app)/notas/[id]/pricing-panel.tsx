'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageCheck, RotateCcw, TriangleAlert, WandSparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Hint } from '@/components/hint';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ClientApiError, getJson, postJson, putJson } from '@/lib/client-api';
import { money } from '@/lib/invoices';
import { ACKABLE, delta, FLAG_INFO, marginOf, moneyCost, parsePrice, pct1, rowExpenses, type PricingPlanView, type PricingRowView } from '@/lib/pricing';
import { MarginBar } from './margin-bar';
import { PriceDetails } from './price-details';
import { MarkupPopover } from './price-slider';
import { TaxBanner, TaxChip } from './tax-banner';

const key = (id: string) => ['pricing', id] as const;

/** Célula que no celular vira "rótulo: valor" (o rótulo vem de `data-label`) e no desktop é uma coluna comum. */
const CELL = 'flex items-baseline justify-between gap-3 px-4 py-1 before:text-xs before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:py-3 md:before:content-none';

type Filter = 'all' | 'attention' | 'notax';

/** Linha que merece olhar: alerta de preço, imposto indisponível ou aviso fiscal. */
const needsAttention = (r: PricingRowView) => r.flags.some((f) => FLAG_INFO[f].tone !== 'info') || r.taxNotes.length > 0 || r.saleTax.pct === null;

/**
 * Passo "Precificar" da nota (docs/specs/pricing.md §7): custo real, imposto sobre a venda, preço sugerido e margem de cada
 * item, com edição do preço digitando ou deslizando o markup. A linha mostra só o essencial e o que pede atenção; a conta
 * inteira, o imposto parte a parte e o histórico ficam na gaveta "Detalhes". O lançamento grava tudo numa transação só.
 */
export function PricingPanel({ invoiceId, ready }: { invoiceId: string; ready: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const plan = useQuery({
    queryKey: key(invoiceId),
    queryFn: () => getJson<PricingPlanView>(`/api/invoices/${invoiceId}/pricing`, 'Não foi possível calcular os preços.'),
    retry: false,
  });

  const bulk = useMutation({
    mutationFn: (action: 'ACCEPT_SUGGESTIONS' | 'CLEAR_DRAFTS') =>
      postJson<PricingPlanView>(`/api/invoices/${invoiceId}/pricing/bulk`, { action }, 'Não foi possível aplicar a todos os itens.'),
    onSuccess: (next) => {
      qc.setQueryData(key(invoiceId), next);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const launch = useMutation({
    mutationFn: () => postJson(`/api/invoices/${invoiceId}/confirm-with-pricing`, {}, 'Não foi possível lançar a entrada com os preços.'),
    onSuccess: () => {
      setConfirming(false);
      router.refresh();
    },
    onError: (e) => {
      setConfirming(false);
      setError(e.message);
      void qc.invalidateQueries({ queryKey: key(invoiceId) });
    },
  });

  // Sem permissão de precificação (403) ou sem itens vinculados: o passo simplesmente não aparece.
  if (plan.isError) {
    return plan.error instanceof ClientApiError && /permiss|forbidden/i.test(plan.error.message) ? null : (
      <p role="alert" className="text-sm text-muted-foreground">
        {plan.error.message}
      </p>
    );
  }
  if (plan.isPending) return <PanelSkeleton />;
  const p = plan.data;
  if (p.rows.length === 0) return null;

  const changing = p.rows.filter((r) => r.proposed !== null && r.proposed !== r.currentPrice);
  const blocked = p.rows.filter((r) => r.proposed !== null && r.blocking.length > 0);
  const margins = changing.map((r) => Number(r.marginPct)).filter(Number.isFinite);
  const avgMargin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null;
  // Totais da entrada: o que as peças custaram e quanto valem ao preço novo, por unidades que entram no estoque.
  const stockQty = (r: PricingRowView) => Number(r.stockQty);
  const costTotal = changing.reduce((acc, r) => acc + (r.cost ? Number(r.cost) * stockQty(r) : 0), 0);
  const saleTotal = changing.reduce((acc, r) => acc + Number(r.proposed) * stockQty(r), 0);

  const attention = p.rows.filter(needsAttention);
  const noTax = p.rows.filter((r) => r.saleTax.pct === null);
  const showFilter = p.rows.length >= 5 && attention.length > 0;
  const visible = filter === 'attention' ? attention : filter === 'notax' ? noTax : p.rows;

  return (
    <section aria-labelledby="pricing-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
            2
          </span>
          <div>
            <h2 id="pricing-title" className="text-lg font-semibold leading-tight">
              Precificar
            </h2>
            <p className="text-sm text-muted-foreground">Custo real + imposto + sua regra. Nada muda até você lançar.</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={bulk.isPending || !p.rows.some((r) => r.suggested && !r.draft && !r.locked)} onClick={() => bulk.mutate('ACCEPT_SUGGESTIONS')}>
            {bulk.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <WandSparkles aria-hidden />} Aceitar todas as sugestões
          </Button>
          {p.rows.some((r) => r.draft) && (
            <Button type="button" size="sm" variant="ghost" disabled={bulk.isPending} onClick={() => bulk.mutate('CLEAR_DRAFTS')}>
              <RotateCcw aria-hidden /> Desfazer meus preços
            </Button>
          )}
        </div>
      </div>

      {!p.hasRule && (
        <Alert variant="info">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            <p>
              Defina a regra de preço (margem, arredondamento) para receber sugestões.{' '}
              <Link href="/configuracoes/precificacao" className="font-medium underline underline-offset-2">
                Configurar precificação
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <TaxBanner readiness={p.taxReadiness} unavailable={p.rows.filter((r) => r.flags.includes('TAX_UNAVAILABLE')).length} />
      <CostProfileNote status={p.costProfile} />

      {showFilter && (
        <ToggleGroup type="single" value={filter} onValueChange={(v) => setFilter((v || 'all') as Filter)} aria-label="Filtrar itens" size="sm">
          <ToggleGroupItem value="all">Todos ({p.rows.length})</ToggleGroupItem>
          <ToggleGroupItem value="attention">Com alerta ({attention.length})</ToggleGroupItem>
          {noTax.length > 0 && <ToggleGroupItem value="notax">Sem imposto ({noTax.length})</ToggleGroupItem>}
        </ToggleGroup>
      )}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table className="block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow className="bg-muted/50">
              <TableHead className="w-auto">Peça</TableHead>
              <TableHead className="w-28 text-right">Custo real</TableHead>
              <TableHead className="w-24 text-right">Imposto</TableHead>
              <TableHead className="w-52">Novo preço</TableHead>
              <TableHead className="w-24 text-right">Margem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block divide-y md:table-row-group">
            {visible.map((r) => (
              <PriceRow key={r.itemNumber} invoiceId={invoiceId} plan={p} row={r} index={p.rows.indexOf(r)} />
            ))}
            {visible.length === 0 && (
              <TableRow className="block md:table-row">
                <TableCell colSpan={5} className="block px-4 py-6 text-center text-sm text-muted-foreground md:table-cell">
                  Nenhum item neste filtro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        <Kbd>Enter</Kbd> grava e vai para o próximo preço · <Kbd>Esc</Kbd> desfaz a digitação
      </p>

      <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:px-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1" aria-live="polite">
          <p className="text-sm">
            <strong>{changing.length}</strong> {changing.length === 1 ? 'preço muda' : 'preços mudam'}
            {blocked.length > 0 ? (
              <span className="font-medium text-destructive"> · {blocked.length} precisa{blocked.length === 1 ? '' : 'm'} de atenção</span>
            ) : (
              <span className="text-emerald-800"> · sem pendências</span>
            )}
          </p>
          {changing.length > 0 && (
            <dl className="tabular flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              <div className="flex gap-1">
                <dt>Custo</dt>
                <dd className="font-medium text-foreground">{money(costTotal)}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Venda</dt>
                <dd className="font-medium text-foreground">{money(saleTotal)}</dd>
              </div>
              {avgMargin !== null && (
                <div className="flex gap-1">
                  <dt>Margem média</dt>
                  <dd className="font-medium text-foreground">{pct1(avgMargin)}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
        <Button type="button" className="w-full sm:w-auto" disabled={!ready || blocked.length > 0 || changing.length === 0 || launch.isPending} onClick={() => setConfirming(true)}>
          <PackageCheck aria-hidden /> Lançar entrada e atualizar preços
        </Button>
      </div>
      {!ready && <p className="text-xs text-muted-foreground">Vincule todos os itens a uma peça para poder lançar a entrada.</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lançar a entrada e atualizar os preços?</AlertDialogTitle>
            <AlertDialogDescription>A entrada no estoque, o custo e os preços abaixo são gravados juntos. Se algo falhar, nada é gravado.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {changing.map((r) => {
              const d = delta(r.currentPrice, r.proposed);
              return (
                <li key={r.itemNumber} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="tabular shrink-0">
                    {r.currentPrice ? money(r.currentPrice) : '—'} → <strong>{money(r.proposed!)}</strong>
                    {d !== null && <span className="text-muted-foreground"> ({d > 0 ? '+' : ''}{pct1(d)})</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={launch.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={launch.isPending}
              onClick={(e) => {
                e.preventDefault(); // mantém aberto até a resposta; fecha em onSuccess/onError
                launch.mutate();
              }}
            >
              {launch.isPending && <Loader2 aria-hidden className="animate-spin" />} Lançar e atualizar preços
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Esqueleto com o mesmo desenho do painel: a tela não pula quando os preços chegam. */
function PanelSkeleton() {
  return (
    <section aria-busy="true" aria-label="Calculando os preços" className="space-y-3">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-[1.6fr_1fr_1fr] items-center gap-4 px-4 py-4 md:grid-cols-[1.6fr_6rem_5rem_9.5rem_6rem]">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="hidden h-5 w-full md:block" />
            <Skeleton className="hidden h-9 w-full md:block" />
            <Skeleton className="hidden h-5 w-full md:block" />
          </div>
        ))}
      </div>
    </section>
  );
}

function PriceRow({ invoiceId, plan, row: r, index }: { invoiceId: string; plan: PricingPlanView; row: PricingRowView; index: number }) {
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null); // o que a pessoa está digitando; null = mostrar o valor do servidor
  const [error, setError] = useState<string | null>(null);
  const id = `price-${r.itemNumber}`;

  const save = useMutation({
    mutationFn: (body: { sellPrice: number | null; ack?: boolean }) =>
      putJson<PricingPlanView>(`/api/invoices/${invoiceId}/items/${r.itemNumber}/pricing`, body, 'Não foi possível salvar o preço.'),
    onSuccess: (next) => {
      qc.setQueryData(key(invoiceId), next);
      setText(null);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const taxPct = r.saleTax.pct === null ? 0 : Number(r.saleTax.pct);
  const ex = rowExpenses(r, plan.rule);
  const overhead = ex.variable + ex.fixed;
  const typed = text === null ? null : parsePrice(text);
  const shownMargin = typed !== null && r.cost ? marginOf(ex.priceCost, typed, taxPct, overhead) : r.marginPct !== null ? Number(r.marginPct) : null;
  const costDelta = delta(r.previousCost, r.cost);
  const needsAck = r.flags.some((f) => ACKABLE.includes(f) && (f !== 'TAX_UNCONFIRMED' || plan.requireTaxConfirmation));
  const changed = r.proposed !== null && r.proposed !== r.currentPrice;
  const priceDelta = delta(r.currentPrice, r.proposed);
  // Na linha só o que pede atenção: alerta de preço, imposto indisponível, ou o motivo de não haver sugestão. O resto fica na gaveta.
  const attention = r.flags.filter((f) => FLAG_INFO[f].tone !== 'info' || r.proposed === null);
  const showTaxChip = r.saleTax.pct === null && !r.flags.includes('TAX_UNAVAILABLE');

  function commit() {
    if (text === null) return;
    if (text.trim() === '') return void save.mutate({ sellPrice: null });
    if (typed === null) return setError('Informe um preço maior que zero, como 43,90.');
    if (String(typed) === String(Number(r.proposed))) return setText(null);
    save.mutate({ sellPrice: typed });
  }

  return (
    <TableRow className="block md:table-row">
      <TableCell className="block px-4 py-3 md:table-cell">
        <p className="text-sm font-medium">{r.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>
            {r.sku} · entra {Number(r.stockQty).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} un
          </span>
          <PriceDetails
            plan={plan}
            row={r}
            trigger={
              <button type="button" className="inline-flex items-center gap-1 rounded underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
                Detalhes
                {r.taxNotes.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-amber-900">
                    <TriangleAlert aria-hidden className="size-3" />
                    <span className="sr-only">{r.taxNotes.length} {r.taxNotes.length === 1 ? 'aviso fiscal' : 'avisos fiscais'} para conferir</span>
                    <span aria-hidden>{r.taxNotes.length}</span>
                  </span>
                )}
              </button>
            }
          />
        </p>
        {(attention.length > 0 || showTaxChip) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {attention.map((f) => (
              <Hint key={f} content={FLAG_INFO[f].hint}>
                <Badge variant={FLAG_INFO[f].tone === 'danger' ? 'danger' : FLAG_INFO[f].tone === 'warning' ? 'warning' : 'secondary'}>{FLAG_INFO[f].label}</Badge>
              </Hint>
            ))}
            {showTaxChip && <TaxChip tax={r.saleTax} />}
          </div>
        )}
      </TableCell>

      <TableCell data-label="Custo real" className={`${CELL} md:text-right`}>
        <span>
          <span className="tabular font-medium">{r.cost ? moneyCost(r.cost) : '—'}</span>
          {costDelta !== null && Math.abs(costDelta) >= 0.05 && (
            <span className={`tabular ml-1.5 text-xs ${costDelta > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
              {costDelta > 0 ? '▲' : '▼'} {pct1(Math.abs(costDelta))} <span className="sr-only">contra a compra anterior</span>
            </span>
          )}
        </span>
      </TableCell>

      <TableCell data-label="Imposto" className={`${CELL} md:text-right`}>
        <span className="tabular text-sm">{r.saleTax.pct === null ? '—' : pct1(r.saleTax.pct)}</span>
      </TableCell>

      <TableCell data-label="Novo preço" className="block space-y-1 px-4 py-2 md:table-cell md:py-3">
        <label htmlFor={id} className="text-xs text-muted-foreground md:sr-only">
          Novo preço de venda
        </label>
        <div className="flex items-center gap-1">
          <InputGroup className="w-32" aria-invalid={error ? true : undefined}>
            <InputGroupAddon align="start">R$</InputGroupAddon>
            <InputGroupInput
              id={id}
              data-price-row={index}
              inputMode="decimal"
              disabled={r.locked || save.isPending}
              value={text ?? (r.proposed !== null ? String(Number(r.proposed)).replace('.', ',') : '')}
              placeholder={r.locked ? 'travado' : 'sem sugestão'}
              aria-describedby={`${id}-info`}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setText(null);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                  document.querySelector<HTMLInputElement>(`[data-price-row="${index + 1}"]`)?.focus();
                }
              }}
            />
          </InputGroup>
          <MarkupPopover row={r} plan={plan} busy={save.isPending} onApply={(price) => save.mutate({ sellPrice: price })} />
          {r.draft !== null && (
            <Button type="button" size="icon" variant="ghost" className="size-8" disabled={save.isPending} onClick={() => save.mutate({ sellPrice: null })} aria-label="Voltar ao preço sugerido" title="Voltar a aceitar o preço sugerido">
              <RotateCcw aria-hidden />
            </Button>
          )}
          {save.isPending && <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <p id={`${id}-info`} className="tabular text-xs text-muted-foreground">
          atual {r.currentPrice ? money(r.currentPrice) : '—'}
          {r.draft !== null ? ' · seu preço' : changed && r.suggested !== null ? ' · sugerido' : ''}
          {priceDelta !== null && Math.abs(priceDelta) >= 0.05 && (
            <span className={`ml-1 font-medium ${priceDelta > 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
              {priceDelta > 0 ? '▲ +' : '▼ −'}
              {pct1(Math.abs(priceDelta))}
              <span className="sr-only"> contra o preço atual</span>
            </span>
          )}
        </p>
        {needsAck && r.proposed !== null && (
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox className="mt-0.5" checked={r.ack} disabled={save.isPending} onCheckedChange={(c) => save.mutate({ sellPrice: Number(r.proposed), ack: c === true })} />
            <span>Estou ciente dos alertas</span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </TableCell>

      <TableCell data-label="Margem" className={`${CELL} md:text-right`}>
        <span className="flex w-24 flex-col items-end gap-1 max-md:w-28">
          <span className="tabular text-sm font-medium">{shownMargin !== null ? pct1(shownMargin) : '—'}</span>
          {shownMargin !== null && <MarginBar margin={shownMargin} min={Number(plan.rule?.minMarginPct ?? 0)} target={plan.rule?.method === 'MARGIN' ? Number(plan.rule.value) : null} />}
        </span>
      </TableCell>
    </TableRow>
  );
}

/**
 * De onde vêm as despesas do preço (docs/specs/cost-engine.md §14, fase 2): com perfil publicado, uma linha discreta diz a
 * versão; motor fora do ar, avisa que valeu a despesa da regra. Motor desligado ou sem perfil: nada a dizer.
 */
export function CostProfileNote({ status }: { status: PricingPlanView['costProfile'] }) {
  if (!status || status.status !== 'OK') {
    if (status?.status !== 'UNAVAILABLE') return null;
    return (
      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertDescription>O perfil de custos não respondeu agora: os preços usam as despesas da regra. Tente atualizar em instantes.</AlertDescription>
      </Alert>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Despesas pelo perfil de custos v{status.version}: estrutura {pct1(status.fixedPct)} e despesas de venda {pct1(Number(status.variablePct) + Number(status.financialPct))} do preço
      {Number(status.extraUnitCost) > 0 && <>, mais {moneyCost(status.extraUnitCost)} por peça</>}.{' '}
      <Link href="/configuracoes/precificacao?aba=despesas" className="underline underline-offset-2">
        Ver despesas
      </Link>
    </p>
  );
}
