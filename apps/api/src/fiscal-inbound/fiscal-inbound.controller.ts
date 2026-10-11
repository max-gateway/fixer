import { Body, Controller, Delete, Get, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { CredentialService, FlagsSchema, InspectCredentialSchema, SettingsSchema, UploadCredentialSchema } from './credentials/credential.service.js';

const actor = (user: AuthUser, req: Request) => ({ id: user.id, ip: req.ip });

@Controller('fiscal')
export class FiscalInboundController {
  constructor(private readonly credentials: CredentialService) {}

  @Get('status')
  @RequirePermission('invoices.read')
  status() {
    return this.credentials.status();
  }

  /**
   * Dados da empresa para a importação de NF-e (CNPJ, razão social, UF). Rota própria (`company`) porque
   * `fiscal/settings` pertence ao módulo fiscal-settings (NFS-e/preço por hora), que nunca escreve estas colunas.
   */
  @Get('company')
  @RequirePermission('invoices.read')
  company() {
    return this.credentials.getSettings();
  }

  @Put('company')
  @RequirePermission('fiscal.manage')
  updateSettings(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.credentials.updateSettings(parse(SettingsSchema, body), actor(user, req));
  }

  @Post('credentials/inspect')
  @RequirePermission('fiscal.manage')
  inspect(@Body() body: unknown) {
    return this.credentials.inspect(parse(InspectCredentialSchema, body));
  }

  @Post('credentials')
  @RequirePermission('fiscal.manage')
  upload(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.credentials.upload(parse(UploadCredentialSchema, body), actor(user, req));
  }

  @Patch('credentials')
  @RequirePermission('fiscal.manage')
  updateFlags(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.credentials.updateFlags(parse(FlagsSchema, body), actor(user, req));
  }

  @Delete('credentials')
  @RequirePermission('fiscal.manage')
  remove(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.credentials.remove(actor(user, req));
  }
}
