import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, apiGet } from '@/lib/api';
import type { CostsOverview } from '@/lib/costs';
import { CostsTab } from './costs-tab';
import { RuleForm, type RuleSettings } from './pricing-settings-form';
import { RuleExceptions, type ScopedRule } from './rule-exceptions';

export const metadata = { title: 'Precificação' };

const TABS = ['regra', 'despesas'] as const;
type Tab = (typeof TABS)[number];

export default async function PrecificacaoPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { aba } = await searchParams;
  // Imposto e tabelas da lei moraram aqui; agora ficam em Tributário. Links antigos (notas, e-mails) continuam funcionando.
  if (aba === 'imposto') redirect('/configuracoes/tributario');
  if (aba === 'tabelas') redirect('/configuracoes/tributario#tabelas');
  const tab: Tab = (TABS as readonly string[]).includes(aba ?? '') ? (aba as Tab) : 'regra';

  let rule: RuleSettings | null;
  let all: ScopedRule[];
  try {
    let rules: { rules: ScopedRule[] };
    [{ rule }, rules] = await Promise.all([apiGet<{ rule: RuleSettings | null }>('/pricing/rule'), apiGet<{ rules: ScopedRule[] }>('/pricing/rules')]);
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

  // Despesas vêm do motor de custos: se ele falhar, só a aba mostra o erro; o resto da página segue.
  const costs = tab === 'despesas' ? await apiGet<CostsOverview>('/costs').catch(() => null) : null;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Precificação</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Como o Fixer sugere o preço de venda quando uma nota de compra chega. Nada muda no preço sem a sua confirmação ao lançar a nota. Os impostos do cálculo ficam em{' '}
          <Link href="/configuracoes/tributario" className="underline underline-offset-2">
            Tributário
          </Link>
          .
        </p>
      </header>

      <Tabs key={tab} defaultValue={tab} className="gap-5">
        <TabsList className="h-auto w-full max-w-xl flex-wrap sm:flex-nowrap">
          <TabsTrigger value="regra">Regra de preço</TabsTrigger>
          {/* Navega (em vez de só trocar a aba) para o servidor buscar as despesas, que só são carregadas nesta aba. */}
          <TabsTrigger value="despesas" asChild>
            <Link href="/configuracoes/precificacao?aba=despesas">Despesas</Link>
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

        <TabsContent value="despesas">
          {/* canEdit: a API recusa quem não tem `pricing.write`; o botão aparece e o erro explica. */}
          <CostsTab data={costs} canEdit />
        </TabsContent>
      </Tabs>
    </section>
  );
}
