import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/config.js';

async function bootstrap() {
  // Dev local: carrega apps/whatsapp/.env se existir (em produção vem do ConfigMap/Secret).
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { port } = loadConfig(); // falha cedo e com mensagem clara se a config estiver errada

  // rawBody: a assinatura dos webhooks da Meta é calculada sobre o corpo exatamente como chegou.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  await app.listen(port);
}
await bootstrap();
