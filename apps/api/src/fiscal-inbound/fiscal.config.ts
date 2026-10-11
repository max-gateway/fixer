import { readFileSync } from 'node:fs';

/** Configuração da sincronização fiscal, toda por variável de ambiente (nada de URL da SEFAZ no código). */
export interface FiscalConfig {
  syncEnabled: boolean;
  tickMs: number;
  requestTimeoutMs: number;
  /** URL do `NFeDistribuicaoDFe` por ambiente; ausente = sincronização desse ambiente não roda. */
  distUrl: { PRODUCTION?: string; HOMOLOGATION?: string };
  /** URL do `NFeRecepcaoEvento` (manifestação do destinatário) por ambiente. */
  eventUrl: { PRODUCTION?: string; HOMOLOGATION?: string };
  /** Versão do SOAP do serviço de eventos (o de distribuição é 1.1, pelo exemplo da NT). Conferir no WSDL. */
  eventSoap: '1.1' | '1.2';
  /** PEM com a cadeia ICP-Brasil dos servidores da SEFAZ (o repositório de CAs do Node não a inclui). */
  caPem?: string;
}

export const FISCAL_CONFIG = Symbol('FISCAL_CONFIG');

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : v !== 'false');
const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function loadFiscalConfig(env: NodeJS.ProcessEnv = process.env): FiscalConfig {
  const caPath = env.FISCAL_CA_BUNDLE;
  return {
    syncEnabled: bool(env.FISCAL_SYNC_ENABLED, true),
    tickMs: int(env.FISCAL_TICK_MS, 30_000),
    requestTimeoutMs: int(env.FISCAL_REQUEST_TIMEOUT_MS, 60_000),
    distUrl: {
      PRODUCTION: env.FISCAL_DIST_URL_PRODUCTION || undefined,
      HOMOLOGATION: env.FISCAL_DIST_URL_HOMOLOGATION || undefined,
    },
    eventUrl: {
      PRODUCTION: env.FISCAL_EVENT_URL_PRODUCTION || undefined,
      HOMOLOGATION: env.FISCAL_EVENT_URL_HOMOLOGATION || undefined,
    },
    eventSoap: env.FISCAL_EVENT_SOAP === '1.1' ? '1.1' : '1.2',
    // Falha na subida se o arquivo não existe: melhor que a primeira consulta morrer com erro de TLS.
    caPem: caPath ? readFileSync(caPath, 'utf8') : undefined,
  };
}
