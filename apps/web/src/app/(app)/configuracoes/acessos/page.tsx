import { ShieldOff, TriangleAlert } from 'lucide-react';
import { AccessWorkspace, type Catalog, type Me, type MembersResponse, type Role } from '@/features/access';
import { ApiError, apiGet } from '@/lib/api';

export const metadata = { title: 'Acessos' };

// A rota só busca os dados iniciais e monta o módulo; tudo o mais vive em src/features/access.
export default async function AcessosPage() {
  try {
    const [me, catalog, roles, members] = await Promise.all([
      apiGet<Me>('/access/me'),
      apiGet<Catalog>('/access/catalog'),
      apiGet<Role[]>('/access/roles'),
      apiGet<MembersResponse>('/access/members'),
    ]);
    return <AccessWorkspace initial={{ me, catalog, roles, members }} />;
  } catch (err) {
    const api = err instanceof ApiError ? err : null;
    const denied = api?.permissionDenied ?? false;
    // 403 que não é de permissão: a API não conseguiu decidir a oficina (ex.: token sem organização). A mensagem dela diz o que falta.
    const blocked = api?.status === 403 && !denied;
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Acessos</h1>
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {denied ? <ShieldOff aria-hidden className="mt-0.5 size-5 shrink-0" /> : <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />}
          <div>
            <p className="font-semibold">
              {denied ? 'Você não tem permissão para ver os acessos da oficina.' : blocked ? 'Não foi possível identificar a sua oficina.' : 'Não foi possível carregar os acessos.'}
            </p>
            {denied && <p>Peça a um administrador a permissão &quot;access.read&quot;.</p>}
            {blocked && api?.detail && <p>{api.detail}</p>}
          </div>
        </div>
      </section>
    );
  }
}
