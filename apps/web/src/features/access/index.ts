// API pública do módulo de acessos. Fora daqui, importe só deste arquivo.
export { AccessWorkspace } from './components/access-workspace';
export { AccessApiContext } from './hooks';
export { createAccessApi, proxyTransport, type AccessApi, type Transport } from './api';
export type * from './types';
