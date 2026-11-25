/**
 * Porta do diretório de identidades (quem existe e pode fazer login). O controle de acesso só fala com esta interface; o adaptador é o control plane da
 * Max Gateway (`control-plane.directory.ts`), que é o dono de organização, membro, convite e conta no Keycloak (docs/specs/control-plane.md). O Fixer não
 * tem credencial de administração do Keycloak.
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

/**
 * Resultado do convite. A criação da conta no control plane é assíncrona (fila de identidade), então há dois casos:
 * - `ready`: a pessoa já existe na organização (o `sub` é conhecido), por exemplo quem tem conta mas ainda não tinha acesso ao Fixer;
 * - `pending`: o control plane aceitou o convite e vai criar a conta; o `sub` e o e-mail de definição de senha chegam depois (`identity.member_ready`).
 */
export type InviteResult =
  | {
      state: 'ready';
      member: DirectoryMember;
      /** `false` quando a conta já existia no diretório (a pessoa usa a senha de sempre). */
      created: boolean;
      /** O e-mail de boas-vindas/definição de senha saiu? Na rota `ready` o diretório não envia nada novo. */
      emailSent: boolean;
    }
  | { state: 'pending'; email: string };

/** `control_plane`: diretório da organização no control plane. `disabled`: integração com o control plane não configurada. */
export type DirectoryMode = 'control_plane' | 'disabled';

export interface MemberDirectory {
  readonly mode: DirectoryMode;
  /** Membros da organização. `null` se o diretório não está disponível (a tela mostra só quem já entrou no Fixer). */
  listMembers(orgId: string): Promise<DirectoryMember[] | null>;
  /** Membro pelo `sub`, só se ele pertence à organização. */
  getMember(orgId: string, id: string): Promise<DirectoryMember | null>;
  /** Pede ao control plane que a pessoa entre na organização (conta, vínculo e e-mail de senha). Idempotente por e-mail. */
  invite(orgId: string, input: { email: string; name?: string }): Promise<InviteResult>;
  /** Tira a pessoa da organização. */
  removeMember(orgId: string, id: string): Promise<void>;
  /** E-mail com o link para (re)definir a senha da pessoa na organização do contexto. */
  sendSetupEmail(id: string): Promise<boolean>;
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
  new DirectoryError('directory_unavailable', 'Convites e redefinição de senha dependem da integração com o control plane (CONTROL_PLANE_URL e CONTROL_PLANE_API_KEY).');
