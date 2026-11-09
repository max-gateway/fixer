import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { RequireFeature } from '../control-plane/feature.guard.js';
import { MarketplaceService, PROVIDER_FEATURE } from './marketplace.service.js';

interface MarketplaceRequest {
  principal?: { tenantId?: string };
}
const orgOf = (req: MarketplaceRequest): string => {
  const id = req.principal?.tenantId;
  if (!id) throw new Error('Requisição sem organização');
  return id;
};

const Connect = z.object({ label: z.string().trim().min(1, 'Dê um nome à conta').max(80, 'O nome da conta é grande demais') }).strict();

/** Contas de marketplace da oficina (Configurações → Marketplaces). A organização vem do Principal, nunca do corpo. */
@Controller('marketplace')
@RequireFeature(PROVIDER_FEATURE)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get()
  @RequirePermission('marketplace.read')
  overview(@Req() req: MarketplaceRequest) {
    return this.marketplace.overview(orgOf(req));
  }

  @Post('accounts')
  @HttpCode(200)
  @RequirePermission('marketplace.manage')
  connect(@Body() body: unknown, @Req() req: MarketplaceRequest) {
    return this.marketplace.connect(orgOf(req), parse(Connect, body).label);
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
