'use client';

import { ChevronRight, KeyRound, Loader2, Mail, Phone, Search, TriangleAlert, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UserAvatar } from '@/components/nav/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ToastProvider, useToast } from '@/components/ui/toaster';
import { DEFAULT_FILTERS, displayName, STATUS_TABS, type Access, type Filters, type Person } from '@/lib/workforce';
import { cn } from '@/lib/utils';
import { useDebounced } from './use-debounced';
import { usePeople, usePositions, useUnits, type Initial } from './hooks';
import { PersonFormSheet } from './person-form-sheet';
import { PersonSheet } from './person-sheet';

export function TeamWorkspace(props: { initial: Initial; access: Access; openId: string | null }) {
  return (
    <ToastProvider>
      <Workspace {...props} />
    </ToastProvider>
  );
}

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

function Workspace({ initial, access, openId: initialOpen }: { initial: Initial; access: Access; openId: string | null }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Filters['status']>(initial.filters.status);
  const [text, setText] = useState(initial.filters.q);
  const q = useDebounced(text, 250);
  const filters = useMemo<Filters>(() => ({ q, status }), [q, status]);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const people = usePeople(filters, initial);
  const units = useUnits(initial).data;
  const positions = usePositions(initial).data;
  const rows = useMemo(() => people.data?.pages.flatMap((p) => p.items) ?? [], [people.data]);

  // URL compartilhável (replaceState: não refaz a busca do servidor).
  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.q) p.set('q', filters.q);
    if (filters.status !== DEFAULT_FILTERS.status) p.set('status', filters.status || 'all');
    if (openId) p.set('open', openId);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [filters, openId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' && access.manage) {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [access.manage]);

  const filtered = !!filters.q || filters.status !== DEFAULT_FILTERS.status;
  const loading = people.isPending || (people.isFetching && people.isPlaceholderData);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="surface grid size-11 place-items-center rounded-2xl border bg-card text-brand">
            <Users aria-hidden className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
            <p className="text-sm text-muted-foreground">Quem trabalha na oficina, em que função e desde quando.</p>
          </div>
        </div>
        {access.manage && (
          <Button onClick={() => setCreating(true)}>
            <UserPlus aria-hidden />
            Nova pessoa
            <kbd className="ml-1 hidden rounded border border-white/30 px-1 font-mono text-[10px] sm:inline">N</kbd>
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Situação" className="inline-flex rounded-full border bg-card p-1 shadow-xs">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value || 'all'}
              role="tab"
              type="button"
              aria-selected={status === t.value}
              onClick={() => setStatus(t.value)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                status === t.value ? 'bg-brand text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            aria-label="Buscar pessoas"
            className="rounded-full pr-9 pl-9"
          />
          {text ? (
            <button type="button" aria-label="Limpar busca" onClick={() => setText('')} className="absolute top-1/2 right-2.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted">
              <X aria-hidden className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:block">/</kbd>
          )}
        </div>

        {!loading && rows.length > 0 && (
          <p aria-live="polite" className="tabular ml-auto text-sm text-muted-foreground">
            {rows.length}
            {people.hasNextPage ? '+' : ''} {rows.length === 1 && !people.hasNextPage ? 'pessoa' : 'pessoas'}
          </p>
        )}
      </div>

      {people.isError && !people.data ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p className="flex-1">{(people.error as Error).message}</p>
          <Button size="sm" variant="outline" onClick={() => people.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : loading ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <Empty filtered={filtered} canCreate={access.manage} onCreate={() => setCreating(true)} onClear={() => (setText(''), setStatus(DEFAULT_FILTERS.status))} />
      ) : (
        <div className="space-y-4">
          <ul className="surface divide-y overflow-hidden rounded-2xl border bg-card">
            {rows.map((p, i) => (
              <li key={p.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
                <PersonRow person={p} selected={p.id === openId} onOpen={() => setOpenId(p.id)} />
              </li>
            ))}
          </ul>
          {people.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => people.fetchNextPage()} disabled={people.isFetchingNextPage}>
                {people.isFetchingNextPage && <Loader2 aria-hidden className="animate-spin" />}
                Carregar mais
              </Button>
            </div>
          )}
          {people.isError && <p role="alert" className="text-center text-sm text-destructive">{(people.error as Error).message}</p>}
        </div>
      )}

      <PersonSheet
        id={openId}
        access={access}
        units={units}
        positions={positions}
        onClose={() => setOpenId(null)}
        onNotify={(title, description) => toast({ title, description, tone: 'success' })}
      />
      <PersonFormSheet
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(p) => {
          setCreating(false);
          setOpenId(p.id);
          toast({ title: 'Pessoa cadastrada', description: 'Agora é só admitir: defina o vínculo e a função.', tone: 'success' });
        }}
      />
    </section>
  );
}

function PersonRow({ person: p, selected, onOpen }: { person: Person; selected: boolean; onOpen: () => void }) {
  const inactive = p.status === 'inactive';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors focus-visible:bg-accent focus-visible:outline-none sm:px-5',
        selected ? 'bg-brand-soft' : 'hover:bg-muted/60',
      )}
    >
      <UserAvatar name={displayName(p)} className={cn('size-10 text-sm', inactive && 'grayscale')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('truncate font-semibold', inactive && 'text-muted-foreground')}>{displayName(p)}</span>
          {p.socialName && <span className="truncate text-xs text-muted-foreground">({p.name})</span>}
          {inactive && <Badge variant="secondary">Inativo</Badge>}
          {p.hasLogin && (
            <Badge variant="outline" className="gap-1 border-brand/25 bg-brand-soft text-brand">
              <KeyRound aria-hidden />
              Acessa o sistema
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
          <span className="tabular font-mono text-xs">{p.cpf}</span>
          {p.email && (
            <span className="hidden min-w-0 items-center gap-1.5 truncate sm:inline-flex">
              <Mail aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{p.email}</span>
            </span>
          )}
          {p.phone && (
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <Phone aria-hidden className="size-3.5 shrink-0" />
              {p.phone}
            </span>
          )}
        </div>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function ListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Carregando equipe" className="surface divide-y overflow-hidden rounded-2xl border bg-card">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ filtered, canCreate, onCreate, onClear }: { filtered: boolean; canCreate: boolean; onCreate: () => void; onClear: () => void }) {
  return (
    <div className="surface flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Users aria-hidden className="size-6" />
      </span>
      <h2 className="text-lg font-semibold">{filtered ? 'Ninguém encontrado' : 'Sua equipe começa aqui'}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered ? 'Nenhuma pessoa combina com a busca ou o filtro atual.' : 'Cadastre mecânicos, atendentes e o restante do time para ligar cada um às ordens e comissões.'}
      </p>
      {filtered ? (
        <Button variant="outline" onClick={onClear}>
          Limpar filtros
        </Button>
      ) : (
        canCreate && (
          <Button onClick={onCreate}>
            <UserPlus aria-hidden />
            Cadastrar primeira pessoa
          </Button>
        )
      )}
    </div>
  );
}
