'use client';

import { Plus, Search } from 'lucide-react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { CommandPalette } from './command-palette';
import { DesktopNav } from './desktop-nav';
import { GoHint } from './go-hint';
import { Kbd } from './kbd';
import { MobileTabBar } from './mobile-tab-bar';
import { NAV_ACTIONS } from './nav-items';
import { useNavShortcuts } from './use-nav-shortcuts';
import type { NavUser } from './user-avatar';
import { UserMenu } from './user-menu';

type Props = {
  brand: { name: string; logoUrl?: string | null };
  user: NavUser | null;
  /** Oficina em uso (multi-tenant). `canSwitch`: o usuário participa de mais de uma. */
  org?: { name: string; canSwitch: boolean } | null;
  signOutAction: () => Promise<void>;
};

/** Cabeçalho fixo da área interna: marca, navegação, busca (⌘K), ação principal, sino e conta. */
export function AppHeader({ brand, user, org, signOutAction }: Props) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mod, setMod] = useState('Ctrl');

  const { scrollY, scrollYProgress } = useScroll();
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 8));
  const progress = useSpring(scrollYProgress, { stiffness: 220, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod('⌘');
  }, []);

  const goPending = useNavShortcuts({
    navigate: useCallback((href: string) => router.push(href), [router]),
    togglePalette: useCallback(() => setPaletteOpen((o) => !o), []),
    openPalette: useCallback(() => setPaletteOpen(true), []),
  });
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const newOrder = NAV_ACTIONS[0]!;

  return (
    <>
      <header
        className={`sticky top-0 z-40 text-white transition-[background-color,box-shadow] duration-200 ${
          scrolled ? 'bg-brand-secondary/85 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.55)] backdrop-blur-xl' : 'bg-brand-secondary'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-8 w-auto" />}
            <span className="text-lg font-semibold tracking-tight">{brand.name}</span>
          </Link>

          <div className="ml-4 hidden md:block">
            <DesktopNav />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={openPalette}
              aria-label="Buscar ou ir para"
              className="group hidden h-9 w-56 items-center gap-2 rounded-lg bg-white/[0.08] px-3 text-sm text-white/60 ring-1 ring-white/10 transition-colors outline-none hover:bg-white/[0.13] hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/60 md:flex lg:w-64"
            >
              <Search className="size-4" />
              <span>Buscar ou ir para…</span>
              <Kbd className="ml-auto text-white/60">{mod}K</Kbd>
            </button>
            <Button variant="ghost" size="icon" aria-label="Buscar ou ir para" onClick={openPalette} className="text-white hover:bg-white/10 hover:text-white md:hidden">
              <Search />
            </Button>

            <motion.div whileTap={reduce ? undefined : { scale: 0.95 }} className="hidden md:block">
              <Button asChild size="sm" className="shadow-[0_6px_16px_-6px_var(--brand-primary)]">
                <Link href={newOrder.href}>
                  <Plus /> {newOrder.short}
                </Link>
              </Button>
            </motion.div>

            <div className="hidden md:block">
              <NotificationBell />
            </div>
            {user && <UserMenu user={user} org={org} signOutAction={signOutAction} onOpenPalette={openPalette} />}
          </div>
        </div>

        <motion.div
          aria-hidden
          style={{ scaleX: reduce ? scrollYProgress : progress }}
          className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand transition-opacity ${scrolled ? 'opacity-100' : 'opacity-0'}`}
        />
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} signOutAction={signOutAction} />
      <GoHint show={goPending} />
      <MobileTabBar />
    </>
  );
}
