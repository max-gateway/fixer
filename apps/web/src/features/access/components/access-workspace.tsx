'use client';

import { CircleAlert, Grid3x3, History, Info, KeyRound, MailPlus, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToastProvider } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAccessData } from '../hooks';
import { ACCESS_MANAGE, countByStatus, EMPTY_FILTER, type MemberFilter } from '../model';
import type { AccessInitial, DirectoryState, Seats } from '../types';
import { AuditPanel } from './audit-panel';
import { InviteDialog } from './invite-dialog';
import { MembersPanel } from './members-panel';
import { PermissionMatrix } from './permission-matrix';
import { RolesPanel } from './roles-panel';

type Tab = 'pessoas' | 'papeis' | 'matriz' | 'historico';

/**
 * Tela de acessos: pessoas, papéis, matriz de permissões e histórico. Só depende dos hooks do módulo (que dependem do
 * cliente injetável), então pode ser montada em qualquer rota ou host.
 */
export function AccessWorkspace({ initial, initialTab = 'pessoas' }: { initial: AccessInitial; initialTab?: Tab }) {
  return (
    <ToastProvider>
      <TooltipProvider>
        <Workspace initial={initial} initialTab={initialTab} />
      </TooltipProvider>
    </ToastProvider>
  );
}

function Workspace({ initial, initialTab }: { initial: AccessInitial; initialTab: Tab }) {
  const { me, catalog, roles, members } = useAccessData(initial);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filter, setFilter] = useState<MemberFilter>(EMPTY_FILTER);
  const [inviteOpen, setInviteOpen] = useState(false);
  const canManage = me.permissions.includes(ACCESS_MANAGE);
  const counts = useMemo(() => countByStatus(members.members), [members.members]);
  const managerCount = members.members.filter((m) => m.isManager).length;
  const canInvite = canManage && members.directory.status === 'ok';

  const showPeople = (patch: Partial<MemberFilter>) => {
    setFilter({ ...EMPTY_FILTER, ...patch });
    setTab('pessoas');
  };

  return (
    <section className="space-y-6">
      <header className="relative overflow-hidden rounded-2xl border bg-card px-5 py-5 shadow-xs sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--brand-primary)_22%,transparent),transparent_70%)]"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-secondary text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]">
              <KeyRound aria-hidden className="size-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Acessos</h1>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">Quem entra na oficina e o que cada pessoa pode fazer. Papéis agrupam permissões; cada pessoa pode ter vários.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SeatMeter seats={members.seats} />
            {canManage && (
              <Button onClick={() => setInviteOpen(true)} disabled={!canInvite} title={canInvite ? undefined : 'Convites indisponíveis: veja o aviso abaixo'} className="shadow-[0_6px_16px_-6px_var(--brand-primary)]">
                <MailPlus /> Convidar pessoa
              </Button>
            )}
          </div>
        </div>
      </header>

      <DirectoryNotice directory={members.directory} canManage={canManage} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<UserCheck />} label="Ativas" value={counts.active} sub="já entraram" onClick={() => showPeople({ status: 'active' })} />
        <Stat icon={<MailPlus />} label="Convites pendentes" value={counts.invited} sub={counts.invited ? 'aguardando o 1º acesso' : 'nenhum pendente'} onClick={() => showPeople({ status: 'invited' })} tone={counts.invited ? 'info' : undefined} />
        <Stat icon={<ShieldCheck />} label="Administradores" value={managerCount} sub={managerCount === 1 ? 'só uma pessoa: considere outra' : 'gerenciam os acessos'} tone={managerCount <= 1 ? 'warn' : undefined} onClick={() => showPeople({})} />
        <Stat icon={<KeyRound />} label="Papéis" value={roles.length} sub={`${catalog.groups.reduce((n, g) => n + g.permissions.length, 0)} permissões no catálogo`} onClick={() => setTab('papeis')} />
      </dl>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
        <TabsList className="h-10 w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="pessoas" className="group px-3">
            <Users /> Pessoas <Count n={counts.all} />
          </TabsTrigger>
          <TabsTrigger value="papeis" className="group px-3">
            <KeyRound /> Papéis <Count n={roles.length} />
          </TabsTrigger>
          <TabsTrigger value="matriz" className="group px-3">
            <Grid3x3 /> Matriz
          </TabsTrigger>
          <TabsTrigger value="historico" className="group px-3">
            <History /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pessoas">
          <MembersPanel members={members.members} roles={roles} catalog={catalog} filter={filter} onFilter={setFilter} canManage={canManage} directory={members.directory} />
        </TabsContent>
        <TabsContent value="papeis">
          <RolesPanel roles={roles} catalog={catalog} canManage={canManage} />
        </TabsContent>
        <TabsContent value="matriz">
          <PermissionMatrix roles={roles} catalog={catalog} canManage={canManage} onOpenRole={() => setTab('papeis')} />
        </TabsContent>
        <TabsContent value="historico">
          <AuditPanel catalog={catalog} />
        </TabsContent>
      </Tabs>

      {canManage && <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={roles} catalog={catalog} seats={members.seats} />}
    </section>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground tabular group-data-[state=active]:bg-brand-soft">{n}</span>;
}

function Stat({ icon, label, value, sub, tone, onClick }: { icon: ReactNode; label: string; value: number; sub: string; tone?: 'warn' | 'info'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-0.5 rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-all hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon} {label}
      </dt>
      <dd className="text-2xl font-semibold tracking-tight tabular">{value}</dd>
      <dd className={cn('text-xs text-muted-foreground', tone === 'warn' && 'text-amber-800', tone === 'info' && 'text-sky-800')}>{sub}</dd>
    </button>
  );
}

/** Ocupação de usuários do plano (só aparece quando o plano limita). */
function SeatMeter({ seats }: { seats: Seats }) {
  if (seats.max === null) return null;
  const pct = Math.min(100, Math.round((seats.used / Math.max(1, seats.max)) * 100));
  const full = seats.used >= seats.max;
  return (
    <div className="min-w-36" title="Usuários ativos do plano">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">Usuários do plano</span>
        <span className={cn('font-semibold tabular', full && 'text-red-700')}>
          {seats.used}/{seats.max}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={seats.max} aria-valuenow={seats.used} aria-label="Usuários do plano">
        <div className={cn('h-full rounded-full transition-[width] duration-500', full ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-brand')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DirectoryNotice({ directory, canManage }: { directory: DirectoryState; canManage: boolean }) {
  if (directory.status === 'ok' || !canManage) return null;
  const off = directory.status === 'off';
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-xl border p-4 text-sm', off ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-amber-200 bg-amber-50 text-amber-950')}>
      {off ? <Info aria-hidden className="mt-0.5 size-4 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <div>
        <p className="font-medium">{off ? 'Convites desligados' : 'Não foi possível consultar o diretório de login'}</p>
        <p className="mt-0.5 opacity-90">
          {off
            ? 'Papéis e permissões funcionam normalmente para quem já entrou. Para convidar pessoas, configure o client de administração do Keycloak na API.'
            : `${directory.message ?? 'Tente de novo em instantes.'} A lista mostra só quem já entrou no Fixer.`}
        </p>
      </div>
    </div>
  );
}
