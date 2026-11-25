import { ControlPlaneClient } from '../../control-plane/control-plane.client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { DirectoryError, type DirectoryMember, type InviteResult, type MemberDirectory } from './member-directory.js';

type Row = { keycloakId: string; email: string; createdAt: Date };

const toMember = (r: Row): DirectoryMember => ({
  id: r.keycloakId,
  email: r.email,
  // O registro local guarda e-mail, não nome; a tela usa o nome do usuário do Fixer quando ele existe.
  name: r.email,
  enabled: true,
  emailVerified: true,
  pendingActions: [],
  createdAt: r.createdAt,
});

/**
 * Diretório de pessoas da organização sobre o control plane, que é o dono de organização, membro, convite e conta no Keycloak.
 *
 * - **Leitura** vem de `OrgMembership`, a projeção que o próprio control plane alimenta (evento `identity.member_ready` e sync do diretório); não há cópia
 *   paralela nem consulta por tela. Quem saiu da organização some na próxima rodada do sync.
 * - **Escrita** vai ao control plane (`addMember`, `removeMember`, `resendSetupEmail`) com a chave `product` presa ao Fixer, que só alcança as organizações
 *   que assinam o produto. O control plane cria a conta de forma assíncrona; por isso o convite de quem ainda não existe é `pending`.
 * - O Fixer não tem credencial de administração do Keycloak.
 *
 * Falha de rede ou 5xx do control plane vira `directory_unavailable` (a tela segue com quem já tem usuário e avisa).
 */
export class ControlPlaneDirectory implements MemberDirectory {
  readonly mode = 'control_plane' as const;

  constructor(
    private readonly client: ControlPlaneClient,
    private readonly prisma: PrismaService,
  ) {}

  async listMembers(_orgId: string): Promise<DirectoryMember[]> {
    const rows = await this.prisma.orgMembership.findMany({ select: { keycloakId: true, email: true, createdAt: true } });
    return rows.map(toMember);
  }

  async getMember(_orgId: string, id: string): Promise<DirectoryMember | null> {
    const row = await this.prisma.orgMembership.findFirst({ where: { keycloakId: id }, select: { keycloakId: true, email: true, createdAt: true } });
    return row ? toMember(row) : null;
  }

  async invite(orgId: string, input: { email: string; name?: string }): Promise<InviteResult> {
    const email = input.email.trim().toLowerCase();
    // Já está na organização (tem conta e vínculo, só não tinha acesso ao Fixer): não há o que pedir ao control plane.
    const known = await this.prisma.orgMembership.findFirst({ where: { email }, select: { keycloakId: true, email: true, createdAt: true } });
    if (known) return { state: 'ready', member: toMember(known), created: false, emailSent: false };

    const added = await this.call(() => this.client.addMember(orgId, { email, name: input.name?.trim() || email }));
    if (!added) throw new DirectoryError('org_not_found', 'Esta organização não assina o Fixer no control plane');
    return { state: 'pending', email };
  }

  async removeMember(orgId: string, id: string): Promise<void> {
    const row = await this.prisma.orgMembership.findFirst({ where: { keycloakId: id }, select: { email: true } });
    if (!row) throw new DirectoryError('not_a_member', 'Pessoa não encontrada nesta organização');
    const userId = await this.userIdOf(orgId, row.email);
    if (!userId) return; // já não consta no control plane: nada a remover
    await this.call(() => this.client.removeMember(orgId, userId));
  }

  async sendSetupEmail(id: string): Promise<boolean> {
    const orgId = TenantContext.require();
    const row = await this.prisma.orgMembership.findFirst({ where: { keycloakId: id }, select: { email: true } });
    if (!row) throw new DirectoryError('not_a_member', 'Pessoa não encontrada nesta organização');
    const userId = await this.userIdOf(orgId, row.email);
    if (!userId) throw new DirectoryError('not_a_member', 'Pessoa não encontrada nesta organização');
    const sent = await this.call(() => this.client.resendSetupEmail(orgId, userId));
    if (sent === null) throw new DirectoryError('not_a_member', 'Pessoa não encontrada nesta organização');
    return sent;
  }

  /** O control plane identifica a pessoa pelo próprio id; o Fixer a conhece pelo `sub`. O e-mail é a ponte (único por organização). */
  private async userIdOf(orgId: string, email: string): Promise<string | null> {
    const members = await this.call(() => this.client.listMembers(orgId));
    if (!members) throw new DirectoryError('org_not_found', 'Esta organização não assina o Fixer no control plane');
    return members.find((m) => m.status !== 'disabled' && m.email.toLowerCase() === email.toLowerCase())?.userId ?? null;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DirectoryError) throw err;
      const message = (err as Error).message;
      // Regra do control plane (dono não sai) não é indisponibilidade.
      if (/dono da organização/.test(message)) throw new DirectoryError('directory_error', message);
      throw new DirectoryError('directory_unavailable', 'O control plane não respondeu. Tente de novo em instantes.');
    }
  }
}
