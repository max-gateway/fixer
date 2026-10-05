'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchInbox, markInboxRead, NotificationsError, type InboxItem } from '@/lib/notifications';

export type ListStatus = 'idle' | 'loading' | 'ready' | 'error';
export type Filter = 'all' | 'unread';

type ListState = { items: InboxItem[]; nextCursor: string | null; status: ListStatus; loadingMore: boolean; error?: string };
const EMPTY: ListState = { items: [], nextCursor: null, status: 'idle', loadingMore: false };

/** Mensagem útil para o usuário (e para quem está configurando) em vez de um erro genérico. */
function describe(e: unknown): string {
  const status = e instanceof NotificationsError ? e.status : 0;
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 404 || status === 502 || status === 0) return 'O serviço de notificações está indisponível. Tente novamente em instantes.';
  return 'Não foi possível carregar as notificações.';
}

const POLL_MS = 60_000;
const MAX_RECONNECT_MS = 30_000;

/**
 * Estado da caixa de entrada: duas listas paginadas (todas / não lidas), contador, e tempo real via SSE.
 * - O SSE só traz itens novos; ao (re)conectar a lista é recarregada, então um aviso perdido nunca
 *   perde a notificação (o servidor é a fonte da verdade).
 * - Sem SSE (rede, proxy), cai para polling a cada 60 s enquanto a aba está visível.
 * - Marcar como lida é otimista, com rollback se o servidor recusar.
 */
export function useInboxStore() {
  const [lists, setLists] = useState<Record<Filter, ListState>>({ all: EMPTY, unread: EMPTY });
  const [unreadCount, setUnreadCount] = useState(0);
  const [live, setLive] = useState(false);
  /** Incrementa a cada item novo recebido ao vivo (o sino usa para animar). */
  const [arrivals, setArrivals] = useState(0);
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const wanted = useRef<Set<Filter>>(new Set(['all']));
  const aborts = useRef<Partial<Record<Filter, AbortController>>>({});

  const patch = useCallback((f: Filter, p: Partial<ListState>) => setLists((s) => ({ ...s, [f]: { ...s[f], ...p } })), []);

  const load = useCallback(
    async (f: Filter) => {
      aborts.current[f]?.abort();
      const ctl = (aborts.current[f] = new AbortController());
      setLists((s) => ({ ...s, [f]: { ...s[f], status: s[f].status === 'ready' ? 'ready' : 'loading' } }));
      try {
        const page = await fetchInbox({ unreadOnly: f === 'unread' }, ctl.signal);
        patch(f, { items: page.items, nextCursor: page.nextCursor, status: 'ready', error: undefined });
        setUnreadCount(page.unreadCount);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') patch(f, { status: 'error', error: describe(e) });
      }
    },
    [patch],
  );

  /** Garante que a lista do filtro foi carregada (a aba "não lidas" só busca quando aberta). */
  const ensure = useCallback(
    (f: Filter) => {
      wanted.current.add(f);
      if (listsRef.current[f].status === 'idle') void load(f);
    },
    [load],
  );

  const loadMore = useCallback(
    async (f: Filter) => {
      const cur = lists[f];
      if (!cur.nextCursor || cur.loadingMore) return;
      patch(f, { loadingMore: true });
      try {
        const page = await fetchInbox({ unreadOnly: f === 'unread', cursor: cur.nextCursor });
        setLists((s) => {
          const seen = new Set(s[f].items.map((i) => i.id));
          return { ...s, [f]: { ...s[f], items: [...s[f].items, ...page.items.filter((i) => !seen.has(i.id))], nextCursor: page.nextCursor, loadingMore: false } };
        });
        setUnreadCount(page.unreadCount);
      } catch {
        patch(f, { loadingMore: false });
      }
    },
    [lists, patch],
  );

  const reloadAll = useCallback(() => {
    for (const f of wanted.current) void load(f);
  }, [load]);

  // --- tempo real -----------------------------------------------------------------------------
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      es = new EventSource('/api/notifications/inbox/stream');
      es.onopen = () => {
        attempt = 0;
        setLive(true);
        reloadAll(); // reconcilia o que chegou enquanto estava offline
      };
      es.addEventListener('notification', (ev) => {
        const item = JSON.parse((ev as MessageEvent<string>).data) as InboxItem;
        setLists((s) => {
          const add = (l: ListState) => (l.status === 'idle' || l.items.some((i) => i.id === item.id) ? l : { ...l, items: [item, ...l.items] });
          return { all: add(s.all), unread: add(s.unread) };
        });
        setUnreadCount((n) => n + 1);
        setArrivals((n) => n + 1);
      });
      es.onerror = () => {
        setLive(false);
        // CLOSED = o navegador desistiu (ex.: 401 por token expirado); reabre com backoff exponencial.
        if (es?.readyState === EventSource.CLOSED && !closed) {
          es.close();
          retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, MAX_RECONNECT_MS));
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [reloadAll]);

  // Primeiro carregamento + fallback de polling + recarga ao voltar para a aba.
  useEffect(() => {
    void load('all');
  }, [load]);

  useEffect(() => {
    if (live) return;
    const t = setInterval(() => document.visibilityState === 'visible' && reloadAll(), POLL_MS);
    return () => clearInterval(t);
  }, [live, reloadAll]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && reloadAll();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reloadAll]);

  // --- ações ------------------------------------------------------------------------------------
  const markRead = useCallback(
    async (ids: string[]) => {
      const targets = new Set(ids);
      const now = new Date().toISOString();
      const snapshot = lists;
      const wasUnread = snapshot.all.items.filter((i) => targets.has(i.id) && !i.readAt).length;
      if (wasUnread === 0) return;
      setLists((s) => ({
        all: { ...s.all, items: s.all.items.map((i) => (targets.has(i.id) && !i.readAt ? { ...i, readAt: now } : i)) },
        unread: { ...s.unread, items: s.unread.items.filter((i) => !targets.has(i.id)) },
      }));
      setUnreadCount((n) => Math.max(0, n - wasUnread));
      try {
        const r = await markInboxRead({ ids });
        setUnreadCount(r.unreadCount);
      } catch {
        setLists(snapshot); // rollback
        setUnreadCount((n) => n + wasUnread);
      }
    },
    [lists],
  );

  const markAllRead = useCallback(async () => {
    const snapshot = { lists, unreadCount };
    const now = new Date().toISOString();
    setLists((s) => ({
      all: { ...s.all, items: s.all.items.map((i) => (i.readAt ? i : { ...i, readAt: now })) },
      unread: { ...s.unread, items: [], nextCursor: null },
    }));
    setUnreadCount(0);
    try {
      await markInboxRead({ all: true });
    } catch {
      setLists(snapshot.lists);
      setUnreadCount(snapshot.unreadCount);
    }
  }, [lists, unreadCount]);

  return useMemo(
    () => ({ lists, unreadCount, live, arrivals, ensure, load, loadMore, markRead, markAllRead }),
    [lists, unreadCount, live, arrivals, ensure, load, loadMore, markRead, markAllRead],
  );
}

export type InboxStore = ReturnType<typeof useInboxStore>;
