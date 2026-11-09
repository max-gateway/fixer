import { Injectable } from '@nestjs/common';

/** Tudo que o cliente do marketplace precisa. Os testes montam um objeto desta forma. */
export interface MarketplaceSettings {
  enabled: boolean;
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Para onde o navegador volta depois de autorizar. Precisa estar em `oauth.allowedReturnUrls` da organização, igual, sem curinga. */
  returnUrl: string;
  /** Host público do serviço: dele sai o endereço de retorno do OAuth que a oficina cadastra no app dela (`/v1/oauth/<provedor>/callback`). Só para mostrar na tela. */
  publicUrl: string;
  timeoutMs: number;
}

/**
 * Integração com o serviço `marketplace` da plataforma (contas, OAuth e conexões por organização). Opcional: sem URL, credencial e endereço de
 * retorno, a tela de Marketplaces mostra "não disponível" e a API segue como sempre. O Fixer fala com o serviço como o client `fixer-marketplace`
 * (client credentials); a organização vem da concessão do registro, escolhida por `X-Org-Id`.
 */
@Injectable()
export class MarketplaceConfig implements MarketplaceSettings {
  readonly baseUrl = (process.env.MARKETPLACE_URL ?? '').replace(/\/+$/, '');
  readonly tokenUrl = process.env.MARKETPLACE_TOKEN_URL ?? '';
  readonly clientId = process.env.MARKETPLACE_CLIENT_ID ?? 'fixer-marketplace';
  readonly clientSecret = process.env.MARKETPLACE_CLIENT_SECRET ?? '';
  readonly returnUrl = process.env.MARKETPLACE_RETURN_URL ?? '';
  readonly publicUrl = (process.env.MARKETPLACE_PUBLIC_URL ?? '').replace(/\/+$/, '');
  readonly timeoutMs = Number(process.env.MARKETPLACE_TIMEOUT_MS ?? 5000);

  get enabled(): boolean {
    return Boolean(this.baseUrl && this.tokenUrl && this.clientSecret && this.returnUrl);
  }
}
