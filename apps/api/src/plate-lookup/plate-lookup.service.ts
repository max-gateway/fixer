import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlateLookupClient } from './plate-lookup.client.js';
import { PlateLookupResultSchema, type PlateLookupResult } from './schema.js';

export interface PlateLookupRecord {
  plate: string;
  cached: boolean; // true = veio do histórico salvo, não gerou chamada nova à Puxa Placa
  queriedAt: Date;
  result: PlateLookupResult;
}

const PLATE_RE = /^[A-Za-z0-9]{7}$/;

/**
 * Regra de negócio central deste módulo: uma placa só é consultada na API
 * Puxa Placa (chamada externa paga, via apps/plate-lookup) uma única vez.
 * Antes de chamar o microservice, checamos se já existe um PlateLookup salvo
 * para a placa — se sim, devolvemos o que já está no banco, sem nova chamada.
 *
 * Placa e dados cadastrais do veículo não mudam, então o resultado é tratado
 * como definitivo. Não há TTL/expiração aqui de propósito.
 *
 * Persistimos o JSON CRU do provedor (rawResponse), sem filtrar campos: como
 * a consulta é paga e nunca expira, o que não for salvo agora só voltaria com
 * nova cobrança. A leitura tipada (PlateLookupResultSchema) é tolerante e
 * extrai só o que a aplicação usa.
 */
@Injectable()
export class PlateLookupService {
  private readonly logger = new Logger(PlateLookupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PlateLookupClient,
  ) {}

  async lookup(rawPlate: string): Promise<PlateLookupRecord> {
    const plate = normalizePlate(rawPlate);
    if (!PLATE_RE.test(plate)) {
      throw new InvalidPlateError(rawPlate);
    }

    const existing = await this.prisma.plateLookup.findUnique({ where: { plate } });
    if (existing) {
      this.logger.debug(`Placa ${plate} já consultada em ${existing.queriedAt.toISOString()}, usando cache.`);
      return {
        plate,
        cached: true,
        queriedAt: existing.queriedAt,
        result: PlateLookupResultSchema.parse(existing.rawResponse),
      };
    }

    const raw = await this.client.consultaPlaca(plate);
    const result = PlateLookupResultSchema.parse(raw);
    const dados = result.basico?.dados;

    const saved = await this.prisma.plateLookup.upsert({
      where: { plate },
      // Se duas requisições concorrentes chegarem para a mesma placa nova,
      // a segunda apenas atualiza com o resultado (idêntico) em vez de falhar
      // na constraint única — evita uma race condition rara em cadastro duplicado.
      create: {
        plate,
        rawResponse: raw as object,
        brand: dados?.marca ?? null,
        model: dados?.modelo ?? null,
        year: dados?.ano ?? null,
      },
      update: {
        rawResponse: raw as object,
        brand: dados?.marca ?? null,
        model: dados?.modelo ?? null,
        year: dados?.ano ?? null,
      },
    });

    this.logger.log(`Placa ${plate} consultada na Puxa Placa (${dados?.marca ?? '?'} ${dados?.modelo ?? '?'}).`);

    return {
      plate,
      cached: false,
      queriedAt: saved.queriedAt,
      result,
    };
  }
}

export class InvalidPlateError extends Error {
  constructor(readonly plate: string) {
    super(`Formato de placa inválido: ${plate}`);
  }
}

function normalizePlate(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}
