import { TriangleAlert } from 'lucide-react';
import { ApiError, apiGet } from '@/lib/api';
import type { AutofillProvenance } from '@/lib/fiscal-autofill';
import type { FiscalStatus } from '@/lib/fiscal-import';
import type { TaxSummary } from './fiscal-overview';
import type { FiscalSettings } from './fiscal-settings-form';
import { SetupJourney } from './journey/setup-journey';

export const metadata = { title: 'Oficina' };

/**
 * Configurações da oficina como uma jornada guiada. O certificado é a única coisa que a pessoa precisa dar: com ele o Fixer
 * busca a empresa, o regime, o serviço, o ISS da prefeitura e a receita, e as notas de compra passam a chegar sozinhas.
 */
export default async function OficinaPage() {
  let status: FiscalStatus;
  try {
    status = await apiGet<FiscalStatus>('/fiscal/status');
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Oficina</h1>
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{denied ? 'Você não tem permissão para ver o cadastro.' : 'Não foi possível carregar o cadastro.'}</p>
            {denied && <p>Peça a um administrador a permissão &quot;invoices.read&quot;.</p>}
          </div>
        </div>
      </section>
    );
  }

  // Sem registro ainda (oficina nova): tudo começa vazio. O imposto depende de permissão de precificação: sem ela, some só essa parte.
  const [fiscal, provenance, tax] = await Promise.all([
    apiGet<FiscalSettings | null>('/fiscal/settings').catch(() => null),
    apiGet<AutofillProvenance>('/fiscal/autofill').catch((): AutofillProvenance => ({ fields: [], simplesOptant: null })),
    apiGet<TaxSummary>('/pricing/tax-profile').catch(() => null),
  ]);

  return <SetupJourney status={status} fiscal={fiscal} provenance={provenance} tax={tax} />;
}
