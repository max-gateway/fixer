'use client';

import { Check, ChevronDown, ExternalLink, Eye, FileText, MessageCircle, MessageCircleOff, Phone, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { brl0, dueLabel, health, LANES, MECHANICS, orderTotal, PRIMARY_NEXT, situation, sinceLabel, TRANSITIONS, type MockOrder } from './mock-data';
import { ChecklistBar, DueChip, Initials, PlateMark, PriorityMark, Slash } from './order-bits';

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
      {/* O fechar do Sheet fica sobre o cabeçalho escuro: clareia o X. */}
      <SheetContent className="overflow-hidden sm:max-w-[32rem] [&>button[aria-label=Fechar]]:text-white/70 [&>button[aria-label=Fechar]]:hover:bg-white/10 [&>button[aria-label=Fechar]]:hover:text-white">
        {order && <Body order={order} onMove={onMove} onAssign={onAssign} onNotify={onNotify} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ order: o, onMove, onAssign, onNotify }: Omit<Props, 'order' | 'onClose'> & { order: MockOrder }) {
  const s = situation(o);
  const lane = LANES.find((l) => l.id === s.lane)!;
  const primary = PRIMARY_NEXT[o.status];
  const others = TRANSITIONS[o.status].filter((t) => t !== primary?.to);
  const stepIndex = STEPS.indexOf(o.status === 'AWAITING_PART' ? 'IN_PROGRESS' : o.status);
  const mechanic = MECHANICS.find((m) => m.id === o.mechanicId);

  return (
    <>
      <header className="space-y-4 bg-brand-secondary px-5 pt-5 pb-5 pr-14 text-white">
        <div className="flex items-start gap-4">
          <PlateMark value={o.vehicle.plate} size="lg" />
          <div className="min-w-0 space-y-0.5">
            <SheetTitle className="font-display flex items-center gap-1.5 text-xl">
              {o.vehicle.brand} {o.vehicle.model}
              <PriorityMark priority={o.priority} />
            </SheetTitle>
            <SheetDescription className="text-white/60">
              {o.vehicle.year} · <span className="tabular">Ordem #{o.number}</span> · {STATUS_LABEL[o.status]}
            </SheetDescription>
          </div>
        </div>

        <div className={cn('rounded-xl px-3.5 py-3', s.late ? 'bg-red-500/15' : 'bg-white/[0.07]')}>
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-widest text-white/60 uppercase">
            <Slash className={s.late ? 'bg-red-400' : undefined} /> {lane.label}
          </p>
          <p className={cn('mt-1 text-sm font-medium', s.late ? 'text-red-200' : 'text-white')}>{s.text}</p>
        </div>

        {o.status !== 'CANCELLED' && (
          <ol className="flex items-center gap-1" aria-label="Etapas da ordem">
            {STEPS.map((st, i) => (
              <li key={st} className="flex flex-1 flex-col gap-1.5">
                <span className={cn('h-1 -skew-x-[35deg] rounded-[1px]', i <= stepIndex ? 'bg-brand' : 'bg-white/15')} />
                <span className={cn('text-[10px] leading-none', i === stepIndex ? 'font-semibold text-white' : 'text-white/50')}>{STATUS_LABEL[st]}</span>
              </li>
            ))}
          </ol>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 px-5 py-5">
          {(primary || others.length > 0) && (
            <div className="flex gap-2">
              {primary && (
                <Button size="lg" className="flex-1" onClick={() => onMove(o.id, primary.to)}>
                  <Check aria-hidden /> {primary.label}
                </Button>
              )}
              {others.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="lg" variant="outline">
                      Outras ações <ChevronDown aria-hidden />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-0">
                    <Command>
                      <CommandList>
                        <CommandGroup>
                          {others.map((t) => (
                            <CommandItem key={t} value={t} onSelect={() => onMove(o.id, t)} className={t === 'CANCELLED' ? 'text-destructive' : undefined}>
                              {t === 'CANCELLED' ? 'Cancelar a ordem' : `Mover para ${STATUS_LABEL[t].toLowerCase()}`}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Cliente</dt>
              <dd className="font-medium">{o.customer.name}</dd>
              <dd className="tabular text-muted-foreground">{o.customer.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prazo</dt>
              <dd>{health(o) !== 'none' ? <DueChip order={o} /> : <span className="text-muted-foreground">{dueLabel(o) ?? 'A definir'}</span>}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">Mexida há {sinceLabel(o.updatedAt)}</dd>
            </div>
            <div>
              <dt className="mb-1 text-xs text-muted-foreground">Mecânico</dt>
              <dd>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-2 rounded-lg border bg-card px-2 py-1 text-sm shadow-xs hover:border-ring/50',
                        !mechanic && 'border-brand/50 bg-brand-soft font-medium text-brand',
                      )}
                    >
                      {mechanic ? <Initials name={mechanic.name} className="size-5 text-[9px]" /> : <UserRoundCog aria-hidden className="size-4" />}
                      {mechanic?.name ?? 'Escolher mecânico'}
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

          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              {o.whatsappLinked ? <MessageCircle aria-hidden className="size-4 text-emerald-600" /> : <MessageCircleOff aria-hidden className="size-4 text-muted-foreground" />}
              {o.whatsappLinked ? 'Recebe os avisos pelo WhatsApp' : 'WhatsApp não vinculado: envie o código OS ao cliente'}
            </li>
            {o.portalViewed && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <Eye aria-hidden className="size-4" /> Cliente já abriu o portal
              </li>
            )}
            {o.invoice === 'pending' && (
              <li className="flex items-center gap-2 font-medium text-amber-800">
                <FileText aria-hidden className="size-4" /> Nota fiscal pendente
              </li>
            )}
          </ul>

          <section aria-labelledby="peek-items">
            <h3 id="peek-items" className="mb-2 text-sm font-bold">
              Serviços e peças
            </h3>
            <ul className="surface divide-y overflow-hidden rounded-xl border bg-card text-sm">
              {o.services.map((sv) => (
                <li key={sv.name} className="flex justify-between gap-3 px-3 py-2">
                  <span>{sv.name}</span>
                  <span className="tabular text-muted-foreground">{brl0(sv.price)}</span>
                </li>
              ))}
              {o.parts.map((p) => (
                <li key={p.name} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    {p.name} <span className="text-muted-foreground">× {p.qty}</span>
                  </span>
                  <span className="tabular text-muted-foreground">{brl0(p.price * p.qty)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 bg-brand-secondary px-3 py-2.5 font-semibold text-white">
                <span>Total</span>
                <span className="tabular font-display">{brl0(orderTotal(o))}</span>
              </li>
            </ul>
          </section>

          <section aria-labelledby="peek-history">
            <h3 id="peek-history" className="mb-3 text-sm font-bold">
              Histórico
            </h3>
            <ol className="relative space-y-4 border-l pl-4">
              {[...o.timeline].reverse().map((t, i) => (
                <li key={i} className="relative">
                  <span aria-hidden className={cn('absolute top-1.5 -left-[1.28rem] size-2 rounded-full ring-4 ring-background', i === 0 ? 'bg-brand' : 'bg-slate-300')} />
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

      <footer className="flex flex-wrap gap-2 border-t bg-card px-5 py-3">
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
