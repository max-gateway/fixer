import { DirectoryConfig } from './directory.config.js';
import { DirectoryError, type DirectoryMember, type InviteResult, type MemberDirectory } from './member-directory.js';

type Fetch = typeof fetch;

/** Representação de usuário da Admin API do Keycloak (só o que usamos). */
interface KcUser {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  requiredActions?: string[];
  createdTimestamp?: number;
}

interface KcOrganization {
  id: string;
  alias?: string;
  name?: string;
}

const PAGE = 100;
/** Teto de segurança das listagens (uma oficina com mais que isso é outro produto). */
const MAX_MEMBERS = 2000;

/**
 * Adaptador do diretório para a Admin REST API do Keycloak 26, autenticado por client credentials (service account).
 * Dois modos, escolhidos por `ACCESS_DIRECTORY_MODE`:
 * - `organization`: realm compartilhado; cada oficina é uma Organization com `alias` = UUID da organização do Fixer;
 * - `realm`: instalação dedicada; todos os usuários do realm são da oficina (remover = desabilitar a conta).
 */
export class KeycloakDirectory implements MemberDirectory {
  private token?: { value: string; until: number };
  private readonly orgIds = new Map<string, string>();

  constructor(
    private readonly config: DirectoryConfig,
    private readonly http: Fetch = fetch,
  ) {}

  get mode() {
    return this.config.mode;
  }

  async listMembers(orgId: string): Promise<DirectoryMember[]> {
    const path = this.mode === 'organization' ? `/organizations/${await this.kcOrg(orgId)}/members` : '/users';
    const out: KcUser[] = [];
    for (let first = 0; first < MAX_MEMBERS; first += PAGE) {
      const page = await this.admin<KcUser[]>('GET', `${path}?first=${first}&max=${PAGE}&briefRepresentation=false`);
      out.push(...page);
      if (page.length < PAGE) break;
    }
    // O service account do próprio client aparece como usuário no modo realm.
    return out.filter((u) => !u.username?.startsWith('service-account-')).map(toMember);
  }

  async getMember(orgId: string, id: string): Promise<DirectoryMember | null> {
    const path = this.mode === 'organization' ? `/organizations/${await this.kcOrg(orgId)}/members/${encodeURIComponent(id)}` : `/users/${encodeURIComponent(id)}`;
    const user = await this.admin<KcUser>('GET', path, undefined, { allow404: true });
    return user ? toMember(user) : null;
  }

  async invite(orgId: string, input: { email: string; name?: string }): Promise<InviteResult> {
    const email = input.email.trim().toLowerCase();
    let user = await this.findByEmail(email);
    let created = false;
    if (!user) {
      const [firstName, ...rest] = (input.name ?? '').trim().split(/\s+/).filter(Boolean);
      const res = await this.admin<null>(
        'POST',
        '/users',
        { username: email, email, firstName: firstName ?? '', lastName: rest.join(' '), enabled: true, emailVerified: false, requiredActions: ['UPDATE_PASSWORD'] },
        { allow409: true },
      );
      // 409: alguém criou a mesma conta entre a busca e o POST. Segue com a que existe.
      user = await this.findByEmail(email);
      if (!user) throw new DirectoryError('directory_error', 'O Keycloak não devolveu a conta criada');
      created = res !== undefined;
    } else if (this.mode === 'realm' && user.enabled === false) {
      // Realm dedicado: "remover" desabilita a conta. Convidar de novo a reabilita.
      await this.admin('PUT', `/users/${user.id}`, { enabled: true });
      user = { ...user, enabled: true };
    }

    if (this.mode === 'organization') {
      // O Keycloak lê o corpo como o id cru. 409 = já é membro (convite repetido): idempotente.
      await this.admin('POST', `/organizations/${await this.kcOrg(orgId)}/members`, user.id, { allow409: true, raw: true });
    }

    const pending = created || (user.requiredActions ?? []).length > 0 || !user.emailVerified;
    const emailSent = created || pending ? await this.sendSetupEmail(user.id, { pendingInvite: true }) : false;
    return { member: toMember(user), created, emailSent };
  }

  async removeMember(orgId: string, id: string): Promise<void> {
    if (this.mode === 'organization') {
      await this.admin('DELETE', `/organizations/${await this.kcOrg(orgId)}/members/${encodeURIComponent(id)}`, undefined, { allow404: true });
    } else {
      await this.admin('PUT', `/users/${encodeURIComponent(id)}`, { enabled: false }, { allow404: true });
    }
  }

  async sendSetupEmail(id: string, opts: { pendingInvite?: boolean } = {}): Promise<boolean> {
    const q = new URLSearchParams({ lifespan: String(this.config.emailLifespan) });
    if (this.config.emailClientId) q.set('client_id', this.config.emailClientId);
    if (this.config.redirectUri) q.set('redirect_uri', this.config.redirectUri);
    const actions = opts.pendingInvite ? ['UPDATE_PASSWORD', 'VERIFY_EMAIL'] : ['UPDATE_PASSWORD'];
    try {
      await this.admin('PUT', `/users/${encodeURIComponent(id)}/execute-actions-email?${q}`, actions);
      return true;
    } catch (err) {
      // Sem SMTP o Keycloak responde 500. A conta e o acesso valem; quem convidou recebe o aviso e pode reenviar depois.
      if (err instanceof DirectoryError && err.code === 'directory_error') return false;
      throw err;
    }
  }

  private async findByEmail(email: string): Promise<KcUser | null> {
    const found = await this.admin<KcUser[]>('GET', `/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=false`);
    return found.find((u) => u.email?.toLowerCase() === email) ?? null;
  }

  /** Id interno da Organization do Keycloak cujo `alias` é o UUID da organização. Cacheado (não muda). */
  private async kcOrg(orgId: string): Promise<string> {
    const hit = this.orgIds.get(orgId);
    if (hit) return hit;
    const match = (list: KcOrganization[]) => list.find((o) => o.alias?.toLowerCase() === orgId || o.name?.toLowerCase() === orgId);
    // A busca do Keycloak 26.0 olha nome e domínio, não o alias: tenta a busca e, se não achar, percorre as páginas.
    let org = match(await this.admin<KcOrganization[]>('GET', `/organizations?search=${encodeURIComponent(orgId)}&briefRepresentation=true`));
    for (let first = 0; !org && first < 10_000; first += PAGE) {
      const page = await this.admin<KcOrganization[]>('GET', `/organizations?first=${first}&max=${PAGE}&briefRepresentation=true`);
      org = match(page);
      if (page.length < PAGE) break;
    }
    if (!org) throw new DirectoryError('org_not_found', 'Esta oficina ainda não tem uma organização no Keycloak (o control plane cria ao cadastrar a oficina).');
    this.orgIds.set(orgId, org.id);
    return org.id;
  }

  private async admin<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: { allow404?: boolean; allow409?: boolean; raw?: boolean } = {},
  ): Promise<T> {
    const url = `${this.config.baseUrl}/admin/realms/${encodeURIComponent(this.config.realm)}${path}`;
    const send = async (token: string) =>
      this.http(url, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : opts.raw ? String(body) : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

    let res: Response;
    try {
      res = await send(await this.accessToken());
      if (res.status === 401) {
        // Token revogado ou chave girada: renova uma vez.
        this.token = undefined;
        res = await send(await this.accessToken());
      }
    } catch (err) {
      if (err instanceof DirectoryError) throw err;
      throw new DirectoryError('directory_unavailable', 'Keycloak indisponível no momento');
    }

    if (res.status === 404 && opts.allow404) return null as T;
    if (res.status === 409 && opts.allow409) return undefined as T;
    if (res.status === 401 || res.status === 403) {
      throw new DirectoryError('directory_misconfigured', 'O client de administração do Keycloak não tem as permissões necessárias (view-users, manage-users, manage-realm)');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (/organizations not enabled/i.test(text)) {
        throw new DirectoryError('directory_misconfigured', 'O realm não tem Organizations habilitado. Habilite no Keycloak ou use ACCESS_DIRECTORY_MODE=realm (instalação dedicada).');
      }
      if (res.status === 404) throw new DirectoryError('not_a_member', 'Pessoa não encontrada no diretório desta oficina');
      throw new DirectoryError('directory_error', `Keycloak respondeu ${res.status}`);
    }
    if (res.status === 201 || res.status === 204) return true as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.until) return this.token.value;
    const res = await this.http(`${this.config.baseUrl}/realms/${encodeURIComponent(this.config.realm)}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId!, client_secret: this.config.clientSecret! }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new DirectoryError('directory_misconfigured', 'Credencial do client de administração do Keycloak recusada');
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    // Renova 30 s antes de expirar.
    this.token = { value: json.access_token, until: Date.now() + Math.max(10, (json.expires_in ?? 60) - 30) * 1000 };
    return json.access_token;
  }
}

function toMember(u: KcUser): DirectoryMember {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const email = (u.email ?? u.username ?? '').toLowerCase();
  return {
    id: u.id,
    email,
    name: name || email,
    enabled: u.enabled !== false,
    emailVerified: u.emailVerified === true,
    pendingActions: u.requiredActions ?? [],
    createdAt: u.createdTimestamp ? new Date(u.createdTimestamp) : null,
  };
}
