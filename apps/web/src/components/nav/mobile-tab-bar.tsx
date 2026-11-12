'use client';

import { Menu, Plus } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useInbox } from '@/components/notifications/inbox-provider';
import { activeLinkId, NAV_ACTIONS, NAV_LINKS, type NavLink } from './nav-items';

const LEFT = NAV_LINKS.slice(0, 2);
// A barra tem 5 vagas (2 + botão central + 2): links marcados `mobile: false` ficam de fora.
// O resto vive na gaveta ("Menu").
const RIGHT = NAV_LINKS.slice(2).filter((l) => l.mobile !== false).slice(0, 1);
const NEW_ORDER = NAV_ACTIONS[0]!;

/** Barra flutuante para o polegar: some ao rolar para baixo, volta ao rolar para cima; "Nova OS" é o botão central. */
export function MobileTabBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const active = activeLinkId(pathname);
  const { unreadCount } = useInbox();
  const [hidden, setHidden] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (v) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(v > prev && v > 120);
  });

  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 500, damping: 34 };

  return (
    <motion.nav
      aria-label="Principal"
      animate={{ y: hidden ? 'calc(100% + 24px)' : 0 }}
      transition={spring}
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 md:hidden"
    >
      <LayoutGroup id="tabbar">
        <ul className="grid grid-cols-5 items-center rounded-2xl border border-white/10 bg-brand-secondary/90 p-1.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.5)] backdrop-blur-xl">
          {LEFT.map((l) => (
            <Tab key={l.id} link={l} active={l.id === active} spring={spring} />
          ))}
          <li className="flex justify-center">
            <motion.div whileTap={reduce ? undefined : { scale: 0.88 }} whileHover={reduce ? undefined : { y: -2 }}>
              <Link
                href={NEW_ORDER.href}
                aria-label={NEW_ORDER.label}
                className="-mt-7 grid size-14 place-items-center rounded-full bg-brand text-white shadow-lg shadow-black/30 ring-4 ring-background outline-none focus-visible:ring-white"
              >
                <Plus className="size-6" strokeWidth={2.5} />
              </Link>
            </motion.div>
          </li>
          {RIGHT.map((l) => (
            <Tab key={l.id} link={l} active={l.id === active} spring={spring} />
          ))}
          <li>
            <button
              type="button"
              onClick={onOpenMenu}
              aria-label={unreadCount > 0 ? `Menu: ${unreadCount} notificações não lidas` : 'Menu'}
              className="relative flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-white/55 outline-none transition-colors active:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <span className="relative">
                <Menu className="size-5" />
                {unreadCount > 0 && <span aria-hidden className="absolute -top-0.5 -right-1 size-2 rounded-full bg-brand ring-2 ring-brand-secondary" />}
              </span>
              <span>Menu</span>
            </button>
          </li>
        </ul>
      </LayoutGroup>
    </motion.nav>
  );
}

function Tab({ link, active, spring, badge = 0 }: { link: NavLink; active: boolean; spring: object; badge?: number }) {
  const Icon = link.icon;
  return (
    <li>
      <Link
        href={link.href}
        aria-current={active ? 'page' : undefined}
        aria-label={badge > 0 ? `${link.label}: ${badge} não lidas` : link.label}
        className={`relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
          active ? 'text-white' : 'text-white/55'
        }`}
      >
        {active && <motion.span layoutId="tab-pill" transition={spring} className="absolute inset-0 rounded-xl bg-white/[0.12]" />}
        <span className="relative">
          <Icon className="size-5" />
          <AnimatePresence>
            {badge > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-white tabular ring-2 ring-brand-secondary"
              >
                {badge > 9 ? '9+' : badge}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="relative">{link.label}</span>
      </Link>
    </li>
  );
}
