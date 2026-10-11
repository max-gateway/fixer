import type { FiscalConfig } from '../../src/fiscal-inbound/fiscal.config.js';

/** Configuração de teste completa; cada teste sobrescreve só o que importa. */
export const testConfig = (over: Partial<FiscalConfig> = {}): FiscalConfig => ({
  syncEnabled: true,
  tickMs: 10,
  requestTimeoutMs: 5000,
  distUrl: {},
  eventUrl: {},
  eventSoap: '1.2',
  ...over,
});
