import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { PlanLimits } from '../control-plane/plan-limits.service.js';
import { MarketplaceService, providerFeature } from './marketplace.service.js';

interface MarketplaceRequest {
  principal?: { tenantId?: string };
}
const orgOf = (req: MarketplaceRequest): string => {
  const id = req.principal?.tenantId;
  if (!id) throw new Error('Requisição sem organização');
  return id;
};

const Slug = z.string().regex(/^[a-z][a-z0-9]{1,31}$/, 'Marketplace inválido');
const App = z
  .object({ clientId: z.string().trim().min(1, 'Informe o Client ID').max(256), clientSecret: z.string().trim().min(1, 'Informe o Client Secret').max(1024) })
  .strict();
/** Nome da conta e, quando a oficina usa o app dela (primeira vez ou troca), as credenciais: tudo o mais o backend monta. */
const Connect = z
  .object({
    label: z.string().trim().min(1, 'Dê um nome à conta').max(80, 'O nome da conta é grande demais'),
    clientId: App.shape.clientId.optional(),
    clientSecret: App.shape.clientSecret.optional(),
  })
  .strict()
  .refine((v) => (v.clientId === undefined) === (v.clientSecret === undefined), { message: 'Informe o Client ID e o Client Secret juntos' });

/**
 * Contas de marketplace da oficina (Configurações → Marketplaces), para qualquer marketplace que o serviço da plataforma opere. A organização vem do
 * Principal, nunca do corpo. O direito do plano (`marketplace.provider.<marketplace>`) é conferido por marketplace; o serviço confere o mesmo.
 */
@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly limits: PlanLimits,
  ) {}

  @Get()
  @RequirePermission('marketplace.read')
  overview(@Req() req: MarketplaceRequest) {
    return this.marketplace.overview(orgOf(req));
  }

  @Post('providers/:provider/app')
  @HttpCode(204)
  @RequirePermission('marketplace.manage')
  async registerApp(@Param('provider') provider: string, @Body() body: unknown, @Req() req: MarketplaceRequest): Promise<void> {
    const slug = parse(Slug, provider);
    const { clientId, clientSecret } = parse(App, body);
    await this.limits.assertFeature(providerFeature(slug));
    await this.marketplace.registerApp(orgOf(req), slug, clientId, clientSecret);
  }

  @Post('providers/:provider/accounts')
  @HttpCode(200)
  @RequirePermission('marketplace.manage')
  async connect(@Param('provider') provider: string, @Body() body: unknown, @Req() req: MarketplaceRequest) {
    const slug = parse(Slug, provider);
    const { label, clientId, clientSecret } = parse(Connect, body);
    await this.limits.assertFeature(providerFeature(slug));
    return this.marketplace.connect(orgOf(req), slug, label, clientId && clientSecret ? { clientId, clientSecret } : undefined);
  }

  @Post('accounts/:id/reauthorize')
  @HttpCode(200)
  @RequirePermission('marketplace.manage')
  reauthorize(@Param('id', ParseUUIDPipe) id: string, @Req() req: MarketplaceRequest) {
    return this.marketplace.reauthorize(orgOf(req), id);
  }

  @Post('accounts/:id/link')
  @HttpCode(200)
  @RequirePermission('marketplace.manage')
  link(@Param('id', ParseUUIDPipe) id: string, @Req() req: MarketplaceRequest) {
    return this.marketplace.link(orgOf(req), id);
  }

  @Delete('accounts/:id')
  @HttpCode(200)
  @RequirePermission('marketplace.manage')
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: MarketplaceRequest) {
    return this.marketplace.revoke(orgOf(req), id);
  }

  @Post('connections/:id/pause')
  @HttpCode(200)
  @RequirePermission('marketplace.manage')
  pause(@Param('id', ParseUUIDPipe) id: string, @Req() req: MarketplaceRequest) {
    return this.marketplace.setConnectionState(orgOf(req), id, 'pause');
  }

  @Post('connections/:id/resume')
  @HttpCode(200)
  @RequirePermission('marketplace.manage')
  resume(@Param('id', ParseUUIDPipe) id: string, @Req() req: MarketplaceRequest) {
    return this.marketplace.setConnectionState(orgOf(req), id, 'resume');
  }
}
