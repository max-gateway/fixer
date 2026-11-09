'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, Pause, Play, Plug, RefreshCw, Store, TriangleAlert, Unplug } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { deleteJson, getJson, postJson } from '@/lib/client-api';
import { accountStatus, type AuthorizationStarted, connectUrl, MARKETPLACE_URL, type MarketplaceAccount, type MarketplaceOverview, type MarketplaceProvider, providerMode, returnOutcome } from '@/lib/marketplace';
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
 * Contas de marketplace da oficina, uma seção por marketplace (a lista vem da API). Conectar leva a pessoa ao marketplace e ela volta para esta tela com o
 * resultado na URL; ao voltar autorizada, a conta é vinculada à oficina sozinha (uma vez). Desconectar pede confirmação. Quem não pode ver ou mudar recebe
 * a mensagem da API.
 */
export function MarketplaceCard() {
  const qc = useQueryClient();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [connecting, setConnecting] = useState<string | null>(null);
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
  const data: MarketplaceOverview | undefined = overview.data;

  return (
    <div className="space-y-4">
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
      {data?.enabled && data.providers.length === 0 && <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">Nenhum marketplace está disponível para a sua oficina.</p>}

      {data?.enabled &&
        data.providers.map((p) => (
          <ProviderSection
            key={p.slug}
            provider={p}
            busy={busy}
            revoking={revoking}
            setRevoking={setRevoking}
            onAction={(url, method) => {
              setError(null);
              setNotice(null);
              act.mutate({ url, method });
            }}
            onReauthorize={(accountId) => {
              setError(null);
              authorize.mutate({ url: `${MARKETPLACE_URL}/accounts/${accountId}/reauthorize` });
            }}
            onConnect={() => {
              setError(null);
              setNotice(null);
              setDialogError(null);
              setConnecting(p.slug);
            }}
          />
        ))}

      {data?.enabled &&
        data.providers
          .filter((p) => p.slug === connecting)
          .map((p) => (
            <ConnectDialog
              key={p.slug}
              open
              onOpenChange={(o) => !o && setConnecting(null)}
              provider={p}
              redirectUri={p.redirectUri}
              hasApp={p.ready}
              busy={authorize.isPending}
              error={dialogError}
              onSubmit={(input: ConnectInput) => {
                setDialogError(null);
                authorize.mutate({ url: connectUrl(p.slug), body: input });
              }}
            />
          ))}
    </div>
  );
}

function ProviderSection({
  provider: p,
  busy,
  revoking,
  setRevoking,
  onAction,
  onReauthorize,
  onConnect,
}: {
  provider: MarketplaceProvider;
  busy: boolean;
  revoking: string | null;
  setRevoking: (id: string | null) => void;
  onAction: (url: string, method?: 'POST' | 'DELETE') => void;
  onReauthorize: (accountId: string) => void;
  onConnect: () => void;
}) {
  const mode = providerMode(p);
  const titleId = `marketplace-${p.slug}`;
  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-2xl border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Store className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {p.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            Conecte a conta de vendedor da oficina. A autorização acontece no site do {p.name}; o Fixer nunca vê a sua senha e guarda o acesso cifrado na plataforma.
          </p>
        </div>
      </div>

      {p.accounts.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">Nenhuma conta conectada ainda.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {p.accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              providerName={p.name}
              busy={busy}
              confirming={revoking === a.id}
              onConfirm={(on) => setRevoking(on ? a.id : null)}
              onAction={onAction}
              onReauthorize={() => onReauthorize(a.id)}
            />
          ))}
        </ul>
      )}

      {mode === 'unavailable' ? (
        <p className="text-sm text-muted-foreground">
          {p.entitled ? `A conexão com o ${p.name} ainda não está liberada para a sua oficina. Fale com o suporte.` : `O ${p.name} não está incluído no plano da sua oficina.`}
        </p>
      ) : (
        <div>
          <Button type="button" disabled={busy} onClick={onConnect}>
            <Plug aria-hidden /> {p.accounts.length === 0 ? `Conectar ${p.name}` : 'Conectar outra conta'}
          </Button>
        </div>
      )}
    </section>
  );
}

function AccountRow({
  account: a,
  providerName,
  busy,
  confirming,
  onConfirm,
  onAction,
  onReauthorize,
}: {
  account: MarketplaceAccount;
  providerName: string;
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
          <p className="font-medium">Desconectar “{a.label}”? O Fixer perde o acesso a essa conta do {providerName}; para voltar, será preciso autorizar de novo.</p>
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
