'use client';

import { Building2, ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Repeat, Search } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useInbox } from '@/components/notifications/inbox-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd } from './kbd';
import { activeLinkId, NAV_ACTIONS, NAV_GROUPS, type NavLink } from './nav-items';

const GROUPS_KEY = 'fixer:nav-groups';
const newOrder = NAV_ACTIONS[0]!;

export type SidebarProps = {
  brand: { name: string; logoUrl?: string | null; iconUrl?: string | null; logoHasName?: boolean };
  org?: { name: string; canSwitch: boolean } | null;
  /** Modo trilho: só ícones, com dica ao lado. Na gaveta do celular é sempre false. */
  collapsed: boolean;
  /** `layoutId` precisa ser único por instância (sidebar fixa e gaveta podem coexistir). */
  id: string;
  mod: string;
  onToggle?: () => void;
  onOpenPalette: () => void;
  /** Chamado ao navegar (a gaveta se fecha). */
  onNavigate?: () => void;
};

/**
 * Conteúdo do menu lateral: marca, oficina, ação principal, grupos recolhíveis, busca e recolher.
 * A pílula desliza até o item ativo (layoutId) e os grupos lembram se estavam abertos.
 */
export function SidebarContent({ brand, org, collapsed, id, mod, onToggle, onOpenPalette, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const { unreadCount } = useInbox();
  const active = activeLinkId(pathname);
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 500, damping: 38 };

  // Grupos fechados pelo usuário. Lê do localStorage depois de montar para não divergir do HTML do servidor.
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]');
      if (Array.isArray(raw)) setClosed(raw.filter((x): x is string => typeof x === 'string'));
    } catch {
      /* sem storage: todos abertos */
    }
  }, []);
  const toggleGroup = (gid: string) =>
    setClosed((prev) => {
      const next = prev.includes(gid) ? prev.filter((g) => g !== gid) : [...prev, gid];
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* ignora */
      }
      return next;
    });

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-white">
      {/* Hexágono do logo em marca d'água no rodapé: textura sem cor. */}
      <svg aria-hidden viewBox="0 0 100 115" className="pointer-events-none absolute -right-16 -bottom-20 w-64 text-white/[0.035]">
        <path d="M50 2 98 29.5v56L50 113 2 85.5v-56Z" fill="none" stroke="currentColor" strokeWidth="6" />
      </svg>

      <div className={`relative flex h-16 shrink-0 items-center gap-2.5 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
        <Link
          href="/"
          onClick={onNavigate}
          aria-label={`${brand.name}: ir para o painel`}
          className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {brand.logoUrl && brand.logoHasName ? (
            // Logo com o nome escrito: no trilho recolhido vira só o símbolo.
            <img src={collapsed && brand.iconUrl ? brand.iconUrl : brand.logoUrl} alt="" className={collapsed ? 'size-9 shrink-0' : 'h-9 w-auto shrink-0'} />
          ) : brand.logoUrl ? (
            <img src={brand.logoUrl} alt="" className="h-8 w-auto shrink-0" />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold">
              {brand.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          {!collapsed && !brand.logoHasName && <span className="truncate text-lg font-semibold tracking-tight">{brand.name}</span>}
        </Link>
      </div>

      <div className={`relative flex flex-col gap-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        {org && !collapsed && (
          <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] p-2 ring-1 ring-white/[0.08]">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10">
              <Building2 className="size-4 text-white/80" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-none text-white/50">Oficina</p>
              <p className="mt-1 truncate text-sm leading-none font-medium" title={org.name}>
                {org.name}
              </p>
            </div>
            {org.canSwitch && (
              // Link comum (não client-side): a página seguinte decide a oficina e recarrega tudo.
              <a
                href="/organizacoes"
                aria-label="Trocar de oficina"
                title="Trocar de oficina"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <Repeat className="size-4" />
              </a>
            )}
          </div>
        )}

        <RailTip label={newOrder.label} hint={newOrder.key} enabled={collapsed}>
          <motion.div whileTap={reduce ? undefined : { scale: 0.97 }}>
            <Link
              href={newOrder.href}
              onClick={onNavigate}
              aria-label={newOrder.label}
              className={`btn-glow flex h-10 items-center rounded-xl text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                collapsed ? 'justify-center' : 'gap-2 px-3'
              }`}
            >
              <Plus className="size-4.5" strokeWidth={2.5} />
              {!collapsed && (
                <>
                  <span>{newOrder.short}</span>
                  {newOrder.key && <Kbd className="ml-auto text-white/80">{newOrder.key.toUpperCase()}</Kbd>}
                </>
              )}
            </Link>
          </motion.div>
        </RailTip>
      </div>

      <LayoutGroup id={id}>
        <nav aria-label="Principal" className={`relative mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-4 [scrollbar-width:thin] ${collapsed ? 'px-2' : 'px-3'}`}>
          {NAV_GROUPS.map((group, gi) => {
            const hasActive = group.items.some((l) => l.id === active);
            // O grupo da página atual nunca fica escondido, para a pessoa sempre ver onde está.
            const open = collapsed || hasActive || !closed.includes(group.id);
            return (
              <section key={group.id} aria-label={group.label} className={gi > 0 ? 'mt-2' : ''}>
                {collapsed ? (
                  gi > 0 && <div aria-hidden className="mx-3 mb-2 h-px bg-white/10" />
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={open}
                    disabled={hasActive}
                    className="group/label flex h-7 w-full items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold tracking-[0.12em] text-white/35 uppercase outline-none transition-colors hover:text-white/75 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-default disabled:hover:text-white/35"
                  >
                    {group.label}
                    <ChevronDown className={`ml-auto size-3.5 opacity-0 transition-[transform,opacity] group-hover/label:opacity-100 group-focus-visible/label:opacity-100 ${open ? '' : '-rotate-90 opacity-100'}`} />
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.ul
                      key="items"
                      initial={reduce ? false : { height: 0, opacity: 0, overflow: 'hidden' }}
                      animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
                      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, overflow: 'hidden' }}
                      transition={{ duration: reduce ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }}
                      className="flex flex-col gap-0.5"
                    >
                      {group.items.map((link) => (
                        <Item
                          key={link.id}
                          link={link}
                          active={link.id === active}
                          collapsed={collapsed}
                          spring={spring}
                          badge={link.id === 'notificacoes' ? unreadCount : 0}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </section>
            );
          })}
        </nav>
      </LayoutGroup>

      <div className={`relative flex shrink-0 flex-col gap-1 border-t border-white/10 py-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        <RailTip label="Buscar ou ir para" hint={`${mod}K`} enabled={collapsed}>
          <button type="button" onClick={onOpenPalette} aria-label="Buscar ou ir para" className={FOOT_BTN(collapsed)}>
            <Search className="size-4" />
            {!collapsed && (
              <>
                <span>Buscar ou ir para…</span>
                <Kbd className="ml-auto text-white/60">{mod}K</Kbd>
              </>
            )}
          </button>
        </RailTip>
        {onToggle && (
          <RailTip label={collapsed ? 'Expandir menu' : 'Recolher menu'} hint="[" enabled={collapsed}>
            <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!collapsed} className={FOOT_BTN(collapsed)}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed && (
                <>
                  <span>Recolher menu</span>
                  <Kbd className="ml-auto text-white/60">[</Kbd>
                </>
              )}
            </button>
          </RailTip>
        )}
      </div>
    </div>
  );
}

const FOOT_BTN = (collapsed: boolean) =>
  `flex h-9 w-full items-center rounded-lg text-sm text-white/60 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 ${
    collapsed ? 'justify-center' : 'gap-2.5 px-2.5'
  }`;

function Item({
  link,
  active,
  collapsed,
  spring,
  badge,
  onNavigate,
}: {
  link: NavLink;
  active: boolean;
  collapsed: boolean;
  spring: object;
  badge: number;
  onNavigate?: () => void;
}) {
  const Icon = link.icon;
  const label = badge > 0 ? `${link.label}: ${badge} não lidas` : link.label;
  return (
    <li>
      <RailTip label={link.label} hint={`G ${link.goKey.toUpperCase()}`} enabled={collapsed}>
        <Link
          href={link.href}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          className={`group/item relative flex h-10 items-center rounded-xl text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
            collapsed ? 'justify-center' : 'gap-3 px-2.5'
          } ${active ? 'text-white' : 'text-white/55 hover:bg-white/[0.05] hover:text-white'}`}
        >
          {active && (
            <>
              <motion.span layoutId="side-pill" transition={spring} className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/[0.06]" />
              <motion.span
                layoutId="side-bar"
                transition={spring}
                className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-full bg-brand"
              />
            </>
          )}
          <span className="relative">
            <Icon className={`size-[18px] transition-transform duration-200 group-hover/item:scale-110 ${active ? 'text-white' : ''}`} />
            {collapsed && badge > 0 && <span aria-hidden className="absolute -top-1 -right-1 size-2 rounded-full bg-brand ring-2 ring-brand-secondary" />}
          </span>
          {!collapsed && <span className="relative truncate">{link.label}</span>}
          <AnimatePresence>
            {!collapsed && badge > 0 && (
              <motion.span
                aria-hidden
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="relative ml-auto rounded-full bg-brand px-1.5 py-px text-[11px] leading-4 font-semibold text-white tabular"
              >
                {badge > 99 ? '99+' : badge}
              </motion.span>
            )}
          </AnimatePresence>
          {!collapsed && badge === 0 && (
            <Kbd className="relative ml-auto text-white/40 opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-visible/item:opacity-100">
              G {link.goKey.toUpperCase()}
            </Kbd>
          )}
        </Link>
      </RailTip>
    </li>
  );
}

/** Dica ao lado do ícone quando o menu está recolhido; fora disso, só repassa o filho. */
function RailTip({ label, hint, enabled, children }: { label: string; hint?: string; enabled: boolean; children: React.ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={12} className="flex items-center gap-2">
        {label}
        {hint && <Kbd className="text-background/70">{hint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
