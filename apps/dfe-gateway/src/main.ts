import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/config.js';

async function bootstrap() {
  // Dev local: carrega apps/dfe-gateway/.env se existir (em produção vem do compose/secret).
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { port, runApi } = loadConfig(); // falha cedo e com mensagem clara se a config estiver errada

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // SIGTERM (rolling deploy) -> scheduler e relay terminam o lote atual e fecham conexões.
  app.enableShutdownHooks();
  // Atrás do nginx: o IP real do cliente (auditoria) vem do X-Forwarded-For do primeiro salto confiável.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // O .pfx vai em base64 no JSON (256 KB -> ~350 KB); 1 MB cobre com folga e barra abuso.
  app.useBodyParser('json', { limit: '1mb' });
  app.use((req: { headers: Record<string, string | string[] | undefined>; id?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    const id = String(req.headers['request-id'] ?? '').slice(0, 64) || randomUUID();
    req.id = id;
    res.setHeader('Request-Id', id);
    next();
  });

  // Worker puro não precisa de porta pública, mas mantém /healthz e /metrics para o orquestrador.
  await app.listen(port);
  if (!runApi) console.log(`worker-only: HTTP em ${port} serve apenas healthz/metrics`);
}
await bootstrap();
