'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Bloco cinza com brilho passando (utilitário `skeleton` do tema). */
const Bone = ({ className }: { className?: string }) => <div className={cn('skeleton rounded-md', className)} />;

/** Cada bloco entra em cascata, na mesma ordem da tela real: cabeçalho, KPIs, fila, filtros, quadro. */
function Stage({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const COLUMN_CARDS = [3, 2, 4, 2, 3, 2];

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy aria-label="Carregando ordens de serviço">
      <Stage i={0} className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Bone className="h-7 w-56" />
          <Bone className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Bone className="h-9 w-28 rounded-lg" />
          <Bone className="h-10 w-36 rounded-lg" />
        </div>
      </Stage>

      <Stage i={1} className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 bg-card p-4">
            <Bone className="h-3 w-2/3" />
            <Bone className="h-7 w-1/2" />
            <Bone className="h-3 w-4/5" />
          </div>
        ))}
      </Stage>

      <Stage i={2} className="space-y-2">
        <Bone className="h-4 w-32" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="w-72 shrink-0 space-y-3 rounded-xl border bg-card p-3.5">
              <div className="flex gap-3">
                <Bone className="size-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-4 w-4/5" />
                  <Bone className="h-3 w-full" />
                </div>
              </div>
              <Bone className="h-8 w-full rounded-md" />
            </div>
          ))}
        </div>
      </Stage>

      <Stage i={3} className="space-y-3">
        <div className="flex items-center gap-2">
          <Bone className="h-10 w-full max-w-sm rounded-lg" />
          <div className="flex gap-1">
            {Array.from({ length: 4 }, (_, i) => (
              <Bone key={i} className="size-8 rounded-full" />
            ))}
          </div>
        </div>
        <Bone className="h-10 w-full max-w-2xl rounded-lg" />
      </Stage>

      <Stage i={4} className="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:px-0">
        {COLUMN_CARDS.map((n, c) => (
          <div key={c} className="w-72 shrink-0 space-y-2.5 p-1.5 xl:w-auto xl:min-w-64 xl:flex-1">
            <div className="flex items-center gap-2 px-1 pt-1 pb-1">
              <Bone className="size-2 rounded-full" />
              <Bone className="h-4 w-24" />
              <Bone className="ml-auto h-4 w-12" />
            </div>
            {Array.from({ length: n }, (_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 + c * 0.06 + i * 0.05, duration: 0.35 }}
                className="space-y-2.5 rounded-lg border bg-card p-3"
              >
                <div className="flex justify-between">
                  <Bone className="h-3.5 w-12" />
                  <Bone className="h-4 w-20 rounded-full" />
                </div>
                <div className="flex gap-2">
                  <Bone className="h-5 w-16" />
                  <Bone className="h-5 flex-1" />
                </div>
                <Bone className="h-3.5 w-2/3" />
                <div className="flex items-center gap-2 border-t pt-2.5">
                  <Bone className="size-6 rounded-full" />
                  <Bone className="ml-auto h-4 w-16" />
                </div>
              </motion.div>
            ))}
          </div>
        ))}
      </Stage>
    </div>
  );
}
