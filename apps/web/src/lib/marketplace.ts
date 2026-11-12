// Contas de marketplace da oficina (serviço `marketplace` da plataforma) como a API do Fixer as devolve. Nunca token nem segredo.
// NADA aqui é de um marketplace só: a lista, o passo a passo de criação do app, o endereço de retorno, o estado das contas e o texto da volta do OAuth vêm do
// serviço (pela API do Fixer). Marketplace novo no serviço aparece aqui sem mexer neste arquivo.

/** O estado da conta em palavras e tom, como o SERVIÇO o diz (o mesmo texto em todos os produtos). */
export type AccountStatus = { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; hint?: string };

export type MarketplaceAccount = {
  id: string;
  label: string;
  /** `active`, `pending_profile`, `reauth_required` ou `pending`. */
  state: string;
  displayName: string | null;
  status: AccountStatus;
  connection: { id: string; state: string } | null;
};

/** Passo a passo para criar o app no marketplace (só usado quando não há app compartilhado). Entregue pelo serviço, já completo. */
export type CredentialsGuide = {
  portalName: string;
  portalUrl?: string;
  createStep: string;
  idLabel: string;
  idHint: string;
  secretLabel: string;
  secretHint: string;
  permissions: string;
};

export type MarketplaceProvider = {
  slug: string;
  name: string;
  /** A oficina tem o direito a este marketplace. */
  entitled: boolean;
  /** Dá para autorizar uma conta agora (app compartilhado da plataforma ou app já cadastrado pela oficina). */
  ready: boolean;
  /** A oficina pode cadastrar o app dela, passo a passo. */
  canUseOwnApp: boolean;
  /** Endereço de retorno que a oficina cadastra no app dela no marketplace. `null` = o serviço não tem endereço público configurado. */
  redirectUri: string | null;
  capabilities: string[];
  credentials: CredentialsGuide;
  accounts: MarketplaceAccount[];
};

/** Texto de cada resultado da volta do OAuth (`?status=&reason=`). Só o código viaja na URL; a mensagem vem daqui. */
export type AuthorizationOutcomes = Record<string, { kind: 'ok' | 'error'; message: string }>;

export type MarketplaceOverview = { enabled: boolean; providers: MarketplaceProvider[]; authorizationOutcomes: AuthorizationOutcomes };

export type AuthorizationStarted = { accountId: string; authorizeUrl: string };

export const MARKETPLACE_URL = '/api/marketplace';
export const connectUrl = (slug: string) => `${MARKETPLACE_URL}/providers/${slug}/accounts`;

/** O que dá para fazer com o marketplace agora, em uma palavra para a tela: conectar direto, cadastrar o app da oficina, ou nada. */
export function providerMode(p: MarketplaceProvider): 'ready' | 'own-app' | 'unavailable' {
  if (!p.entitled) return 'unavailable';
  if (p.ready) return 'ready';
  return p.canUseOwnApp ? 'own-app' : 'unavailable';
}

/** Resultado da volta do marketplace (`?status=&accountId=&reason=`) em mensagem; `linkAccountId` indica a conta a vincular em seguida. */
export function returnOutcome(params: URLSearchParams, outcomes: AuthorizationOutcomes): { kind: 'ok' | 'error'; message: string; linkAccountId?: string } | null {
  const status = params.get('status');
  if (!status) return null;
  const known = status === 'error' ? params.get('reason') : status;
  const outcome = (known && outcomes[known]) || outcomes.error;
  if (!outcome) return { kind: 'error', message: 'Não foi possível concluir a autorização.' };
  const accountId = params.get('accountId');
  return { ...outcome, ...(outcome.kind === 'ok' && accountId ? { linkAccountId: accountId } : {}) };
}
