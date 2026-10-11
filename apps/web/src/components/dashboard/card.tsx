'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Superfície do dashboard. Entra em cascata (fade + subida) conforme `index`, sem atrasar a leitura. */
export function Card({ children, className, index = 0 }: { children: ReactNode; className?: string; index?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className={cn('rounded-xl border bg-card p-5 shadow-xs', className)}
    >
      {children}
    </motion.section>
  );
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}
