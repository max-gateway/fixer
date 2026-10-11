'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, LoaderCircle, X } from 'lucide-react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { postJson } from '@/lib/client-api';
import { formatPlate } from '@/lib/masks';
import { OrderCreated, type CreatedOrder } from './order-created';
import { PlateHero } from './plate-hero';
import { usePlateLookup, type PlateData } from './use-plate-lookup';
import { hasErrors, validate, type FieldName, type FormValues } from './validate';
import { VehiclePanel } from './vehicle-panel';

const EMPTY: FormValues = { plate: '', brand: '', model: '', year: '', color: '' };

/**
 * Nova ordem em uma tela só e sem rolagem: a placa abre o fluxo, o veículo se revela logo abaixo e o botão fecha o fluxo.
 * Cliente e quilometragem não são pedidos aqui: o cliente se conecta pelo QR code da ordem criada.
 */
export function NewOrderForm({ portalOrigin }: { portalOrigin: string }) {
  const reduce = useReducedMotion();

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [created, setCreated] = useState<CreatedOrder | null>(null);
  const createOrder = useMutation({
    mutationFn: (payload: unknown) => postJson<CreatedOrder>('/api/service-orders', payload),
    onSuccess: setCreated,
  });
  const saving = createOrder.isPending;
  const serverError = createOrder.error?.message ?? null;

  const setValue = useCallback((k: keyof FormValues, v: string) => setValues((cur) => ({ ...cur, [k]: v })), []);

  // O resultado da placa só preenche o que veio; o que o operador já digitou à mão não é apagado por um campo vazio.
  const applyPlate = useCallback((plate: string, d: PlateData) => {
    setValues((v) => ({ ...v, plate, brand: d.brand ?? v.brand, model: d.model ?? v.model, year: d.year ?? v.year, color: d.color ?? v.color }));
  }, []);
  const plateLookup = usePlateLookup(applyPlate);

  const errors = useMemo(() => validate(values), [values]);
  // Erros só aparecem depois da primeira tentativa de envio (não gritar com quem ainda está digitando).
  const shown = submitted ? errors : {};
  const plateReady = values.plate.length === 7;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    createOrder.reset();
    if (hasErrors(errors)) {
      const first = (['plate', 'brand', 'model', 'year'] as FieldName[]).find((f) => errors[f]);
      if (first) document.getElementById(first)?.focus();
      return;
    }

    createOrder.mutate({
      description: null,
      mileageAtEntry: null,
      vehicle: {
        plate: values.plate,
        brand: values.brand.trim(),
        model: values.model.trim(),
        year: values.year ? Number(values.year) : null,
        color: values.color.trim() || null,
      },
      partLines: [],
      serviceLines: [],
    });
  }

  function reset() {
    setValues(EMPTY);
    setSubmitted(false);
    createOrder.reset();
    setCreated(null);
    plateLookup.reset();
  }

  if (created) {
    return <OrderCreated order={created} phone="" portalUrl={`${portalOrigin}/o/${created.portalToken}`} onNew={reset} />;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-3xl">
      <motion.div
        layout={!reduce}
        transition={{ type: 'spring', stiffness: 220, damping: 30 }}
        className={`flex flex-col ${plateReady ? '' : 'min-h-[60dvh] justify-center'}`}
      >
        <div className="space-y-3">
          <motion.header layout={!reduce} initial={reduce ? false : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">Nova ordem de serviço</p>
            <AnimatePresence initial={false}>
              {!plateReady && (
                <motion.h1
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 overflow-hidden text-4xl font-semibold tracking-tight"
                >
                  Qual é o veículo?
                </motion.h1>
              )}
            </AnimatePresence>
          </motion.header>

          <PlateHero compact={plateReady} plate={values.plate} error={shown.plate} lookup={plateLookup} onChange={(p) => setValue('plate', p)} />

          {!plateReady && (
            <div className="text-center">
              <Link href="/ordens" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Cancelar e voltar às ordens
              </Link>
            </div>
          )}

          <AnimatePresence>
            {plateReady && (
              <motion.div key="rest" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: 12 }} className="space-y-3">
                <VehiclePanel values={values} errors={shown} lookup={plateLookup} onChange={setValue} />

                {serverError && (
                  <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">
                    {serverError}
                  </p>
                )}
                <div className="flex items-stretch gap-2">
                <Link
                  href="/ordens"
                  aria-disabled={saving}
                  className="inline-flex h-14 shrink-0 items-center gap-1.5 rounded-2xl px-5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
                >
                  <X aria-hidden className="size-4" /> Cancelar
                </Link>
                <motion.button
                  type="submit"
                  disabled={saving}
                  initial={reduce ? false : { opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, type: 'spring', stiffness: 260, damping: 24 }}
                  whileHover={reduce ? undefined : { scale: 1.015 }}
                  whileTap={reduce ? undefined : { scale: 0.975 }}
                  className="group relative flex h-14 min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden rounded-2xl bg-brand px-6 text-base font-semibold text-white shadow-lg shadow-brand/25 transition-colors hover:bg-brand-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70"
                >
                  {!reduce && (
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 w-1/4 -skew-x-12 bg-white/20"
                      initial={{ left: '-30%' }}
                      animate={{ left: '130%' }}
                      transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}
                    />
                  )}
                  <span className="relative min-w-0 flex-1 text-left leading-tight">
                    <span className="block truncate text-sm font-semibold">{[values.brand, values.model].filter(Boolean).join(' ') || 'Veículo'}</span>
                    <span className="block truncate text-xs font-medium opacity-80">
                      <span className="font-mono tracking-[0.15em]">{formatPlate(values.plate)}</span>
                      {[values.year, values.color].filter(Boolean).map((d) => ` · ${d}`)}
                    </span>
                  </span>
                  <span className="relative flex shrink-0 items-center gap-2">
                    {saving ? (
                      <>
                        <LoaderCircle aria-hidden className="size-5 animate-spin" /> Abrindo…
                      </>
                    ) : (
                      <>
                        Abrir ordem <ArrowRight aria-hidden className="size-5 transition-transform group-hover:translate-x-1" />
                      </>
                    )}
                  </span>
                </motion.button>
                </div>
                
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </form>
  );
}
