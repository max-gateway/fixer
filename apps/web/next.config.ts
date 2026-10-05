import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Exigido por apps/web/Dockerfile (copia .next/standalone).
  output: 'standalone',
  agentRules: false,
  // Monorepo: o tracing precisa enxergar a raiz para incluir os pacotes do workspace.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@fixer/ui'],
  // Dev: libera acesso pelo túnel HTTPS do ngrok (celular) e pelo IP da rede.
  allowedDevOrigins: ['unturpentined-lichtly-delena.ngrok-free.dev', '192.168.0.14'],
};

export default config;
