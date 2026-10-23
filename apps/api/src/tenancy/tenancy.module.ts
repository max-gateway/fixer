import { PLATFORM_ROLE_SCOPES } from '@max-gateway/auth';
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformCatalogConfig } from '../catalog-platform/platform-catalog.config.js';
import { FixerTenantDirectory } from './fixer-tenant-directory.js';
import { MembershipService } from './membership.service.js';
import { MeController } from './me.controller.js';
import { PortalTenantMiddleware, ROLE_SCOPES, TenantMiddleware } from './tenant.middleware.js';
import { TenantDirectory } from './tenant-directory.service.js';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [
    TenantDirectory,
    MembershipService,
    PlatformCatalogConfig,
    FixerTenantDirectory,
    { provide: ROLE_SCOPES, useValue: PLATFORM_ROLE_SCOPES },
    TenantMiddleware,
    PortalTenantMiddleware,
  ],
  exports: [TenantDirectory, MembershipService],
})
export class TenancyModule {}
