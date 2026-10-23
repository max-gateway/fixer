import { Package, TriangleAlert, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { pct, TAX_LABEL, type TaxOverview } from './model';
import { TaxDonut } from './tax-donut';

// Peças e serviços lado a lado: cada um tem a sua tabela de imposto e o seu preço. O que o preço sugerido das peças usa é só o
// lado esquerdo; o direito vale para a nota de serviço e para a mão de obra.

const ORDER = ['icms', 'iss', 'pis', 'cofins', 'cbs', 'ibs', 'ipi', 'irpj', 'csll', 'cpp'];

export type Slice = { key: string; pct: number };

const byOrder = (a: Slice, b: Slice) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key);
/** Fatias do imposto sobre a venda de peças: Simples traz a repartição do Anexo I; Presumido soma federais e o ICMS da venda. */
export function partsSlices(overview: TaxOverview, icmsSalePct: string | null): Slice[] {
  const raw: Slice[] = overview.simples
    ? overview.simples.components.map((c) => ({ key: c.key, pct: Number(c.pct) }))
    : overview.presumido
      ? [
          { key: 'irpj', pct: Number(overview.presumido.irpjPct) },
          { key: 'csll', pct: Number(overview.presumido.csllPct) },
          { key: 'pis', pct: Number(overview.presumido.pisPct) },
          { key: 'cofins', pct: Number(overview.presumido.cofinsPct) },
          ...(icmsSalePct != null ? [{ key: 'icms', pct: Number(icmsSalePct) }] : []),
        ]
      : [];
  return raw.filter((s) => s.pct > 0).sort(byOrder);
}

/** Rosca da divisão do imposto, com o nome de balcão de cada tributo. */
function Split({ slices, unit, label }: { slices: Slice[]; unit: string; label: string }) {
  return <TaxDonut slices={slices.map((s) => ({ ...s, name: TAX_LABEL[s.key]?.name ?? s.key.toUpperCase(), who: TAX_LABEL[s.key]?.who ?? '' }))} unit={unit} label={label} />;
}

function Side({ icon: Icon, title, subtitle, basis, children }: { icon: typeof Package; title: string; subtitle: string; basis: string | null; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-xl border bg-card surface p-5 shadow-xs">
      <header className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {basis && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{basis}</span>}
      </header>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{children}</p>;

/** Venda de peças (produtos): a conta do preço sugerido. */
export function PartsCard({ overview, slices }: { overview: TaxOverview; slices: Slice[] }) {
  const regime = overview.regime;
  return (
    <Side icon={Package} title="Peças e produtos" subtitle="Imposto sobre a venda de mercadorias" basis={overview.simples ? 'Anexo I do Simples' : regime === 'PRESUMIDO' ? 'Lucro Presumido' : null}>
      {regime === 'REAL' ? (
        <Empty>No Lucro Real o imposto incide sobre o lucro e admite crédito: não há percentual sobre a venda. Defina o percentual na regra de preço.</Empty>
      ) : slices.length === 0 ? (
        <Empty>Sem dados para calcular ainda. Preencha o regime e a receita dos últimos 12 meses.</Empty>
      ) : (
        <Split slices={slices} unit="sobre a venda de peças" label="Imposto sobre a venda de peças" />
      )}
      <ul className="mt-auto space-y-1 text-xs text-muted-foreground">
        <li>É a conta que o preço sugerido das peças faz antes da sua margem.</li>
        <li>Peças com ICMS já recolhido (substituição tributária) ou PIS/COFINS monofásico pagam menos: o Fixer ajusta peça a peça pela nota de compra.</li>
        {overview.simples?.stateTaxesOutsideDas && <li>Acima do sublimite, ICMS e ISS são pagos fora do DAS e não entram nesta divisão.</li>}
      </ul>
    </Side>
  );
}

/** Mão de obra: imposto do serviço (Anexo III no Simples) mais o ISS do município. */
export function ServicesCard({ overview }: { overview: TaxOverview }) {
  const regime = overview.regime;
  const { simples, presumido } = overview.services;
  const iss = overview.iss;
  const issRate = iss.saved ?? iss.engine?.ratePct ?? null;

  let slices: Slice[] = [];
  if (simples) slices = simples.components.map((c) => ({ key: c.key, pct: Number(c.pct) })).sort(byOrder);
  else if (presumido) {
    slices = [
      { key: 'irpj', pct: Number(presumido.irpjPct) },
      { key: 'csll', pct: Number(presumido.csllPct) },
      { key: 'pis', pct: Number(presumido.pisPct) },
      { key: 'cofins', pct: Number(presumido.cofinsPct) },
      ...(issRate != null ? [{ key: 'iss', pct: Number(issRate) }] : []),
    ]
      .filter((s) => s.pct > 0)
      .sort(byOrder);
  }

  let source: string;
  if (iss.saved != null) source = 'Salva na configuração (prefeitura ou digitada).';
  else if (iss.engine?.status === 'OK') source = 'Pela tabela do município no Fixer; a prefeitura ainda não informou na NFS-e Nacional.';
  else if (iss.engine?.status === 'MUNICIPIO_NAO_COBERTO') source = 'O Fixer ainda não tem a tabela deste município: informe a alíquota nos ajustes.';
  else if (iss.engine?.status === 'SEM_REGRA') source = 'Este serviço tem alíquota própria no município que o Fixer não modela: informe nos ajustes.';
  else source = !iss.item ? 'Falta o subitem do serviço (LC 116).' : 'Sem alíquota para este serviço.';
  const differs = iss.saved != null && iss.engine?.status === 'OK' && iss.engine.ratePct != null && Number(iss.engine.ratePct) !== Number(iss.saved);
  const lawIssue = iss.check === 'ACIMA_DO_MAXIMO' || iss.check === 'ABAIXO_DO_MINIMO';
  const warn = differs
    ? `A tabela do município diz ${pct(iss.engine!.ratePct!)}, mas a salva é ${pct(iss.saved!)}. Confira com a prefeitura.`
    : lawIssue
      ? `Fora dos limites da LC 116 (${iss.check === 'ACIMA_DO_MAXIMO' ? 'máximo de 5%' : 'mínimo de 2%'}). Confira com o contador.`
      : null;
  const remaining = iss.engine?.remainingPct && Number(iss.engine.remainingPct) < 100 ? iss.engine : null;

  return (
    <Side icon={Wrench} title="Serviços e mão de obra" subtitle="Imposto sobre o serviço prestado" basis={simples ? 'Anexo III do Simples' : regime === 'PRESUMIDO' ? 'Lucro Presumido' : null}>
      {regime === 'REAL' ? (
        <Empty>No Lucro Real o imposto incide sobre o lucro. Só o ISS do município é cobrado sobre o serviço.</Empty>
      ) : slices.length === 0 ? (
        <Empty>Sem dados para calcular ainda. Preencha o regime e a receita dos últimos 12 meses.</Empty>
      ) : (
        <Split slices={slices} unit="sobre o serviço" label="Imposto sobre o serviço" />
      )}

      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <p className="text-sm font-medium">ISS do município</p>
          <p className="text-lg font-semibold tabular-nums">{issRate != null ? pct(issRate) : <span className="text-muted-foreground">—</span>}</p>
        </div>
        {iss.item && <p className="text-xs text-muted-foreground">Serviço: subitem {iss.item} da LC 116</p>}
        <p className="text-xs text-muted-foreground">{source}</p>
        {simples && <p className="text-xs text-muted-foreground">No Simples o ISS pago já está dentro do DAS; esta alíquota vale para a nota de serviço e a retenção.</p>}
        {remaining && (
          <p className="text-xs">
            Na transição da reforma o ISS cai para {pct(remaining.remainingPct!, 0)} do atual: efetiva de <span className="font-medium tabular-nums">{pct(remaining.effectivePct!, 4)}</span>.
          </p>
        )}
        {warn && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {warn}
          </p>
        )}
      </div>
      <ul className="mt-auto space-y-1 text-xs text-muted-foreground">
        <li>A receita de peças e de serviços soma na mesma RBT12; cada uma usa a sua tabela.</li>
      </ul>
    </Side>
  );
}
