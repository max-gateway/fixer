import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { ApiError, apiGet } from '@/lib/api';
import type { AutofillProvenance } from '@/lib/fiscal-autofill';
import type { FiscalStatus } from '@/lib/fiscal-import';
import { CertificateCard } from './certificate-card';
import { CompanyForm } from './company-form';
import { FiscalOverview, type TaxSummary } from './fiscal-overview';
import type { FiscalSettings } from './fiscal-settings-form';
import { SyncCard } from './sync-card';

export const metadata = { title: 'Oficina' };

/**
 * Configurações da oficina. O certificado é a única coisa que a pessoa precisa dar: com ele o Fixer busca a empresa, o
 * regime, o serviço, o ISS da prefeitura e a receita, e mostra de onde veio cada valor. Digitar fica em "Ajustes manuais".
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
  const company = status.settings;
  const cred = status.credential;

  return (
    <section className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Oficina</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Os dados da empresa e o certificado digital. Com o certificado o Fixer busca a empresa, os impostos e as notas de compra na SEFAZ. Tudo de imposto fica em{' '}
          <Link href="/configuracoes/tributario" className="underline underline-offset-2">
            Tributário
          </Link>
          .
        </p>
      </header>

      {!cred && (
        <Block title="Comece pelo certificado digital" description="É a única coisa que você precisa enviar.">
          <CertificateCard status={status} cnpjSaved={Boolean(company?.cnpj)} receita={{ available: Boolean(provenance.sources?.receita), enabled: Boolean(provenance.taxDataConsent?.enabled) }} />
        </Block>
      )}

      {company?.cnpj && (
        <Block title="Dados da empresa" description="Vieram do certificado e da consulta de CNPJ.">
          <FiscalOverview
            company={{ cnpj: company.cnpj, legalName: company.legalName, ufCode: company.ufCode }}
            fiscal={fiscal}
            provenance={provenance}
            tax={tax}
            hasCredential={Boolean(cred)}
            scope="company"
          />
        </Block>
      )}

      {cred && (
        <div className="grid gap-10 xl:grid-cols-2">
          <Block title="Certificado digital">
            <CertificateCard status={status} cnpjSaved={Boolean(company?.cnpj)} receita={{ available: Boolean(provenance.sources?.receita), enabled: Boolean(provenance.taxDataConsent?.enabled) }} />
          </Block>
          <Block title="Busca de notas de compra">
            <SyncCard credential={cred} />
          </Block>
        </div>
      )}

      {company?.cnpj && !cred && (
        <Block title="Ajustes manuais" description="Sem certificado, a empresa pode ser informada à mão. Regime, ISS e valor da hora ficam em Tributário.">
          <CompanyForm key={`${company.cnpj}|${company.legalName}|${company.ufCode}`} initial={company} locked={false} />
        </Block>
      )}
    </section>
  );
}

function Block({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
