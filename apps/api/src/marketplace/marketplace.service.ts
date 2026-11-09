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
  /** A organização tem um aplicativo ativo do marketplace para autorizar contas. */
  canConnect: boolean;
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
    if (!this.client.enabled) return { enabled: false, provider: PROVIDER, canConnect: false, accounts: [] };
    return this.call(async () => {
      const [accounts, apps] = await Promise.all([
        this.client.request<{ items: RawAccount[] }>(orgId, 'GET', '/v1/accounts'),
        this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps'),
      ]);
      return {
        enabled: true,
        provider: PROVIDER,
        canConnect: apps.items.some((a) => a.provider === PROVIDER && a.status === 'active'),
        accounts: accounts.items
          .filter((a) => a.provider === PROVIDER && a.state !== 'revoked')
          .map((a) => ({ id: a.id, label: a.label, state: a.state, displayName: a.displayName, connection: a.connection ? { id: a.connection.id, state: a.connection.state } : null })),
      };
    });
  }

  /** Inicia a autorização; o navegador vai a `authorizeUrl` e volta para a tela de Marketplaces. */
  connect(orgId: string, label: string): Promise<Started> {
    return this.call(async () => {
      const apps = await this.client.request<{ items: RawApp[] }>(orgId, 'GET', '/v1/apps');
      const app = apps.items.find((a) => a.provider === PROVIDER && a.status === 'active');
      if (!app) throw new ConflictException('Nenhum aplicativo do Mercado Livre está liberado para a sua oficina.');
      return this.client.request<Started>(orgId, 'POST', '/v1/accounts', { provider: PROVIDER, appId: app.id, label, returnUrl: this.cfg.returnUrl });
    });
  }

  reauthorize(orgId: string, accountId: string): Promise<Started> {
    return this.call(() => this.client.request<Started>(orgId, 'POST', `/v1/accounts/${accountId}/reauthorize`, { returnUrl: this.cfg.returnUrl }));
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

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.client.enabled) throw new ServiceUnavailableException('Marketplaces não está configurado neste ambiente.');
    try {
      return await fn();
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
