import type { SefazConfig } from '../src/core/sefaz/sefaz.config.js';

/** Configuração SEFAZ de teste; cada teste sobrescreve só o que importa. */
export const testConfig = (over: Partial<SefazConfig> = {}): SefazConfig => ({
  requestTimeoutMs: 5000,
  distUrl: {},
  eventUrl: {},
  eventSoap: '1.2',
  ...over,
});
