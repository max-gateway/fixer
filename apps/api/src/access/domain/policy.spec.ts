import { describe, expect, it } from 'vitest';
import { AccessRuleViolation, assertAllowed, assertRoleName, effectivePermissions, managers, memberStatus, type Snapshot } from './policy.js';

const snap = (): Snapshot => ({
  roles: [
    { id: 'admin', name: 'Admin', isSystem: true, permissions: ['access.read', 'access.manage', 'payables.read'] },
    { id: 'gerente', name: 'Gerente', isSystem: false, permissions: ['access.read', 'access.manage'] },
    { id: 'balcao', name: 'Balcão', isSystem: false, permissions: ['payables.read'] },
  ],
  users: [
    { id: 'ana', active: true, roleIds: ['admin'] },
    { id: 'bia', active: true, roleIds: ['gerente', 'balcao'] },
    { id: 'caio', active: true, roleIds: ['balcao'] },
    { id: 'dani', active: false, roleIds: ['admin'] },
  ],
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AccessRuleViolation) return e.code;
    throw e;
  }
  return 'ok';
};

describe('effectivePermissions / managers', () => {
  it('une as permissões dos papéis; inativo não tem nenhuma', () => {
    expect([...effectivePermissions(snap(), 'bia')].sort()).toEqual(['access.manage', 'access.read', 'payables.read']);
    expect(effectivePermissions(snap(), 'dani').size).toBe(0);
  });

  it('administradores são os ativos com access.manage', () => {
    expect(managers(snap()).sort()).toEqual(['ana', 'bia']);
  });
});

describe('assertAllowed', () => {
  it('permite mudança comum', () => {
    expect(code(() => assertAllowed(snap(), { kind: 'user.roles', userId: 'caio', roleIds: ['gerente'] }, 'ana'))).toBe('ok');
  });

  it('não deixa o autor tirar o próprio acesso', () => {
    expect(code(() => assertAllowed(snap(), { kind: 'user.roles', userId: 'ana', roleIds: ['balcao'] }, 'ana'))).toBe('self_lockout');
    expect(code(() => assertAllowed(snap(), { kind: 'user.active', userId: 'bia', active: false }, 'bia'))).toBe('self_lockout');
    expect(code(() => assertAllowed(snap(), { kind: 'role.permissions', roleId: 'gerente', permissions: ['access.read'] }, 'bia'))).toBe('self_lockout');
  });

  it('não deixa a oficina sem administrador, mesmo por outra pessoa', () => {
    const s = snap();
    const one: Snapshot = { ...s, users: s.users.filter((u) => u.id !== 'bia') };
    // Só a Ana administra; o Caio (sem access.manage) não poderia agir, mas a regra vale para qualquer autor.
    expect(code(() => assertAllowed(one, { kind: 'user.active', userId: 'ana', active: false }, 'sistema'))).toBe('last_manager');
  });

  it('deixa consertar uma oficina que já está sem administrador', () => {
    const s: Snapshot = { ...snap(), users: [{ id: 'caio', active: true, roleIds: ['balcao'] }] };
    expect(code(() => assertAllowed(s, { kind: 'user.roles', userId: 'caio', roleIds: ['balcao'] }, 'caio'))).toBe('ok');
  });

  it('protege o papel de sistema', () => {
    expect(code(() => assertAllowed(snap(), { kind: 'role.delete', roleId: 'admin' }, 'ana'))).toBe('system_role');
    expect(code(() => assertAllowed(snap(), { kind: 'role.permissions', roleId: 'admin', permissions: [] }, 'ana'))).toBe('system_role');
  });

  it('apagar papel tira o papel das pessoas e respeita o último administrador', () => {
    const s = snap();
    const onlyBia: Snapshot = { ...s, users: s.users.filter((u) => u.id !== 'ana') };
    expect(code(() => assertAllowed(onlyBia, { kind: 'role.delete', roleId: 'gerente' }, 'caio'))).toBe('last_manager');
    const after = assertAllowed(s, { kind: 'role.delete', roleId: 'balcao' }, 'ana');
    expect(after.users.find((u) => u.id === 'caio')!.roleIds).toEqual([]);
  });

  it('recusa referência desconhecida', () => {
    expect(code(() => assertAllowed(snap(), { kind: 'user.roles', userId: 'caio', roleIds: ['nada'] }, 'ana'))).toBe('unknown_role');
    expect(code(() => assertAllowed(snap(), { kind: 'user.active', userId: 'zé', active: true }, 'ana'))).toBe('unknown_user');
    expect(code(() => assertAllowed(snap(), { kind: 'role.permissions', roleId: 'balcao', permissions: ['root'] }, 'ana'))).toBe('unknown_permission');
  });
});

describe('assertRoleName', () => {
  const existing = [{ id: 'r1', name: 'Balcão' }];
  it('normaliza espaços e recusa duplicado sem diferenciar acento/caixa', () => {
    expect(assertRoleName('  Mecânico   chefe ', existing)).toBe('Mecânico chefe');
    expect(code(() => assertRoleName('balcao', existing))).toBe('duplicate_role_name');
    expect(assertRoleName('Balcão', existing, 'r1')).toBe('Balcão');
    expect(code(() => assertRoleName('x', existing))).toBe('invalid_role_name');
  });
});

describe('memberStatus', () => {
  const base = { linked: true, active: true, lastSeenAt: new Date(), directoryEnabled: true };
  it('deriva a situação na ordem certa', () => {
    expect(memberStatus({ ...base, linked: false })).toBe('unlinked');
    expect(memberStatus({ ...base, active: false, directoryEnabled: false })).toBe('inactive');
    expect(memberStatus({ ...base, directoryEnabled: false })).toBe('blocked');
    expect(memberStatus({ ...base, lastSeenAt: null })).toBe('invited');
    expect(memberStatus({ ...base, directoryEnabled: null })).toBe('active');
  });
});
