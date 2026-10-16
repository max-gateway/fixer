import { CircleAlert, CircleCheck, Circle } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export type ReadinessStep = {
  id: 'regime' | 'dados' | 'perfil' | 'tabela' | 'tabela-monofasico';
  label: string;
  done: boolean;
  detail: string;
  optional?: boolean;
  tableId?: string;
};

export type TaxReadiness = {
  regime: 'SIMPLES' | 'PRESUMIDO' | 'REAL';
  regimeInformed: boolean;
  supported: boolean;
  steps: ReadinessStep[];
  requiredTables: string[];
  ready: boolean;
  summary: string;
};

export const REGIME_LABEL: Record<TaxReadiness['regime'], string> = { SIMPLES: 'Simples Nacional', PRESUMIDO: 'Lucro Presumido', REAL: 'Lucro Real' };

/** Passo a passo do que falta para o imposto sobre a venda sair "confirmado" em vez de "estimado". */
export function ReadinessCard({ readiness }: { readiness: TaxReadiness }) {
  const ready = readiness.ready;
  return (
    <Alert variant={ready ? 'success' : 'warning'} aria-labelledby="readiness-title" className="gap-y-2 p-4">
      {ready ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
      <AlertTitle id="readiness-title" className="text-sm font-semibold">
        {ready ? 'Imposto pronto para confirmar' : 'Imposto ainda estimado'}
      </AlertTitle>
      <AlertDescription className="gap-3">
        <p>{readiness.summary}</p>
        <ol className="w-full space-y-2 border-t border-black/10 pt-3">
          {readiness.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2.5">
              {s.done ? <CircleCheck aria-label="pronto" className="mt-0.5 size-4 shrink-0 text-emerald-700" /> : <Circle aria-label={s.optional ? 'opcional, pendente' : 'pendente'} className="mt-0.5 size-4 shrink-0 text-amber-700" />}
              <div>
                <p className="font-medium">
                  {s.label}
                  {s.optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">só para peças monofásicas</span>}
                </p>
                <p className="text-muted-foreground">
                  {s.detail}
                  {!s.done && s.tableId && (
                    <>
                      {' '}
                      <Link href="?aba=tabelas" className="underline underline-offset-2">
                        Ir para as tabelas
                      </Link>
                    </>
                  )}
                  {!s.done && s.id === 'regime' && (
                    <>
                      {' '}
                      <Link href="/configuracoes" className="underline underline-offset-2">
                        Abrir Dados fiscais
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </AlertDescription>
    </Alert>
  );
}
