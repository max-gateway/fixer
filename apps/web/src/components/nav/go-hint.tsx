'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Kbd } from './kbd';
import { NAV_LINKS, NOTIFICATIONS_LINK } from './nav-items';

/** Dica que aparece após pressionar "g": mostra as teclas que completam a sequência. */
export function GoHint({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          className="fixed bottom-6 left-1/2 z-50 hidden -translate-x-1/2 items-center gap-4 rounded-xl bg-brand-secondary px-4 py-2.5 text-sm text-white shadow-xl md:flex"
        >
          <span className="flex items-center gap-1.5 text-white/60"><Kbd>G</Kbd> então</span>
          {[...NAV_LINKS, NOTIFICATIONS_LINK].map((l) => (
            <span key={l.id} className="flex items-center gap-1.5">
              <Kbd>{l.goKey.toUpperCase()}</Kbd> {l.label}
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
