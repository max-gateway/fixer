'use client';

import { DonutChart } from '@/components/charts/donut-chart';
import { pct } from './model';

export type TaxSlice = { key: string; name: string; who: string; pct: number };

const brl2 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Divisão do imposto sobre a venda: percentual sobre a venda, reais a cada R$ 100 e a fatia de cada tributo no total. */
export function TaxDonut({ slices, unit, label }: { slices: TaxSlice[]; unit: string; label: string }) {
  return (
    <DonutChart
      slices={slices.map((s) => ({ key: s.key, name: s.name, hint: s.who, value: s.pct }))}
      label={label}
      centerValue={(s, total) => pct(s ? s.value : total)}
      centerLabel={(s) => (s ? s.name : unit)}
      row={(s, total) => ({ primary: pct(s.value), secondary: `R$ ${brl2(s.value)} · ${pct((s.value / total) * 100, 0)} do imposto` })}
    />
  );
}
