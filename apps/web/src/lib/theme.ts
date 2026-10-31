'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Preferência de tema por navegador. "system" segue o sistema operacional e acompanha mudanças ao vivo.
export type ThemePref = 'light' | 'dark' | 'system';

export const THEME_KEY = 'fixer-theme';

/**
 * Roda no <head> antes da primeira pintura (layout raiz): aplica a classe `dark` sem piscar o tema errado.
 * Precisa ser autocontido: vira texto de <script>, sem acesso a imports.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;

const MEDIA = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  const dark = pref === 'dark' || (pref === 'system' && matchMedia(MEDIA).matches);
  // Desliga transições por um quadro: sem isso cada borda e fundo animaria a troca separadamente.
  root.classList.add('theme-switching');
  root.classList.toggle('dark', dark);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = matchMedia(MEDIA);
  const onSystem = () => {
    if (read() === 'system') apply('system');
    cb();
  };
  // Outra aba trocou o tema: acompanha.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    apply(read());
    cb();
  };
  mq.addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener('change', onSystem);
    window.removeEventListener('storage', onStorage);
  };
}

/** Preferência atual e como trocá-la. No servidor é sempre "system" (o script do <head> já aplicou a certa). */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, read, () => 'system' as const);
  const setPref = useCallback((next: ThemePref) => {
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* sem storage: vale só nesta página */
    }
    apply(next);
    listeners.forEach((l) => l());
  }, []);
  return { pref, setPref };
}
