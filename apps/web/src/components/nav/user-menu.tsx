'use client';

import { Bell, Building2, ChevronDown, Command, KeyRound, LogOut, Repeat, Search, Settings } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { useInbox } from '@/components/notifications/inbox-provider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Kbd } from './kbd';
import { ACCESS_LINK, NOTIFICATIONS_LINK, SETTINGS_LINK } from './nav-items';
import { UserAvatar, type NavUser } from './user-avatar';

type Props = {
  user: NavUser;
  org?: { name: string; canSwitch: boolean } | null;
  signOutAction: () => Promise<void>;
  onOpenPalette: () => void;
};

/**
 * Área do usuário: avatar com anel em gradiente que gira ao abrir, indicador de conexão em tempo real
 * e um card de conta com atalhos úteis e saída.
 */
export function UserMenu({ user, org, signOutAction, onOpenPalette }: Props) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const { live, unreadCount } = useInbox();
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          aria-label={`Conta de ${user.name}`}
          whileTap={reduce ? undefined : { scale: 0.96 }}
          className="group flex h-10 items-center gap-2 rounded-full py-1 pr-1 pl-1 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent md:pr-3"
        >
          <span className="relative grid size-9 place-items-center">
            {/* Anel cônico na cor da marca; gira devagar quando o menu está aberto ou sob o cursor. */}
            <span
              aria-hidden
              className={`absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,var(--brand-primary),#60a5fa,var(--brand-primary))] transition-opacity group-hover:opacity-100 group-data-[state=open]:opacity-100 ${
                reduce ? 'opacity-90' : 'opacity-70 group-hover:animate-[spin_3s_linear_infinite] group-data-[state=open]:animate-[spin_3s_linear_infinite]'
              }`}
            />
            <span className="absolute inset-[2px] rounded-full bg-background" />
            <UserAvatar name={user.name} className="relative size-[30px]" />
            <span
              aria-hidden
              title={live ? 'Tempo real ativo' : 'Sem tempo real'}
              className={`absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background ${live ? 'bg-emerald-400' : 'bg-amber-400'}`}
            >
              {live && !reduce && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />}
            </span>
          </span>
          <span className="hidden max-w-28 truncate text-sm font-medium md:block">{firstName}</span>
          <ChevronDown className="hidden size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 md:block" />
        </motion.button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={10} className="w-72 gap-0 overflow-hidden rounded-2xl p-0 shadow-xl">
        <div className="relative px-4 pt-4 pb-3">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-16 bg-[radial-gradient(120%_140%_at_0%_0%,var(--brand-primary),transparent_70%),linear-gradient(120deg,var(--brand-secondary),color-mix(in_oklab,var(--brand-secondary)_70%,var(--brand-primary)))] opacity-95"
          />
          <div className="relative flex items-end gap-3 pt-5">
            <UserAvatar name={user.name} className="size-14 text-lg ring-4 ring-popover" />
            <div className="min-w-0 pb-0.5">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              {user.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
            </div>
          </div>
          <p
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              live ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
            }`}
          >
            <span className={`size-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {live ? 'Tempo real ativo' : 'Atualizando periodicamente'}
          </p>
        </div>

        {org && (
          <div className="border-t p-1.5">
            <p className="flex h-9 items-center gap-2.5 px-2.5 text-sm">
              <Building2 className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium" title={org.name}>
                {org.name}
              </span>
            </p>
            {org.canSwitch && (
              // Link comum (não client-side): a página seguinte decide a oficina e recarrega tudo.
              <a href="/organizacoes" className={ROW}>
                <Repeat /> Trocar de oficina
              </a>
            )}
          </div>
        )}

        <div className="border-t p-1.5">
          <MenuLink href={NOTIFICATIONS_LINK.href} onClick={() => setOpen(false)}>
            <Bell /> Notificações
            {unreadCount > 0 && (
              <span className="ml-auto rounded-full bg-brand px-1.5 py-px text-[11px] font-semibold text-white tabular">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </MenuLink>
          <MenuLink href={SETTINGS_LINK.href} onClick={() => setOpen(false)}>
            <Settings /> {SETTINGS_LINK.label}
          </MenuLink>
          <MenuLink href={ACCESS_LINK.href} onClick={() => setOpen(false)}>
            <KeyRound /> {ACCESS_LINK.label}
          </MenuLink>
          <MenuButton
            onClick={() => {
              setOpen(false);
              onOpenPalette();
            }}
          >
            <Search /> Buscar e atalhos
            <Kbd className="ml-auto text-muted-foreground">
              <Command className="size-3" />K
            </Kbd>
          </MenuButton>
        </div>

        <form action={signOutAction} className="border-t p-1.5">
          <button
            type="submit"
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-destructive outline-none transition-colors hover:bg-red-50 focus-visible:bg-red-50 [&_svg]:size-4"
          >
            <LogOut /> Sair
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

const ROW =
  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground';

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onClick} className={ROW}>
      {children}
    </Link>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={ROW}>
      {children}
    </button>
  );
}
