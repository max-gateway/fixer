import { Controller, Get, Header, Injectable, Req, UnauthorizedException } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Uma peça casada ao catálogo com dado fiscal, no formato que o CLI `fiscal-backfill` da plataforma lê (`services/parts-search`). */
export interface BackfillLine {
  storeId: string;
  sku: string;
  ncm?: string;
  cest?: string;
  origin?: number;
  unit?: string;
  verified: boolean;
}

interface PartForBackfill {
  catalogSku: string | null;
  ncm: string | null;
  cest: string | null;
  originCode: number | null;
  unit: string | null;
  fiscalVerified: boolean;
}

const PAGE = 1000;

/**
 * Backfill da classificação fiscal para a plataforma (docs/specs/parts-search-fiscal.md §9). Só as peças JÁ CASADAS ao catálogo (`catalogSku`) e com algum
 * dado fiscal: as não casadas seguem o fluxo de proposta de inserção e só recebem classificação depois de existirem no catálogo. `fiscalVerified = true`
 * vira o aceite do contador na plataforma (a referência dele é o client que roda o CLI, ex.: `migracao-fixer`). Nada derivado sai daqui: CFOP, CST e CSOSN
 * são do motor tributário, e custo, margem e fornecedor nunca vão ao catálogo.
 */
@Injectable()
export class FiscalBackfillExport {
  constructor(private readonly prisma: PrismaService) {}

  /** Linha de uma peça, ou `null` se não há o que levar. Função pura. */
  static lineOf(part: PartForBackfill, storeId: string): BackfillLine | null {
    if (!part.catalogSku) return null;
    const ncm = part.ncm?.replace(/[.\s]/g, '') ?? '';
    const cest = part.cest?.replace(/[.\s]/g, '') ?? '';
    const unit = part.unit?.trim().toUpperCase() ?? '';
    const line: BackfillLine = {
      storeId,
      sku: part.catalogSku,
      ...(/^[0-9]{8}$/.test(ncm) ? { ncm } : {}),
      ...(/^[0-9]{7}$/.test(cest) ? { cest } : {}),
      ...(part.originCode !== null && part.originCode >= 0 && part.originCode <= 8 ? { origin: part.originCode } : {}),
      ...(/^[A-Z0-9]{1,6}$/.test(unit) ? { unit } : {}),
      verified: part.fiscalVerified,
    };
    return line.ncm || line.cest || line.origin !== undefined || line.unit ? line : null;
  }

  /** NDJSON da oficina atual (o isolamento por organização é do próprio banco, via RLS). */
  async ndjson(orgId: string): Promise<string> {
    const storeId = orgId.toLowerCase();
    const lines: string[] = [];
    for (let after: string | undefined; ; ) {
      const rows = await this.prisma.part.findMany({
        where: { catalogSku: { not: null }, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: PAGE,
        select: { id: true, catalogSku: true, ncm: true, cest: true, originCode: true, unit: true, fiscalVerified: true },
      });
      for (const r of rows) {
        const line = FiscalBackfillExport.lineOf(r, storeId);
        if (line) lines.push(JSON.stringify(line));
      }
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1]!.id;
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
  }
}

/** `GET /catalog-platform/fiscal-backfill`: só quem configura o fiscal da oficina (`fiscal.manage`, risco alto). */
@Controller('catalog-platform')
export class FiscalBackfillController {
  constructor(private readonly exporter: FiscalBackfillExport) {}

  @Get('fiscal-backfill')
  @RequirePermission('fiscal.manage')
  @Header('Content-Type', 'application/x-ndjson; charset=utf-8')
  export(@Req() req: { principal?: { tenantId?: string } }): Promise<string> {
    const org = req.principal?.tenantId;
    if (!org) throw new UnauthorizedException('Organização não identificada');
    return this.exporter.ndjson(org);
  }
}
