/**
 * Modo gateway: em vez de falar com a SEFAZ, o Fixer consome o `dfe-gateway` central (docs/specs/dfe-gateway.md).
 * Ligado quando `DFE_GATEWAY_URL` e `DFE_GATEWAY_API_KEY` existem; sem elas o módulo continua no modo direto
 * (cliente SEFAZ + certificado cifrado local), para dev e para tenants ainda não migrados.
 */
export interface GatewayConfig {
  url: string;
  apiKey: string;
  /** Intervalo do reconciliador: puxa o cursor do gateway mesmo sem aviso. Consultar o gateway é barato (só banco). */
  pollMs: number;
  requestTimeoutMs: number;
}

export const GATEWAY_CONFIG = Symbol('FISCAL_GATEWAY_CONFIG');

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig | null {
  const url = env.DFE_GATEWAY_URL?.trim();
  const apiKey = env.DFE_GATEWAY_API_KEY?.trim();
  if (!url && !apiKey) return null;
  if (!url || !apiKey) throw new Error('DFE_GATEWAY_URL e DFE_GATEWAY_API_KEY devem ser definidas juntas');
  if (!url.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) {
    throw new Error('DFE_GATEWAY_URL precisa ser https (http só para localhost)');
  }
  const pollMs = Number(env.DFE_GATEWAY_POLL_MS ?? 60_000);
  return {
    url: url.replace(/\/+$/, ''),
    apiKey,
    pollMs: Number.isInteger(pollMs) && pollMs >= 1_000 ? pollMs : 60_000,
    requestTimeoutMs: 15_000,
  };
}
