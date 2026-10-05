import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaClient } from '@fixer/db';

/**
 * Wrapper fino do PrismaClient como provider do Nest, para poder ser
 * injetado nos services (ex.: PlateLookupService) e ter seu ciclo de vida
 * (connect/disconnect) amarrado ao do módulo Nest.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
