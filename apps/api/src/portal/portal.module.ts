import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { PortalService } from './portal.service.js';

/** Portal público do cliente (/portal/:token): mensagens, relato do problema, checklist e dados cadastrais. */
@Module({
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
