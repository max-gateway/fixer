'use client';

import { CheckCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInbox } from './inbox-provider';
import { NotificationList } from './notification-list';
import type { Filter } from './use-inbox-store';

/** Página cheia da caixa de entrada: mesmas listas do sino, sem limite de altura. */
export function InboxPage() {
  const store = useInbox();
  const [tab, setTab] = useState<Filter>('all');

  useEffect(() => {
    store.ensure(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ensure é estável o bastante; só reage à troca de aba
  }, [tab]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notificações</h1>
          <p className="flex items-center gap-2 text-sm text-slate-600">
            Mensagens e alertas dos clientes nas suas ordens.
            <Badge variant={store.live ? 'success' : 'warning'}>{store.live ? 'Ao vivo' : 'Atualizando a cada minuto'}</Badge>
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={store.unreadCount === 0} onClick={() => void store.markAllRead()}>
          <CheckCheck /> Marcar todas como lidas
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">Todas</TabsTrigger>
          <TabsTrigger value="unread">Não lidas{store.unreadCount > 0 ? ` (${store.unreadCount})` : ''}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        <NotificationList store={store} filter={tab} onOpen={(item) => void store.markRead([item.id])} />
      </div>
    </section>
  );
}
