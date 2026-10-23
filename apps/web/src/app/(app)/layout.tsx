import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth, signOut } from '@/auth';
import { CertificateBanner } from '@/components/certificate-banner';
import { AppShell, SIDEBAR_COOKIE } from '@/components/nav/app-shell';
import { InboxProvider } from '@/components/notifications/inbox-provider';
import { QueryProvider } from '@/components/query-provider';
import { apiGet } from '@/lib/api';
import { getBranding } from '@/lib/branding';
import type { CertificateAlert } from '@/lib/certificate-alert';
import { getOrgContext, listOrganizations, orgLabel } from '@/lib/org-server';

/**
 * Alerta de vencimento do certificado. Informativo: se a API recusar (sem permissão `fiscal.manage`, plano sem fiscal)
 * ou estiver fora do ar, a página abre normalmente, só sem o banner.
 */
async function loadCertificateAlert(): Promise<CertificateAlert | null> {
  try {
    return (await apiGet<{ alert: CertificateAlert | null }>('/fiscal/certificate-alert')).alert;
  } catch {
    return null;
  }
}

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
  const certAlert = ctx.active ? await loadCertificateAlert() : null;
  const defaultCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'rail';
  const user = session?.user ? { name: session.user.name ?? session.user.email ?? 'Usuário', email: session.user.email } : null;
  return (
    <QueryProvider>
      <InboxProvider>
        <a
          href="#conteudo"
          className="sr-only z-50 rounded-lg bg-card px-3 py-2 text-sm font-medium text-slate-900 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Pular para o conteúdo
        </a>
        <AppShell
          brand={{ name: b.displayName, logoUrl: b.logoUrl }}
          user={user}
          org={org}
          signOutAction={signOutAction}
          defaultCollapsed={defaultCollapsed}
          banner={certAlert && ctx.active ? <CertificateBanner alert={certAlert} orgId={ctx.active} /> : null}
        >
          {children}
        </AppShell>
      </InboxProvider>
    </QueryProvider>
  );
}
