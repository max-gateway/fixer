import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import { applyCatalog, catalog, CATALOG_VERSION } from '@fixer/catalog';
import { PrismaService } from '../prisma/prisma.service.js';

export const CATALOG_APPLIER = Symbol('CATALOG_APPLIER');

/**
 * Aplica o catálogo global (@fixer/catalog) ao banco do tenant na subida da API: cobre o
 * provisionamento (banco novo) e upgrades (versão embarcada diferente da aplicada).
 * A aplicação é idempotente e aditiva (spec §7.2), então reaplicar é seguro.
 */
@Injectable()
export class CatalogBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(CATALOG_APPLIER) private readonly apply: typeof applyCatalog = applyCatalog,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const state = await this.prisma.catalogState.findUnique({ where: { id: 1 } });
      if (state?.version === CATALOG_VERSION) return;
      await this.prisma.$transaction((tx) => this.apply(tx as never, catalog));
      this.logger.log(`Catálogo ${CATALOG_VERSION} aplicado (anterior: ${state?.version ?? 'nenhum'}).`);
    } catch (err) {
      // O catálogo é um enriquecimento; a API não deve cair por causa dele.
      this.logger.error(`Falha ao aplicar o catálogo ${CATALOG_VERSION}`, err instanceof Error ? err.stack : String(err));
    }
  }
}
