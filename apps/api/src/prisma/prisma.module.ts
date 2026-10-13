import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { SystemPrismaService } from './system-prisma.service.js';

// @Global para não precisar reimportar em cada módulo que precisa do banco.
@Global()
@Module({
  providers: [PrismaService, SystemPrismaService],
  exports: [PrismaService, SystemPrismaService],
})
export class PrismaModule {}
