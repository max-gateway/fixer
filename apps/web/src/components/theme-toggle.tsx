'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemePref } from '@/lib/theme';

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

/** Seletor de tema em três posições; a pílula desliza até a opção escolhida. */
export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { pref, setPref } = useTheme();
  const reduce = useReducedMotion();
  return (
    <div role="radiogroup" aria-label="Tema" className={cn('grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5', className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const on = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={compact ? label : undefined}
            title={compact ? label : undefined}
            onClick={() => setPref(value)}
            className={cn(
              'relative flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {on && (
              <motion.span
                layoutId="theme-pill"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-md bg-card shadow-xs ring-1 ring-border"
              />
            )}
            <Icon className="relative size-3.5" />
            {!compact && <span className="relative">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
