'use client';

import { Check, ExternalLink, MessageCircle, Phone, UserRoundCog } from 'lucide-react';
import { Plate } from '@/components/orders/status-badge';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { brl0, MECHANICS, orderTotal, PRIMARY_NEXT, TRANSITIONS, sinceLabel, type MockOrder } from './mock-data';
import { ChecklistBar, DueChip, Initials, PriorityMark, StatusLabel } from './order-bits';

const STEPS: OrderStatus[] = ['QUOTE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED'];

type Props = {
  order: MockOrder | null;
  onClose: () => void;
  onMove: (id: string, to: OrderStatus) => void;
  onAssign: (id: string, mechanicId: string | null) => void;
  onNotify: (id: string) => void;
};

/** Visão rápida: decide e age sem sair da lista. A ordem completa fica a um clique, para o que exige mais contexto. */
export function OrderPeek({ order, onClose, onMove, onAssign, onNotify }: Props) {
  return (
    <Sheet open={!!order} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-[32rem]">{order && <Body order={order} onMove={onMove} onAssign={onAssign} onNotify={onNotify} />}</SheetContent>
    </Sheet>
  );
}

function Body({ order: o, onMove, onAssign, onNotify }: Omit<Props, 'order' | 'onClose'> & { order: MockOrder }) {
  const next = TRANSITIONS[o.status];
  const primary = PRIMARY_NEXT[o.status];
  const stepIndex = STEPS.indexOf(o.status === 'AWAITING_PART' ? 'IN_PROGRESS' : o.status);
  const mechanic = MECHANICS.find((m) => m.id === o.mechanicId);

  return (
    <>
      <header className="space-y-3 border-b px-5 pt-5 pb-4 pr-14">
        <div className="flex items-center gap-2">
          <SheetTitle className="tabular">Ordem #{o.number}</SheetTitle>
          <PriorityMark priority={o.priority} />
          <StatusLabel status={o.status} />
        </div>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <Plate value={o.vehicle.plate} />
          <span>
            {o.vehicle.brand} {o.vehicle.model} · {o.vehicle.year}
          </span>
        </SheetDescription>

        {o.status === 'CANCELLED' ? null : (
          <ol className="flex items-center gap-1 pt-1" aria-label="Etapas da ordem">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-1 flex-col gap-1">
                <span className={cn('h-1 rounded-full transition-colors', i <= stepIndex ? 'bg-slate-900' : 'bg-slate-200')} />
                <span className={cn('text-[10px] leading-none', i === stepIndex ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{STATUS_LABEL[s]}</span>
              </li>
            ))}
          </ol>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 px-5 py-5">
          <div className="flex flex-wrap gap-2">
            {primary && (
              <Button onClick={() => onMove(o.id, primary.to)}>
                <Check aria-hidden /> {primary.label}
              </Button>
            )}
            {next
              .filter((s) => s !== primary?.to)
              .map((s) => (
                <Button key={s} variant={s === 'CANCELLED' ? 'ghost' : 'outline'} className={s === 'CANCELLED' ? 'text-destructive hover:text-destructive' : ''} onClick={() => onMove(o.id, s)}>
                  {s === 'CANCELLED' ? 'Cancelar' : `Mover p/ ${STATUS_LABEL[s].toLowerCase()}`}
                </Button>
              ))}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Cliente</dt>
              <dd className="font-medium">{o.customer.name}</dd>
              <dd className="tabular text-muted-foreground">{o.customer.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prazo</dt>
              <dd>{o.promisedAt ? <DueChip order={o} className="text-xs" /> : <span className="text-muted-foreground">A definir</span>}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">Última movimentação há {sinceLabel(o.updatedAt)}</dd>
            </div>
            <div>
              <dt className="mb-1 text-xs text-muted-foreground">Mecânico</dt>
              <dd>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-2 rounded-lg border bg-card px-2 py-1 text-sm shadow-xs hover:border-ring/50">
                      {mechanic ? <Initials name={mechanic.name} className="size-5 text-[9px]" /> : <UserRoundCog aria-hidden className="size-4 text-muted-foreground" />}
                      {mechanic?.name ?? 'Atribuir'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-0">
                    <Command>
                      <CommandList>
                        <CommandGroup heading="Equipe">
                          {MECHANICS.map((m) => (
                            <CommandItem key={m.id} value={m.name} onSelect={() => onAssign(o.id, m.id)}>
                              <Initials name={m.name} className="size-5 text-[9px]" />
                              {m.name}
                              {m.id === o.mechanicId && <Check aria-hidden className="ml-auto size-4" />}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-xs text-muted-foreground">Checklist</dt>
              <dd>
                <ChecklistBar done={o.checklist.done} total={o.checklist.total} />
              </dd>
            </div>
          </dl>

          <section aria-labelledby="peek-items">
            <h3 id="peek-items" className="mb-2 text-sm font-semibold">
              Serviços e peças
            </h3>
            <ul className="divide-y rounded-xl border text-sm">
              {o.services.map((s) => (
                <li key={s.name} className="flex justify-between gap-3 px-3 py-2">
                  <span>{s.name}</span>
                  <span className="tabular text-muted-foreground">{brl0(s.price)}</span>
                </li>
              ))}
              {o.parts.map((p) => (
                <li key={p.name} className="flex justify-between gap-3 bg-slate-50/60 px-3 py-2">
                  <span>
                    {p.name} <span className="text-muted-foreground">× {p.qty}</span>
                  </span>
                  <span className="tabular text-muted-foreground">{brl0(p.price * p.qty)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 bg-slate-50 px-3 py-2.5 font-semibold">
                <span>Total</span>
                <span className="tabular">{brl0(orderTotal(o))}</span>
              </li>
            </ul>
          </section>

          <section aria-labelledby="peek-history">
            <h3 id="peek-history" className="mb-3 text-sm font-semibold">
              Histórico
            </h3>
            <ol className="relative space-y-4 border-l pl-4">
              {[...o.timeline].reverse().map((t, i) => (
                <li key={i} className="relative">
                  <span aria-hidden className="absolute top-1.5 -left-[1.28rem] size-2 rounded-full bg-slate-400 ring-4 ring-background" />
                  <p className="text-sm">{t.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.by} · há {sinceLabel(t.at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </ScrollArea>

      <footer className="flex flex-wrap gap-2 border-t bg-card/80 px-5 py-3">
        <Button variant="outline" size="sm" onClick={() => onNotify(o.id)}>
          <MessageCircle aria-hidden /> Avisar no WhatsApp
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`tel:${o.customer.phone.replace(/\D/g, '')}`}>
            <Phone aria-hidden /> Ligar
          </a>
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" disabled title="No conceito, abre /ordens/[id]">
          Ordem completa <ExternalLink aria-hidden />
        </Button>
      </footer>
    </>
  );
}
