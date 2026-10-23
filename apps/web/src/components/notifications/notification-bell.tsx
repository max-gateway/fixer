'use client';

import { Bell, CheckCheck } from 'lucide-react';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInbox } from './inbox-provider';
import { NotificationList } from './notification-list';
import type { Filter } from './use-inbox-store';

/** Sino do cabeçalho: contador animado, balança quando chega algo ao vivo, popover com as últimas notificações. */
export function NotificationBell() {
  const store = useInbox();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Filter>('all');
  const bell = useAnimationControls();
  const lastArrival = useRef(store.arrivals);

  // Balança o sino a cada item novo recebido ao vivo.
  useEffect(() => {
    if (store.arrivals === lastArrival.current) return;
    lastArrival.current = store.arrivals;
    if (!reduce) void bell.start({ rotate: [0, -16, 14, -10, 6, 0], transition: { duration: 0.6 } });
  }, [store.arrivals, reduce, bell]);

  const changeTab = (v: string) => {
    const f = v as Filter;
    setTab(f);
    store.ensure(f);
  };

  const count = store.unreadCount;
  const label = count > 0 ? `Notificações: ${count} não lida${count > 1 ? 's' : ''}` : 'Notificações';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className="relative">
          <motion.span animate={bell} style={{ display: 'inline-flex', transformOrigin: '50% 0%' }}>
            <Bell />
          </motion.span>
          <AnimatePresence>
            {count > 0 && (
              <motion.span
                key={count} // muda o key a cada valor: o número "pula" ao mudar
                initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] leading-none font-semibold text-white tabular ring-2 ring-background"
                aria-hidden
              >
                {count > 99 ? '99+' : count}
              </motion.span>
            )}
          </AnimatePresence>
          {!store.live && <span className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-amber-400" title="Sem tempo real — atualizando periodicamente" />}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[min(24rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Notificações</h2>
          <Button size="xs" variant="ghost" disabled={count === 0} onClick={() => void store.markAllRead()}>
            <CheckCheck /> Marcar todas como lidas
          </Button>
        </div>

        <Tabs value={tab} onValueChange={changeTab} className="gap-0">
          <div className="border-b px-4 py-2">
            <TabsList className="w-full">
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="unread">Não lidas{count > 0 ? ` (${count > 99 ? '99+' : count})` : ''}</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>

        <ScrollArea className="h-[min(22rem,60vh)]">
          <NotificationList
            store={store}
            filter={tab}
            onOpen={(item) => {
              void store.markRead([item.id]);
              setOpen(false);
            }}
          />
        </ScrollArea>

        <div className="border-t px-4 py-2 text-center">
          <Link href="/notificacoes" onClick={() => setOpen(false)} className="text-sm font-medium text-brand hover:underline">
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
