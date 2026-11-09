// Contas de marketplace da oficina (serviço `marketplace` da plataforma) como a API do Fixer as devolve. Nunca token nem segredo.

export type MarketplaceAccount = {
  id: string;
  label: string;
  /** `active`, `pending_profile`, `reauth_required` ou `pending`. */
  state: string;
  displayName: string | null;
  connection: { id: string; state: string } | null;
};

export type MarketplaceOverview = {
  enabled: boolean;
  provider: string;
  /** A oficina já cadastrou o app dela no Mercado Livre. */
  canConnect: boolean;
  /** Endereço de retorno que a oficina cadastra no app do Mercado Livre. */
  redirectUri: string;
  accounts: MarketplaceAccount[];
};

export type AuthorizationStarted = { accountId: string; authorizeUrl: string };

export const MARKETPLACE_URL = '/api/marketplace';

export type AccountStatus = { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; hint?: string };

/** O estado da conta em palavras, já levando em conta se a oficina a usa (conexão) e se está pausada. */
export function accountStatus(a: MarketplaceAccount): AccountStatus {
  if (a.state === 'reauth_required') return { label: 'Precisa reconectar', tone: 'bad', hint: 'O Mercado Livre pediu que você autorize de novo.' };
  if (a.state === 'pending') return { label: 'Aguardando autorização', tone: 'warn', hint: 'A autorização no Mercado Livre não foi concluída.' };
  if (a.state === 'pending_profile') return { label: 'Finalizando', tone: 'warn', hint: 'Autorizada; estamos lendo o perfil do vendedor. Atualize em instantes.' };
  if (a.state !== 'active') return { label: a.state, tone: 'muted' };
  if (!a.connection) return { label: 'Autorizada, não vinculada', tone: 'warn', hint: 'Falta vincular a conta à oficina.' };
  if (a.connection.state === 'paused') return { label: 'Pausada', tone: 'muted' };
  if (a.connection.state === 'active') return { label: 'Conectada', tone: 'ok' };
  return { label: a.connection.state, tone: 'muted' };
}

/** Resultado da volta do Mercado Livre (`?status=&accountId=&reason=`) em mensagem; `link` indica a conta a vincular em seguida. */
export function returnOutcome(params: URLSearchParams): { kind: 'ok' | 'error'; message: string; linkAccountId?: string } | null {
  const status = params.get('status');
  if (!status) return null;
  if (status === 'active' || status === 'pending_profile') {
    const accountId = params.get('accountId') ?? undefined;
    return { kind: 'ok', message: 'Conta autorizada no Mercado Livre.', ...(accountId ? { linkAccountId: accountId } : {}) };
  }
  const reasons: Record<string, string> = {
    denied: 'A autorização foi negada no Mercado Livre.',
    rejected: 'O Mercado Livre recusou a autorização. Tente de novo.',
    unavailable: 'O Mercado Livre está indisponível agora. Tente de novo em instantes.',
    conflict: 'Esta conta do Mercado Livre já está em uso por outra organização.',
  };
  return { kind: 'error', message: reasons[params.get('reason') ?? ''] ?? 'Não foi possível concluir a autorização.' };
}
