'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

// Template (remonta a cada navegação): o conteúdo entra com um fade curto, dando continuidade ao trocar de página.
export default function AppTemplate({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}
