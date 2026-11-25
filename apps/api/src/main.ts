import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { validateEnv } from './config/env.js';

async function bootstrap() {
  // Dev local: carrega apps/api/.env se existir (em produção vem do ConfigMap/Secret).
  // Não sobrescreve variáveis já definidas no ambiente.
  if (existsSync('.env')) process.loadEnvFile('.env');
  // DEV_HOST (raiz/.env): IP da máquina na rede, para o celular alcançar o Keycloak.
  if (existsSync('../../.env')) process.loadEnvFile('../../.env');
  if (process.env.DEV_HOST) process.env.KEYCLOAK_AUTH_SERVER_URL ??= `http://${process.env.DEV_HOST}:8180`;
  const env = validateEnv();
  const app = await NestFactory.create(AppModule);
  // Necessário para que onApplicationShutdown (PlateEventsConsumerService)
  // seja chamado e o loop de consumo pare de forma limpa em SIGTERM/SIGINT.
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}
await bootstrap();
