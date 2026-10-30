'use client';

import { CornerDownLeft, LogOut, Search, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Kbd } from './kbd';
import { ALL_LINKS, NAV_ACTIONS, normalize } from './nav-items';

type Command = {
  id: string;
  group: 'Ir para' | 'Ações' | 'Conta';
  label: string;
  icon: LucideIcon;
  keys?: string[];
  keywords: string[];
  run: () => void;
};

type Props = { open: boolean; onOpenChange: (o: boolean) => void };

/** Paleta de comandos (Ctrl/⌘ K): navegar, criar e sair sem tirar a mão do teclado. */
export function CommandPalette({ open, onOpenChange }: Props) {
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
                transition={{ duration: reduce ? 0 : 0.15 }}
                className="fixed inset-0 z-50 bg-brand-secondary/50 backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-3 pt-[10vh]">
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: -12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                  className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl"
                >
                  <Dialog.Title className="sr-only">Paleta de comandos</Dialog.Title>
                  <PaletteBody close={() => onOpenChange(false)} />
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** Logout é um POST em /logout (Keycloak encerra a sessão SSO e volta ao /login); sem server action. */
function signOut() {
  const f = document.createElement('form');
  f.method = 'post';
  f.action = '/logout';
  document.body.appendChild(f);
  f.submit();
}

function PaletteBody({ close }: { close: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    return [
      ...ALL_LINKS.map<Command>((l) => ({
        id: l.id, group: 'Ir para', label: l.label, icon: l.icon, keys: ['g', l.goKey], keywords: l.keywords, run: go(l.href),
      })),
      ...NAV_ACTIONS.map<Command>((a) => ({
        id: a.id, group: 'Ações', label: a.label, icon: a.icon, keys: a.key ? [a.key] : undefined, keywords: a.keywords, run: go(a.href),
      })),
      {
        id: 'sair', group: 'Conta', label: 'Sair', icon: LogOut, keywords: ['logout', 'encerrar sessao'],
        run: () => {
          close();
          signOut();
        },
      },
    ];
  }, [close, router]);

  const results = useMemo(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return commands;
    return commands.filter((c) => {
      const hay = normalize(`${c.label} ${c.keywords.join(' ')}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [commands, query]);

  const active = Math.min(index, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((active + 1) % Math.max(results.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((active - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <>
      <div className="flex items-center gap-3 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          placeholder="Para onde você quer ir?"
          className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <Kbd className="text-muted-foreground">Esc</Kbd>
      </div>

      <div ref={listRef} id="palette-list" role="listbox" className="max-h-[min(22rem,55vh)] overflow-y-auto p-2">
        {results.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            Nada encontrado para “{query}”.
          </p>
        )}
        {results.map((c, i) => {
          const header = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          const Icon = c.icon;
          const isActive = i === active;
          return (
            <div key={c.id}>
              {header && <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{header}</p>}
              <div
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={isActive}
                data-active={isActive}
                onMouseMove={() => i !== active && setIndex(i)}
                onClick={c.run}
                className={`relative flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium ${c.id === 'sair' ? 'text-destructive' : ''}`}
              >
                {isActive && (
                  <motion.span
                    layoutId="palette-active"
                    transition={{ type: 'spring', stiffness: 600, damping: 42 }}
                    className="absolute inset-0 rounded-lg bg-accent"
                  />
                )}
                <Icon className="relative size-4 text-muted-foreground" />
                <span className="relative">{c.label}</span>
                {c.keys && (
                  <span className="relative ml-auto flex items-center gap-1 text-muted-foreground">
                    {c.keys.map((k, n) => (
                      <Kbd key={n}>{k.toUpperCase()}</Kbd>
                    ))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 border-t bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
        <span className="flex items-center gap-1.5"><Kbd><CornerDownLeft className="size-3" /></Kbd> abrir</span>
      </div>
    </>
  );
}
