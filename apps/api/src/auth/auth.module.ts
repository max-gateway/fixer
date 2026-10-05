import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthConfig } from './auth.config.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

/**
 * Autenticação via JWT do Keycloak do tenant. O guard é global: toda rota exige
 * Bearer token, salvo as marcadas com @Public().
 */
@Module({
  providers: [AuthConfig, AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
