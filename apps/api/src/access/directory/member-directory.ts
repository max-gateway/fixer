/**
 * Porta do diretório de identidades (quem existe e pode fazer login). O controle de acesso só fala com esta interface;
 * o Keycloak é um adaptador (`keycloak.directory.ts`). Trocar por outro provedor, ou pelo control plane da Max Gateway
 * quando ele assumir os convites, não muda regra nem tela.
 */
export interface DirectoryMember {
  /** `sub` do token: liga a pessoa ao `User.keycloakId` do Fixer. */
  id: string;
  email: string;
  name: string;
  enabled: boolean;
  emailVerified: boolean;
  /** Ações pendentes na conta (ex.: definir senha). Indica convite ainda não concluído. */
  pendingActions: string[];
  createdAt: Date | null;
}

export interface InviteResult {
  member: DirectoryMember;
  /** `false` quando a conta já existia no diretório (a pessoa usa a senha de sempre). */
  created: boolean;
  /** O e-mail de boas-vindas/definição de senha saiu? `false` com SMTP ausente: a tela avisa, o acesso vale mesmo assim. */
  emailSent: boolean;
}

export type DirectoryMode = 'organization' | 'realm' | 'disabled';

export interface MemberDirectory {
  /**
   * `organization`: realm único com Organizations do Keycloak (uma por oficina, alias = UUID da organização).
   * `realm`: instalação dedicada, o realm inteiro é a oficina. `disabled`: sem credencial de administração configurada.
   */
  readonly mode: DirectoryMode;
  /** Membros da organização. `null` se o diretório não está disponível (a tela mostra só quem já entrou no Fixer). */
  listMembers(orgId: string): Promise<DirectoryMember[] | null>;
  /** Membro pelo `sub`, só se ele pertence à organização. */
  getMember(orgId: string, id: string): Promise<DirectoryMember | null>;
  /** Cria a conta (se não existe), coloca na organização e envia o e-mail de definição de senha. Idempotente por e-mail. */
  invite(orgId: string, input: { email: string; name?: string }): Promise<InviteResult>;
  /** Tira a pessoa da organização. No modo `realm`, desabilita a conta (o realm é só desta oficina). */
  removeMember(orgId: string, id: string): Promise<void>;
  /** E-mail com o link para (re)definir a senha. `pendingInvite` também pede a verificação do e-mail. */
  sendSetupEmail(id: string, opts?: { pendingInvite?: boolean }): Promise<boolean>;
}

export const MEMBER_DIRECTORY = Symbol('MemberDirectory');

export type DirectoryErrorCode = 'directory_unavailable' | 'directory_misconfigured' | 'org_not_found' | 'not_a_member' | 'directory_error';

/** Falha do diretório com código estável; o serviço traduz para HTTP. */
export class DirectoryError extends Error {
  constructor(
    readonly code: DirectoryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Diretório desligado: leitura devolve `null`, escrita explica o que configurar. */
export class DisabledDirectory implements MemberDirectory {
  readonly mode = 'disabled' as const;
  listMembers = async () => null;
  getMember = async () => null;
  invite(): Promise<InviteResult> {
    return Promise.reject(unavailable());
  }
  removeMember(): Promise<void> {
    return Promise.reject(unavailable());
  }
  sendSetupEmail(): Promise<boolean> {
    return Promise.reject(unavailable());
  }
}

const unavailable = () =>
  new DirectoryError('directory_unavailable', 'Convites e redefinição de senha precisam do client de administração do Keycloak (KEYCLOAK_ADMIN_CLIENT_ID/SECRET).');
