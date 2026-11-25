import { describe, expect, it, vi } from 'vitest';
import { PlatformRolesPublisher } from './platform-roles.publisher.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type CpMember = { userId: string; email: string; role: string; status: string; platformRoles: string[] };
const cp = (email: string, platformRoles: string[], over: Partial<CpMember> = {}): CpMember => ({ userId: `cp-${email}`, email, role: 'member', status: 'active', platformRoles, ...over });
const fixerUser = (email: string, keys: string[]) => ({ email, roles: [{ role: { permissions: keys.map((key) => ({ permission: { key } })) } }] });

function build(opts: { members?: CpMember[] | null; users?: ReturnType<typeof fixerUser>[]; enabled?: boolean; setResult?: boolean } = {}) {
  const listMembers = vi.fn(async () => (opts.members === undefined ? [] : opts.members));
  const setPlatformRoles = vi.fn(async () => opts.setResult ?? true);
  const findUsers = vi.fn(async () => opts.users ?? []);
  const cfg = opts.enabled === false ? { url: undefined, apiKey: undefined } : { url: 'http://cp', apiKey: 'k' };
  const publisher = new PlatformRolesPublisher(cfg as never, { listMembers, setPlatformRoles } as never, { user: { findMany: findUsers }, orgLicense: { findMany: vi.fn(async () => [{ orgId: ORG }]) } } as never);
  return { publisher, listMembers, setPlatformRoles, findUsers };
}

describe('PlatformRolesPublisher.publishOrg', () => {
  it('informa ao control plane os papéis que as permissões do Fixer implicam, quando diferem dos dele', async () => {
    const { publisher, setPlatformRoles } = build({
      members: [cp('ana@x.com', ['viewer']), cp('bia@x.com', ['viewer'])],
      users: [fixerUser('ana@x.com', ['pricing.write']), fixerUser('bia@x.com', [])],
    });
    expect(await publisher.publishOrg(ORG)).toEqual({ sent: 1 });
    expect(setPlatformRoles).toHaveBeenCalledTimes(1);
    expect(setPlatformRoles).toHaveBeenCalledWith(ORG, 'cp-ana@x.com', ['price_manager', 'fiscal_editor']); // bia já está em viewer: nada a enviar
  });

  it('idempotente: o estado que volta do control plane não gera novo envio (ordem dos papéis não importa)', async () => {
    const { publisher, setPlatformRoles } = build({
      members: [cp('ana@x.com', ['fiscal_editor', 'price_manager'])],
      users: [fixerUser('ana@x.com', ['pricing.write'])],
    });
    expect(await publisher.publishOrg(ORG)).toEqual({ sent: 0 });
    expect(setPlatformRoles).not.toHaveBeenCalled();
  });

  it('casa por e-mail sem diferenciar maiúsculas e ignora quem ainda não existe no control plane ou está desativado lá', async () => {
    const { publisher, setPlatformRoles } = build({
      members: [cp('Ana@X.com', ['viewer']), cp('off@x.com', ['viewer'], { status: 'disabled' })],
      users: [fixerUser('ana@x.com', ['fiscal.verify']), fixerUser('off@x.com', ['pricing.write']), fixerUser('novo@x.com', ['pricing.write'])],
    });
    expect(await publisher.publishOrg(ORG)).toEqual({ sent: 1 });
    expect(setPlatformRoles).toHaveBeenCalledWith(ORG, 'cp-Ana@X.com', ['viewer', 'accountant']);
  });

  it('só considera usuários ativos do Fixer na organização', async () => {
    const { publisher, findUsers } = build({ members: [] });
    await publisher.publishOrg(ORG);
    expect(findUsers).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: ORG, active: true } }));
  });

  it('organização que não assina o produto (o control plane responde 404): não faz nada e não é erro', async () => {
    const { publisher, setPlatformRoles, findUsers } = build({ members: null });
    expect(await publisher.publishOrg(ORG)).toEqual({ sent: 0, skipped: 'org_not_in_product' });
    expect(findUsers).not.toHaveBeenCalled();
    expect(setPlatformRoles).not.toHaveBeenCalled();
  });

  it('integração desligada (sem URL ou chave): não chama nada', async () => {
    const { publisher, listMembers } = build({ enabled: false });
    expect(await publisher.publishOrg(ORG)).toEqual({ sent: 0, skipped: 'disabled' });
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('falha do control plane NUNCA lança para quem chama (a mudança de acesso já foi gravada)', async () => {
    const { publisher, listMembers } = build();
    listMembers.mockRejectedValueOnce(new Error('control plane fora do ar'));
    await expect(publisher.publishOrg(ORG)).resolves.toEqual({ sent: 0 });
  });

  it('uma falha em uma pessoa interrompe a rodada sem lançar; a próxima rodada reenvia', async () => {
    const { publisher, setPlatformRoles } = build({
      members: [cp('ana@x.com', ['viewer'])],
      users: [fixerUser('ana@x.com', ['pricing.write'])],
    });
    setPlatformRoles.mockRejectedValueOnce(new Error('500'));
    await expect(publisher.publishOrg(ORG)).resolves.toEqual({ sent: 0 });
    expect(await publisher.publishOrg(ORG)).toEqual({ sent: 1 });
  });

  it('chamadas simultâneas para a mesma organização compartilham uma única rodada', async () => {
    const { publisher, listMembers } = build({ members: [] });
    await Promise.all([publisher.publishOrg(ORG), publisher.publishOrg(ORG), publisher.publishOrg(ORG)]);
    expect(listMembers).toHaveBeenCalledTimes(1);
    await publisher.publishOrg(ORG); // terminada a rodada, a próxima executa de novo
    expect(listMembers).toHaveBeenCalledTimes(2);
  });
});

describe('PlatformRolesPublisher.reconcileAll', () => {
  it('percorre as organizações com licença do produto', async () => {
    const { publisher, listMembers } = build({ members: [] });
    await publisher.reconcileAll();
    expect(listMembers).toHaveBeenCalledWith(ORG);
  });
});
