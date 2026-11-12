'use client';

import { CarFront, ChevronRight, Clock, Loader2, ScanLine, Search, Type, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { VehicleFilter } from '@/lib/part-search';
import { cn } from '@/lib/utils';
import { normalizePlate, PLATE_RE, pushRecentVehicle, toFilter, vehicleName, yearsOf, type DirectoryVehicle, type VehicleOption } from '@/lib/vehicles';
import { usePlateVehicles, useShopVehicles, useStored, useVehicleFacets, useVehicleResolve } from './use-parts';

const DEBOUNCE_MS = 250;
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * O veículo da busca: um botão largo acima do campo (como no storefront, é a ação que mais evita peça errada). Com veículo, mostra qual é, troca e
 * remove; sem, convida a escolher. A escolha abre o seletor (controlado pela página, que também o abre de outros lugares).
 */
export function VehicleBar({ vehicle, onChange, open, onOpenChange: setOpen }: { vehicle?: VehicleFilter; onChange: (v: VehicleFilter | undefined) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [recents, setRecents] = useStored<VehicleFilter[]>('pecas:veiculos', []);
  const pick = (v: VehicleFilter) => {
    setRecents((r) => pushRecentVehicle(r, v));
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      {vehicle ? (
        <div className="flex items-center gap-2 rounded-2xl border border-brand/30 bg-brand-soft py-2 pr-2 pl-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-primary-foreground">
            <CarFront aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-brand">{vehicle.label}</span>
            <span className="block text-xs text-muted-foreground">Só peças que servem neste veículo</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Trocar
          </Button>
          <button type="button" onClick={() => onChange(undefined)} aria-label={`Remover o veículo ${vehicle.label}`} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground">
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex w-full items-center gap-3 rounded-2xl border border-dashed bg-card py-2 pr-3 pl-3 text-left transition-colors hover:border-brand/50 hover:bg-brand-soft"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground group-hover:bg-brand group-hover:text-primary-foreground">
            <CarFront aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Escolher veículo</span>
            <span className="block text-xs text-muted-foreground">Pela placa ou pelo modelo: a busca mostra só o que serve</span>
          </span>
          <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-xl" aria-describedby="vehicle-picker-desc">
          {open && <VehiclePicker recents={recents} onPick={pick} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Tab = 'modelo' | 'placa';

function VehiclePicker({ recents, onPick }: { recents: VehicleFilter[]; onPick: (v: VehicleFilter) => void }) {
  const [tab, setTab] = useState<Tab>('modelo');
  const [plate, setPlate] = useState<string>();
  const shop = useShopVehicles(true);

  const shortcuts = (shop.data?.length ?? 0) > 0 || recents.length > 0;
  return (
    <>
      <div className="border-b px-5 pt-5 pb-4 pr-14">
        <DialogTitle>Para qual veículo?</DialogTitle>
        <DialogDescription id="vehicle-picker-desc">A busca passa a mostrar só as peças que servem nele, e cada sugestão diz se serve.</DialogDescription>
        <div role="tablist" aria-label="Como escolher" className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(
            [
              ['modelo', Type, 'Marca e modelo'],
              ['placa', ScanLine, 'Placa'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn('flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors', tab === value ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon aria-hidden className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === 'modelo' ? <ModelTab onPick={onPick} /> : <PlateTab plate={plate} onPlate={setPlate} onPick={onPick} onManual={() => setTab('modelo')} />}
      </div>

      {shortcuts && (
        <div className="space-y-3 border-t bg-muted/40 px-5 py-4">
          {(shop.data?.length ?? 0) > 0 && (
            <Shortcuts title="Na oficina agora" icon={<Wrench aria-hidden className="size-3.5" />}>
              {shop.data!.map((v) => (
                <Chip
                  key={v.plate}
                  onClick={() => {
                    setTab('placa');
                    setPlate(v.plate);
                  }}
                  title={`OS ${v.orderNumber}`}
                >
                  <span className="tabular rounded bg-background px-1 font-mono text-[0.7rem] tracking-wider">{v.plate}</span> {v.label}
                </Chip>
              ))}
            </Shortcuts>
          )}
          {recents.length > 0 && (
            <Shortcuts title="Recentes" icon={<Clock aria-hidden className="size-3.5" />}>
              {recents.map((v) => (
                <Chip key={v.id} onClick={() => onPick(v)}>
                  {v.label}
                </Chip>
              ))}
            </Shortcuts>
          )}
        </div>
      )}
    </>
  );
}

// --- marca e modelo ----------------------------------------------------------------------------------------------------

type Nav = { make?: string; model?: string; year?: number };

/** Texto livre ("gol 1.6 2015") ou, sem texto, a cascata montadora → modelo → ano → versão. */
function ModelTab({ onPick }: { onPick: (v: VehicleFilter) => void }) {
  const [input, setInput] = useState('');
  const [text, setText] = useState('');
  const [nav, setNav] = useState<Nav>({});
  useEffect(() => {
    const t = setTimeout(() => setText(input), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const searching = text.trim().length >= 2;
  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">Buscar veículo</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Digite o carro: gol 1.6 2015, strada working…"
          className="h-12 w-full rounded-xl border bg-background pr-3 pl-10 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
        />
      </label>
      {searching ? <Resolved text={text} onPick={onPick} /> : <Cascade nav={nav} onNav={setNav} onPick={onPick} />}
    </div>
  );
}

function Resolved({ text, onPick }: { text: string; onPick: (v: VehicleFilter) => void }) {
  const resolve = useVehicleResolve(text);
  if (resolve.isError) return <ErrorBox message={resolve.error.message} onRetry={() => resolve.refetch()} />;
  if (!resolve.data) return <ListSkeleton />;
  if (resolve.data.data.length === 0)
    return <Empty>Nenhum veículo com “{text.trim()}”. Tente só o modelo (ex.: “strada”) ou navegue pelas montadoras apagando o texto.</Empty>;
  const year = resolve.data.year;
  return (
    <ul aria-label="Veículos encontrados" className={cn('space-y-1', resolve.isFetching && 'opacity-60')}>
      {resolve.data.data.map((v) => (
        <VehicleRow key={v.vehicleId} vehicle={v} onClick={() => onPick(toFilter(v, year))} />
      ))}
    </ul>
  );
}

function Cascade({ nav, onNav, onPick }: { nav: Nav; onNav: (n: Nav) => void; onPick: (v: VehicleFilter) => void }) {
  const facets = useVehicleFacets(nav);
  const [filter, setFilter] = useState('');
  useEffect(() => setFilter(''), [nav.make, nav.model]);
  const data = facets.data;

  const crumbs: { label: string; to: Nav }[] = [
    { label: 'Montadoras', to: {} },
    ...(nav.make ? [{ label: nav.make, to: { make: nav.make } }] : []),
    ...(nav.make && nav.model ? [{ label: nav.model, to: { make: nav.make, model: nav.model } }] : []),
    ...(nav.make && nav.model && nav.year ? [{ label: String(nav.year), to: nav }] : []),
  ];

  return (
    <div className="space-y-3">
      <nav aria-label="Etapas" className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <span key={c.label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />}
            {i === crumbs.length - 1 ? (
              <span className="font-semibold">{c.label}</span>
            ) : (
              <button type="button" onClick={() => onNav(c.to)} className="text-brand hover:underline">
                {c.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      {facets.isError ? (
        <ErrorBox message={facets.error.message} onRetry={() => facets.refetch()} />
      ) : !data ? (
        <ListSkeleton />
      ) : !nav.make ? (
        <OptionGrid label="Montadoras" options={data.makes} filter={filter} onFilter={setFilter} onPick={(make) => onNav({ make })} />
      ) : !nav.model ? (
        <OptionGrid label={`Modelos ${nav.make}`} options={data.models ?? []} filter={filter} onFilter={setFilter} onPick={(model) => onNav({ make: nav.make, model })} />
      ) : (
        <div className={cn('space-y-4', facets.isFetching && 'opacity-60')}>
          {(data.years?.length ?? 0) > 0 && (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ano</legend>
              <div className="flex flex-wrap gap-1.5">
                <YearChip active={!nav.year} onClick={() => onNav({ make: nav.make, model: nav.model })}>
                  Todos
                </YearChip>
                {data.years!.map((y) => (
                  <YearChip key={y} active={nav.year === y} onClick={() => onNav({ ...nav, year: y })}>
                    {y}
                  </YearChip>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Versão</p>
            {(data.vehicles?.length ?? 0) === 0 ? (
              <Empty>Nenhuma versão {nav.year ? `de ${nav.year}` : ''} com peças no catálogo.</Empty>
            ) : (
              <ul aria-label="Versões" className="space-y-1">
                {data.vehicles!.map((v) => (
                  <VehicleRow key={v.vehicleId} vehicle={v} onClick={() => onPick(toFilter(v, nav.year))} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Montadoras ou modelos: as com mais peças primeiro (é onde a oficina mais trabalha), com filtro quando a lista é longa. */
function OptionGrid({ label, options, filter, onFilter, onPick }: { label: string; options: VehicleOption[]; filter: string; onFilter: (f: string) => void; onPick: (name: string) => void }) {
  const sorted = useMemo(() => [...options].sort((a, b) => b.parts - a.parts || a.name.localeCompare(b.name, 'pt-BR')), [options]);
  const shown = filter ? sorted.filter((o) => fold(o.name).includes(fold(filter))) : sorted;
  if (options.length === 0) return <Empty>Nada por aqui ainda.</Empty>;
  return (
    <div className="space-y-2">
      {options.length > 12 && (
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          aria-label={`Filtrar ${label.toLowerCase()}`}
          placeholder={`Filtrar ${label.toLowerCase()}`}
          className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
        />
      )}
      <ul aria-label={label} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {shown.map((o) => (
          <li key={o.name}>
            <button type="button" onClick={() => onPick(o.name)} className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm hover:border-brand/50 hover:bg-brand-soft">
              <span className="truncate font-medium">{o.name}</span>
              <span className="tabular shrink-0 text-xs text-muted-foreground">{o.vehicles}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="col-span-full text-sm text-muted-foreground">Nada com “{filter}”.</li>}
      </ul>
    </div>
  );
}

// --- placa -------------------------------------------------------------------------------------------------------------

function PlateTab({ plate, onPlate, onPick, onManual }: { plate?: string; onPlate: (p: string) => void; onPick: (v: VehicleFilter) => void; onManual: () => void }) {
  const [input, setInput] = useState(plate ?? '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (plate) setInput(plate);
  }, [plate]);
  const result = usePlateVehicles(plate);

  const submit = () => {
    const p = normalizePlate(input);
    if (!PLATE_RE.test(p)) return setInvalid(true);
    setInvalid(false);
    onPlate(p);
  };

  return (
    <div className="space-y-4">
      <form
        className="flex items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="relative flex-1">
          <span className="sr-only">Placa</span>
          <span aria-hidden className="absolute inset-x-0 top-0 h-3 rounded-t-[0.6rem] bg-blue-700 text-center text-[0.5rem] leading-3 font-bold tracking-[0.3em] text-white">
            BRASIL
          </span>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(normalizePlate(e.target.value))}
            placeholder="ABC1D23"
            aria-invalid={invalid}
            className="h-14 w-full rounded-xl border-2 border-foreground bg-background pt-2 text-center font-mono text-2xl font-bold tracking-[0.25em] uppercase outline-none placeholder:text-muted-foreground/50 focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/20"
          />
        </label>
        <Button type="submit" className="h-14 px-5" disabled={result.isFetching}>
          {result.isFetching ? <Loader2 aria-hidden className="animate-spin" /> : 'Buscar'}
        </Button>
      </form>
      {invalid && <p className="text-sm text-destructive">Placa inválida. Use o formato ABC1234 ou ABC1D23.</p>}

      {result.isError && <ErrorBox message={result.error.message} onRetry={() => result.refetch()} />}
      {result.data &&
        (!result.data.vehicle ? (
          <Empty>
            Não encontramos os dados dessa placa.{' '}
            <button type="button" onClick={onManual} className="font-medium text-brand underline underline-offset-2">
              Escolha pela marca e modelo.
            </button>
          </Empty>
        ) : (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs tracking-wider">{result.data.plate}</span>
              <span className="font-medium">{result.data.vehicle.label}</span>
              {result.data.vehicle.year && <span className="text-muted-foreground">· {result.data.vehicle.year}</span>}
            </p>
            {result.data.candidates.length === 0 ? (
              <Empty>
                O catálogo não tem esse modelo pelo nome que a placa traz.{' '}
                <button type="button" onClick={onManual} className="font-medium text-brand underline underline-offset-2">
                  Escolha pela marca e modelo.
                </button>
              </Empty>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Qual destas versões é o carro?</p>
                <ul aria-label="Versões da placa" className="space-y-1">
                  {result.data.candidates.map((v) => (
                    <VehicleRow key={v.vehicleId} vehicle={v} onClick={() => onPick(toFilter(v, result.data!.vehicle?.year))} />
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
    </div>
  );
}

// --- peças --------------------------------------------------------------------------------------------------------------

function VehicleRow({ vehicle, onClick }: { vehicle: DirectoryVehicle; onClick: () => void }) {
  const detail = [vehicle.engine && `Motor ${vehicle.engine}`, yearsOf(vehicle)].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-brand/30 hover:bg-brand-soft">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground group-hover:bg-brand group-hover:text-primary-foreground">
          <CarFront aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{vehicleName(vehicle)}</span>
          <span className="tabular block truncate text-xs text-muted-foreground">
            {detail && `${detail} · `}
            {vehicle.partCount.toLocaleString('pt-BR')} {vehicle.partCount === 1 ? 'peça' : 'peças'}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
      </button>
    </li>
  );
}

function YearChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn('tabular rounded-lg border px-2.5 py-1 text-sm', active ? 'border-brand bg-brand text-primary-foreground' : 'bg-card hover:border-brand/50')}>
      {children}
    </button>
  );
}

function Shortcuts({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon} {title}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border bg-card px-3 py-1 text-sm hover:border-brand/50 hover:bg-brand-soft">
      {children}
    </button>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>;

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      {message}
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 rounded-xl" />
      ))}
    </div>
  );
}
