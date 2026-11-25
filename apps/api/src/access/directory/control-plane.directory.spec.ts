import { describe, expect, it, vi } from 'vitest';
import { TEST_ORG } from '../../../test/setup.js';
import { ControlPlaneDirectory } from './control-plane.directory.js';
import { DirectoryError } from './member-directory.js';

const ORG = TEST_ORG;
const at = new Date('2026-11-01T00:00:00Z');
const row = (keycloakId: string, email: string) => ({ keycloakId, email, createdAt: at });
const cpMember = (userId: string, email: string, status = 'active') => ({ userId, email, role: 'member', status, platformRoles: [] as string[] });

function build(opts: { rows?: ReturnType<typeof row>[]; cp?: ReturnType<typeof cpMember>[] | null } = {}) {
  const rows = opts.rows ?? [];
  const prisma = {
    orgMembership: {
      findMany: vi.fn(async () => rows),
      findFirst: vi.fn(async ({ where }: { where: { keycloakId?: string; email?: string } }) => rows.find((r) => (where.keycloakId ? r.keycloakId === where.keycloakId : r.email === where.email)) ?? null),
    },
  };
  const client = {
    addMember: vi.fn(async () => ({ userId: 'cp-new', identity: 'pending' })),
    removeMember: vi.fn(async () => true),
    resendSetupEmail: vi.fn(async () => true as boolean | null),
    listMembers: vi.fn(async () => (opts.cp === undefined ? [] : opts.cp)),
  };
  return { directory: new ControlPlaneDirectory(client as never, prisma as never), client, prisma };
}

describe('ControlPlaneDirectory leitura (projeção local)', () => {
  it('lista e acha pessoas pelo registro que o control plane alimenta, sem chamar o control plane', async () => {
    const { directory, client } = build({ rows: [row('s1', 'ana@x.com'), row('s2', 'bia@x.com')] });
    expect((await directory.listMembers(ORG)).map((m) => m.id)).toEqual(['s1', 's2']);
    expect(await directory.getMember(ORG, 's2')).toMatchObject({ id: 's2', email: 'bia@x.com', enabled: true });
    expect(await directory.getMember(ORG, 'nao-existe')).toBeNull();
    expect(client.listMembers).not.toHaveBeenCalled();
  });
});

describe('ControlPlaneDirectory.invite', () => {
  it('quem já está na organização (tem conta e vínculo) volta como `ready`, sem pedir nada ao control plane', async () => {
    const { directory, client } = build({ rows: [row('s1', 'ana@x.com')] });
    const r = await directory.invite(ORG, { email: ' Ana@X.com ' });
    expect(r).toMatchObject({ state: 'ready', created: false, emailSent: false, member: { id: 's1', email: 'ana@x.com' } });
    expect(client.addMember).not.toHaveBeenCalled();
  });

  it('quem não existe vai ao control plane (e-mail em minúsculas, nome padrão = e-mail) e volta `pending`: o sub só chega depois', async () => {
    const { directory, client } = build();
    expect(await directory.invite(ORG, { email: 'Novo@X.com' })).toEqual({ state: 'pending', email: 'novo@x.com' });
    expect(client.addMember).toHaveBeenCalledWith(ORG, { email: 'novo@x.com', name: 'novo@x.com' });
    await directory.invite(ORG, { email: 'outro@x.com', name: '  Outro Nome ' });
    expect(client.addMember).toHaveBeenLastCalledWith(ORG, { email: 'outro@x.com', name: 'Outro Nome' });
  });

  it('organização que não assina o Fixer no control plane: org_not_found', async () => {
    const { directory, client } = build();
    client.addMember.mockResolvedValueOnce(null as never);
    await expect(directory.invite(ORG, { email: 'novo@x.com' })).rejects.toMatchObject({ code: 'org_not_found' });
  });

  it('control plane fora do ar vira directory_unavailable, nunca erro cru', async () => {
    const { directory, client } = build();
    client.addMember.mockRejectedValueOnce(new Error('fetch failed'));
    const err = await directory.invite(ORG, { email: 'novo@x.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(DirectoryError);
    expect(err).toMatchObject({ code: 'directory_unavailable' });
  });
});

describe('ControlPlaneDirectory.removeMember', () => {
  it('traduz o sub para o id do control plane pelo e-mail e remove', async () => {
    const { directory, client } = build({ rows: [row('s1', 'Ana@x.com')], cp: [cpMember('cp-1', 'ana@x.com')] });
    await directory.removeMember(ORG, 's1');
    expect(client.removeMember).toHaveBeenCalledWith(ORG, 'cp-1');
  });

  it('ignora membro já desativado no control plane e pessoa que ele não conhece mais: nada a remover, sem erro', async () => {
    const off = build({ rows: [row('s1', 'ana@x.com')], cp: [cpMember('cp-1', 'ana@x.com', 'disabled')] });
    await off.directory.removeMember(ORG, 's1');
    expect(off.client.removeMember).not.toHaveBeenCalled();
    const gone = build({ rows: [row('s1', 'ana@x.com')], cp: [] });
    await gone.directory.removeMember(ORG, 's1');
    expect(gone.client.removeMember).not.toHaveBeenCalled();
  });

  it('sub que não está na organização: not_a_member', async () => {
    const { directory } = build({ rows: [] });
    await expect(directory.removeMember(ORG, 'fantasma')).rejects.toMatchObject({ code: 'not_a_member' });
  });

  it('regra do control plane (o dono não sai) é directory_error com a mensagem dele, não indisponibilidade', async () => {
    const { directory, client } = build({ rows: [row('s1', 'dono@x.com')], cp: [cpMember('cp-1', 'dono@x.com')] });
    client.removeMember.mockRejectedValueOnce(new Error('O dono da organização não pode ser removido'));
    await expect(directory.removeMember(ORG, 's1')).rejects.toMatchObject({ code: 'directory_error', message: 'O dono da organização não pode ser removido' });
  });
});

describe('ControlPlaneDirectory.sendSetupEmail', () => {
  it('reenvia pelo control plane, na organização do contexto, e devolve se o e-mail saiu', async () => {
    const { directory, client } = build({ rows: [row('s1', 'ana@x.com')], cp: [cpMember('cp-1', 'ana@x.com')] });
    expect(await directory.sendSetupEmail('s1')).toBe(true);
    expect(client.resendSetupEmail).toHaveBeenCalledWith(ORG, 'cp-1');
    client.resendSetupEmail.mockResolvedValueOnce(false);
    expect(await directory.sendSetupEmail('s1')).toBe(false); // SMTP fora: a tela avisa, o acesso vale
  });

  it('pessoa que o control plane não conhece nesta organização é not_a_member', async () => {
    const { directory, client } = build({ rows: [row('s1', 'ana@x.com')], cp: [cpMember('cp-1', 'ana@x.com')] });
    client.resendSetupEmail.mockResolvedValueOnce(null);
    await expect(directory.sendSetupEmail('s1')).rejects.toMatchObject({ code: 'not_a_member' });
    await expect(build({ rows: [] }).directory.sendSetupEmail('s1')).rejects.toMatchObject({ code: 'not_a_member' });
  });
});
