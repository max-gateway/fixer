import { ArrowLeft, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, apiGet } from '@/lib/api';
import { RuleForm, type RuleSettings } from './pricing-settings-form';
import { ReadinessCard, type TaxReadiness } from './readiness';
import { RuleExceptions, type ScopedRule } from './rule-exceptions';
import { TaxProfileForm, type TaxProfileSettings } from './tax-profile-form';
import { TaxTables, type TaxTableView } from './tax-tables';

export const metadata = { title: 'Precificação' };

const TABS = ['regra', 'imposto', 'tabelas'] as const;
type Tab = (typeof TABS)[number];

export default async function PrecificacaoPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { aba } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(aba ?? '') ? (aba as Tab) : 'regra';

  let rule: RuleSettings | null;
  let profile: TaxProfileSettings | null;
  let readiness: TaxReadiness;
  let all: ScopedRule[];
  let tables: { rulesVersion: string; tables: TaxTableView[] };
  try {
    let rules: { rules: ScopedRule[] };
    let p: { profile: TaxProfileSettings | null; readiness: TaxReadiness };
    [{ rule }, p, rules, tables] = await Promise.all([
      apiGet<{ rule: RuleSettings | null }>('/pricing/rule'),
      apiGet<{ profile: TaxProfileSettings | null; readiness: TaxReadiness }>('/pricing/tax-profile'),
      apiGet<{ rules: ScopedRule[] }>('/pricing/rules'),
      apiGet<{ rulesVersion: string; tables: TaxTableView[] }>('/pricing/tax-tables'),
    ]);
    profile = p.profile;
    readiness = p.readiness;
    all = rules.rules.filter((r) => r.scope !== 'DEFAULT');
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="font-semibold">{denied ? 'Você não tem permissão para ver a precificação.' : 'Não foi possível carregar a precificação.'}</p>
        </div>
      </section>
    );
  }

  const pendingTables = tables.tables.filter((t) => readiness.requiredTables.includes(t.id) && t.review?.current !== true).length;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4" /> Cadastro da oficina
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Precificação</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Como o Fixer sugere o preço de venda quando uma nota de compra chega. Nada muda no preço sem a sua confirmação ao lançar a nota.
        </p>
      </header>

      <Tabs key={tab} defaultValue={tab} className="gap-5">
        <TabsList className="h-auto w-full max-w-xl flex-wrap sm:flex-nowrap">
          <TabsTrigger value="regra">Regra de preço</TabsTrigger>
          <TabsTrigger value="imposto">
            Imposto
            {!readiness.ready && <span aria-label="pendências" className="size-2 rounded-full bg-amber-500" />}
          </TabsTrigger>
          <TabsTrigger value="tabelas">
            Tabelas
            {pendingTables > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900">{pendingTables}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="regra" className="space-y-8">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Regra padrão</h2>
            <RuleForm key={JSON.stringify(rule)} initial={rule} />
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Exceções por fornecedor, NCM ou peça</h2>
            <RuleExceptions key={JSON.stringify(all)} rules={all} base={rule} />
          </div>
        </TabsContent>

        <TabsContent value="imposto" className="space-y-6">
          <ReadinessCard readiness={readiness} />
          {/* canReview: a API recusa quem não tem `fiscal.verify`; o botão aparece e o erro explica. */}
          <TaxProfileForm key={JSON.stringify(profile)} initial={profile} readiness={readiness} canReview />
        </TabsContent>

        <TabsContent value="tabelas">
          <TaxTables key={JSON.stringify(tables.tables.map((t) => t.review))} tables={tables.tables} rulesVersion={tables.rulesVersion} required={readiness.requiredTables} canReview />
        </TabsContent>
      </Tabs>
    </section>
  );
}
