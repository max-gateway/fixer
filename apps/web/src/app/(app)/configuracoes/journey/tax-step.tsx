'use client';

import { ArrowRight, Landmark, Percent, ReceiptText, Wrench } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { provenanceTag, REGIME_LABEL, type AutofillProvenance } from '@/lib/fiscal-autofill';
import { money } from '@/lib/invoices';
import { ReceitaConsent, RegimeQuestion, TaxStatus, type TaxSummary } from '../fiscal-overview';
import type { FiscalSettings } from '../fiscal-settings-form';
import { DataItem, Surface } from './ui';

const pct = (v: string | number) => `${String(Number(v)).replace('.', ',')}%`;

type Props = { fiscal: FiscalSettings | null; provenance: AutofillProvenance; tax: TaxSummary | null; hasCredential: boolean };

/**
 * O mínimo para o imposto da venda: o regime (a única pergunta que pode sobrar), a autorização da Receita e os números
 * que a Receita e a prefeitura trouxeram. O cálculo completo, com faixa e repartição, fica em Tributário.
 */
export function TaxStep({ fiscal, provenance, tax, hasCredential }: Props) {
  const regime = fiscal?.taxRegime ?? null;
  const tag = (field: string) => provenanceTag(provenance.fields.find((f) => f.field === field));
  const simples = (tax?.readiness.regime ?? regime ?? 'SIMPLES') === 'SIMPLES';
  const revenue = simples ? tax?.profile?.rbt12 : tax?.profile?.icmsSalePct;

  return (
    <div className="space-y-4">
      {tax?.readiness && regime && <TaxStatus readiness={tax.readiness} />}

      {!regime && <RegimeQuestion simplesOptant={provenance.simplesOptant} />}

      <Surface>
        <div className="grid gap-5 sm:grid-cols-2">
          <DataItem icon={Landmark} label="Regime tributário" value={regime ? (REGIME_LABEL[regime] ?? regime) : null} source={tag('taxRegime')?.text} estimated={tag('taxRegime')?.estimated} />
          <DataItem icon={Wrench} label="Serviço (LC 116)" value={fiscal?.lc116Item ? `item ${fiscal.lc116Item}` : null} source={tag('lc116Item')?.text ?? (fiscal?.lc116Item ? null : 'Vem da CNAE na consulta de CNPJ')} />
          <DataItem icon={Percent} label="Alíquota de ISS" value={fiscal?.issRate != null ? pct(fiscal.issRate) : null} source={tag('issRate')?.text} estimated={tag('issRate')?.estimated} />
          {tax && regime !== 'REAL' && (
            <DataItem
              icon={ReceiptText}
              label={simples ? 'Receita dos últimos 12 meses' : 'ICMS cobrado na venda'}
              value={revenue != null ? (simples ? money(revenue) : pct(revenue)) : null}
              source={tag(simples ? 'rbt12' : 'icmsSalePct')?.text}
              estimated={tag(simples ? 'rbt12' : 'icmsSalePct')?.estimated}
            />
          )}
        </div>
      </Surface>

      {hasCredential && provenance.sources?.receita && <ReceitaConsent consent={provenance.taxDataConsent ?? null} />}

      <Button asChild variant="outline" className="w-full sm:w-auto">
        <Link href="/configuracoes/tributario">
          Ver o cálculo completo em Tributário <ArrowRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
