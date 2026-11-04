'use client';

import { Building2, KeyRound, Landmark, Library, Tags } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/configuracoes', label: 'Oficina', icon: Building2, exact: true },
  { href: '/configuracoes/tributario', label: 'Tributário', icon: Landmark, exact: false },
  { href: '/configuracoes/precificacao', label: 'Precificação', icon: Tags, exact: false },
  { href: '/configuracoes/catalogo', label: 'Catálogo', icon: Library, exact: false },
  { href: '/configuracoes/acessos', label: 'Acessos', icon: KeyRound, exact: false },
] as const;

/** Seções das configurações. Rola na horizontal no celular em vez de quebrar a linha. */
export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Seções das configurações" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1 sm:w-auto">
        {SECTIONS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
