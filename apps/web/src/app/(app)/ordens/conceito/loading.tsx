'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Bloco cinza com brilho passando (utilitário `skeleton` do tema). */
const Bone = ({ className }: { className?: string }) => <div className={cn('skeleton rounded-md', className)} />;

/** Cada bloco entra em cascata, na mesma ordem da tela real: cabeçalho, alternância, grupos. */
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

const LANE_ROWS = [4, 5, 3];

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Carregando ordens de serviço">
      <Stage i={0} className="space-y-6 rounded-2xl bg-brand-secondary p-5 sm:p-7">
        <div className="flex justify-between gap-4">
          <div className="space-y-3">
            <div className="h-3 w-40 rounded bg-white/10" />
            <div className="h-8 w-64 max-w-full rounded bg-white/15" />
          </div>
          <div className="h-10 w-36 rounded-md bg-brand/60" />
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2 border-l-2 border-white/10 pl-3">
              <div className="h-7 w-16 rounded bg-white/15" />
              <div className="h-3 w-24 rounded bg-white/10" />
            </div>
          ))}
        </div>
        <div className="h-12 rounded-xl bg-white/90" />
      </Stage>

      <Stage i={1} className="flex justify-between gap-3">
        <Bone className="h-10 w-64 rounded-lg" />
        <Bone className="h-9 w-96 max-w-[45%] rounded-lg max-sm:hidden" />
      </Stage>

      {LANE_ROWS.map((n, l) => (
        <Stage key={l} i={2 + l} className="space-y-3">
          <div className="flex items-center gap-3">
            <Bone className="h-1.5 w-7 -skew-x-[35deg]" />
            <Bone className="h-5 w-32" />
            <Bone className="h-4 w-56 max-sm:hidden" />
          </div>
          <div className="divide-y rounded-2xl border bg-card">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <Bone className="h-7 w-20" />
                <div className="w-40 space-y-1.5">
                  <Bone className="h-4 w-full" />
                  <Bone className="h-3 w-2/3" />
                </div>
                <Bone className="h-4 flex-1 max-md:hidden" />
                <Bone className="h-8 w-24 rounded-md" />
              </div>
            ))}
          </div>
        </Stage>
      ))}
    </div>
  );
}
