import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { validateEnv } from './config/env.js';

async function bootstrap() {
  // Dev local: carrega apps/api/.env se existir (em produção vem do ConfigMap/Secret).
  // Não sobrescreve variáveis já definidas no ambiente.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = validateEnv();
  const app = await NestFactory.create(AppModule);
  // Necessário para que onApplicationShutdown (PlateEventsConsumerService)
  // seja chamado e o loop de consumo pare de forma limpa em SIGTERM/SIGINT.
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}
await bootstrap();
