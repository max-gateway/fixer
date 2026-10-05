import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/config.js';

async function bootstrap() {
  // Dev local: carrega apps/notifications/.env se existir (em produção vem do ConfigMap/Secret).
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { port } = loadConfig(); // falha cedo e com mensagem clara se a config estiver errada

  const app = await NestFactory.create(AppModule);
  // SIGTERM (rolling deploy) -> consumer e dispatcher terminam o lote atual e fecham conexões.
  app.enableShutdownHooks();
  await app.listen(port);
}
await bootstrap();
