'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Clock, Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { describedBy, Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { ClientApiError, postJson } from '@/lib/client-api';
import { brl, type Service } from '@/lib/orders';
import { estimateNote, parseHours, type ServiceEstimate } from '@/lib/service-hours';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new ClientApiError('Falha ao carregar.');
  return res.json() as Promise<T>;
}

/** Acrescenta um serviço do catálogo à ordem, mostrando de onde vem a estimativa de horas para este veículo. */
export function AddService({ orderId, vehicleId }: { orderId: string; vehicleId: string }) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState('');
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');

  const services = useQuery({ queryKey: ['services'], queryFn: () => getJson<Service[]>('/api/services') });
  const estimate = useQuery({
    queryKey: ['service-estimate', serviceId, vehicleId],
    queryFn: () => getJson<ServiceEstimate>(`/api/services/${serviceId}/estimate?vehicleId=${encodeURIComponent(vehicleId)}`),
    enabled: serviceId !== '',
  });

  const add = useMutation({
    mutationFn: (body: object) => postJson(`/api/service-orders/${orderId}/service-lines`, body, 'Falha ao adicionar o serviço.'),
    onSuccess: () => {
      setServiceId('');
      setHours('');
      setDescription('');
      router.refresh();
    },
  });

  const parsedHours = parseHours(hours);
  const hoursInvalid = hours.trim() !== '' && parsedHours == null;
  const est = estimate.data;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!serviceId || hoursInvalid) return;
    add.mutate({
      serviceId,
      ...(parsedHours != null && { hours: parsedHours }),
      ...(description.trim() && { description: description.trim() }),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Adicionar serviço</p>
      <Field id="svc" label="Serviço">
        <Select {...describedBy('svc')} value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={services.isPending}>
          <option value="">{services.isPending ? 'Carregando…' : 'Escolha um serviço'}</option>
          {services.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {brl(s.defaultPrice)}
            </option>
          ))}
        </Select>
      </Field>

      {serviceId && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <Clock aria-hidden className="size-3.5" />
          {estimate.isPending
            ? 'Buscando estimativa…'
            : est && est.source !== 'NONE'
              ? estimateNote(est.source, est.hours, est.sampleCount)
              : estimateNote('NONE')}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field
          id="svc-hours"
          label="Horas"
          optional
          error={hoursInvalid ? 'Use um valor entre 0,25 e 100' : null}
          hint={est && est.source === 'LEARNED' ? 'Vazio usa a sugestão' : 'Sobrescreve a estimativa'}
        >
          <Input {...describedBy('svc-hours', hoursInvalid ? 'x' : null)} inputMode="decimal" placeholder="ex.: 4,5" value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field id="svc-desc" label="Descrição para a nota" optional hint="Texto livre; vai na nota fiscal de serviço, não afeta o aprendizado">
          <Textarea {...describedBy('svc-desc')} rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      {add.error && (
        <p role="alert" className="text-sm text-red-600">
          {add.error.message}
        </p>
      )}
      <Button type="submit" size="sm" disabled={!serviceId || hoursInvalid || add.isPending}>
        {add.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
        Adicionar
      </Button>
    </form>
  );
}
