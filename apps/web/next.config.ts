import { fileURLToPath } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// DEV_HOST (IP da máquina na rede, p/ testar no celular) vem do .env da raiz; as URLs derivam dele.
// Valores já definidos (apps/web/.env.local, ambiente) têm prioridade.
loadEnvConfig(fileURLToPath(new URL('../../', import.meta.url)));
const devHost = process.env.DEV_HOST;
if (devHost) {
  process.env.NEXT_PUBLIC_API_URL ??= `http://${devHost}:3002`;
  process.env.KEYCLOAK_AUTH_SERVER_URL ??= `http://${devHost}:8180`;
}

const config: NextConfig = {
  // Exigido por apps/web/Dockerfile (copia .next/standalone).
  output: 'standalone',
  agentRules: false,
  // Monorepo: o tracing precisa enxergar a raiz para incluir os pacotes do workspace.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@fixer/ui'],
  // Dev: libera acesso pelo túnel HTTPS do ngrok (celular) e pelo IP da rede.
  allowedDevOrigins: ['unturpentined-lichtly-delena.ngrok-free.dev', ...(devHost ? [devHost] : [])],
};

export default config;
