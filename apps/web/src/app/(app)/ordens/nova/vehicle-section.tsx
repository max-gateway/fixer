import { LoaderCircle, Search } from 'lucide-react';
import { PlateCapture } from '@/components/plate-capture';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, describedBy } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { normalizePlate } from '@/lib/masks';
import { Section } from './section';
import type { usePlateLookup } from './use-plate-lookup';
import type { Errors, FormValues } from './validate';

type Lookup = ReturnType<typeof usePlateLookup>;

export function VehicleSection({
  values,
  errors,
  lookup,
  onChange,
  onPlateRead,
}: {
  values: FormValues;
  errors: Errors;
  lookup: Lookup;
  onChange: (k: keyof FormValues, v: string) => void;
  /** Placa lida pela câmera: preenche e já consulta. */
  onPlateRead: (plate: string) => void;
}) {
  const loading = lookup.status.kind === 'loading';
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => onChange(k, e.target.value);

  return (
    <Section step={2} title="Veículo" description="Digite a placa ou fotografe: marca, modelo, ano e cor são preenchidos sozinhos.">
      <div className="flex flex-wrap items-end gap-2">
        <Field id="plate" label="Placa" error={errors.plate}>
          <Input
            {...describedBy('plate', errors.plate)}
            value={values.plate}
            onChange={(e) => onChange('plate', normalizePlate(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // Enter busca a placa; não envia o formulário sem querer
                void lookup.lookup(values.plate);
              }
            }}
            autoComplete="off"
            maxLength={7}
            placeholder="ABC1D23"
            className="w-36 font-mono text-base uppercase tracking-[0.2em]"
          />
        </Field>
        <Button type="button" variant="outline" disabled={loading} onClick={() => void lookup.lookup(values.plate)}>
          {loading ? <LoaderCircle aria-hidden className="animate-spin" /> : <Search aria-hidden />}
          {loading ? 'Consultando…' : 'Buscar dados'}
        </Button>
        {lookup.status.kind === 'found' && <Badge variant="success">Dados preenchidos pela placa</Badge>}
      </div>
      {lookup.status.kind === 'error' && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {lookup.status.message} Você pode preencher os dados abaixo à mão.
        </p>
      )}

      <PlateCapture onPlate={onPlateRead} />

      <div className="grid gap-3 sm:grid-cols-2">
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
        <Field id="mileage" label="Km na entrada" optional error={errors.mileage}>
          <Input {...describedBy('mileage', errors.mileage)} value={values.mileage} onChange={set('mileage')} type="number" min={0} inputMode="numeric" />
        </Field>
      </div>
    </Section>
  );
}
