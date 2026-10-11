'use client';

import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { isActive, NAV_LINKS } from './nav-items';

/**
 * Navegação do header: uma "pílula" desliza até o item ativo (layoutId), um segundo realce segue o cursor
 * e a barra de brilho na cor da marca marca a página atual.
 */
export function DesktopNav() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 480, damping: 36 };

  return (
    <LayoutGroup id="desktop-nav">
      <nav aria-label="Principal" className="hidden items-center gap-1 md:flex" onMouseLeave={() => setHovered(null)}>
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link);
          const Icon = link.icon;
          return (
            <Link
              key={link.id}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              onMouseEnter={() => setHovered(link.id)}
              onFocus={() => setHovered(link.id)}
              className={`relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
                active ? 'text-white' : 'text-white/65 hover:text-white'
              }`}
            >
              {hovered === link.id && !active && (
                <motion.span layoutId="nav-hover" transition={spring} className="absolute inset-0 rounded-lg bg-white/[0.07]" />
              )}
              {active && (
                <>
                  <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-lg bg-white/[0.12] ring-1 ring-white/10" />
                  <motion.span
                    layoutId="nav-glow"
                    transition={spring}
                    className="absolute -bottom-3.5 left-3 right-3 h-0.5 rounded-full bg-brand shadow-[0_0_14px_2px_var(--brand-primary)]"
                  />
                </>
              )}
              <Icon className="relative size-4" />
              <span className="relative">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
