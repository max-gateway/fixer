import { TriangleAlert } from 'lucide-react';
import { ApiError, apiGet } from '@/lib/api';
import { provenanceTag, type AutofillProvenance } from '@/lib/fiscal-autofill';
import type { FiscalStatus } from '@/lib/fiscal-import';
import { FiscalOverview, type TaxSummary } from '../fiscal-overview';
import { FiscalSettingsForm, type FiscalSettings } from '../fiscal-settings-form';
import { ReadinessCard } from '../precificacao/readiness';
import { TaxProfileForm, type TaxProfileSettings } from '../precificacao/tax-profile-form';
import { TaxTables, type TaxTableView } from '../precificacao/tax-tables';
import { AdjustmentsPanel } from './adjustments-panel';
import { brDate, type TaxOverview } from './model';
import { Card, EngineCheck, ReformCard, SimplesLimit, TaxHero } from './sections';
import { PartsCard, partsSlices, ServicesCard } from './sides';

export const metadata = { title: 'Tributário' };

type TaxProfileResponse = { profile: (TaxProfileSettings & { icmsSalePct: string | null }) | null; readiness: TaxSummary['readiness'] };

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="font-semibold">{children}</div>
    </div>
  );
}

/**
 * Tudo que entra no cálculo do imposto, num lugar só: o que o motor calcula (faixa, alíquota, repartição, limites e reforma),
 * de onde vem cada dado (Receita via Integra Contador, prefeitura, contador) e os ajustes manuais. O cálculo é da API; a tela
 * só traduz para a pessoa.
 */
export default async function TributarioPage() {
  let status: FiscalStatus;
  try {
    status = await apiGet<FiscalStatus>('/fiscal/status');
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Tributário</h1>
        <Notice>{denied ? 'Você não tem permissão para ver o cadastro fiscal.' : 'Não foi possível carregar os dados tributários.'}</Notice>
      </section>
    );
  }

  // Cada parte falha sozinha: sem permissão de precificação some só o que depende dela.
  const [fiscal, provenance, taxProfile, overview, tables] = await Promise.all([
    apiGet<FiscalSettings | null>('/fiscal/settings').catch(() => null),
    apiGet<AutofillProvenance>('/fiscal/autofill').catch((): AutofillProvenance => ({ fields: [], simplesOptant: null })),
    apiGet<TaxProfileResponse>('/pricing/tax-profile').catch(() => null),
    apiGet<TaxOverview>('/pricing/tax-overview').catch(() => null),
    apiGet<{ rulesVersion: string; tables: TaxTableView[] }>('/pricing/tax-tables').catch(() => null),
  ]);
  const company = status.settings;
  const cred = status.credential;
  const readiness = taxProfile?.readiness ?? null;

  const rbtProv = provenanceTag(provenance.fields.find((f) => f.field === 'rbt12'));
  const asOf = taxProfile?.profile?.rbt12AsOf;
  const rbt12Note = rbtProv ? `${rbtProv.text}${asOf ? ` · ${brDate(asOf)}` : ''}` : taxProfile?.profile?.rbt12 ? 'Informada por você' : null;
  const slices = overview ? partsSlices(overview, taxProfile?.profile?.icmsSalePct ?? null) : [];

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tributário</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">Os impostos que o Fixer usa para sugerir o preço, com a origem de cada número. O que vem da Receita e da prefeitura dispensa digitação.</p>
      </header>

      {!company?.cnpj ? (
        <Notice>Envie o certificado digital em &quot;Oficina&quot; para o Fixer buscar os dados da empresa.</Notice>
      ) : (
        <>
          {overview ? (
            <>
              <TaxHero overview={overview} readiness={readiness} rbt12Note={rbt12Note} />
              <div className="grid items-stretch gap-5 lg:grid-cols-2">
                <PartsCard overview={overview} slices={slices} />
                <ServicesCard overview={overview} />
              </div>
              {overview.simples && <SimplesLimit simples={overview.simples} />}
              <div className="grid gap-5 lg:grid-cols-2">
                <EngineCheck conferencia={overview.conferencia} receitaAvailable={Boolean(provenance.sources?.receita)} consent={Boolean(provenance.taxDataConsent?.enabled)} />
                {overview.transition && <ReformCard transition={overview.transition} />}
              </div>
            </>
          ) : (
            <Notice>Você não tem permissão para ver o cálculo do imposto, ou ele não está disponível agora.</Notice>
          )}

          <Card title="Dados que alimentam o cálculo" hint="Cada valor mostra a fonte. Valor digitado nunca é trocado sozinho: se a fonte discordar, você é avisado.">
            <FiscalOverview
              company={{ cnpj: company.cnpj, legalName: company.legalName, ufCode: company.ufCode }}
              fiscal={fiscal}
              provenance={provenance}
              tax={taxProfile && { profile: taxProfile.profile, readiness: taxProfile.readiness }}
              hasCredential={Boolean(cred)}
              issEngine={overview?.iss.engine?.ratePct ?? null}
              hideStatus
            />
          </Card>

          {readiness && !readiness.ready && <ReadinessCard readiness={readiness} />}

          <AdjustmentsPanel pending={Boolean(readiness && !readiness.ready)}>
            <FiscalSettingsForm key={JSON.stringify(fiscal)} initial={fiscal} />
            {taxProfile && <TaxProfileForm key={JSON.stringify(taxProfile.profile)} initial={taxProfile.profile} readiness={taxProfile.readiness} canReview />}
            {tables && taxProfile && (
              <div id="tabelas" className="scroll-mt-24 space-y-3">
                <h3 className="text-base font-semibold">Tabelas da lei</h3>
                <TaxTables key={JSON.stringify(tables.tables.map((t) => t.review))} tables={tables.tables} rulesVersion={tables.rulesVersion} required={taxProfile.readiness.requiredTables} canReview />
              </div>
            )}
          </AdjustmentsPanel>
        </>
      )}
    </section>
  );
}
