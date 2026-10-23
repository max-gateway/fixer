'use client';

import { useEffect, useRef, useState } from 'react';
import { ALL_LINKS, NAV_ACTIONS } from './nav-items';

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

type Options = {
  navigate: (href: string) => void;
  togglePalette: () => void;
  openPalette: () => void;
  toggleSidebar?: () => void;
};

/**
 * Atalhos globais:
 *  - Ctrl/⌘ + K ou "/"  → paleta de comandos
 *  - g p / g o / g c / g n → Painel / Ordens / Clientes / Notificações
 *  - n → nova OS
 *  - [ → recolher/expandir a sidebar
 * Ignora quando o foco está em campo de texto. Retorna se a sequência "g" está pendente (para mostrar a dica).
 */
export function useNavShortcuts({ navigate, togglePalette, openPalette, toggleSidebar }: Options): boolean {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const opts = useRef({ navigate, togglePalette, openPalette, toggleSidebar });
  opts.current = { navigate, togglePalette, openPalette, toggleSidebar };

  useEffect(() => {
    const setP = (v: boolean) => {
      pendingRef.current = v;
      setPending(v);
      clearTimeout(timer.current);
      if (v) timer.current = setTimeout(() => setP(false), 1500);
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        opts.current.togglePalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      const k = e.key.toLowerCase();

      if (pendingRef.current) {
        const hit = ALL_LINKS.find((l) => l.goKey === k);
        setP(false);
        if (hit) {
          e.preventDefault();
          opts.current.navigate(hit.href);
        }
        return;
      }
      if (k === 'g') return setP(true);
      if (k === '[' && opts.current.toggleSidebar) {
        e.preventDefault();
        return opts.current.toggleSidebar();
      }
      if (k === '/') {
        e.preventDefault();
        return opts.current.openPalette();
      }
      const action = NAV_ACTIONS.find((a) => a.key === k);
      if (action) {
        e.preventDefault();
        opts.current.navigate(action.href);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer.current);
    };
  }, []);

  return pending;
}
