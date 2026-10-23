import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createAccessApi, type Transport } from './api';
import { AccessWorkspace } from './components/access-workspace';
import { AccessApiContext } from './hooks';
import { auditSentence, countByStatus, coverage, diff, effective, filterMembers, relative, sameSet } from './model';
import type { AccessInitial, AuditItem, Catalog, Member, Role } from './types';

const catalog: Catalog = {
  groups: [
    {
      key: 'access',
      label: 'Acessos',
      description: 'Pessoas e papéis',
      permissions: [
        { key: 'access.read', label: 'Ver acessos', risk: null },
        { key: 'access.manage', label: 'Gerenciar acessos', risk: 'high' },
      ],
    },
    { key: 'payables', label: 'Contas a pagar', description: 'Parcelas', permissions: [{ key: 'payables.read', label: 'Ver contas', risk: null }] },
  ],
};

const roles: Role[] = [
  { id: 'admin', name: 'Admin', description: 'Acesso total', isSystem: true, createdAt: '2026-10-01T00:00:00Z', permissions: ['access.manage', 'access.read', 'payables.read'], memberCount: 1 },
  { id: 'balcao', name: 'Balcão', description: null, isSystem: false, createdAt: '2026-10-01T00:00:00Z', permissions: ['payables.read'], memberCount: 1 },
];

const member = (o: Partial<Member>): Member => ({
  sub: 's',
  userId: 'u',
  name: 'Ana Souza',
  email: 'ana@oficina.com',
  status: 'active',
  roleIds: [],
  lastSeenAt: '2026-10-16T10:00:00Z',
  createdAt: null,
  isSelf: false,
  isManager: false,
  ...o,
});

const members: Member[] = [
  member({ sub: 'a', name: 'Ana Souza', roleIds: ['admin'], isSelf: true, isManager: true }),
  member({ sub: 'b', name: 'João Mecânico', email: 'joao@oficina.com', roleIds: ['balcao'], status: 'invited', lastSeenAt: null }),
  member({ sub: 'c', name: 'Carla', email: 'carla@x.com', userId: null, status: 'unlinked', lastSeenAt: null }),
];

describe('model', () => {
  it('filtra por texto sem acento, situação e papel', () => {
    expect(filterMembers(members, { q: 'joao', status: 'all', roleId: 'all' }).map((m) => m.sub)).toEqual(['b']);
    expect(filterMembers(members, { q: '', status: 'unlinked', roleId: 'all' }).map((m) => m.sub)).toEqual(['c']);
    expect(filterMembers(members, { q: '', status: 'all', roleId: 'admin' }).map((m) => m.sub)).toEqual(['a']);
    expect(countByStatus(members)).toMatchObject({ all: 3, active: 1, invited: 1, unlinked: 1 });
  });

  it('diff, sameSet e permissões efetivas', () => {
    expect(diff(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
    expect([...effective(['admin', 'balcao'], roles)].sort()).toEqual(['access.manage', 'access.read', 'payables.read']);
  });

  it('cobertura do grupo vira o estado do "marcar todas"', () => {
    expect(coverage(catalog.groups[0]!, new Set(['access.read']))).toEqual({ on: 1, total: 2, state: 'indeterminate' });
    expect(coverage(catalog.groups[0]!, new Set()).state).toBe(false);
    expect(coverage(catalog.groups[1]!, new Set(['payables.read'])).state).toBe(true);
  });

  it('tempo relativo', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(relative(null, now)).toBe('nunca');
    expect(relative('2026-10-16T11:59:30Z', now)).toBe('agora mesmo');
    expect(relative('2026-10-16T10:00:00Z', now)).toBe('há 2 horas');
    expect(relative('2026-10-15T12:00:00Z', now)).toBe('ontem');
  });

  it('frases do histórico usam os rótulos do catálogo', () => {
    const base: AuditItem = { id: '1', at: '2026-10-16T10:00:00Z', actorId: 'u', actorName: 'Ana', action: '', targetType: 'role', targetId: 'r', targetLabel: 'Balcão', detail: null };
    expect(auditSentence({ ...base, action: 'role.updated', detail: { added: ['access.read'], removed: [] } }, catalog)).toEqual({ title: 'Ana editou o papel Balcão', detail: '+ Ver acessos' });
    expect(auditSentence({ ...base, action: 'member.invited', targetType: 'member', targetLabel: 'joao@x.com', detail: { roles: ['Balcão'], emailSent: false } })).toEqual({
      title: 'Ana convidou joao@x.com',
      detail: 'Papéis: Balcão · E-mail não enviado',
    });
    expect(auditSentence({ ...base, actorName: null, action: 'role.deleted', detail: { affectedMembers: 2 } }).title).toBe('Sistema excluiu o papel Balcão');
  });
});

describe('api', () => {
  it('monta caminhos e corpos pelo transporte injetado', async () => {
    const t: Transport = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } as never;
    const api = createAccessApi(t);
    await api.setRoles('a/b', ['r1']);
    await api.audit({ cursor: 'c1', take: 10 });
    await api.deleteRole('r 1');
    expect(t.put).toHaveBeenCalledWith('/access/members/a%2Fb/roles', { roleIds: ['r1'] }, expect.any(String));
    expect(t.get).toHaveBeenCalledWith('/access/audit?cursor=c1&take=10', expect.any(String));
    expect(t.del).toHaveBeenCalledWith('/access/roles/r%201', expect.any(String));
  });
});

describe('AccessWorkspace', () => {
  const render = (initial: AccessInitial) => {
    const qc = new QueryClient();
    const api = createAccessApi({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } as never);
    return renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <AccessApiContext.Provider value={api}>
          <AccessWorkspace initial={initial} />
        </AccessApiContext.Provider>
      </QueryClientProvider>,
    );
  };
  const initial = (permissions: string[], directory: AccessInitial['members']['directory'] = { mode: 'organization', status: 'ok' }): AccessInitial => ({
    me: { userId: 'u', permissions },
    catalog,
    roles,
    members: { members, directory, seats: { max: 5, used: 2 } },
  });

  it('administrador vê o botão de convite, o medidor do plano e as pessoas com situação e papéis', () => {
    const html = render(initial(['access.read', 'access.manage']));
    expect(html).toContain('Convidar pessoa');
    expect(html).toContain('Usuários do plano');
    expect(html).toContain('2/5');
    expect(html).toContain('João Mecânico');
    expect(html).toContain('Convidado');
    expect(html).toContain('Sem acesso');
    expect(html).toContain('Balcão');
  });

  it('quem só lê não vê o convite; diretório desligado avisa só a quem administra', () => {
    const reader = render(initial(['access.read'], { mode: 'disabled', status: 'off' }));
    expect(reader).not.toContain('Convidar pessoa');
    expect(reader).not.toContain('Convites desligados');
    const admin = render(initial(['access.read', 'access.manage'], { mode: 'disabled', status: 'off' }));
    expect(admin).toContain('Convites desligados');
  });
});
