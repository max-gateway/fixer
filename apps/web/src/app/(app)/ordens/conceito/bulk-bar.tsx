'use client';

import { ArrowRightLeft, MessageCircle, UserRoundCog, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { UserAvatar } from '@/components/nav/user-avatar';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import { brl0, MECHANICS, orderTotal, TRANSITIONS, type MockOrder } from './mock-data';

type Props = {
  selected: MockOrder[];
  onClear: () => void;
  onMove: (to: OrderStatus) => void;
  onAssign: (mechanicId: string) => void;
  onNotify: () => void;
};

/** Barra flutuante da seleção. Só oferece o status para onde TODAS as ordens marcadas podem ir. */
export function BulkBar({ selected, onClear, onMove, onAssign, onNotify }: Props) {
  const reduce = useReducedMotion();
  const common = (Object.keys(STATUS_LABEL) as OrderStatus[]).filter((s) => selected.length > 0 && selected.every((o) => TRANSITIONS[o.status].includes(s)));
  const total = selected.reduce((n, o) => n + orderTotal(o), 0);

  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          role="toolbar"
          aria-label="Ações para as ordens selecionadas"
          initial={reduce ? false : { y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? undefined : { y: 24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-fit flex-wrap items-center gap-2 rounded-2xl border bg-slate-900 p-2 pl-4 text-white shadow-2xl sm:bottom-6"
        >
          <span className="tabular text-sm font-semibold" aria-live="polite">
            {selected.length} {selected.length === 1 ? 'selecionada' : 'selecionadas'}
            <span className="ml-2 font-normal text-slate-400 max-sm:hidden">{brl0(total)}</span>
          </span>

          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="secondary" disabled={common.length === 0} title={common.length === 0 ? 'As ordens marcadas estão em etapas sem destino em comum' : undefined}>
                <ArrowRightLeft aria-hidden /> Mover para
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-52 p-0">
              <Command>
                <CommandList>
                  <CommandGroup>
                    {common.map((s) => (
                      <CommandItem key={s} value={STATUS_LABEL[s]} onSelect={() => onMove(s)}>
                        {STATUS_LABEL[s]}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="secondary">
                <UserRoundCog aria-hidden /> Atribuir
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-56 p-0">
              <Command>
                <CommandList>
                  <CommandGroup>
                    {MECHANICS.map((m) => (
                      <CommandItem key={m.id} value={m.name} onSelect={() => onAssign(m.id)}>
                        <UserAvatar name={m.name} className="size-5 text-[9px]" /> {m.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Button size="sm" variant="secondary" onClick={onNotify}>
            <MessageCircle aria-hidden /> Avisar
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Limpar seleção" onClick={onClear} className="text-slate-300 hover:bg-white/10 hover:text-white">
            <X aria-hidden />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
