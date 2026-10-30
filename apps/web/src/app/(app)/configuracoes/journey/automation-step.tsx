'use client';

import { useMutation } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CirclePause, CloudDownload, FileCheck2, Loader2, PackagePlus, TriangleAlert, Zap, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { patchJson } from '@/lib/client-api';
import { relativeTime, syncHealth, type FiscalCredentialView, type Health } from '@/lib/fiscal-import';
import { cn } from '@/lib/utils';
import { automations } from './model';
import { Note } from './ui';

type Flags = { enabled?: boolean; autoManifest?: boolean; autoExport?: boolean; acknowledgeManifestDuty?: boolean };

const HEALTH: Record<Health['tone'], { tone: 'ok' | 'warn' | 'error' | 'info'; icon: LucideIcon }> = {
  ok: { tone: 'ok', icon: CircleCheck },
  warn: { tone: 'warn', icon: TriangleAlert },
  error: { tone: 'error', icon: CircleAlert },
  off: { tone: 'info', icon: CirclePause },
};

/** O que a nota de compra faz sozinha depois que chega: buscar, liberar o XML completo e entrar no estoque. */
export function AutomationStep({ credential }: { credential: FiscalCredentialView }) {
  const router = useRouter();
  // A ciência automática só liga depois de a pessoa confirmar a obrigação da manifestação conclusiva (a API exige o aceite).
  const [awaitingAck, setAwaitingAck] = useState<Flags | null>(null);
  const on = automations(credential);
  const health = syncHealth(credential);
  const s = credential.syncState;

  const update = useMutation({
    mutationFn: (body: Flags) => patchJson('/api/fiscal/credentials', body, 'Não foi possível salvar a alteração.'),
    onSuccess: () => router.refresh(),
  });

  const apply = (body: Flags) => (body.autoManifest && !on.manifest ? setAwaitingAck(body) : update.mutate(body));
  const allOn = on.sync && on.manifest && on.stock;
  const { tone, icon: HealthIcon } = HEALTH[health.tone];

  const items: { id: keyof typeof on; icon: LucideIcon; title: string; detail: string; flag: keyof Flags; requires?: string }[] = [
    { id: 'sync', icon: CloudDownload, flag: 'enabled', title: 'Buscar notas na SEFAZ', detail: 'De hora em hora, traz toda nota emitida contra o CNPJ da oficina.' },
    {
      id: 'manifest',
      icon: FileCheck2,
      flag: 'autoManifest',
      title: 'Dar ciência da operação',
      detail: 'A SEFAZ só libera o XML completo depois da ciência. O Fixer registra a de cada nota nova.',
    },
    {
      id: 'stock',
      icon: PackagePlus,
      flag: 'autoExport',
      title: 'Lançar a entrada no estoque',
      detail: 'Se todos os itens forem reconhecidos (código do fornecedor ou de barras) numa compra normal, as peças entram sem pedir confirmação. O resto espera por você.',
    },
  ];

  return (
    <div className="space-y-4">
      <Note tone={tone} icon={HealthIcon}>
        <p className="font-semibold">{health.title}</p>
        {health.detail && <p>{health.detail}</p>}
      </Note>

      <ol className="surface divide-y overflow-hidden rounded-2xl border bg-card">
        {items.map((it, i) => {
          const checked = on[it.id];
          const Icon = it.icon;
          return (
            <li key={it.id} className={cn('flex items-start gap-3 p-4 transition-colors sm:gap-4 sm:p-5', checked && 'bg-brand-soft/50')}>
              <span aria-hidden className={cn('relative grid size-10 shrink-0 place-items-center rounded-xl transition-colors', checked ? 'bg-brand text-white shadow-[0_6px_16px_-6px_var(--brand-primary)]' : 'bg-slate-100 text-slate-500')}>
                <Icon className="size-5" />
                <span className="font-display absolute -top-1.5 -left-1.5 grid size-5 place-items-center rounded-full border-2 border-card bg-brand-secondary text-[10px] font-bold text-white">{i + 1}</span>
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <label htmlFor={`auto-${it.id}`} className="text-sm font-semibold">
                  {it.title}
                </label>
                <p id={`auto-${it.id}-desc`} className="text-xs text-muted-foreground sm:text-sm">
                  {it.detail}
                </p>
              </div>
              <Switch
                id={`auto-${it.id}`}
                aria-describedby={`auto-${it.id}-desc`}
                checked={checked}
                disabled={update.isPending}
                onCheckedChange={(v) => apply({ [it.flag]: v } as Flags)}
                className="mt-1"
              />
            </li>
          );
        })}
      </ol>

      {!allOn && (
        <Button type="button" size="lg" className="w-full sm:w-auto" disabled={update.isPending} onClick={() => apply({ enabled: true, autoManifest: true, autoExport: true })}>
          {update.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Zap aria-hidden />} Ligar todas as automações
        </Button>
      )}
      {update.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {update.error.message}
        </p>
      )}

      {s && credential.enabled && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border bg-card p-3">
            <dt className="text-xs text-muted-foreground">Última consulta ok</dt>
            <dd className="tabular font-medium">{relativeTime(s.lastSuccessAt)}</dd>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <dt className="text-xs text-muted-foreground">Próxima consulta</dt>
            <dd className="tabular font-medium">{relativeTime(s.nextPollAt)}</dd>
          </div>
        </dl>
      )}

      <AlertDialog open={awaitingAck !== null} onOpenChange={(open) => !open && setAwaitingAck(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ciência não é a manifestação final</AlertDialogTitle>
            <AlertDialogDescription>
              Depois da ciência, a empresa deve registrar a confirmação, o desconhecimento ou a operação não realizada em até 180 dias da autorização da nota.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Agora não</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (awaitingAck) update.mutate({ ...awaitingAck, acknowledgeManifestDuty: true });
                setAwaitingAck(null);
              }}
            >
              Estou ciente, ligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
