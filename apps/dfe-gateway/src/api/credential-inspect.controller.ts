import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CredentialService, InspectSchema } from '../credentials/credential.service.js';
import { AuthGuard } from '../tenants/auth.guard.js';

/**
 * Cadastro guiado pelo certificado: o produto ainda não conhece o CNPJ, então lê o titular e o CNPJ do `.pfx`
 * ANTES de criar a empresa. Não grava nada e não depende de empresa (docs/specs/dfe-gateway.md §6.2).
 */
@Controller('v1/credential')
@UseGuards(AuthGuard)
export class CredentialInspectController {
  constructor(private readonly credentials: CredentialService) {}

  @Post('inspect')
  @HttpCode(200)
  inspect(@Body() body: unknown) {
    return this.credentials.inspect(InspectSchema.parse(body));
  }
}
