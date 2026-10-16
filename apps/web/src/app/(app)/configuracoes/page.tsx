import { Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { ApiError, apiGet } from '@/lib/api';
import type { FiscalStatus } from '@/lib/fiscal-import';
import { CertificateCard } from './certificate-card';
import { CompanyForm } from './company-form';
import { CompanyOverview } from './company-overview';
import { FiscalSettingsForm, type FiscalSettings } from './fiscal-settings-form';
import { SyncCard } from './sync-card';

export const metadata = { title: 'Cadastro da oficina' };

export default async function CadastroPage() {
  let status: FiscalStatus;
  try {
    status = await apiGet<FiscalStatus>('/fiscal/status');
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
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

  // Sem registro ainda (oficina nova): o formulário começa vazio.
  const fiscal = await apiGet<FiscalSettings | null>('/fiscal/settings').catch(() => null);
  const company = status.settings;
  const missingTax = !fiscal?.issRate || !fiscal?.municipalServiceCode;

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cadastro da oficina</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Envie o certificado digital da oficina: o Fixer lê o CNPJ dele e preenche sozinho a empresa, o município e o Simples Nacional. É com o mesmo certificado que as notas de compra são buscadas na SEFAZ.
        </p>
      </header>

      <p className="text-sm">
        <Link href="/configuracoes/precificacao" className="font-medium underline underline-offset-2">
          Precificação
        </Link>
        <span className="text-muted-foreground"> · regra de preço e perfil tributário usados para sugerir o preço de venda quando uma nota chega.</span>
      </p>

      <Step n={1} title="Certificado digital" done={Boolean(status.credential)}>
        <CertificateCard status={status} cnpjSaved={Boolean(company?.cnpj)} />
      </Step>

      {company?.cnpj && (
        <Step n={2} title="Dados da oficina" done>
          <CompanyOverview
            key={`${company.cnpj}|${company.legalName}|${company.ufCode}|${fiscal?.municipalityIbge}|${fiscal?.taxRegime}`}
            cnpj={company.cnpj}
            legalName={company.legalName}
            ufCode={company.ufCode}
            municipalityIbge={fiscal?.municipalityIbge ?? null}
            taxRegime={fiscal?.taxRegime ?? null}
          />
          {!status.credential && (
            <details className="max-w-xl text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Corrigir dados manualmente</summary>
              <div className="mt-3">
                <CompanyForm key={`${company.cnpj}|${company.legalName}|${company.ufCode}`} initial={company} locked={false} />
              </div>
            </details>
          )}
        </Step>
      )}

      {company?.cnpj && (
        <Step n={3} title="Impostos" done={!missingTax && Boolean(fiscal?.taxRegime)}>
          {missingTax && (
            <p role="note" className="flex max-w-xl items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                A alíquota de ISS e o código de tributação são definidos por cada prefeitura e não constam no CNPJ: confirme com o seu contador ou na prefeitura do município acima.
              </span>
            </p>
          )}
          <FiscalSettingsForm key={JSON.stringify(fiscal)} initial={fiscal} />
        </Step>
      )}

      {status.credential && (
        <Step n={4} title="Busca de notas de compra" done={status.credential.enabled}>
          <SyncCard credential={status.credential} />
        </Step>
      )}
    </section>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden
          className={`grid size-6 place-items-center rounded-full text-xs font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}
        >
          {done ? '✓' : n}
        </span>
        {title}
        <span className="sr-only">{done ? ' (concluído)' : ''}</span>
      </h2>
      {children}
    </div>
  );
}
