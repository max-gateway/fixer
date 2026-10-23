'use client';

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, type PointerEvent } from 'react';
import { PlateCapture } from '@/components/plate-capture';
import { normalizePlate } from '@/lib/masks';
import type { usePlateLookup } from './use-plate-lookup';

type Lookup = ReturnType<typeof usePlateLookup>;

export const MERCOSUL = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;

function hint(kind: Lookup['status']['kind'], complete: boolean, status: Lookup['status']): string {
  if (kind === 'loading') return 'Buscando os dados do veículo…';
  if (kind === 'found') return status.kind === 'found' && status.specs.cached ? 'Veículo já consultado antes — dados salvos.' : 'Veículo encontrado.';
  return complete ? 'Placa completa.' : 'Digite a placa ou';
}

/**
 * A placa é o ponto de partida e a estrela da tela: um campo no formato de placa (faixa azul no padrão
 * Mercosul, cinza no antigo) que consulta sozinho ao completar 7 caracteres. A câmera fica ao lado.
 * A placa inclina em 3D na direção do ponteiro e brilha enquanto consulta.
 */
export function PlateHero({
  plate,
  error,
  lookup,
  onChange,
  compact = false,
}: {
  compact?: boolean;
  plate: string;
  error?: string;
  lookup: Lookup;
  onChange: (plate: string) => void;
}) {
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const kind = lookup.status.kind;
  const complete = plate.length === 7;
  const mercosul = complete ? MERCOSUL.test(plate) : true;

  // Inclinação 3D: o ponteiro (-0.5..0.5 sobre a placa) vira rotação com mola.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotY = useSpring(useTransform(px, [-0.5, 0.5], [-9, 9]), { stiffness: 180, damping: 18 });
  const rotX = useSpring(useTransform(py, [-0.5, 0.5], [7, -7]), { stiffness: 180, damping: 18 });

  useEffect(() => input.current?.focus(), []);
  // Esconde o teclado do celular enquanto os dados são buscados.
  useEffect(() => {
    if (kind === 'loading') input.current?.blur();
  }, [kind]);

  function tilt(e: PointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  }
  function untilt() {
    px.set(0);
    py.set(0);
  }

  function change(raw: string) {
    const next = normalizePlate(raw);
    onChange(next);
    if (next.length === 7) void lookup.lookup(next);
    else if (kind !== 'idle') lookup.reset();
  }

  return (
    <div className="space-y-3">
      <div className={`mx-auto flex w-full items-stretch gap-3 transition-[max-width] duration-500 ${compact ? 'max-w-md' : 'max-w-xl'}`}>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 30, scale: 0.94 }}
          animate={error && !reduce ? { opacity: 1, y: 0, scale: 1, x: [0, -8, 8, -5, 5, 0] } : { opacity: 1, y: 0, scale: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          onPointerMove={tilt}
          onPointerLeave={untilt}
          style={{ perspective: 900 }}
          className="relative min-w-0 flex-1"
        >
          <motion.div
            style={reduce ? undefined : { rotateX: rotX, rotateY: rotY }}
            animate={{ boxShadow: complete && kind !== 'error' ? '0 0 18px -6px var(--brand-primary)' : '0 4px 10px -4px rgba(15,20,27,.25)' }}
            transition={{ duration: 0.6 }}
            className={`overflow-hidden rounded-2xl border-[5px] bg-white ${error ? 'border-red-500' : 'border-[#0f141b]'}`}
          >
            <motion.div
              animate={{ backgroundColor: mercosul ? '#1d3f9f' : '#6b7280' }}
              className="flex items-center justify-between px-4 py-1 text-[11px] font-bold tracking-[0.35em] text-white"
            >
              <span>BRASIL</span>
              <span aria-hidden className="text-base leading-none">
                {mercosul ? '◢◣' : ''}
              </span>
            </motion.div>

            <div className="relative">
              <input
                ref={input}
                id="plate"
                value={plate}
                onChange={(e) => change(e.target.value)}
                aria-label="Placa do veículo"
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={7}
                placeholder="ABC1D23"
                className={`w-full bg-transparent px-4 text-center font-mono font-bold ${compact ? 'py-2 text-[clamp(1.75rem,7vw,2.5rem)]' : 'py-4 text-[clamp(2.25rem,10vw,4.5rem)]'} uppercase leading-none tracking-[0.14em] text-[#0f141b] outline-none placeholder:text-slate-300`}
              />
              {kind === 'loading' && !reduce && (
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-brand/25 to-transparent"
                  initial={{ left: '-33%' }}
                  animate={{ left: '100%' }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                />
              )}
            </div>
          </motion.div>

          <div className="pointer-events-none absolute -right-2 -top-2" aria-live="polite">
            <AnimatePresence mode="wait">
              {kind === 'loading' && (
                <motion.span key="l" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="grid size-8 place-items-center rounded-full bg-card shadow-md ring-1 ring-border">
                  <LoaderCircle aria-label="Consultando" className="size-4 animate-spin text-brand" />
                </motion.span>
              )}
              {kind === 'found' && (
                <motion.span
                  key="f"
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                  className="grid size-8 place-items-center rounded-full bg-emerald-500 text-white shadow-md"
                >
                  <CircleCheck aria-label="Dados encontrados" className="size-5" />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <div className="flex min-h-7 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
        <AnimatePresence mode="wait">
          <motion.p
            aria-live="polite"
            key={error ?? hint(kind, complete, lookup.status)}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            role={error ? 'alert' : undefined}
            className={error ? 'font-medium text-destructive' : 'text-muted-foreground'}
          >
            {error ?? hint(kind, complete, lookup.status)}
          </motion.p>
        </AnimatePresence>
        {/* A câmera só faz sentido enquanto não há dados do veículo. */}
        {kind !== 'found' && kind !== 'loading' && (
          <PlateCapture
            variant="inline"
            allowUpload={false}
            onPlate={(p) => {
              onChange(p);
              void lookup.lookup(p);
            }}
          />
        )}
      </div>
    </div>
  );
}
