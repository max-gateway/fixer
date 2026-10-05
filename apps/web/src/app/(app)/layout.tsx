import Link from 'next/link';
import type { ReactNode } from 'react';
import { auth, signOut } from '@/auth';
import { InboxProvider } from '@/components/notifications/inbox-provider';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { getBranding } from '@/lib/branding';

// Área interna da oficina (exige login via proxy.ts). O portal do cliente fica em /o/[token].
export default async function AppLayout({ children }: { children: ReactNode }) {
  const b = getBranding();
  const session = await auth();
  return (
    <InboxProvider>
        <header className="bg-brand-secondary text-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
            {b.logoUrl && <img src={b.logoUrl} alt="" className="h-8 w-auto" />}
            <span className="text-lg font-semibold">{b.displayName}</span>
            <nav className="ml-6 flex gap-4 text-sm">
              <Link href="/">Consulta de placa</Link>
              <Link href="/ordens">Ordens</Link>
              <Link href="/clientes">Clientes</Link>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <NotificationBell />
            {session?.user && (
              <form
                className="flex items-center gap-3 text-sm"
                action={async () => {
                  'use server';
                  await signOut();
                }}
              >
                <span>{session.user.name}</span>
                <button className="underline">Sair</button>
              </form>
            )}
            </div>
          </div>
        </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </InboxProvider>
  );
}
