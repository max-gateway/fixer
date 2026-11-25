'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Clock, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { postJson } from '@/lib/client-api';
import type { OrderDetail, OrderStatus } from '@/lib/orders';
import { estimateNote, formatHours, parseHours } from '@/lib/service-hours';

type Line = OrderDetail['serviceLines'][number];

/** As horas reais só são informadas com a ordem em execução; antes disso só se vê a estimativa. */
const EDITABLE: OrderStatus[] = ['IN_PROGRESS', 'AWAITING_PART'];

function HoursRow({ orderId, line, editable }: { orderId: string; line: Line; editable: boolean }) {
  const router = useRouter();
  // Só a sugestão aprendida é pré-preenchida; referência e "sem histórico" começam vazios (spec §6.3).
  const initial = line.hoursActual ?? (line.hoursEstimateSource === 'LEARNED' ? line.hoursEstimated : null);
  const [text, setText] = useState(initial != null ? String(Number(initial)).replace('.', ',') : '');
  const save = useMutation({
    mutationFn: (hours: number) => postJson(`/api/service-orders/${orderId}/service-lines/${line.id}/hours`, { hours }, 'Falha ao salvar as horas.'),
    onSuccess: () => router.refresh(),
  });
  const parsed = parseHours(text);
  const saved = line.hoursActual != null && parsed === Number(line.hoursActual);
  const note = estimateNote(line.hoursEstimateSource, line.hoursEstimated);

  return (
    <li className="space-y-1.5 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="min-w-0 flex-1 font-medium">{line.serviceName}</span>
        {line.hoursActual != null && !editable && (
          <span className="tabular font-medium">{formatHours(line.hoursActual)}</span>
        )}
      </div>
      {line.description && <p className="text-xs text-muted-foreground">{line.description}</p>}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock aria-hidden className="size-3.5" /> {note}
      </p>

      {editable && (
        <form
          className="flex flex-wrap items-center gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed != null) save.mutate(parsed);
          }}
        >
          <label htmlFor={`h-${line.id}`} className="sr-only">
            Horas reais de {line.serviceName}
          </label>
          <Input
            id={`h-${line.id}`}
            inputMode="decimal"
            placeholder="Horas reais (ex.: 4,5)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={text !== '' && parsed == null ? true : undefined}
            className="w-44"
          />
          <Button type="submit" size="sm" variant={saved ? 'outline' : 'default'} disabled={parsed == null || save.isPending || saved}>
            {save.isPending ? <Loader2 aria-hidden className="animate-spin" /> : saved ? <Check aria-hidden /> : null}
            {saved ? 'Salvo' : 'Salvar horas'}
          </Button>
          {parsed != null && <span className="tabular text-xs text-muted-foreground">{formatHours(parsed)}</span>}
          {text !== '' && parsed == null && <span className="text-xs text-destructive">Use um valor entre 0,25 e 100</span>}
        </form>
      )}
      {save.error && (
        <p role="alert" className="text-xs text-red-600">
          {save.error.message}
        </p>
      )}
    </li>
  );
}

export function ServiceHours({ orderId, status, lines }: { orderId: string; status: OrderStatus; lines: Line[] }) {
  const editable = EDITABLE.includes(status);
  return (
    <div>
      {editable && lines.some((l) => l.hoursActual == null) && (
        <p className="mb-1 text-xs text-muted-foreground">Informe as horas reais de cada serviço antes de concluir a ordem.</p>
      )}
      <ul className="divide-y">
        {lines.map((l) => (
          <HoursRow key={l.id} orderId={orderId} line={l} editable={editable} />
        ))}
      </ul>
    </div>
  );
}
