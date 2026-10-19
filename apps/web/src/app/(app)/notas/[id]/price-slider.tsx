'use client';

import { SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { MarkupSlider, type SliderMark, type SliderZone } from '@/components/markup-slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { money } from '@/lib/invoices';
import { marginOf, markupOf, pct1, priceFromMarkup, rowExpenses, type PricingPlanView, type PricingRowView, type Rounding } from '@/lib/pricing';

const ROUND = (v: number) => Math.round(v * 10) / 10;

/**
 * Marcadores do seletor: onde a regra de preço cairia ("regra"), onde está o preço de hoje ("atual") e atalhos comuns. Quem está
 * muito perto de um marcador mais importante some, para os rótulos não se sobreporem.
 */
export function buildMarks({ cost, suggested, current, max }: { cost: number; suggested: number | null; current: number | null; max: number }): SliderMark[] {
  const marks: SliderMark[] = [];
  const gap = max * 0.09;
  const add = (m: SliderMark) => {
    if (m.value < 0 || m.value > max) return;
    if (marks.some((x) => Math.abs(x.value - m.value) < gap)) return;
    marks.push(m);
  };
  // Regra e preço atual levam o preço exato: o markup arredondado, passado de novo pelo arredondamento da regra, erra por um degrau.
  if (suggested !== null) add({ value: ROUND(markupOf(cost, suggested)), label: 'regra', tone: 'rule', price: suggested });
  if (current !== null) add({ value: ROUND(markupOf(cost, current)), label: 'atual', tone: 'current', price: current });
  for (const v of [30, 50, 100]) add({ value: v, label: `${v}%`, tone: 'preset' });
  return marks;
}

/**
 * Zonas do markup (docs/specs/custos-e-impostos-ui.md §9.1): vermelho enquanto o preço, depois do imposto e das despesas, não
 * cobre o custo; âmbar até a margem mínima da regra; verde daí em diante. Imposto e despesas somando 100% ou mais: tudo vermelho.
 */
export function buildZones({ taxPct, overheadPct, fixedPct = 0, minMarginPct, max, costRatio = 1 }: { taxPct: number; overheadPct: number; fixedPct?: number; minMarginPct: number; max: number; costRatio?: number }): SliderZone[] {
  // O markup é sobre o custo de aquisição; o preço precisa cobrir custo × costRatio (com o extra por unidade do perfil).
  const at = (room: number) => (room > 0 ? (costRatio * (100 / room) - 1) * 100 : max);
  const room = 100 - taxPct - overheadPct;
  if (room <= 0) return [{ from: 0, to: max, tone: 'danger', label: 'Prejuízo depois do imposto' }];
  const lossEnd = at(room);
  const evenEnd = fixedPct > 0 ? at(room - fixedPct) : lossEnd;
  const minEnd = minMarginPct > 0 ? at(room - fixedPct - minMarginPct) : evenEnd;
  const zones: SliderZone[] = [{ from: 0, to: lossEnd, tone: 'danger', label: 'Prejuízo depois do imposto' }];
  if (fixedPct > 0) zones.push({ from: lossEnd, to: evenEnd, tone: 'warning', label: 'Não cobre a estrutura' });
  if (minMarginPct > 0) zones.push({ from: evenEnd, to: minEnd, tone: 'warning', label: 'Abaixo da margem mínima' });
  if (minEnd < max) zones.push({ from: minEnd, to: max, tone: 'ok', label: 'Na meta' });
  return zones;
}

/** Limite da escala: 200% ou o que couber o maior marcador com folga, em passos de 50. */
export function scaleMax(...markups: number[]): number {
  const top = Math.max(200, ...markups.filter(Number.isFinite));
  return Math.ceil((top * 1.15) / 50) * 50;
}

/**
 * Ajuste do preço de um item pelo markup sobre o custo, deslizando. Mostra na hora o preço (já arredondado como a regra) e a
 * margem líquida, avisa se ficou abaixo da margem mínima ou do custo depois do imposto, e só grava ao soltar o controle.
 */
export function MarkupPopover({ row: r, plan, busy, onApply }: { row: PricingRowView; plan: PricingPlanView; busy: boolean; onApply: (price: number) => void }) {
  const [open, setOpen] = useState(false);
  if (r.cost === null || Number(r.cost) <= 0 || r.locked) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="size-8" disabled={busy} aria-label="Ajustar o preço pelo markup">
              <SlidersHorizontal aria-hidden />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Ajustar pelo markup</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 space-y-3 p-4">
        {/* Remonta ao abrir para partir do preço que vale agora. */}
        {open && <Body row={r} plan={plan} onApply={onApply} />}
      </PopoverContent>
    </Popover>
  );
}

function Body({ row: r, plan, onApply }: { row: PricingRowView; plan: PricingPlanView; onApply: (price: number) => void }) {
  const cost = Number(r.cost);
  const rule = r.rule ?? plan.rule;
  const rounding = (rule?.rounding ?? 'CENTS_90') as Rounding;
  const minMargin = Number(rule?.minMarginPct ?? 0);
  const tax = r.saleTax.pct === null ? 0 : Number(r.saleTax.pct);
  const ex = rowExpenses(r, plan.rule);
  const overhead = ex.variable + ex.fixed;
  const start = r.proposed ?? r.suggested ?? r.currentPrice;
  const suggested = r.suggested === null ? null : Number(r.suggested);
  const current = r.currentPrice === null ? null : Number(r.currentPrice);

  const max = scaleMax(start ? markupOf(cost, Number(start)) : 0, suggested ? markupOf(cost, suggested) : 0, current ? markupOf(cost, current) : 0);
  const [m, setM] = useState(start ? Math.max(0, ROUND(markupOf(cost, Number(start)))) : 50);
  // Preço exato enquanto a pessoa não mexe no controle: ao abrir, a prévia é o preço que está no campo, não o arredondado da regra.
  const [exact, setExact] = useState<number | null>(start ? Number(start) : null);

  const price = exact ?? priceFromMarkup(cost, m, rounding);
  const margin = marginOf(ex.priceCost, price, tax, overhead);
  const loss = (price * (100 - tax - ex.variable)) / 100 < ex.priceCost;
  const belowEven = !loss && ex.fixed > 0 && (price * (100 - tax - overhead)) / 100 < ex.priceCost;
  const low = !loss && !belowEven && margin < minMargin;

  return (
    <>
      <div className="space-y-0.5">
        <p className="text-sm font-semibold">Markup sobre o custo</p>
        <p className="text-xs text-muted-foreground">Custo real {money(cost)}. Arraste ou digite; o preço só é gravado ao soltar.</p>
      </div>

      <MarkupSlider
        label="Markup"
        value={m}
        min={0}
        max={max}
        step={1}
        marks={buildMarks({ cost, suggested, current, max })}
        zones={buildZones({ taxPct: tax, overheadPct: ex.variable, fixedPct: ex.fixed, minMarginPct: minMargin, max, costRatio: ex.priceCost / cost })}
        onChange={(v) => {
          setExact(null);
          setM(v);
        }}
        onCommit={(v) => onApply(priceFromMarkup(cost, v, rounding))}
        onPickMark={(mark) => {
          const p = mark.price ?? priceFromMarkup(cost, mark.value, rounding);
          setM(mark.value);
          setExact(mark.price ?? null);
          onApply(p);
        }}
      />

      <ZoneLegend minMargin={minMargin} structure={ex.fixed > 0} />

      <dl className="tabular grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Preço</dt>
          <dd className="text-base font-semibold">{money(price)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Margem líquida</dt>
          <dd className="text-base font-semibold">{pct1(margin)}</dd>
        </div>
      </dl>
      {r.saleTax.pct === null && <p className="text-xs text-muted-foreground">Sem imposto calculado: a margem não desconta imposto.</p>}

      {loss && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>Depois do imposto e das despesas este preço não cobre o custo. O lançamento fica bloqueado.</AlertDescription>
        </Alert>
      )}
      {belowEven && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription>Cobre o custo e as despesas de venda, mas não a parte da estrutura da oficina ({pct1(ex.fixed)}): o lançamento vai pedir ciência.</AlertDescription>
        </Alert>
      )}
      {low && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription>Abaixo da margem mínima da regra ({pct1(minMargin)}): o lançamento vai pedir ciência.</AlertDescription>
        </Alert>
      )}
    </>
  );
}

function ZoneLegend({ minMargin, structure }: { minMargin: number; structure: boolean }) {
  const items = [
    { cls: 'bg-red-400/70', text: 'prejuízo' },
    ...(structure ? [{ cls: 'bg-amber-300/80', text: 'não cobre a estrutura' }] : []),
    ...(minMargin > 0 ? [{ cls: 'bg-amber-300/80', text: `abaixo de ${pct1(minMargin)}` }] : []),
    { cls: 'bg-emerald-400/60', text: 'na meta' },
  ];
  return (
    <p aria-hidden className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.text} className="inline-flex items-center gap-1">
          <span className={`inline-block size-2 rounded-full ${i.cls}`} />
          {i.text}
        </span>
      ))}
    </p>
  );
}
