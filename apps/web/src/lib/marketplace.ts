// Contas de marketplace da oficina (serviço `marketplace` da plataforma) como a API do Fixer as devolve. Nunca token nem segredo.
// Nada aqui é de um marketplace só: a lista de marketplaces vem da API; só o texto de ajuda para criar o app é por marketplace (GUIDES).

export type MarketplaceAccount = {
  id: string;
  label: string;
  /** `active`, `pending_profile`, `reauth_required` ou `pending`. */
  state: string;
  displayName: string | null;
  connection: { id: string; state: string } | null;
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
  /** Endereço de retorno que a oficina cadastra no app dela no marketplace. */
  redirectUri: string;
  accounts: MarketplaceAccount[];
};

export type MarketplaceOverview = { enabled: boolean; providers: MarketplaceProvider[] };

export type AuthorizationStarted = { accountId: string; authorizeUrl: string };

export const MARKETPLACE_URL = '/api/marketplace';
export const connectUrl = (slug: string) => `${MARKETPLACE_URL}/providers/${slug}/accounts`;

/** O que dá para fazer com o marketplace agora, em uma palavra para a tela: conectar direto, cadastrar o app da oficina, ou nada. */
export function providerMode(p: MarketplaceProvider): 'ready' | 'own-app' | 'unavailable' {
  if (!p.entitled) return 'unavailable';
  if (p.ready) return 'ready';
  return p.canUseOwnApp ? 'own-app' : 'unavailable';
}

export type AccountStatus = { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; hint?: string };

/** O estado da conta em palavras, já levando em conta se a oficina a usa (conexão) e se está pausada. */
export function accountStatus(a: MarketplaceAccount): AccountStatus {
  if (a.state === 'reauth_required') return { label: 'Precisa reconectar', tone: 'bad', hint: 'O marketplace pediu que você autorize de novo.' };
  if (a.state === 'pending') return { label: 'Aguardando autorização', tone: 'warn', hint: 'A autorização no marketplace não foi concluída.' };
  if (a.state === 'pending_profile') return { label: 'Finalizando', tone: 'warn', hint: 'Autorizada; estamos lendo o perfil do vendedor. Atualize em instantes.' };
  if (a.state !== 'active') return { label: a.state, tone: 'muted' };
  if (!a.connection) return { label: 'Autorizada, não vinculada', tone: 'warn', hint: 'Falta vincular a conta à oficina.' };
  if (a.connection.state === 'paused') return { label: 'Pausada', tone: 'muted' };
  if (a.connection.state === 'active') return { label: 'Conectada', tone: 'ok' };
  return { label: a.connection.state, tone: 'muted' };
}

/** Resultado da volta do marketplace (`?status=&accountId=&reason=`) em mensagem; `linkAccountId` indica a conta a vincular em seguida. */
export function returnOutcome(params: URLSearchParams): { kind: 'ok' | 'error'; message: string; linkAccountId?: string } | null {
  const status = params.get('status');
  if (!status) return null;
  if (status === 'active' || status === 'pending_profile') {
    const accountId = params.get('accountId') ?? undefined;
    return { kind: 'ok', message: 'Conta autorizada no marketplace.', ...(accountId ? { linkAccountId: accountId } : {}) };
  }
  const reasons: Record<string, string> = {
    denied: 'A autorização foi negada no marketplace.',
    rejected: 'O marketplace recusou a autorização. Tente de novo.',
    unavailable: 'O marketplace está indisponível agora. Tente de novo em instantes.',
    conflict: 'Esta conta do marketplace já está em uso por outra organização.',
  };
  return { kind: 'error', message: reasons[params.get('reason') ?? ''] ?? 'Não foi possível concluir a autorização.' };
}

/**
 * Ajuda para a oficina criar o app dela em cada marketplace (só usada quando não há app compartilhado). Marketplace sem entrada aqui cai no texto genérico,
 * então acrescentar um provider no serviço já funciona; a entrada só torna o passo a passo mais específico.
 */
export type ProviderGuide = {
  portalUrl?: string;
  portalName: string;
  createStep: string;
  idLabel: string;
  idHint: string;
  secretLabel: string;
  secretHint: string;
  permissions: string;
};

const GENERIC_GUIDE: ProviderGuide = {
  portalName: 'o painel de desenvolvedores do marketplace',
  createStep: 'Procure a opção de criar um novo aplicativo (ou “aplicação”). No nome, pode usar o nome da sua oficina.',
  idLabel: 'ID do aplicativo',
  idHint: 'Aparece como “App ID”, “Client ID” ou “Partner ID”.',
  secretLabel: 'Chave secreta',
  secretHint: 'Aparece como “Secret Key”, “Client Secret” ou “Partner Key”.',
  permissions: 'Deixe marcadas as permissões de leitura e de escrita. Assim o Fixer consegue ver e atualizar seus anúncios e pedidos.',
};

const GUIDES: Record<string, Partial<ProviderGuide>> = {
  mercadolivre: {
    portalUrl: 'https://developers.mercadolivre.com.br/devcenter',
    portalName: 'o painel de desenvolvedores do Mercado Livre',
    createStep: 'Clique em “Criar nova aplicação”. No nome, pode usar o nome da sua oficina. Os outros campos de texto você pode preencher como achar melhor.',
    idHint: 'No painel do Mercado Livre aparece como “App ID” ou “Client ID”: um número grande.',
    secretHint: 'Aparece como “Secret Key” ou “Client Secret”: um código com letras e números.',
  },
};

export const guideFor = (slug: string): ProviderGuide => ({ ...GENERIC_GUIDE, ...GUIDES[slug] });
