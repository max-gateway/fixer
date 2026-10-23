'use client';

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { Droplets, Gauge, MapPin, PencilLine, Users, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Field, describedBy } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { PlateSpecs, usePlateLookup } from './use-plate-lookup';
import type { Errors, FormValues } from './validate';

type Lookup = ReturnType<typeof usePlateLookup>;

const COLORS: Record<string, string> = {
  branco: '#f8fafc', preto: '#111827', prata: '#cbd5e1', cinza: '#6b7280', vermelho: '#dc2626', azul: '#2563eb',
  verde: '#16a34a', amarelo: '#facc15', laranja: '#ea580c', marrom: '#78350f', bege: '#d6c7a1', dourado: '#ca8a04',
};
const colorHex = (name: string) => COLORS[name.trim().toLowerCase().split(/\s|\//)[0] ?? ''];

/** Cor de texto legível sobre o fundo `hex` (claro -> tinta escura; escuro -> branco). */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1c2430' : '#ffffff';
}

const ease = [0.22, 1, 0.36, 1] as const;
const fuel = (t: string) => titleCase(t).replace(/Alcool/g, 'Álcool').replace(/\//g, '/');
const titleCase = (t: string) => t.toLowerCase().replace(/(^|[\s/])\S/g, (m) => m.toUpperCase());

/** Número que sobe até o valor (ex.: 1.0 → 999 cc). Sem animação quando o usuário prefere menos movimento. */
function CountUp({ to, reduce }: { to: number; reduce: boolean }) {
  const mv = useMotionValue(reduce ? to : 0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString('pt-BR'));
  useEffect(() => {
    const controls = animate(mv, to, { duration: reduce ? 0 : 0.9, ease });
    return () => controls.stop();
  }, [mv, to, reduce]);
  return <motion.span>{text}</motion.span>;
}

/** `value` é o destaque; `unit` fica ao lado, menor. Números contam até o valor. */
type Chip = { icon: LucideIcon; label: string; value: ReactNode; unit?: string };

/** Fichas técnicas do veículo; só as que vieram na consulta. */
function specChips(s: PlateSpecs, reduce: boolean): Chip[] {
  const chips: (Chip | false | undefined)[] = [
    !!(s.cilindradas || s.motor) && {
      icon: Gauge,
      label: s.cilindradas && s.motor ? `Motor ${s.motor}` : 'Motor',
      value: s.cilindradas ? <CountUp to={s.cilindradas} reduce={reduce} /> : s.motor,
      unit: s.cilindradas ? 'cc' : undefined,
    },
    !!s.potencia && { icon: Zap, label: 'Potência', value: <CountUp to={s.potencia} reduce={reduce} />, unit: 'cv' },
    !!s.combustivel && { icon: Droplets, label: 'Combustível', value: fuel(s.combustivel) },
    !!s.lotacao && { icon: Users, label: 'Lotação', value: <CountUp to={s.lotacao} reduce={reduce} />, unit: s.lotacao === 1 ? 'lugar' : 'lugares' },
    !!s.local && { icon: MapPin, label: 'Emplacado em', value: s.local.replace(/\s*-\s*/, ' · ') },
  ];
  return chips.filter((c): c is Chip => !!c);
}

/**
 * Dossiê do veículo: esqueleto enquanto consulta; ao achar, o cartão ganha a cor do carro, o modelo vira
 * título e as fichas técnicas entram em cascata. Se não achar, os campos abrem para preenchimento manual.
 */
export function VehiclePanel({
  values,
  errors,
  lookup,
  onChange,
}: {
  values: FormValues;
  errors: Errors;
  lookup: Lookup;
  onChange: (k: keyof FormValues, v: string) => void;
}) {
  const reduce = !!useReducedMotion();
  const [editing, setEditing] = useState(false);
  const kind = lookup.status.kind;
  const open = editing || kind === 'error' || kind === 'idle';
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => onChange(k, e.target.value);
  const hex = colorHex(values.color) ?? '';
  const tinted = kind === 'found' && !!hex;

  return (
    <motion.section
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 28 }}
      transition={{ duration: 0.5, ease }}
      animate={{ opacity: 1, y: 0, backgroundColor: tinted ? hex : '#ffffff', color: tinted ? inkOn(hex) : '#1c2430' }}
      className="relative overflow-hidden rounded-3xl shadow-[0_6px_24px_-12px_rgba(15,20,27,.25)]"
      aria-label="Veículo"
    >
      {/* Um brilho suave dá volume ao fundo colorido. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/20 via-transparent to-black/10" />

      <div className="relative space-y-3 p-4">
        {kind === 'loading' ? (
          <div className="flex items-center gap-3" aria-busy>
            <div className="size-11 animate-pulse rounded-full bg-current/10" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/4 animate-pulse rounded bg-current/10" />
              <div className="h-6 w-2/3 animate-pulse rounded bg-current/10" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            <div className="min-w-0 flex-1">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={`${values.brand}|${values.model}`}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.25 }}
                >
                  <p className="truncate text-xs font-semibold uppercase tracking-[0.25em] opacity-70">{values.brand || 'Veículo'}</p>
                  <h2 className="truncate text-xl font-semibold leading-tight tracking-tight">{values.model || 'Informe o modelo'}</h2>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {values.year && <span className="rounded-full bg-current/10 px-2.5 py-1 text-xs font-semibold tabular-nums">{values.year}</span>}
              {values.color && <span className="hidden rounded-full bg-current/10 px-2.5 py-1 text-xs font-medium sm:inline">{values.color}</span>}
              {kind === 'found' && (
                <button
                  type="button"
                  onClick={() => setEditing((e) => !e)}
                  aria-expanded={open}
                  aria-label={editing ? 'Concluir ajuste' : 'Ajustar dados'}
                  className="grid size-8 place-items-center rounded-full opacity-70 transition hover:bg-current/10 hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-current/40 focus-visible:outline-none"
                >
                  <PencilLine aria-hidden className="size-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {lookup.status.kind === 'found' && <Specs specs={lookup.status.specs} reduce={reduce} />}

        {kind === 'error' && (
          <p role="alert" className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
            {lookup.status.message} Preencha os dados abaixo à mão.
          </p>
        )}

        <AnimatePresence initial={false}>
          {open && kind !== 'loading' && (
            <motion.div
              key="fields"
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease }}
              className="-mx-1 overflow-hidden px-1"
            >
              <div className="grid gap-3 rounded-2xl bg-card surface p-3 text-card-foreground sm:grid-cols-2">
                <Field id="brand" label="Marca" error={errors.brand}>
                  <Input {...describedBy('brand', errors.brand)} value={values.brand} onChange={set('brand')} />
                </Field>
                <Field id="model" label="Modelo" error={errors.model}>
                  <Input {...describedBy('model', errors.model)} value={values.model} onChange={set('model')} />
                </Field>
                <Field id="year" label="Ano" optional error={errors.year}>
                  <Input {...describedBy('year', errors.year)} value={values.year} onChange={set('year')} inputMode="numeric" maxLength={4} />
                </Field>
                <Field id="color" label="Cor" optional>
                  <Input id="color" value={values.color} onChange={set('color')} />
                </Field>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

function Specs({ specs, reduce }: { specs: PlateSpecs; reduce: boolean }) {
  const chips = specChips(specs, reduce);
  if (!chips.length) return null;
  return (
    <div className="space-y-2">
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {chips.map(({ icon: Icon, label, value, unit }, i) => (
            <motion.li
              key={label}
              initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              whileHover={reduce ? undefined : { y: -2 }}
              transition={{ delay: 0.06 * i, duration: 0.4, ease }}
              className="group flex min-w-0 items-center gap-2.5 rounded-2xl bg-current/10 py-2 pl-2.5 pr-4 transition-colors hover:bg-current/15"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-current/10">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold tabular-nums">
                  {value}
                  {unit && <span className="ml-1 text-xs font-medium opacity-70">{unit}</span>}
                </span>
                <span className="block truncate text-[11px] opacity-70">{label}</span>
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
