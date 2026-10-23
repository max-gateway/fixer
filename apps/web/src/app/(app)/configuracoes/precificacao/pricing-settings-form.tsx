'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MarkupSlider, type SliderMark } from '@/components/markup-slider';
import { UnitInput } from '@/components/unit-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { putJson } from '@/lib/client-api';
import { marginOf, marginToMarkup, markupToMargin, pct1, roundUp } from '@/lib/pricing';

export type RuleSettings = {
  method: 'MARGIN' | 'MARKUP';
  value: string;
  taxPctOverride: string | null;
  overheadPct: string;
  rounding: 'NONE' | 'CENTS_90' | 'CENTS_00' | 'MULTIPLE_5' | 'MULTIPLE_10';
  minMarginPct: string;
  maxJumpPct: string;
};

export const num = (v: string): number | null | 'invalid' => {
  if (v.trim() === '') return null;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
};
export const show = (v: string | null | undefined) => (v == null ? '' : String(Number(v)).replace('.', ','));

const ROUNDING: Record<RuleSettings['rounding'], string> = {
  CENTS_90: 'Terminar em ,90 (79,90)',
  CENTS_00: 'Real cheio (80,00)',
  MULTIPLE_5: 'Múltiplo de 5',
  MULTIPLE_10: 'Múltiplo de 10',
  NONE: 'Sem arredondamento (só centavos)',
};

/** Escala e atalhos do seletor, por método: margem raramente passa de 60%; markup chega a 200% em peça barata. */
const SCALE = {
  MARGIN: { max: 70, step: 0.5, marks: [20, 30, 40, 50].map((v): SliderMark => ({ value: v, label: `${v}%`, tone: 'preset' })) },
  MARKUP: { max: 200, step: 1, marks: [30, 50, 80, 100].map((v): SliderMark => ({ value: v, label: `${v}%`, tone: 'preset' })) },
} as const;

/** Regra de preço da oficina. A prévia mostra o efeito numérico antes de salvar, para a pessoa conferir a conta. */
export function RuleForm({ initial }: { initial: RuleSettings | null }) {
  const router = useRouter();
  const [method, setMethod] = useState<RuleSettings['method']>(initial?.method ?? 'MARGIN');
  const [value, setValue] = useState(show(initial?.value ?? '35'));
  const [overhead, setOverhead] = useState(show(initial?.overheadPct ?? '0'));
  const [rounding, setRounding] = useState<RuleSettings['rounding']>(initial?.rounding ?? 'CENTS_90');
  const [minMargin, setMinMargin] = useState(show(initial?.minMarginPct ?? '0'));
  const [maxJump, setMaxJump] = useState(show(initial?.maxJumpPct ?? '25'));
  const [override, setOverride] = useState(show(initial?.taxPctOverride));
  const [submitted, setSubmitted] = useState(false);

  const n = { value: num(value), overhead: num(overhead), minMargin: num(minMargin), maxJump: num(maxJump), override: num(override) };
  const bad = (x: number | null | 'invalid') => x === 'invalid';
  const errors = {
    value: n.value === null || bad(n.value) ? 'Informe um número, como 35' : null,
    overhead: bad(n.overhead) ? 'Informe um número' : null,
    minMargin: bad(n.minMargin) ? 'Informe um número' : null,
    maxJump: bad(n.maxJump) ? 'Informe um número' : null,
    override: bad(n.override) ? 'Informe um número' : null,
  };
  const shown = submitted ? errors : { value: null, overhead: null, minMargin: null, maxJump: null, override: null };
  const scale = SCALE[method];
  const valueNum = typeof n.value === 'number' ? n.value : 0;

  // Prévia: custo R$ 100,00 com o imposto definido aqui (ou 0, se vier do perfil do contador).
  const preview = (() => {
    if (typeof n.value !== 'number') return null;
    const tax = typeof n.override === 'number' ? n.override : 0;
    const oh = typeof n.overhead === 'number' ? n.overhead : 0;
    const room = method === 'MARGIN' ? 100 - n.value - tax - oh : 100 - tax - oh;
    if (room <= 0) return 'impossível';
    const raw = method === 'MARGIN' ? 100 / (room / 100) : (100 * (1 + n.value / 100)) / (room / 100);
    const price = roundUp(raw, rounding);
    return { price, margin: marginOf(100, price, tax, oh) };
  })();

  const save = useMutation({
    mutationFn: (body: object) => putJson('/api/pricing/rule', body, 'Não foi possível salvar a regra.'),
    onSuccess: () => router.refresh(),
  });

  function changeMethod(next: RuleSettings['method']) {
    if (next === method) return;
    // Troca de método preservando o efeito: a mesma margem vira o markup equivalente (e vice-versa), sem imposto nem despesas.
    if (typeof n.value === 'number') {
      const converted = next === 'MARKUP' ? marginToMarkup(n.value) : markupToMargin(n.value);
      if (Number.isFinite(converted)) setValue(show(String(Math.min(SCALE[next].max, Math.round(converted * 2) / 2))));
    }
    setMethod(next);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    save.mutate({
      method,
      value: n.value,
      overheadPct: n.overhead ?? 0,
      rounding,
      minMarginPct: n.minMargin ?? 0,
      maxJumpPct: n.maxJump ?? 25,
      taxPctOverride: n.override,
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6" noValidate>
      <div className="space-y-4 rounded-xl border bg-card surface p-4">
        <div className="space-y-1.5">
          <p id="rule-method-label" className="text-sm font-medium">
            Como calcular
          </p>
          <ToggleGroup type="single" value={method} onValueChange={(v) => v && changeMethod(v as RuleSettings['method'])} aria-labelledby="rule-method-label">
            <ToggleGroupItem value="MARGIN">Margem sobre a venda</ToggleGroupItem>
            <ToggleGroupItem value="MARKUP">Markup sobre o custo</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {method === 'MARGIN' ? 'Margem: o percentual do PREÇO que sobra de lucro (recomendado: já considera imposto e despesas).' : 'Markup: o percentual somado ao CUSTO, antes de imposto e despesas.'}
          </p>
        </div>

        <MarkupSlider
          label={method === 'MARGIN' ? 'Margem desejada' : 'Markup'}
          value={valueNum}
          min={0}
          max={scale.max}
          step={scale.step}
          marks={[...scale.marks]}
          error={shown.value}
          onChange={(v) => setValue(show(String(v)))}
        />
        {typeof n.value === 'number' && n.value > 0 && (
          <p className="text-xs text-muted-foreground">
            {method === 'MARGIN'
              ? `Equivale a um markup de ${pct1(marginToMarkup(n.value))} sobre o custo, sem imposto nem despesas.`
              : `Equivale a uma margem de ${pct1(markupToMargin(n.value))} sobre a venda, sem imposto nem despesas.`}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rule-overhead" label="Despesas variáveis" optional hint="Taxa de cartão, comissão: percentual do preço." error={shown.overhead}>
          <UnitInput id="rule-overhead" unit="%" hint value={overhead} onChange={(e) => setOverhead(e.target.value)} error={shown.overhead} />
        </Field>
        <Field id="rule-rounding" label="Arredondamento (sempre para cima)">
          <Select id="rule-rounding" value={rounding} onChange={(e) => setRounding(e.target.value as RuleSettings['rounding'])}>
            {Object.entries(ROUNDING).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rule-min" label="Margem mínima" optional hint="Abaixo disso, o lançamento pede ciência." error={shown.minMargin}>
          <UnitInput id="rule-min" unit="%" hint value={minMargin} onChange={(e) => setMinMargin(e.target.value)} error={shown.minMargin} />
        </Field>
        <Field id="rule-jump" label="Variação máxima de preço" optional hint="Mudança maior que isso pede ciência." error={shown.maxJump}>
          <UnitInput id="rule-jump" unit="%" hint value={maxJump} onChange={(e) => setMaxJump(e.target.value)} error={shown.maxJump} />
        </Field>
      </div>
      <Field id="rule-override" label="Imposto sobre a venda fixo" optional hint="Se preencher, vale este percentual para todas as peças e o perfil do contador é ignorado." error={shown.override}>
        <UnitInput id="rule-override" unit="%" hint value={override} onChange={(e) => setOverride(e.target.value)} error={shown.override} />
      </Field>

      {preview === null ? (
        <Alert>
          <AlertDescription>Informe a margem para ver um exemplo.</AlertDescription>
        </Alert>
      ) : preview === 'impossível' ? (
        <Alert variant="destructive">
          <AlertDescription>Margem, imposto e despesas somam 100% ou mais: não existe preço possível.</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="info" aria-live="polite">
          <AlertDescription>
            <p>
              Exemplo: peça que custa <strong>R$ 100,00</strong> → preço <strong>R$ {preview.price.toFixed(2).replace('.', ',')}</strong>, margem líquida <strong>{pct1(preview.margin)}</strong>
              {n.override === null && ' (sem imposto, que vem do perfil do contador)'}.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Submit pending={save.isPending} error={save.error?.message ?? null} done={save.isSuccess} label="Salvar regra" />
    </form>
  );
}

export function Submit({ pending, error, done, label }: { pending: boolean; error: string | null; done: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : null} {label}
      </Button>
      {done && !pending && !error && (
        <span role="status" className="flex items-center gap-1 text-sm text-emerald-800">
          <Check aria-hidden className="size-4" /> Salvo
        </span>
      )}
      {error && (
        <span role="alert" className="text-sm font-medium text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
