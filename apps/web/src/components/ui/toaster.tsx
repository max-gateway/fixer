'use client';

import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'error' | 'info';
type ToastInput = {
  title: string;
  description?: string;
  tone?: Tone;
  /** Ação do aviso (ex.: "Desfazer"). Clicar executa e fecha. */
  action?: { label: string; onClick: () => void };
  /** ms até sumir; avisos com ação duram mais para dar tempo de desfazer. */
  duration?: number;
};
type Toast = ToastInput & { id: number };

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast fora do ToastProvider');
  return ctx;
}

/** Avisos efêmeros no canto inferior, anunciados por leitores de tela (aria-live). Pausam enquanto o mouse está em cima. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { ...t, id }]);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Avisos"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
      >
        {items.map((t) => (
          <ToastItem key={t.id} t={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ t, onDone }: { t: Toast; onDone: () => void }) {
  const [paused, setPaused] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => done.current(), t.duration ?? (t.action ? 8000 : 4500));
    return () => clearTimeout(id);
  }, [paused, t.duration, t.action]);

  const tone = t.tone ?? 'success';
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-xl border bg-card surface p-3.5 shadow-lg"
    >
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', tone === 'error' ? 'text-red-700' : tone === 'info' ? 'text-muted-foreground' : 'text-emerald-700')} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t.title}</p>
        {t.description && <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>}
      </div>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action!.onClick();
            onDone();
          }}
          className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-brand hover:bg-brand-soft focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t.action.label}
        </button>
      )}
      <button type="button" onClick={onDone} aria-label="Dispensar aviso" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
