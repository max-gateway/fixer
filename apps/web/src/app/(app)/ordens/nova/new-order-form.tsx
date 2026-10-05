'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Field, describedBy } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import type { Part, Service } from '@/lib/orders';
import { CustomerSection } from './customer-section';
import { ItemsSection } from './items-section';
import { OrderCreated, type CreatedOrder } from './order-created';
import { computeLines, OrderSummary } from './order-summary';
import { Section } from './section';
import { usePlateLookup, type PlateData } from './use-plate-lookup';
import { VehicleSection } from './vehicle-section';
import { hasErrors, validate, type FieldName, type FormValues, type PartLine } from './validate';

const EMPTY: FormValues = { phone: '', plate: '', brand: '', model: '', year: '', color: '', mileage: '', description: '' };

export function NewOrderForm({ parts, services, portalOrigin }: { parts: Part[]; services: Service[]; portalOrigin: string }) {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [partLines, setPartLines] = useState<PartLine[]>([]);
  const [serviceIds, setServiceIds] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ order: CreatedOrder; phone: string } | null>(null);

  const setValue = useCallback((k: keyof FormValues, v: string) => setValues((cur) => ({ ...cur, [k]: v })), []);

  // O resultado da placa só preenche o que veio; o que o operador já digitou à mão não é apagado por um campo vazio.
  const applyPlate = useCallback((plate: string, d: PlateData) => {
    setValues((v) => ({ ...v, plate, brand: d.brand ?? v.brand, model: d.model ?? v.model, year: d.year ?? v.year, color: d.color ?? v.color }));
  }, []);
  const plateLookup = usePlateLookup(applyPlate);

  const errors = useMemo(() => validate(values, partLines), [values, partLines]);
  // Erros só aparecem depois da primeira tentativa de envio (não gritar com quem ainda está digitando).
  const shown = submitted ? errors : {};
  const { lines, total } = useMemo(() => computeLines(parts, services, partLines, serviceIds), [parts, services, partLines, serviceIds]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (hasErrors(errors)) {
      const first = (['phone', 'plate', 'brand', 'model', 'year', 'mileage', 'parts'] as FieldName[]).find((f) => errors[f]);
      if (first && first !== 'parts') document.getElementById(first)?.focus();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/service-orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerPhone: values.phone || undefined,
          description: values.description.trim() || null,
          mileageAtEntry: values.mileage ? Number(values.mileage) : null,
          vehicle: {
            plate: values.plate,
            brand: values.brand.trim(),
            model: values.model.trim(),
            year: values.year ? Number(values.year) : null,
            color: values.color.trim() || null,
          },
          partLines: partLines.filter((l) => l.partId).map((l) => ({ partId: l.partId, quantity: Number(l.quantity) })),
          serviceLines: [...serviceIds].map((serviceId) => ({ serviceId })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setServerError(body.message ?? 'Falha ao salvar.');
      setCreated({ order: body as CreatedOrder, phone: values.phone });
    } catch {
      setServerError('Falha de rede. Verifique a conexão e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setValues(EMPTY);
    setPartLines([]);
    setServiceIds(new Set());
    setSubmitted(false);
    setServerError(null);
    setCreated(null);
    plateLookup.reset();
  }

  if (created) {
    return <OrderCreated order={created.order} phone={created.phone} portalUrl={`${portalOrigin}/o/${created.order.portalToken}`} onNew={reset} />;
  }

  const descHint = 'O que o cliente relatou. Ele também pode complementar pelo portal.';
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-5">
        <CustomerSection phone={values.phone} error={shown.phone} onChange={(v) => setValue('phone', v)} />
        <VehicleSection
          values={values}
          errors={shown}
          lookup={plateLookup}
          onChange={setValue}
          onPlateRead={(plate) => {
            setValue('plate', plate);
            void plateLookup.lookup(plate);
          }}
        />
        <Section step={3} title="Solicitação do cliente" description="Opcional.">
          <Field id="description" label="Descrição" optional hint={descHint}>
            <Textarea {...describedBy('description', null, descHint)} value={values.description} onChange={(e) => setValue('description', e.target.value)} rows={3} />
          </Field>
        </Section>
        <ItemsSection
          parts={parts}
          services={services}
          partLines={partLines}
          serviceIds={serviceIds}
          partsError={shown.parts}
          onPartLines={(update) => setPartLines(update)}
          onToggleService={(id, on) =>
            setServiceIds((prev) => {
              const next = new Set(prev);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            })
          }
        />
      </div>

      <OrderSummary values={values} lines={lines} total={total} error={serverError} saving={saving} />
    </form>
  );
}
