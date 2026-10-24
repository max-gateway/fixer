'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Search, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode, RefObject } from 'react';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';

const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const;

/**
 * Casca dos seletores de busca (peça do estoque, peça do catálogo): janela com o fundo desfocado, campo de busca, fio de progresso, lista
 * navegável (↑ ↓ Enter, o realce desliza entre as linhas) e, em telas largas, um painel opcional (`preview`) com a peça em foco.
 * Quem usa decide a busca e as linhas (`children`: `PickerRow`, `PickerNotice`, `PickerSkeleton`); aqui só vivem a moldura e o movimento.
 * O estado aberto/fechado fica com quem usa, que também põe o gatilho (`PickerTrigger`) dentro do mesmo `DialogPrimitive.Root`.
 */
export function SearchDialog({
  open,
  title,
  description,
  placeholder,
  text,
  onText,
  inputRef,
  busy,
  focusedValue,
  onFocusedValue,
  resultCount,
  preview,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  placeholder: string;
  text: string;
  onText: (text: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Há busca a caminho (digitando ou no ar): acende o fio de progresso. */
  busy: boolean;
  /** Valor (`CommandItem value`) da linha em foco. */
  focusedValue: string;
  onFocusedValue: (value: string) => void;
  resultCount: number;
  preview?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              initial={reduce ? false : { opacity: 0, backdropFilter: 'blur(0px)' }}
              animate={{ opacity: 1, backdropFilter: 'blur(10px)' }}
              exit={reduce ? undefined : { opacity: 0, backdropFilter: 'blur(0px)' }}
              transition={{ duration: 0.22, ease: EASE }}
              className="fixed inset-0 z-[60] bg-slate-950/40"
            />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content
            asChild
            forceMount
            onOpenAutoFocus={(e) => {
              // Foco no campo com o texto selecionado: digitar já troca a busca; Enter/↓ já navegam.
              e.preventDefault();
              inputRef.current?.focus();
              inputRef.current?.select();
            }}
          >
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.97, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.98, filter: 'blur(4px)' }}
              transition={reduce ? { duration: 0 } : { ...SPRING, filter: { duration: 0.2 }, opacity: { duration: 0.15 } }}
              className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full flex-col overflow-hidden rounded-t-2xl border bg-popover text-popover-foreground shadow-2xl outline-none sm:top-[10vh] sm:bottom-auto sm:w-[min(52rem,calc(100vw-2rem))] sm:rounded-2xl"
            >
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>

              <ProgressBar busy={busy} />
              <div className="flex min-h-0">
                {/* A busca é do servidor: o cmdk não filtra de novo (shouldFilter=false). */}
                <Command shouldFilter={false} loop value={focusedValue} onValueChange={onFocusedValue} className="min-w-0 flex-1 rounded-none bg-transparent">
                  <div className="flex items-center gap-3 border-b px-4">
                    <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <CommandPrimitive.Input
                      ref={inputRef}
                      value={text}
                      onValueChange={onText}
                      placeholder={placeholder}
                      className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
                    />
                    <DialogPrimitive.Close
                      aria-label="Fechar"
                      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <X aria-hidden className="size-4" />
                    </DialogPrimitive.Close>
                  </div>

                  <CommandList className="max-h-[min(26rem,55dvh)] min-h-56 p-1.5">{children}</CommandList>

                  <footer className="hidden items-center gap-4 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:flex">
                    <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
                    <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd> escolher</span>
                    <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> fechar</span>
                    {resultCount > 0 && <span className="tabular ml-auto">{resultCount} {resultCount === 1 ? 'resultado' : 'resultados'}</span>}
                  </footer>
                </Command>
                {preview}
              </div>
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

/** Uma linha da lista. O realce da linha em foco é um único elemento que desliza de uma linha para outra (`layoutId`). */
export function PickerRow({
  value,
  index,
  focused,
  chosen,
  lead,
  title,
  subtitle,
  onChoose,
}: {
  value: string;
  index: number;
  focused: boolean;
  chosen: boolean;
  /** Miniatura ou ícone à esquerda. */
  lead: ReactNode;
  title: string;
  subtitle: string;
  onChoose: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <CommandItem value={value} onSelect={onChoose} className="relative rounded-lg p-0 data-[selected=true]:bg-transparent">
      {focused && (
        <motion.span
          layoutId="picker-focus"
          aria-hidden
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
          className="absolute inset-0 rounded-lg bg-brand/10 ring-1 ring-brand/25"
        />
      )}
      <motion.span
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE, delay: Math.min(index, 8) * 0.025 }}
        className="relative flex w-full items-center gap-3 px-2 py-2"
      >
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        <AnimatePresence initial={false}>
          {chosen && (
            <motion.span
              initial={reduce ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-white"
              title="Marcada"
            >
              <Check aria-hidden className="size-3.5" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </CommandItem>
  );
}

export function PickerNotice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
      <span aria-hidden className="grid size-10 place-items-center rounded-full bg-muted [&>svg]:size-5">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

/** Esqueleto com a forma das linhas, para a primeira busca (as seguintes mantêm a lista anterior). */
export function PickerSkeleton() {
  return (
    <div role="presentation" className="space-y-1">
      <div aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <span className="skeleton size-12 rounded-md" />
            <span className="flex-1 space-y-2">
              <span className="skeleton block h-3.5 w-3/5 rounded" />
              <span className="skeleton block h-3 w-2/5 rounded" />
            </span>
          </div>
        ))}
      </div>
      <p className="sr-only" role="status">Buscando…</p>
    </div>
  );
}

/** Fio de luz no topo da janela enquanto há busca a caminho. */
function ProgressBar({ busy }: { busy: boolean }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {busy && (
        <motion.div aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand/15">
          <motion.div
            className="h-full w-1/3 rounded-full bg-brand"
            animate={reduce ? { x: '100%' } : { x: ['-100%', '300%'] }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
