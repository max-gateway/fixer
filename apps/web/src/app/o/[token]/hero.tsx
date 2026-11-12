import { Icon } from '@/components/icons';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import type { PortalOrder } from '@/lib/portal';

/** Placa no padrão Mercosul, para o carro ser reconhecido de relance. */
export function PlateBadge({ plate }: { plate: string }) {
  const text = plate.length === 7 ? `${plate.slice(0, 3)}${plate.slice(3)}` : plate;
  return (
    <div className="inline-flex flex-col overflow-hidden rounded-lg border-2 border-[#0f141b] bg-white shadow-sm" aria-label={`Placa ${plate}`}>
      <div className="flex items-center justify-between bg-[#003399] px-2 py-0.5 text-[8px] font-bold tracking-widest text-white">
        <span>BRASIL</span>
        <span aria-hidden="true">★</span>
      </div>
      <div className="px-3 py-1 font-mono text-xl font-bold tracking-[0.18em] text-[#0f141b]">{text}</div>
    </div>
  );
}

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'QUOTE', label: 'Orçamento' },
  { status: 'APPROVED', label: 'Aprovada' },
  { status: 'IN_PROGRESS', label: 'Em andamento' },
  { status: 'COMPLETED', label: 'Pronto' },
  { status: 'DELIVERED', label: 'Entregue' },
];

const stepIndex = (s: OrderStatus) => (s === 'AWAITING_PART' ? 2 : STEPS.findIndex((x) => x.status === s));

const HINT: Record<OrderStatus, string> = {
  QUOTE: 'Estamos preparando seu orçamento. Enquanto isso, você já pode completar seus dados e o checklist.',
  APPROVED: 'Orçamento aprovado! Seu carro entra na fila de serviço.',
  IN_PROGRESS: 'Nossa equipe está trabalhando no seu carro.',
  AWAITING_PART: 'Estamos aguardando a chegada de uma peça para continuar.',
  COMPLETED: 'Serviço concluído! Seu carro está pronto para retirada.',
  DELIVERED: 'Veículo entregue. Obrigado pela confiança!',
  CANCELLED: 'Esta ordem foi cancelada. Fale com a oficina se tiver dúvidas.',
};

export function Hero({ order }: { order: PortalOrder }) {
  const { vehicle, status } = order;
  const current = stepIndex(status);
  const cancelled = status === 'CANCELLED';
  const progress = cancelled ? 0 : (current / (STEPS.length - 1)) * 100;

  return (
    <section className="overflow-hidden rounded-3xl bg-brand-secondary text-white shadow-lg">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-white/60">Ordem de serviço #{order.number}</p>
            <h1 className="text-2xl font-semibold leading-tight">
              {vehicle.brand} {vehicle.model}
            </h1>
            <p className="text-sm text-white/70">{[vehicle.year, vehicle.color].filter(Boolean).join(' · ') || 'Seu veículo'}</p>
          </div>
          <PlateBadge plate={vehicle.plate} />
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${cancelled ? 'bg-red-500/20 text-red-200' : 'bg-white/15'}`}
            >
              {status === 'AWAITING_PART' ? <Icon name="clock" className="size-4" /> : !cancelled && <span className="size-2 animate-pulse rounded-full bg-emerald-400" />}
              {STATUS_LABEL[status]}
            </span>
          </div>
          <p className="text-sm text-white/80">{HINT[status]}</p>
        </div>

        {!cancelled && (
          <ol className="relative flex justify-between pt-1" aria-label="Etapas da ordem de serviço">
            <div className="absolute inset-x-3 top-[19px] h-0.5 bg-white/20" aria-hidden="true">
              <div className="h-full bg-emerald-400 transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            {STEPS.map((step, i) => {
              const done = i < current || status === 'DELIVERED';
              const active = i === current && status !== 'DELIVERED';
              return (
                <li key={step.status} className="relative z-10 flex w-16 flex-col items-center gap-1.5 text-center" aria-current={active ? 'step' : undefined}>
                  <span
                    className={`grid size-[22px] place-items-center rounded-full border-2 transition-colors ${
                      done ? 'border-emerald-400 bg-emerald-400 text-brand-secondary' : active ? 'border-white bg-brand-secondary ring-4 ring-white/20' : 'border-white/30 bg-brand-secondary'
                    }`}
                  >
                    {done && <Icon name="check" className="size-3" strokeWidth={3} />}
                    {active && <span className="size-2 rounded-full bg-card" />}
                  </span>
                  <span className={`text-[11px] leading-tight ${active ? 'font-semibold text-white' : 'text-white/60'}`}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
