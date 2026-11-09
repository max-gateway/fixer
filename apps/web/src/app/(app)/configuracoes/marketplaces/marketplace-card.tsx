'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, Pause, Play, Plug, RefreshCw, Store, TriangleAlert, Unplug } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { deleteJson, getJson, postJson } from '@/lib/client-api';
import { accountStatus, type AuthorizationStarted, MARKETPLACE_URL, type MarketplaceAccount, type MarketplaceOverview, returnOutcome } from '@/lib/marketplace';
import { cn } from '@/lib/utils';
import { ConnectDialog, type ConnectInput } from './connect-dialog';

const KEY = ['marketplace'] as const;
const TONE = {
  ok: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-900 ring-amber-200',
  bad: 'bg-red-50 text-red-900 ring-red-200',
  muted: 'bg-muted text-muted-foreground ring-border',
} as const;

/**
 * Contas do Mercado Livre da oficina. Conectar leva a pessoa ao Mercado Livre e ela volta para esta tela com o resultado na URL; ao voltar
 * autorizada, a conta é vinculada à oficina sozinha (uma vez). Desconectar pede confirmação. Quem não pode ver ou mudar recebe a mensagem da API.
 */
export function MarketplaceCard() {
  const qc = useQueryClient();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [connecting, setConnecting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const overview = useQuery({ queryKey: KEY, queryFn: () => getJson<MarketplaceOverview>(MARKETPLACE_URL, 'Não foi possível carregar os marketplaces.') });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const fail = (e: Error) => {
    setRevoking(null);
    setError(e.message);
  };

  const authorize = useMutation({
    mutationFn: (v: { url: string; body?: unknown }) => postJson<AuthorizationStarted>(v.url, v.body ?? {}, 'Não foi possível iniciar a autorização.'),
    onSuccess: (r) => window.location.assign(r.authorizeUrl),
    onError: (e) => (connecting ? setDialogError(e.message) : fail(e)),
  });
  const act = useMutation({
    mutationFn: (v: { url: string; method?: 'POST' | 'DELETE' }) => (v.method === 'DELETE' ? deleteJson(v.url, 'Não foi possível desconectar a conta.') : postJson(v.url, {}, 'Não foi possível concluir a ação.')),
    onSuccess: () => {
      setRevoking(null);
      setError(null);
      return refresh();
    },
    onError: fail,
  });

  // Volta do Mercado Livre: mostra o resultado, vincula a conta autorizada (uma vez) e limpa a URL para um F5 não repetir nada.
  const handled = useRef(false);
  useEffect(() => {
    const outcome = returnOutcome(params);
    if (!outcome || handled.current) return;
    handled.current = true;
    router.replace(path);
    if (outcome.kind === 'error') return setError(outcome.message);
    setNotice(outcome.message);
    if (outcome.linkAccountId) act.mutate({ url: `${MARKETPLACE_URL}/accounts/${outcome.linkAccountId}/link` });
  }, [params]);

  const busy = authorize.isPending || act.isPending;
  const data = overview.data;

  return (
    <section aria-labelledby="marketplaces-title" className="space-y-4 rounded-2xl border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Store className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="marketplaces-title" className="text-base font-semibold">
            Mercado Livre
          </h2>
          <p className="text-sm text-muted-foreground">
            Conecte a conta de vendedor da oficina. A autorização acontece no site do Mercado Livre; o Fixer nunca vê a sua senha e guarda o acesso cifrado na plataforma.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> {notice}
        </p>
      )}

      {overview.isPending && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {overview.isError && (
        <p role="alert" className="text-sm font-medium text-red-900">
          {overview.error.message}
        </p>
      )}
      {data && !data.enabled && <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">Marketplaces ainda não está disponível neste ambiente.</p>}

      {data?.enabled && (
        <>
          {data.accounts.length === 0 ? (
            <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">Nenhuma conta conectada ainda.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.accounts.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  busy={busy}
                  confirming={revoking === a.id}
                  onConfirm={(on) => setRevoking(on ? a.id : null)}
                  onAction={(url, method) => {
                    setError(null);
                    setNotice(null);
                    act.mutate({ url, method });
                  }}
                  onReauthorize={() => {
                    setError(null);
                    authorize.mutate({ url: `${MARKETPLACE_URL}/accounts/${a.id}/reauthorize` });
                  }}
                />
              ))}
            </ul>
          )}

          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setNotice(null);
                setDialogError(null);
                setConnecting(true);
              }}
            >
              <Plug aria-hidden /> {data.accounts.length === 0 ? 'Conectar Mercado Livre' : 'Conectar outra conta'}
            </Button>
          </div>
          {connecting && (
            <ConnectDialog
              open
              onOpenChange={setConnecting}
              redirectUri={data.redirectUri}
              hasApp={data.canConnect}
              busy={authorize.isPending}
              error={dialogError}
              onSubmit={(input: ConnectInput) => {
                setDialogError(null);
                authorize.mutate({ url: `${MARKETPLACE_URL}/accounts`, body: input });
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function AccountRow({
  account: a,
  busy,
  confirming,
  onConfirm,
  onAction,
  onReauthorize,
}: {
  account: MarketplaceAccount;
  busy: boolean;
  confirming: boolean;
  onConfirm: (on: boolean) => void;
  onAction: (url: string, method?: 'POST' | 'DELETE') => void;
  onReauthorize: () => void;
}) {
  const status = accountStatus(a);
  const base = MARKETPLACE_URL;
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{a.label}</p>
          {a.displayName && <p className="truncate text-xs text-muted-foreground">{a.displayName}</p>}
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE[status.tone])}>{status.label}</span>
      </div>
      {status.hint && <p className="text-xs text-muted-foreground">{status.hint}</p>}

      {confirming ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Desconectar “{a.label}”? O Fixer perde o acesso a essa conta; para voltar, será preciso autorizar de novo.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => onAction(`${base}/accounts/${a.id}`, 'DELETE')}>
              Desconectar
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onConfirm(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {a.state === 'active' && !a.connection && (
            <Button type="button" size="sm" disabled={busy} onClick={() => onAction(`${base}/accounts/${a.id}/link`)}>
              <Plug aria-hidden /> Vincular à oficina
            </Button>
          )}
          {a.connection?.state === 'active' && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction(`${base}/connections/${a.connection!.id}/pause`)}>
              <Pause aria-hidden /> Pausar
            </Button>
          )}
          {a.connection?.state === 'paused' && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction(`${base}/connections/${a.connection!.id}/resume`)}>
              <Play aria-hidden /> Retomar
            </Button>
          )}
          {(a.state === 'reauth_required' || a.state === 'pending') && (
            <Button type="button" size="sm" disabled={busy} onClick={onReauthorize}>
              <RefreshCw aria-hidden /> Reconectar
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onConfirm(true)}>
            <Unplug aria-hidden /> Desconectar
          </Button>
        </div>
      )}
    </li>
  );
}
