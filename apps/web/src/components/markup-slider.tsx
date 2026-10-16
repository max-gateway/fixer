'use client';

import { useId, useState } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export interface SliderMark {
  value: number;
  label: string;
  /** `rule` = onde a regra de preço cairia; `current` = onde está o preço de hoje; `preset` = atalho comum. */
  tone?: 'rule' | 'current' | 'preset';
  /** Preço exato a que o marcador corresponde (regra, preço atual): o markup arredondado não o reproduziria. */
  price?: number;
}

const TONE: Record<NonNullable<SliderMark['tone']>, string> = {
  rule: 'font-medium text-primary',
  current: 'font-medium text-foreground',
  preset: 'text-muted-foreground',
};

const clean = (n: number, step: number) => Math.round(n / step) * step;
const fmt = (n: number) => String(Number(n.toFixed(2))).replace('.', ',');

/**
 * Seletor deslizante de percentual (markup ou margem): arrasta para escolher e confere o número ao lado, que também é
 * editável. Os marcadores embaixo são atalhos clicáveis e mostram onde a regra e o preço atual caem na escala. `onChange`
 * dispara a cada passo (para a prévia); `onCommit` ao soltar, ao digitar Enter/sair do campo ou ao clicar num marcador.
 */
export function MarkupSlider({
  label,
  value,
  onChange,
  onCommit,
  onPickMark,
  min = 0,
  max = 200,
  step = 1,
  marks = [],
  disabled,
  error,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  /** Clique num marcador. Se informado, substitui onChange/onCommit nesse clique (para quem precisa do preço exato do marcador). */
  onPickMark?: (mark: SliderMark) => void;
  min?: number;
  max?: number;
  step?: number;
  marks?: SliderMark[];
  disabled?: boolean;
  error?: string | null;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null); // o que está sendo digitado; null = mostrar o valor
  const inside = (v: number) => Math.min(max, Math.max(min, v));

  function commitText() {
    if (text === null) return;
    const n = Number(text.trim().replace(',', '.'));
    setText(null);
    if (!Number.isFinite(n) || n < 0) return;
    onChange(n);
    onCommit?.(n);
  }

  const pos = (v: number) => `${((inside(v) - min) / (max - min)) * 100}%`;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <InputGroup className="h-8 w-24" aria-invalid={error ? true : undefined}>
          <InputGroupInput
            id={id}
            inputMode="decimal"
            disabled={disabled}
            value={text ?? fmt(value)}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitText();
              }
              if (e.key === 'Escape') setText(null);
            }}
          />
          <InputGroupAddon align="end">%</InputGroupAddon>
        </InputGroup>
      </div>

      <Slider
        thumbLabel={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={[inside(value)]}
        onValueChange={([v]) => {
          setText(null);
          onChange(clean(v!, step));
        }}
        onValueCommit={([v]) => onCommit?.(clean(v!, step))}
      />

      {marks.length > 0 && (
        <div className="relative h-5" aria-label="Atalhos">
          {marks.map((m) => (
            <button
              key={`${m.tone}-${m.value}`}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (onPickMark) return onPickMark(m);
                onChange(m.value);
                onCommit?.(m.value);
              }}
              style={{ left: pos(m.value) }}
              className={cn('absolute -translate-x-1/2 rounded px-1 text-xs whitespace-nowrap hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none', TONE[m.tone ?? 'preset'])}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
