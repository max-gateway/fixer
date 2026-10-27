'use client';

import { Car } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { VehicleFilter } from '@/lib/part-search';

/** Busca de peças de um veículo por montadora e modelo, sem precisar de texto (usa a lista por veículo da plataforma). */
export function VehiclePopover({ vehicle, onApply }: { vehicle?: VehicleFilter; onApply: (v: VehicleFilter | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const canApply = make.trim().length > 0;
  const label = useMemo(() => [make.trim(), model.trim()].filter(Boolean).join(' '), [make, model]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={vehicle ? 'secondary' : 'outline'} size="sm">
          <Car aria-hidden /> <span className="max-w-40 truncate">{vehicle ? vehicle.label : 'Por veículo'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canApply) return;
            onApply({ make: make.trim(), ...(model.trim() ? { model: model.trim() } : {}), label });
            setOpen(false);
          }}
        >
          <p className="text-sm font-medium">Peças de um veículo</p>
          {(
            [
              ['Montadora', make, setMake, 'Fiat'],
              ['Modelo (opcional)', model, setModel, 'Strada'],
            ] as const
          ).map(([l, v, set, ph]) => (
            <label key={l} className="block space-y-1 text-xs font-medium">
              {l}
              <input value={v} onChange={(e) => set(e.target.value)} placeholder={ph} className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20" />
            </label>
          ))}
          <div className="flex gap-2">
            {vehicle && (
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => { onApply(undefined); setMake(''); setModel(''); setOpen(false); }}>
                Remover
              </Button>
            )}
            <Button type="submit" size="sm" className="flex-1" disabled={!canApply}>
              Ver peças
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Dica: na ficha de uma peça, a aba Veículos filtra pelo modelo exato e funciona junto com o texto da busca.</p>
        </form>
      </PopoverContent>
    </Popover>
  );
}
