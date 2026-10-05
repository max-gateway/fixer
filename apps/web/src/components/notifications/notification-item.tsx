'use client';

import { ListChecks, MessageSquare, TriangleAlert, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { cn } from 'cn';
import { timeAgo, type InboxItem } from '@/lib/notifications';

const ICON: Record<string, LucideIcon> = {
  'order.message_posted': MessageSquare,
  'order.problem_reported': TriangleAlert,
  'order.checklist_item_answered': ListChecks,
};

export function NotificationItem({ item, onOpen }: { item: InboxItem; onOpen?: (item: InboxItem) => void }) {
  const reduce = useReducedMotion();
  const Icon = ICON[item.eventType] ?? MessageSquare;
  const unread = !item.readAt;
  const warning = item.severity === 'warning';

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <Link
        href={`/ordens/${encodeURIComponent(item.orderId)}`}
        onClick={() => onOpen?.(item)}
        className={cn(
          'relative flex gap-3 px-4 py-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent',
          unread && 'bg-brand-soft/60',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
            warning ? 'bg-amber-100 text-amber-800' : 'bg-secondary text-foreground',
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate', unread ? 'font-semibold' : 'font-medium')}>{item.title}</span>
            <time dateTime={item.createdAt} className="shrink-0 text-xs text-muted-foreground tabular">
              {timeAgo(item.createdAt)}
            </time>
          </span>
          {item.body && <span className="mt-0.5 line-clamp-2 block text-muted-foreground">{item.body}</span>}
          {item.orderNumber != null && <span className="mt-1 block text-xs text-muted-foreground">Ordem #{item.orderNumber}</span>}
        </span>
        {unread && (
          <>
            <span className="absolute top-4 right-2 size-2 rounded-full bg-brand" aria-hidden />
            <span className="sr-only">Não lida</span>
          </>
        )}
      </Link>
    </motion.li>
  );
}
