// Regras de apresentação da tela de acessos. Puras (sem React): fáceis de testar e de reaproveitar.
import type { AuditItem, Catalog, CatalogGroup, Member, MemberStatus, Role } from './types';

export const STATUS_META: Record<MemberStatus, { label: string; hint: string; dot: string; chip: string }> = {
  active: { label: 'Ativo', hint: 'Já entrou no sistema', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-600/15' },
  invited: { label: 'Convidado', hint: 'Ainda não fez o primeiro acesso', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800 ring-sky-600/15' },
  unlinked: { label: 'Sem acesso', hint: 'Está na organização, mas sem papel no Fixer', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-500/15' },
  inactive: { label: 'Desativado', hint: 'Não consegue entrar nesta oficina', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-900 ring-amber-600/20' },
  blocked: { label: 'Conta bloqueada', hint: 'A conta está desabilitada no login (Keycloak)', dot: 'bg-red-500', chip: 'bg-red-50 text-red-800 ring-red-600/15' },
};

export const STATUS_ORDER: MemberStatus[] = ['active', 'invited', 'unlinked', 'inactive', 'blocked'];

/** Matiz estável por nome: cada papel tem sempre a mesma cor em todas as telas. */
export function roleHue(name: string): number {
  let h = 7;
  for (const c of name) h = (h * 33 + c.codePointAt(0)!) % 360;
  return h;
}

export const roleStyle = (role: Pick<Role, 'name' | 'isSystem'>) =>
  role.isSystem
    ? { backgroundColor: 'color-mix(in oklab, var(--brand-primary) 12%, white)', color: 'var(--brand-hover)', borderColor: 'color-mix(in oklab, var(--brand-primary) 30%, white)' }
    : { backgroundColor: `oklch(0.96 0.03 ${roleHue(role.name)})`, color: `oklch(0.38 0.09 ${roleHue(role.name)})`, borderColor: `oklch(0.88 0.05 ${roleHue(role.name)})` };

export type MemberFilter = { q: string; status: MemberStatus | 'all'; roleId: string | 'all' };
export const EMPTY_FILTER: MemberFilter = { q: '', status: 'all', roleId: 'all' };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function filterMembers(members: Member[], f: MemberFilter): Member[] {
  const q = fold(f.q.trim());
  return members.filter(
    (m) =>
      (f.status === 'all' || m.status === f.status) &&
      (f.roleId === 'all' || m.roleIds.includes(f.roleId)) &&
      (!q || fold(m.name).includes(q) || fold(m.email).includes(q)),
  );
}

export function countByStatus(members: Member[]): Record<MemberStatus | 'all', number> {
  const out = { all: members.length, active: 0, invited: 0, unlinked: 0, inactive: 0, blocked: 0 };
  for (const m of members) out[m.status]++;
  return out;
}

export function diff(before: readonly string[], after: readonly string[]) {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((x) => !b.has(x)), removed: [...b].filter((x) => !a.has(x)) };
}

export const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && diff(a, b).added.length === 0;

/** Quantas permissões do grupo estão ligadas: decide o estado do "marcar todas" (inclusive o misto). */
export function coverage(group: CatalogGroup, granted: ReadonlySet<string>): { on: number; total: number; state: boolean | 'indeterminate' } {
  const on = group.permissions.filter((p) => granted.has(p.key)).length;
  const total = group.permissions.length;
  return { on, total, state: on === 0 ? false : on === total ? true : 'indeterminate' };
}

export function allPermissionKeys(catalog: Catalog): string[] {
  return catalog.groups.flatMap((g) => g.permissions.map((p) => p.key));
}

export function permissionLabel(catalog: Catalog, key: string): string {
  for (const g of catalog.groups) for (const p of g.permissions) if (p.key === key) return p.label;
  return key;
}

/** Permissões efetivas de uma pessoa (união dos papéis), para a prévia "o que ela vai poder fazer". */
export function effective(roleIds: readonly string[], roles: Role[]): Set<string> {
  const ids = new Set(roleIds);
  return new Set(roles.filter((r) => ids.has(r.id)).flatMap((r) => r.permissions));
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function relative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'nunca';
  const s = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  if (Math.abs(s) < 60) return 'agora mesmo';
  for (const [unit, sec] of STEPS) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
  return 'agora mesmo';
}

const list = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.map(String).join(', ') : null);

/** Frase do histórico ("Ana deu o papel Balcão a caio@x.com"). */
export function auditSentence(item: AuditItem, catalog?: Catalog): { title: string; detail: string | null } {
  const who = item.actorName ?? 'Sistema';
  const target = item.targetLabel ?? item.targetId;
  const d = item.detail ?? {};
  const perms = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.map((k) => (catalog ? permissionLabel(catalog, String(k)) : String(k))).join('; ') : null);
  switch (item.action) {
    case 'member.invited':
      return { title: `${who} convidou ${target}`, detail: [list(d.roles) && `Papéis: ${list(d.roles)}`, d.emailSent === false && 'E-mail não enviado'].filter(Boolean).join(' · ') || null };
    case 'member.linked':
      return { title: `${who} deu acesso a ${target}`, detail: list(d.added) && `Papéis: ${list(d.added)}` };
    case 'member.roles_changed':
      return { title: `${who} alterou os papéis de ${target}`, detail: [list(d.added) && `+ ${list(d.added)}`, list(d.removed) && `− ${list(d.removed)}`].filter(Boolean).join('  ') || null };
    case 'member.deactivated':
      return { title: `${who} desativou ${target}`, detail: null };
    case 'member.reactivated':
      return { title: `${who} reativou ${target}`, detail: null };
    case 'member.removed':
      return { title: `${who} removeu ${target} da oficina`, detail: null };
    case 'member.setup_email':
      return { title: `${who} enviou ${d.kind === 'invite' ? 'o convite de novo' : 'a redefinição de senha'} para ${target}`, detail: null };
    case 'role.created':
      return { title: `${who} criou o papel ${target}`, detail: perms(d.permissions) };
    case 'role.updated': {
      const renamed = d.renamed as { from?: string; to?: string } | undefined;
      const parts = [renamed && `Renomeado de "${renamed.from}"`, perms(d.added) && `+ ${perms(d.added)}`, perms(d.removed) && `− ${perms(d.removed)}`].filter(Boolean);
      return { title: `${who} editou o papel ${target}`, detail: parts.join('  ') || null };
    }
    case 'role.deleted':
      return { title: `${who} excluiu o papel ${target}`, detail: typeof d.affectedMembers === 'number' && d.affectedMembers > 0 ? `${d.affectedMembers} pessoa(s) perderam este papel` : null };
    default:
      return { title: `${who}: ${item.action} (${target})`, detail: null };
  }
}

export const ACCESS_MANAGE = 'access.manage';
