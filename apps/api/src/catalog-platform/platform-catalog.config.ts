import { Injectable } from '@nestjs/common';
import { parseCatalogList } from './catalogs.js';

@Injectable()
export class PlatformCatalogConfig {
  /** Catálogos globais que toda oficina do Fixer lê (contrato comercial por organização é decisão futura do dono do produto). */
  readonly catalogs = parseCatalogList(process.env.PARTS_SEARCH_CATALOGS);
}
