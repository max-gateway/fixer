import { ArrowRight, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Hint } from '@/components/hint';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { PricingPlanView, SaleTaxView } from '@/lib/pricing';

/** Etiqueta única do estado do imposto de um item: nunca só cor, sempre com texto; a explicação abre ao passar o mouse ou tocar. */
export function TaxChip({ tax }: { tax: SaleTaxView }) {
  if (tax.pct === null) {
    return (
      <Hint content="O imposto sobre a venda não pôde ser calculado: veja o motivo em Detalhes.">
        <Badge variant="danger">Imposto indisponível</Badge>
      </Hint>
    );
  }
  if (tax.confidence === 'DEFINIDO') {
    return (
      <Hint content="Percentual que você definiu na regra de preço.">
        <Badge variant="secondary">Definido por você</Badge>
      </Hint>
    );
  }
  if (tax.confidence === 'CONFIRMADO') {
    return (
      <Hint content="O contador validou os dados e as tabelas, e o enquadramento da peça está confirmado.">
        <Badge variant="success">Imposto confirmado</Badge>
      </Hint>
    );
  }
  return (
    <Hint content="Falta validação do contador (dados ou tabelas) ou a confirmação do enquadramento da peça.">
      <Badge variant="warning">Imposto estimado</Badge>
    </Hint>
  );
}

/**
 * Aviso único no topo do passo "Precificar": o que falta, no cadastro, para o imposto desta nota sair confirmado.
 * Some quando está tudo pronto. O link leva direto para a aba certa da configuração.
 */
export function TaxBanner({ readiness, unavailable }: { readiness: PricingPlanView['taxReadiness']; unavailable: number }) {
  if (readiness.ready && unavailable === 0) return null;

  if (!readiness.supported) {
    return (
      <Alert variant="info">
        <TriangleAlert aria-hidden />
        <AlertDescription>Lucro Real: o imposto não tem percentual sobre a venda e não é calculado. Defina o percentual de imposto na regra de preço para receber sugestões.</AlertDescription>
      </Alert>
    );
  }

  const needsData = readiness.missing.some((m) => m.id === 'regime' || m.id === 'dados' || m.id === 'perfil');
  const href = `/configuracoes/precificacao?aba=${needsData ? 'imposto' : 'tabelas'}`;
  const danger = unavailable > 0;
  const [first, ...rest] = readiness.missing;
  const headline = danger ? `${unavailable} ${unavailable === 1 ? 'item está' : 'itens estão'} sem imposto calculado.` : 'Imposto estimado.';
  // Uma linha só: o que acontece, o primeiro passo que falta e o caminho. A lista completa está no checklist da configuração.
  return (
    <Alert variant={danger ? 'destructive' : 'warning'} className="items-center">
      <TriangleAlert aria-hidden />
      <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          <strong className="font-medium">{headline}</strong>
          {first && (
            <>
              {' '}
              Falta: {first.label.charAt(0).toLowerCase() + first.label.slice(1)}
              {rest.length > 0 && ` (e mais ${rest.length})`}.
            </>
          )}
        </span>
        <Link href={href} className="ml-auto inline-flex items-center gap-1 font-medium underline underline-offset-2">
          Concluir <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </AlertDescription>
    </Alert>
  );
}
