import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@fixer/db';

/**
 * Cliente que IGNORA a RLS (papel `fixer_system`, com BYPASSRLS). Existe só para o que, por natureza, atravessa
 * organizações: descobrir a organização de um token público do portal ou de um código de WhatsApp, listar as
 * organizações com trabalho a fazer (agendadores fiscais) e publicar a outbox de todas.
 *
 * Regra de uso: ele descobre ONDE agir; quem age é o PrismaService, dentro de `TenantContext.run`. Lógica de negócio nunca
 * lê nem grava dados de oficina por aqui.
 *
 * `SYSTEM_DATABASE_URL` cai para `DATABASE_URL` quando ausente: em instalações legadas (um banco por oficina) o
 * papel da aplicação continua sendo dono das tabelas e o comportamento não muda.
 */
@Injectable()
export class SystemPrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor() {
    super({ datasourceUrl: process.env.SYSTEM_DATABASE_URL ?? process.env.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
