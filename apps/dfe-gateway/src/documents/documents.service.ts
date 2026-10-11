import { Injectable, NotFoundException } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { Database } from '../db/database.service.js';

export interface DocumentDto {
  nsu: string;
  schema: string;
  accessKey: string | null;
  xml: string;
  receivedAt: Date;
}

interface Row {
  nsu: string;
  schema: string;
  access_key: string | null;
  xml_gzip: Buffer;
  received_at: Date;
}

const toDto = (r: Row): DocumentDto => ({
  nsu: r.nsu,
  schema: r.schema,
  accessKey: r.access_key,
  xml: gunzipSync(r.xml_gzip).toString('utf8'),
  receivedAt: r.received_at,
});

export const MAX_PAGE = 200;

/** Leitura dos documentos por cursor de NSU: a fonte da verdade da entrega (spec §6.2 e §7.3). */
@Injectable()
export class DocumentsService {
  constructor(private readonly db: Database) {}

  /** Documentos com NSU > `afterNsu`, em ordem crescente. `nextCursor` é o maior NSU devolvido (ou null se acabou). */
  async list(companyId: string, afterNsu: bigint, limit: number) {
    const take = Math.min(Math.max(1, limit), MAX_PAGE);
    const { rows } = await this.db.query<Row>(
      `SELECT nsu::text, schema, access_key, xml_gzip, received_at FROM documents
        WHERE company_id = $1 AND nsu > $2 ORDER BY nsu LIMIT $3`,
      [companyId, afterNsu.toString(), take],
    );
    const items = rows.map(toDto);
    const state = await this.db.query<{ last_nsu: string }>('SELECT last_nsu::text FROM sync_state WHERE company_id = $1', [companyId]);
    return {
      items,
      nextCursor: items.length === take ? (items[items.length - 1]!.nsu) : null,
      /** Último NSU já consumido da SEFAZ para este CNPJ (o consumidor sabe se está em dia). */
      lastNsu: state.rows[0]?.last_nsu ?? '0',
    };
  }

  /** XML mais útil da chave: o `procNFe` completo, se já chegou; senão o mais recente (resumo/evento). */
  async byAccessKey(companyId: string, accessKey: string): Promise<DocumentDto> {
    const { rows } = await this.db.query<Row>(
      `SELECT nsu::text, schema, access_key, xml_gzip, received_at FROM documents
        WHERE company_id = $1 AND access_key = $2
        ORDER BY (schema LIKE 'procNFe%') DESC, nsu DESC LIMIT 1`,
      [companyId, accessKey],
    );
    if (!rows[0]) throw new NotFoundException('Documento não encontrado');
    return toDto(rows[0]);
  }
}
