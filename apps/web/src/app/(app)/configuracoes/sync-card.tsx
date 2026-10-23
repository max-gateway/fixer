'use client';

import { useMutation } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CirclePause, Loader2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { patchJson } from '@/lib/client-api';
import { relativeTime, syncHealth, type FiscalCredentialView, type Health } from '@/lib/fiscal-import';
import { cn } from '@/lib/utils';

const TONE: Record<Health['tone'], { box: string; icon: typeof CircleCheck }> = {
  ok: { box: 'border-emerald-200 bg-emerald-50 text-emerald-950', icon: CircleCheck },
  warn: { box: 'border-amber-200 bg-amber-50 text-amber-950', icon: TriangleAlert },
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: CircleAlert },
  off: { box: 'border-slate-200 bg-slate-50 text-slate-800', icon: CirclePause },
};

export function SyncCard({ credential }: { credential: FiscalCredentialView }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const health = syncHealth(credential);
  const { box, icon: Icon } = TONE[health.tone];
  const s = credential.syncState;

  const update = useMutation({
    mutationFn: (body: object) => patchJson('/api/fiscal/credentials', body, 'Não foi possível salvar a alteração.'),
    onSuccess: () => {
      setAck(false);
      router.refresh();
    },
  });

  return (
    <div className="max-w-xl space-y-5">
      <div role="status" className={cn('flex items-start gap-3 rounded-xl border p-4 text-sm', box)}>
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">{health.title}</p>
          {health.detail && <p>{health.detail}</p>}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border bg-card surface p-5 shadow-xs">
        <Toggle
          id="sync-enabled"
          label="Buscar notas automaticamente"
          description="Consulta a SEFAZ de hora em hora e traz as notas emitidas contra o CNPJ da oficina."
          checked={credential.enabled}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ enabled: v })}
        />

        <div className="border-t pt-4">
          <Toggle
            id="sync-manifest"
            label="Dar ciência das notas automaticamente"
            description="A SEFAZ só entrega o XML completo depois da ciência da operação. Com isto ligado, o Fixer registra a ciência de cada nota nova."
            checked={credential.autoManifest}
            disabled={update.isPending || (!credential.autoManifest && !ack)}
            onChange={(v) => update.mutate(v ? { autoManifest: true, acknowledgeManifestDuty: true } : { autoManifest: false })}
          />
          {!credential.autoManifest && (
            <label htmlFor="ack-duty" className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
              <input id="ack-duty" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-primary)]" />
              <span>
                Estou ciente de que a ciência <strong>não é a manifestação final</strong>. Depois dela, a empresa deve registrar a confirmação, o desconhecimento ou a operação não realizada em até <strong>180 dias</strong> da autorização da nota.
              </span>
            </label>
          )}
        </div>

        <div className="border-t pt-4">
          <Toggle
            id="sync-export"
            label="Lançar a entrada no estoque automaticamente"
            description="Quando todos os itens de uma nota são reconhecidos sozinhos (pelo código do fornecedor ou pelo código de barras) e a nota é uma compra normal, o Fixer soma as peças ao estoque sem pedir confirmação. Notas com item pendente ou em revisão continuam esperando por você."
            checked={credential.autoExport}
            disabled={update.isPending}
            onChange={(v) => update.mutate({ autoExport: v })}
          />
        </div>

        {update.error && (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-destructive">
            {update.isPending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {update.error.message}
          </p>
        )}
      </div>

      {s && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card surface p-5 text-sm shadow-xs sm:grid-cols-3">
          <Stat label="Última consulta ok" value={relativeTime(s.lastSuccessAt)} />
          <Stat label="Próxima consulta" value={credential.enabled ? relativeTime(s.nextPollAt) : '—'} />
          <Stat label="Último número lido" value={s.lastNsu === '0' ? '—' : s.lastNsu} />
        </dl>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

/** Interruptor acessível: um checkbox com role="switch", o rótulo e a explicação ligados a ele. */
function Toggle({ id, label, description, checked, disabled, onChange }: { id: string; label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-describedby={`${id}-desc`}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-[var(--brand-primary)] disabled:opacity-50"
      />
    </div>
  );
}
