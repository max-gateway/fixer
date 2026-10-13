import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth, signOut } from '@/auth';
import { AppHeader } from '@/components/nav/app-header';
import { InboxProvider } from '@/components/notifications/inbox-provider';
import { QueryProvider } from '@/components/query-provider';
import { getBranding } from '@/lib/branding';
import { getOrgContext, listOrganizations, orgLabel } from '@/lib/org-server';

async function signOutAction() {
  'use server';
  await signOut();
}

// Área interna da oficina (exige login via proxy.ts). O portal do cliente fica em /o/[token].
export default async function AppLayout({ children }: { children: ReactNode }) {
  const b = getBranding();
  const session = await auth();
  // Multi-tenant: quem participa de mais de uma oficina precisa escolher antes de ver qualquer dado.
  const ctx = await getOrgContext();
  if (ctx.needsChoice) redirect('/organizacoes');
  const current = ctx.active ? (await listOrganizations()).find((o) => o.id === ctx.active) : undefined;
  const org = ctx.active ? { name: current ? orgLabel(current) : `Oficina ${ctx.active.slice(0, 8)}`, canSwitch: ctx.orgs.length > 1 } : null;
  const user = session?.user ? { name: session.user.name ?? session.user.email ?? 'Usuário', email: session.user.email } : null;
  return (
    <QueryProvider>
      <InboxProvider>
        <a
          href="#conteudo"
          className="sr-only z-50 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Pular para o conteúdo
        </a>
        <AppHeader brand={{ name: b.displayName, logoUrl: b.logoUrl }} user={user} org={org} signOutAction={signOutAction} />
        {/* pb-28 no mobile abre espaço para a tab bar flutuante */}
        <main id="conteudo" className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 sm:py-8 md:pb-8">
          {children}
        </main>
      </InboxProvider>
    </QueryProvider>
  );
}
