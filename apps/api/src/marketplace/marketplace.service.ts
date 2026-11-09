import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MarketplaceClient, toHttpException } from './marketplace.client.js';
import { MarketplaceConfig, type MarketplaceSettings } from './marketplace.config.js';

/** Único marketplace ligado hoje. */
export const PROVIDER = 'mercadolivre';
/** Direito do plano (control plane) que libera o provider; o serviço `marketplace` confere o mesmo direito e fecha por padrão. */
export const PROVIDER_FEATURE = `marketplace.provider.${PROVIDER}`;

export interface MarketplaceAccount {
  id: string;
  label: string;
  /** `active`, `pending_profile`, `reauth_required` ou `pending`. */
  state: string;
  displayName: string | null;
  connection: { id: string; state: string } | null;
}

export interface MarketplaceOverview {
  /** Falso quando o Fixer não está configurado para falar com o serviço. */
  enabled: boolean;
  provider: string;
  /** A oficina já cadastrou o app dela do Mercado Livre (necessário para autorizar contas). */
  canConnect: boolean;
  /** Endereço de retorno que a oficina precisa cadastrar no app do Mercado Livre. */
  redirectUri: string;
  accounts: MarketplaceAccount[];
}

interface RawAccount {
  id: string;
  provider: string;
  label: string;
  state: string;
  displayName: string | null;
  connection: { id: string; storeId: string | null; state: string } | null;
}
interface RawApp {
  id: string;
  provider: string;
  status: string;
}
type Started = { accountId: string; authorizeUrl: string };

/**
 * Contas do Mercado Livre da oficina. O Fixer não tem lojas: a conexão usa o id da organização como loja. Token e segredo nunca passam por aqui;
 * o serviço só devolve estado, perfil e a conexão. Todo erro do serviço sai por `toHttpException`.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly client: MarketplaceClient,
    @Inject(MarketplaceConfig) private readonly cfg: MarketplaceSettings,
  ) {}

  async overview(orgId: string): Promise<MarketplaceOverview> {
    if (!this.client.enabled) return { enabled: false, provider: PROVIDER, canConnect: false, redirectUri: '', accounts: [] };
    return this.call(async () => {
      const [accounts, apps] = await Promise.all([
        this.client.request<{ items: RawAccount[] }>(orgId, 'GET', '/v1/accounts'),
        this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps'),
      ]);
      return {
        enabled: true,
        provider: PROVIDER,
        canConnect: apps.items.some((a) => a.provider === PROVIDER && a.status === 'active'),
        redirectUri: this.cfg.redirectUri,
        accounts: accounts.items
          .filter((a) => a.provider === PROVIDER && a.state !== 'revoked')
          .map((a) => ({ id: a.id, label: a.label, state: a.state, displayName: a.displayName, connection: a.connection ? { id: a.connection.id, state: a.connection.state } : null })),
      };
    });
  }

  /** Inicia a autorização; o navegador vai a `authorizeUrl` e volta para a tela de Marketplaces. */
  connect(orgId: string, label: string, creds?: { clientId: string; clientSecret: string }): Promise<Started> {
    return this.call(async () => {
      if (creds) await this.upsertApp(orgId, creds.clientId, creds.clientSecret);
      const apps = await this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps');
      const app = apps.items.find((a) => a.provider === PROVIDER && a.status === 'active');
      if (!app) throw new ConflictException('Cadastre primeiro o aplicativo da sua oficina no Mercado Livre.');
      await this.ensureReturnUrl(orgId);
      return this.client.request<Started>(orgId, 'POST', '/v1/accounts', { provider: PROVIDER, appId: app.id, label, returnUrl: this.cfg.returnUrl });
    });
  }

  reauthorize(orgId: string, accountId: string): Promise<Started> {
    return this.call(async () => {
      await this.ensureReturnUrl(orgId);
      return this.client.request<Started>(orgId, 'POST', `/v1/accounts/${accountId}/reauthorize`, { returnUrl: this.cfg.returnUrl });
    });
  }

  /**
   * Cadastra (ou troca) o app OAuth da oficina no Mercado Livre. O segredo vai direto ao cofre do serviço e nunca volta; nada dele é guardado ou logado aqui.
   * Se já existe um app ativo, troca o segredo dele: as contas ligadas continuam e a próxima renovação já usa o novo.
   */
  registerApp(orgId: string, clientId: string, clientSecret: string): Promise<void> {
    return this.call(() => this.upsertApp(orgId, clientId, clientSecret));
  }

  private async upsertApp(orgId: string, clientId: string, clientSecret: string): Promise<void> {
    const secrets = { clientId, clientSecret };
    const apps = await this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps');
    const current = apps.items.find((a) => a.provider === PROVIDER && a.status === 'active');
    if (current) await this.client.request(orgId, 'PUT', `/v1/apps/${current.id}/secrets`, { secrets });
    else await this.client.request(orgId, 'POST', '/v1/apps', { provider: PROVIDER, label: `ml-${Date.now().toString(36)}`, secrets });
  }

  /** Liga a conta autorizada à oficina (conexão loja → conta). */
  link(orgId: string, accountId: string): Promise<unknown> {
    return this.call(() => this.client.request(orgId, 'PUT', `/v1/connections/${orgId}/${PROVIDER}`, { accountId }));
  }

  revoke(orgId: string, accountId: string): Promise<unknown> {
    return this.call(() => this.client.request(orgId, 'DELETE', `/v1/accounts/${accountId}`));
  }

  setConnectionState(orgId: string, connectionId: string, action: 'pause' | 'resume'): Promise<unknown> {
    return this.call(() => this.client.request(orgId, 'POST', `/v1/connections/${connectionId}/${action}`, {}));
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
