'use client';

import { Menu, Search } from 'lucide-react';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CommandPalette } from './command-palette';
import { GoHint } from './go-hint';
import { Kbd } from './kbd';
import { MobileDrawer } from './mobile-drawer';
import { MobileTabBar } from './mobile-tab-bar';
import { ALL_LINKS, activeLinkId } from './nav-items';
import { SidebarContent } from './sidebar';
import { useNavShortcuts } from './use-nav-shortcuts';
import type { NavUser } from './user-avatar';
import { UserMenu } from './user-menu';

/** Cookie lido no servidor (layout) para a sidebar já nascer no estado certo, sem piscar. */
export const SIDEBAR_COOKIE = 'fixer-sidebar';

const W_OPEN = '17rem';
const W_RAIL = '4.75rem';

type Props = {
  brand: { name: string; logoUrl?: string | null; iconUrl?: string | null; logoHasName?: boolean };
  user: NavUser | null;
  /** Oficina em uso (multi-tenant). `canSwitch`: o usuário participa de mais de uma. */
  org?: { name: string; canSwitch: boolean } | null;
  defaultCollapsed?: boolean;
  /** Faixa de aviso entre a barra do topo e o conteúdo (ex.: certificado vencendo). */
  banner?: ReactNode;
  children: ReactNode;
};

/**
 * Estrutura da área interna: menu lateral recolhível (desktop) ou gaveta + tab bar (celular),
 * barra superior com contexto, busca (⌘K), sino e conta, e o conteúdo da página.
 */
export function AppShell({ brand, user, org, defaultCollapsed = false, banner, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mod, setMod] = useState('Ctrl');

  const { scrollY, scrollYProgress } = useScroll();
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 8));
  const progress = useSpring(scrollYProgress, { stiffness: 220, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod('⌘');
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      document.cookie = `${SIDEBAR_COOKIE}=${c ? 'open' : 'rail'}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  }, []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);

  const goPending = useNavShortcuts({
    navigate: useCallback((href: string) => router.push(href), [router]),
    togglePalette: useCallback(() => setPaletteOpen((o) => !o), []),
    openPalette,
    toggleSidebar,
  });

  const current = ALL_LINKS.find((l) => l.id === activeLinkId(pathname));
  const CurrentIcon = current?.icon;

  return (
    <TooltipProvider delayDuration={120}>
      <div style={{ '--sbw': collapsed ? W_RAIL : W_OPEN } as React.CSSProperties}>
        <aside
          aria-label="Menu lateral"
          className="fixed inset-y-0 left-0 z-40 hidden w-(--sbw) border-r border-white/[0.06] bg-brand-secondary transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:block"
        >
          <SidebarContent
            brand={brand}
            org={org}
            collapsed={collapsed}
            id="sidebar"
            mod={mod}
            onToggle={toggleSidebar}
            onOpenPalette={openPalette}
          />
        </aside>

        <div className="transition-[padding] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:pl-(--sbw)">
          <header
            className={`sticky top-0 z-30 border-b transition-[background-color,box-shadow,border-color] duration-200 ${
              scrolled ? 'border-border bg-background/75 backdrop-blur-xl backdrop-saturate-150' : 'border-transparent bg-transparent'
            }`}
          >
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
              <Button variant="ghost" size="icon" aria-label="Abrir menu" onClick={() => setDrawerOpen(true)} className="-ml-2 md:hidden">
                <Menu />
              </Button>

              {/* Onde estou: o título acompanha a navegação com um deslize curto. */}
              <div className="min-w-0">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={current?.id ?? 'home'}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                    transition={{ duration: 0.14 }}
                    className="flex items-center gap-2"
                  >
                    {CurrentIcon && (
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card text-brand ring-1 ring-border">
                        <CurrentIcon className="size-4" />
                      </span>
                    )}
                    <h2 className="truncate text-base font-semibold tracking-tight">{current?.label ?? brand.name}</h2>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={openPalette}
                  aria-label="Buscar ou ir para"
                  className="group hidden h-9 w-56 items-center gap-2 rounded-lg bg-card/70 px-3 shadow-xs text-sm text-muted-foreground ring-1 ring-border transition-[color,box-shadow] outline-none hover:text-foreground hover:ring-input focus-visible:ring-2 focus-visible:ring-ring lg:flex xl:w-72"
                >
                  <Search className="size-4" />
                  <span>Buscar ou ir para…</span>
                  <Kbd className="ml-auto">{mod}K</Kbd>
                </button>
                <Button variant="ghost" size="icon" aria-label="Buscar ou ir para" onClick={openPalette} className="lg:hidden">
                  <Search />
                </Button>
                <NotificationBell />
                {user && <UserMenu user={user} org={org} onOpenPalette={openPalette} />}
              </div>
            </div>

            <motion.div
              aria-hidden
              style={{ scaleX: reduce ? scrollYProgress : progress }}
              className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand transition-opacity ${scrolled ? 'opacity-100' : 'opacity-0'}`}
            />
          </header>

          {banner}
          {/* pb-28 no mobile abre espaço para a tab bar flutuante */}
          <main id="conteudo" className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 sm:py-8 md:pb-8">
            {children}
          </main>
        </div>
      </div>

      <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} brand={brand} org={org} mod={mod} onOpenPalette={() => (setDrawerOpen(false), openPalette())} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <GoHint show={goPending} />
      <MobileTabBar onOpenMenu={() => setDrawerOpen(true)} />
    </TooltipProvider>
  );
}
