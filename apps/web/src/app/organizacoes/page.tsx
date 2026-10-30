import { Building2, ChevronRight } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getBranding } from '@/lib/branding';
import { getOrgContext, listOrganizations, orgLabel } from '@/lib/org-server';

/** Quem participa de mais de uma oficina escolhe aqui em qual vai trabalhar (e volta aqui para trocar). */
export default async function OrganizationsPage() {
  const session = (await auth()) as { error?: string } | null;
  if (!session || session.error) redirect('/login');

  const { orgs, active } = await getOrgContext();
  // Uma oficina só (ou token legado): não há o que escolher.
  if (orgs.length <= 1) redirect('/');

  const b = getBranding();
  const list = await listOrganizations();

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          {b.logoUrl && <img src={b.logoUrl} alt={b.logoHasName ? b.displayName : ''} className={b.logoHasName ? 'h-14 w-auto rounded-lg bg-brand-secondary px-3' : 'h-9 w-auto'} />}
          {!b.logoHasName && <span className="text-xl font-bold text-slate-900">{b.displayName}</span>}
        </div>

        <h1 className="text-2xl font-bold text-slate-900">Qual oficina?</h1>
        <p className="mt-2 text-slate-500">Você participa de mais de uma. Escolha em qual vai trabalhar agora; dá para trocar a qualquer momento.</p>

        <ul className="mt-6 space-y-3">
          {list.map((o) => (
            <li key={o.id}>
              <form action="/organizacoes/selecionar" method="post">
                <input type="hidden" name="org" value={o.id} />
                <button
                  type="submit"
                  className="group flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-brand focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.99]"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                    <Building2 className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{orgLabel(o)}</span>
                    {o.id === active && <span className="text-xs font-medium text-emerald-700">Em uso agora</span>}
                  </span>
                  <ChevronRight className="size-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand" />
                </button>
              </form>
            </li>
          ))}
        </ul>

        <form className="mt-8 text-center" action="/logout" method="post">
          <button className="text-sm text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline">Sair</button>
        </form>
      </div>
    </main>
  );
}
