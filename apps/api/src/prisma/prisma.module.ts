import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// @Global para não precisar reimportar em cada módulo que precisa do banco.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
