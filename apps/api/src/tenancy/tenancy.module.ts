import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MembershipService } from './membership.service.js';
import { MeController } from './me.controller.js';
import { PortalTenantMiddleware, TenantMiddleware } from './tenant.middleware.js';
import { TenantDirectory } from './tenant-directory.service.js';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [TenantDirectory, MembershipService, TenantMiddleware, PortalTenantMiddleware],
  exports: [TenantDirectory, MembershipService],
})
export class TenancyModule {}
