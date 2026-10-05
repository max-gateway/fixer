'use client';

import { BellOff, RefreshCw } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { InboxItem } from '@/lib/notifications';
import { NotificationItem } from './notification-item';
import type { Filter, InboxStore } from './use-inbox-store';

/** Lista de uma aba (todas/não lidas) com os 4 estados: carregando, erro, vazio e dados. */
export function NotificationList({
  store,
  filter,
  onOpen,
  emptyHint,
}: {
  store: InboxStore;
  filter: Filter;
  onOpen?: (item: InboxItem) => void;
  emptyHint?: string;
}) {
  const list = store.lists[filter];

  if (list.status === 'idle' || (list.status === 'loading' && list.items.length === 0)) {
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Carregando notificações">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (list.status === 'error' && list.items.length === 0) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm">
        <p className="text-muted-foreground">{list.error ?? 'Não foi possível carregar as notificações.'}</p>
        <Button size="sm" variant="outline" onClick={() => void store.load(filter)}>
          <RefreshCw /> Tentar de novo
        </Button>
      </div>
    );
  }

  if (list.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
        <BellOff className="size-8 opacity-50" aria-hidden />
        <p className="font-medium text-foreground">{filter === 'unread' ? 'Tudo em dia' : 'Nenhuma notificação ainda'}</p>
        <p>{emptyHint ?? 'Mensagens e problemas relatados pelos clientes aparecem aqui.'}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        <AnimatePresence initial={false}>
          {list.items.map((item) => (
            <NotificationItem key={item.id} item={item} onOpen={onOpen} />
          ))}
        </AnimatePresence>
      </ul>
      {list.nextCursor && (
        <div className="p-3 text-center">
          <Button size="sm" variant="ghost" disabled={list.loadingMore} onClick={() => void store.loadMore(filter)}>
            {list.loadingMore ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </>
  );
}
