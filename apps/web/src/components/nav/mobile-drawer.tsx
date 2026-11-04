'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Dialog } from 'radix-ui';
import { SidebarContent, type SidebarProps } from './sidebar';

type Props = Omit<SidebarProps, 'collapsed' | 'id' | 'onToggle' | 'onNavigate'> & { open: boolean; onOpenChange: (o: boolean) => void };

/** Menu completo no celular: gaveta que entra pela esquerda (arraste para o lado ou toque fora para fechar). */
export function MobileDrawer({ open, onOpenChange, ...props }: Props) {
  const reduce = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.2 }}
                className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm md:hidden"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.aside
                initial={reduce ? false : { x: '-100%' }}
                animate={{ x: 0 }}
                exit={reduce ? { opacity: 0 } : { x: '-100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                drag={reduce ? false : 'x'}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.4, right: 0 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -80 || info.velocity.x < -500) onOpenChange(false);
                }}
                className="fixed inset-y-0 left-0 z-50 w-[min(20rem,86vw)] rounded-r-3xl bg-brand-secondary shadow-2xl outline-none md:hidden"
              >
                <Dialog.Title className="sr-only">Menu</Dialog.Title>
                <SidebarContent {...props} collapsed={false} id="drawer" onNavigate={() => onOpenChange(false)} />
                <Dialog.Close
                  aria-label="Fechar menu"
                  className="absolute top-3.5 right-3 grid size-9 place-items-center rounded-lg text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <X className="size-5" />
                </Dialog.Close>
              </motion.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
