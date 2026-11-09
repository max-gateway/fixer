import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MarketplaceClient, toHttpException } from './marketplace.client.js';
import { MarketplaceConfig, type MarketplaceSettings } from './marketplace.config.js';

/** Direito do plano (control plane) que libera um marketplace; o serviço `marketplace` confere o mesmo direito e fecha por padrão. */
export const providerFeature = (slug: string): string => `marketplace.provider.${slug}`;

export interface MarketplaceAccount {
  id: string;
  label: string;
  /** `active`, `pending_profile`, `reauth_required` ou `pending`. */
  state: string;
  displayName: string | null;
  connection: { id: string; state: string } | null;
}

/** Um marketplace que o serviço opera, o que a oficina pode fazer com ele e as contas dela. Nada daqui é específico de um marketplace. */
export interface MarketplaceProvider {
  slug: string;
  name: string;
  /** A oficina tem o direito a este marketplace. */
  entitled: boolean;
  /** Dá para autorizar uma conta já: há app compartilhado da plataforma ou a oficina já cadastrou o dela. */
  ready: boolean;
  /** A oficina pode cadastrar o app dela (assistente na tela). Sem app compartilhado, é o único caminho. */
  canUseOwnApp: boolean;
  /** Endereço de retorno que a oficina cadastra no app dela no marketplace. */
  redirectUri: string;
  accounts: MarketplaceAccount[];
}

export interface MarketplaceOverview {
  /** Falso quando o Fixer não está configurado para falar com o serviço. */
  enabled: boolean;
  providers: MarketplaceProvider[];
}

interface RawProvider {
  slug: string;
  name: string;
  entitled: boolean;
  appSources: { platform: boolean; own: boolean };
}
interface RawApp {
  id: string;
  provider: string;
  status: string;
  source: 'tenant' | 'platform';
}
interface RawAccount {
  id: string;
  provider: string;
  label: string;
  state: string;
  displayName: string | null;
  connection: { id: string; storeId: string | null; state: string } | null;
}
type Started = { accountId: string; authorizeUrl: string };

const activeApp = (apps: RawApp[], provider: string, source: RawApp['source']) => apps.find((a) => a.provider === provider && a.status === 'active' && a.source === source);

/**
 * Contas de marketplace da oficina, para qualquer marketplace que o serviço opere (a lista vem do serviço, não daqui). O Fixer não tem lojas: a conexão
 * usa o id da organização como loja. Token e segredo nunca passam por aqui; o serviço só devolve estado, perfil e a conexão. Todo erro sai por `toHttpException`.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly client: MarketplaceClient,
    @Inject(MarketplaceConfig) private readonly cfg: MarketplaceSettings,
  ) {}

  async overview(orgId: string): Promise<MarketplaceOverview> {
    if (!this.client.enabled) return { enabled: false, providers: [] };
    return this.call(async () => {
      const [providers, apps, accounts] = await Promise.all([
        this.client.request<{ items: RawProvider[] }>(orgId, 'GET', '/v1/providers'),
        this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps'),
        this.client.request<{ items: RawAccount[] }>(orgId, 'GET', '/v1/accounts'),
      ]);
      return {
        enabled: true,
        providers: providers.items.map((p) => ({
          slug: p.slug,
          name: p.name,
          entitled: p.entitled,
          ready: p.entitled && Boolean(activeApp(apps.items, p.slug, 'tenant') ?? (p.appSources.platform ? activeApp(apps.items, p.slug, 'platform') : undefined)),
          canUseOwnApp: p.entitled && p.appSources.own,
          redirectUri: this.redirectUri(p.slug),
          accounts: accounts.items
            .filter((a) => a.provider === p.slug && a.state !== 'revoked')
            .map((a) => ({ id: a.id, label: a.label, state: a.state, displayName: a.displayName, connection: a.connection ? { id: a.connection.id, state: a.connection.state } : null })),
        })),
      };
    });
  }

  /**
   * Inicia a autorização de uma conta. Se a oficina mandou as credenciais do app dela, cadastra (ou troca o segredo d)o app antes. Sem credenciais usa o app
   * que já houver: o dela, se cadastrou um, senão o compartilhado da plataforma. O endereço de retorno é registrado sozinho na lista permitida da oficina.
   */
  connect(orgId: string, provider: string, label: string, creds?: { clientId: string; clientSecret: string }): Promise<Started> {
    return this.call(async () => {
      if (creds) await this.upsertOwnApp(orgId, provider, creds.clientId, creds.clientSecret);
      const apps = (await this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps')).items;
      const app = activeApp(apps, provider, 'tenant') ?? activeApp(apps, provider, 'platform');
      if (!app) throw new ConflictException('Este marketplace ainda não está liberado para a sua oficina. Cadastre o aplicativo da sua oficina para conectar.');
      await this.ensureReturnUrl(orgId);
      return this.client.request<Started>(orgId, 'POST', '/v1/accounts', { provider, appId: app.id, label, returnUrl: this.cfg.returnUrl });
    });
  }

  /** Cadastra ou troca as credenciais do app da própria oficina, sem iniciar autorização. */
  registerApp(orgId: string, provider: string, clientId: string, clientSecret: string): Promise<void> {
    return this.call(() => this.upsertOwnApp(orgId, provider, clientId, clientSecret));
  }

  reauthorize(orgId: string, accountId: string): Promise<Started> {
    return this.call(async () => {
      await this.ensureReturnUrl(orgId);
      return this.client.request<Started>(orgId, 'POST', `/v1/accounts/${accountId}/reauthorize`, { returnUrl: this.cfg.returnUrl });
    });
  }

  /** Liga a conta autorizada à oficina (conexão loja → conta). O marketplace da conta vem do serviço, nunca do pedido. */
  link(orgId: string, accountId: string): Promise<unknown> {
    return this.call(async () => {
      const account = await this.client.request<RawAccount>(orgId, 'GET', `/v1/accounts/${accountId}`);
      if (!account?.provider) throw new NotFoundException('Não encontrado.');
      return this.client.request(orgId, 'PUT', `/v1/connections/${orgId}/${account.provider}`, { accountId });
    });
  }

  revoke(orgId: string, accountId: string): Promise<unknown> {
    return this.call(() => this.client.request(orgId, 'DELETE', `/v1/accounts/${accountId}`));
  }

  setConnectionState(orgId: string, connectionId: string, action: 'pause' | 'resume'): Promise<unknown> {
    return this.call(() => this.client.request(orgId, 'POST', `/v1/connections/${connectionId}/${action}`, {}));
  }

  private redirectUri(provider: string): string {
    return this.cfg.publicUrl ? `${this.cfg.publicUrl}/v1/oauth/${provider}/callback` : '';
  }

  private async upsertOwnApp(orgId: string, provider: string, clientId: string, clientSecret: string): Promise<void> {
    const secrets = { clientId, clientSecret };
    const apps = await this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps');
    const current = activeApp(apps.items, provider, 'tenant');
    if (current) await this.client.request(orgId, 'PUT', `/v1/apps/${current.id}/secrets`, { secrets });
    else await this.client.request(orgId, 'POST', '/v1/apps', { provider, label: `${provider}-${Date.now().toString(36)}`, secrets });
  }

  /**
   * O serviço só redireciona para endereços que a organização cadastrou (lista exata). O Fixer cadastra o próprio endereço de retorno, uma vez, antes de
   * iniciar a autorização: a oficina não precisa saber disso. Preserva o resto da configuração e respeita a versão (If-Match).
   */
  private async ensureReturnUrl(orgId: string): Promise<void> {
    const cur = await this.client.request<{ document: { oauth?: { allowedReturnUrls?: string[] } } & Record<string, unknown>; version: number }>(orgId, 'GET', '/v1/settings');
    const urls = cur.document.oauth?.allowedReturnUrls ?? [];
    if (urls.includes(this.cfg.returnUrl)) return;
    const next = { ...cur.document, oauth: { ...cur.document.oauth, allowedReturnUrls: [...urls, this.cfg.returnUrl] } };
    await this.client.request(orgId, 'PUT', '/v1/settings', next, { 'if-match': `"${cur.version}"` });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.client.enabled) throw new ServiceUnavailableException('Marketplaces não está configurado neste ambiente.');
    try {
      return await fn();
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
