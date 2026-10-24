'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, Car, ChevronDown, ChevronLeft, ChevronRight, Copy, History, Loader2, PackagePlus, Repeat2, ScanBarcode, Search, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { PartImage } from '@/components/catalog/part-image';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toaster';
import { postJson } from '@/lib/client-api';
import { formatCents, formatLocation, formatMoney, groupApplications, groupCrossPairs, yearRange, type Application, type PartDetail, type PartHit } from '@/lib/part-search';
import { cn } from '@/lib/utils';
import { useCopy } from './part-card';
import { usePartDetail, usePartHistory, useLocalPart, type LocalPart, type PartHistory } from './use-parts';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—');
const num = (v: string | number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function Chip({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  const cls = 'tabular inline-flex items-center rounded-md border bg-background px-2 py-1 text-xs';
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={cn(cls, 'transition-colors hover:border-ring/50 hover:bg-accent hover:text-brand')}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>;

// --- Resumo ----------------------------------------------------------------------------------------------------------

function Overview({ part, hit, onSearch }: { part: PartDetail; hit?: PartHit; onSearch: (code: string) => void }) {
  const copy = useCopy();
  const offer = hit?.offer;
  return (
    <div className="space-y-6">
      {offer && (
        <div className="surface flex items-end justify-between gap-4 rounded-2xl border bg-card p-4">
          <div>
            <p className="text-xs text-muted-foreground">Oferta da loja</p>
            <p className="tabular text-2xl font-semibold tracking-tight">{offer.priceCents != null ? formatCents(offer.priceCents) : 'Sem preço'}</p>
          </div>
          <div className="text-right text-sm">
            <p className={cn('font-medium', offer.quantityAvailable > 0 ? 'text-emerald-700' : 'text-red-700')}>{offer.quantityAvailable > 0 ? `${offer.quantityAvailable} em estoque` : 'Sem saldo'}</p>
            {formatLocation(offer.location) && <p className="text-xs text-muted-foreground">{formatLocation(offer.location)}</p>}
          </div>
        </div>
      )}

      <Section title="Identificação">
        <dl className="divide-y rounded-xl border text-sm">
          <Row label="Código">
            <span className="tabular">{part.partNumber}</span>
            <button type="button" onClick={() => copy(part.partNumber, 'Código')} aria-label="Copiar código" className="ml-2 text-muted-foreground hover:text-foreground">
              <Copy aria-hidden className="size-3.5" />
            </button>
          </Row>
          <Row label="SKU do catálogo">
            <span className="tabular text-xs">{part.sku}</span>
            <button type="button" onClick={() => copy(part.sku, 'SKU')} aria-label="Copiar SKU" className="ml-2 text-muted-foreground hover:text-foreground">
              <Copy aria-hidden className="size-3.5" />
            </button>
          </Row>
          {part.brand && <Row label="Marca">{part.brand.name}</Row>}
          {part.category && (
            <Row label="Categoria">
              <span className="flex flex-wrap items-center gap-x-1 text-right">
                {(part.category.path.length ? part.category.path : [part.category]).map((c, i, a) => (
                  <span key={c.id} className={i === a.length - 1 ? 'font-medium' : 'text-muted-foreground'}>
                    {c.name}
                    {i < a.length - 1 && ' ›'}
                  </span>
                ))}
              </span>
            </Row>
          )}
        </dl>
      </Section>

      {part.barcodes.length > 0 && (
        <Section title="Código de barras (GTIN)">
          <div className="flex flex-wrap gap-1.5">
            {part.barcodes.map((b) => (
              <Chip key={b} onClick={() => onSearch(b)} title="Buscar por este código de barras">
                <ScanBarcode aria-hidden className="mr-1.5 size-3.5" />
                {b}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {part.oemCodes.length > 0 && (
        <Section title="Códigos OEM (original de fábrica)">
          <div className="flex flex-wrap gap-1.5">
            {part.oemCodes.map((c) => (
              <Chip key={c} onClick={() => onSearch(c)} title="Buscar por este código">
                {c}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {part.catalogAttributes.length > 0 && (
        <Section title="Especificações">
          <dl className="divide-y rounded-xl border text-sm">
            {part.catalogAttributes.map((a, i) => (
              <Row key={`${a.name}-${i}`} label={a.name}>
                {a.value}
              </Row>
            ))}
          </dl>
        </Section>
      )}

      {part.titleSynonyms.length > 0 && (
        <Section title="Também conhecida como">
          <div className="flex flex-wrap gap-1.5">
            {part.titleSynonyms.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-4 px-3 py-2">
    <dt className="shrink-0 text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 items-center justify-end text-right">{children}</dd>
  </div>
);

// --- Compatibilidade -------------------------------------------------------------------------------------------------

function Fitment({ part, onVehicle }: { part: PartDetail; onVehicle: (a: Application) => void }) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => groupApplications(part.applications, filter), [part.applications, filter]);
  const shown = groups.reduce((n, g) => n + g.count, 0);

  if (part.isUniversalFit && part.applications.length === 0) return <Empty>Peça universal: serve em qualquer veículo compatível com a medida e a especificação.</Empty>;
  if (part.applications.length === 0) return <Empty>O catálogo ainda não tem aplicações cadastradas para esta peça.</Empty>;
  return (
    <div className="space-y-4">
      {part.isUniversalFit && <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand">Peça universal, além das aplicações abaixo.</p>}
      <label className="relative block">
        <span className="sr-only">Filtrar veículos</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por marca, modelo, motor ou ano (ex.: strada 2016)"
          className="h-10 w-full rounded-xl border bg-background pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
        />
      </label>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {filter ? `${shown} de ${part.applications.length}` : part.applications.length.toLocaleString('pt-BR')} {part.applications.length === 1 ? 'aplicação' : 'aplicações'}
      </p>
      {groups.length === 0 && <Empty>Nenhum veículo com “{filter}”.</Empty>}
      <div className="space-y-2">
        {groups.map((g) => (
          <details key={g.make} open={groups.length === 1 || Boolean(filter)} className="group rounded-xl border bg-card open:shadow-xs">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <Car aria-hidden className="size-4 text-muted-foreground" /> {g.make}
              </span>
              <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                {g.count}
                <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="space-y-3 border-t px-3 py-3">
              {g.models.map((m) => (
                <div key={m.model}>
                  <p className="mb-1 flex items-baseline justify-between text-sm font-medium">
                    {m.model}
                    <span className="tabular text-xs font-normal text-muted-foreground">{yearRange(m.yearFrom, m.yearTo)}</span>
                  </p>
                  <ul className="space-y-1">
                    {m.items.map((a) => (
                      <li key={a.vehicleId} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate">{a.engine ?? a.vehicleName}</span>
                          <span className="tabular text-muted-foreground">
                            {yearRange(a.yearFrom, a.yearTo)}
                            {a.position && ` · ${a.position}`}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onVehicle(a)}
                          className="shrink-0 rounded-md border bg-background px-2 py-1 font-medium text-brand hover:border-ring/50 hover:bg-accent"
                        >
                          Outras peças deste veículo
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

// --- Equivalentes ----------------------------------------------------------------------------------------------------

function Cross({ part, onSearch }: { part: PartDetail; onSearch: (code: string) => void }) {
  const copy = useCopy();
  const groups = useMemo(() => groupCrossPairs(part.crossPairs, { partNumber: part.partNumber, brand: part.brand?.name }), [part]);
  const total = groups.reduce((n, g) => n + g.codes.length, 0);
  if (groups.length === 0) return <Empty>Sem equivalentes cadastrados para esta peça.</Empty>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'código equivalente' : 'códigos equivalentes'} em {groups.length} {groups.length === 1 ? 'marca' : 'marcas'}. Clique para buscar a peça.
        </p>
        <Button variant="ghost" size="xs" onClick={() => copy(groups.map((g) => `${g.brand}: ${g.codes.join(', ')}`).join('\n'), 'Equivalentes')}>
          <Copy aria-hidden /> Copiar tudo
        </Button>
      </div>
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={g.brand} className="rounded-xl border p-3">
            <p className="mb-2 text-sm font-medium">
              {g.brand} <span className="text-xs font-normal text-muted-foreground">· {g.codes.length}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.codes.map((c) => (
                <Chip key={c} onClick={() => onSearch(c)} title={`Buscar ${c}`}>
                  {c}
                </Chip>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Histórico -------------------------------------------------------------------------------------------------------

const SOURCE: Record<PartHistory['prices'][number]['source'], string> = { INVOICE: 'Nota de compra', MANUAL: 'Manual', AUTO: 'Regra automática', REVERSAL: 'Estorno' };

/** Evolução do preço de venda e do custo, do mais antigo ao mais novo. SVG simples: não precisa de biblioteca para duas linhas. */
function PriceChart({ prices }: { prices: PartHistory['prices'] }) {
  const pts = [...prices].reverse();
  if (pts.length < 2) return null;
  const W = 480;
  const H = 120;
  const pad = 6;
  const vals = pts.flatMap((p) => [Number(p.sellAfter), Number(p.costAfter)]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - pad * 2);
  const line = (pick: (p: (typeof pts)[number]) => number) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(' ');
  return (
    <figure className="rounded-xl border p-3">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Preço de venda de ${formatMoney(pts[0]!.sellAfter)} a ${formatMoney(pts.at(-1)!.sellAfter)} em ${pts.length} alterações`} className="h-28 w-full">
        <path d={line((p) => Number(p.costAfter))} fill="none" stroke="var(--color-slate-400)" strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={line((p) => Number(p.sellAfter))} fill="none" stroke="var(--brand-primary)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(Number(p.sellAfter))} r="3" fill="var(--brand-primary)" />
        ))}
      </svg>
      <figcaption className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded bg-brand" /> Venda
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 border-t-2 border-dashed border-slate-400" /> Custo
        </span>
        <span className="tabular ml-auto">
          {fmtDate(pts[0]!.createdAt)} → {fmtDate(pts.at(-1)!.createdAt)}
        </span>
      </figcaption>
    </figure>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular text-lg font-semibold tracking-tight">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ShopForm({ part }: { part: PartDetail }) {
  const [cost, setCost] = useState('');
  const [sell, setSell] = useState('');
  const { toast } = useToast();
  const client = useQueryClient();
  const toNum = (s: string) => Number(s.replace(',', '.'));
  const valid = cost.trim() !== '' && sell.trim() !== '' && toNum(cost) >= 0 && toNum(sell) >= 0 && !Number.isNaN(toNum(cost)) && !Number.isNaN(toNum(sell));
  const create = useMutation({
    mutationFn: () => postJson('/api/parts/from-catalog', { catalogSku: part.sku, costPrice: toNum(cost), sellPrice: toNum(sell) }, 'Não foi possível cadastrar a peça.'),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['local-part', part.sku] });
      toast({ title: 'Peça cadastrada na oficina', description: part.name, tone: 'success' });
    },
    onError: (e) => toast({ title: e.message, tone: 'error' }),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) create.mutate();
      }}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <p className="text-sm font-medium">Cadastrar na oficina</p>
      <p className="text-xs text-muted-foreground">Nome e código de barras vêm do catálogo. Informe o custo e o preço de venda para começar a controlar estoque e histórico.</p>
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Custo (R$)', cost, setCost],
          ['Venda (R$)', sell, setSell],
        ].map(([label, val, set]) => (
          <label key={label as string} className="space-y-1 text-xs font-medium">
            {label as string}
            <input
              inputMode="decimal"
              value={val as string}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              placeholder="0,00"
              className="tabular h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
            />
          </label>
        ))}
      </div>
      <Button type="submit" disabled={!valid || create.isPending} className="w-full">
        {create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <PackagePlus aria-hidden />} Cadastrar peça
      </Button>
    </form>
  );
}

function HistoryView({ local }: { local: LocalPart }) {
  const { data, isLoading, isError, refetch } = usePartHistory(local.id);
  if (isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
  if (isError || !data)
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-2">
          <p>Não foi possível carregar o histórico.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );

  const avgSale = data.sales.length ? data.sales.reduce((s, l) => s + Number(l.unitPrice) * Number(l.quantity), 0) / data.sales.reduce((s, l) => s + Number(l.quantity), 0) : null;
  const last = data.purchases[0];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Em estoque" value={num(data.part.stockQty)} hint={`Venda ${formatMoney(data.part.sellPrice)}`} />
        <Stat label="Custo" value={formatMoney(data.part.costPrice)} hint={data.part.avgCost ? `Médio ${formatMoney(data.part.avgCost)}` : undefined} />
        <Stat label="Comprado" value={num(data.totals.boughtQty)} hint={`${data.totals.purchases} ${data.totals.purchases === 1 ? 'entrada' : 'entradas'}${last ? ` · última ${fmtDate(last.createdAt)}` : ''}`} />
        <Stat label="Vendido" value={num(data.totals.soldQty)} hint={`${data.totals.sales} ${data.totals.sales === 1 ? 'venda' : 'vendas'}${avgSale ? ` · média ${formatMoney(avgSale)}` : ''}`} />
      </div>

      <Section title="Preço ao longo do tempo">
        <PriceChart prices={data.prices} />
        {data.prices.length === 0 ? (
          <Empty>Nenhuma alteração de preço registrada.</Empty>
        ) : (
          <ul className="divide-y rounded-xl border text-sm">
            {data.prices.slice(0, 8).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="tabular block">
                    {p.sellBefore ? `${formatMoney(p.sellBefore)} → ` : ''}
                    <strong>{formatMoney(p.sellAfter)}</strong>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {SOURCE[p.source]} · custo {formatMoney(p.costAfter)}
                    {p.marginAfter && ` · margem ${num(p.marginAfter)}%`}
                  </span>
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">{fmtDate(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Histórico de compras">
        {data.purchases.length === 0 ? (
          <Empty>Nenhuma entrada de estoque registrada.</Empty>
        ) : (
          <ul className="divide-y rounded-xl border text-sm">
            {data.purchases.map((m) => {
              const inv = m.purchaseInvoiceItem?.invoice;
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{inv ? inv.issuerName : (m.note ?? 'Entrada manual')}</span>
                    <span className="text-xs text-muted-foreground">
                      {inv ? `NF ${inv.number ?? 's/n'}` : 'Sem nota'} · {num(m.quantity)} un{m.unitCost ? ` × ${formatMoney(m.unitCost)}` : ''}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">{fmtDate(m.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Histórico de vendas">
        {data.sales.length === 0 ? (
          <Empty>Esta peça ainda não foi usada em nenhuma ordem de serviço.</Empty>
        ) : (
          <ul className="divide-y rounded-xl border text-sm">
            {data.sales.map((l) => {
              const so = l.serviceOrder;
              const profit = l.unitCost ? (Number(l.unitPrice) - Number(l.unitCost)) * Number(l.quantity) : null;
              return (
                <li key={l.id}>
                  <a href={`/ordens/${so.id}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-accent/60">
                    <span className="min-w-0">
                      <span className="block truncate">
                        OS {so.number} · {so.customer.name}
                      </span>
                      <span className="tabular text-xs text-muted-foreground">
                        {so.vehicle.plate} · {so.vehicle.brand} {so.vehicle.model} · {num(l.quantity)} un × {formatMoney(l.unitPrice)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-xs text-muted-foreground">{fmtDate(l.createdAt)}</span>
                      {profit !== null && <span className={cn('tabular text-xs font-medium', profit >= 0 ? 'text-emerald-700' : 'text-red-700')}>{profit >= 0 ? '+' : ''}{formatMoney(profit)}</span>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {(data.totals.purchases > data.purchases.length || data.totals.sales > data.sales.length) && (
        <p className="text-center text-xs text-muted-foreground">Mostrando os 50 registros mais recentes de cada lista; os totais acima são do período inteiro.</p>
      )}
    </div>
  );
}

function ShopTab({ part }: { part: PartDetail }) {
  const local = useLocalPart(part.sku);
  if (local.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (local.isError) return <Empty>Não foi possível consultar o estoque da oficina.</Empty>;
  if (local.data) return <HistoryView local={local.data} />;
  return (
    <div className="space-y-4">
      <Empty>Esta peça ainda não está no estoque da oficina, então não há histórico de compra nem de venda.</Empty>
      <ShopForm part={part} />
    </div>
  );
}

// --- Gaveta ----------------------------------------------------------------------------------------------------------

export function PartSheet({
  sku,
  hit,
  onClose,
  onSearchCode,
  onVehicle,
  onPrev,
  onNext,
}: {
  sku: string | undefined;
  hit: PartHit | undefined;
  onClose: () => void;
  onSearchCode: (code: string) => void;
  onVehicle: (a: Application) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const detail = usePartDetail(sku);
  const part = detail.data;
  const title = part?.name ?? hit?.name ?? 'Peça';
  const crossCount = part ? groupCrossPairs(part.crossPairs, { partNumber: part.partNumber, brand: part.brand?.name }).reduce((n, g) => n + g.codes.length, 0) : 0;

  return (
    <Sheet open={Boolean(sku)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl" aria-describedby="part-sheet-desc">
        <header className="flex gap-4 border-b p-5 pr-14">
          <PartImage key={part?.imageUrl ?? hit?.imageUrl} url={part?.imageUrl ?? hit?.imageUrl} className="size-24 rounded-xl bg-white" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {(part?.brand ?? hit?.brand) && <span className="rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand">{(part?.brand ?? hit?.brand)!.name}</span>}
              {(part?.isUniversalFit ?? hit?.isUniversalFit) && <span className="rounded-full border px-2 py-0.5 text-muted-foreground">Universal</span>}
              {part && !part.active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Inativa no catálogo</span>}
            </div>
            <SheetTitle className="text-base">{title}</SheetTitle>
            <SheetDescription id="part-sheet-desc" className="tabular">
              {part?.partNumber ?? hit?.partNumber}
            </SheetDescription>
          </div>
        </header>

        {detail.isLoading && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        )}
        {detail.isError && (
          <div role="alert" className="m-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-2">
              <p>{detail.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
                Tentar de novo
              </Button>
            </div>
          </div>
        )}
        {part && (
          <Tabs defaultValue="resumo" className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="mx-5 mt-3 grid w-auto grid-cols-4">
              <TabsTrigger value="resumo">
                <Boxes aria-hidden /> Resumo
              </TabsTrigger>
              <TabsTrigger value="compat">
                <Car aria-hidden /> Veículos <Count n={part.applications.length} />
              </TabsTrigger>
              <TabsTrigger value="cross">
                <Repeat2 aria-hidden /> Equivalentes <Count n={crossCount} />
              </TabsTrigger>
              <TabsTrigger value="oficina">
                <History aria-hidden /> Oficina
              </TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <TabsContent value="resumo">
                <Overview part={part} hit={hit} onSearch={onSearchCode} />
              </TabsContent>
              <TabsContent value="compat">
                <Fitment part={part} onVehicle={onVehicle} />
              </TabsContent>
              <TabsContent value="cross">
                <Cross part={part} onSearch={onSearchCode} />
              </TabsContent>
              <TabsContent value="oficina">
                <ShopTab part={part} />
              </TabsContent>
            </div>
          </Tabs>
        )}

        {(onPrev || onNext) && (
          <footer className="flex items-center justify-between border-t p-3">
            <Button variant="ghost" size="sm" onClick={onPrev} disabled={!onPrev}>
              <ChevronLeft aria-hidden /> Anterior <kbd className="ml-1 text-[0.65rem] text-muted-foreground">k</kbd>
            </Button>
            <Button variant="ghost" size="sm" onClick={onNext} disabled={!onNext}>
              Próxima <kbd className="mr-1 text-[0.65rem] text-muted-foreground">j</kbd> <ChevronRight aria-hidden />
            </Button>
          </footer>
        )}
      </SheetContent>
    </Sheet>
  );
}

const Count = ({ n }: { n: number }) => (n > 0 ? <span className="tabular rounded-full bg-muted px-1.5 text-[0.65rem] text-muted-foreground">{n > 999 ? '999+' : n}</span> : null);
