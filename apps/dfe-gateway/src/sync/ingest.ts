import { gzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { parseResNfe } from '../core/parser/summary.parser.js';
import type { DistDocument } from '../core/parser/dist-response.parser.js';
import { schemaKind } from '../core/parser/dist-response.parser.js';

export interface IngestCounters {
  stored: number;
  duplicate: number;
  invalid: number;
  manifestQueued: number;
}

const ACCESS_KEY = /<chNFe>([A-Z0-9]{43}[0-9])<\/chNFe>|Id="NFe([A-Z0-9]{43}[0-9])"/;

export function extractAccessKey(xml: string): string | null {
  const m = ACCESS_KEY.exec(xml);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

export interface IngestContext {
  companyId: string;
  cnpj: string;
  autoManifest: boolean;
}

/**
 * Grava o lote do jeito que a SEFAZ entregou (XML em gzip), sem interpretar regra de negócio: conciliação,
 * itens e estoque são dos sistemas clientes. Roda dentro da transação do chamador, que também avança o NSU.
 *
 * Um documento ruim nunca derruba o lote (uma exceção aqui abortaria a transação inteira do Postgres e o
 * lote seria reprocessado para sempre): vira contador `invalid`.
 */
export async function ingestBatch(c: PoolClient, documents: DistDocument[], ctx: IngestContext): Promise<IngestCounters & { maxStoredNsu: bigint | null; minStoredNsu: bigint | null }> {
  const counters: IngestCounters = { stored: 0, duplicate: 0, invalid: 0, manifestQueued: 0 };
  let max: bigint | null = null;
  let min: bigint | null = null;

  for (const doc of documents) {
    if (doc.error || doc.nsu === null || doc.xml === '') {
      counters.invalid++;
      continue;
    }
    const accessKey = extractAccessKey(doc.xml);
    const res = await c.query(
      `INSERT INTO documents (company_id, nsu, schema, access_key, xml_gzip) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (company_id, nsu) DO NOTHING`,
      [ctx.companyId, doc.nsu.toString(), doc.schema, accessKey, gzipSync(Buffer.from(doc.xml, 'utf8'))],
    );
    if (res.rowCount === 0) {
      counters.duplicate++;
      continue;
    }
    counters.stored++;
    if (max === null || doc.nsu > max) max = doc.nsu;
    if (min === null || doc.nsu < min) min = doc.nsu;

    if (ctx.autoManifest && schemaKind(doc.schema) === 'resNFe' && (await queueManifestation(c, doc.xml, ctx))) counters.manifestQueued++;
  }
  return { ...counters, maxStoredNsu: max, minStoredNsu: min };
}

/** Ciência só para nota autorizada que outro emitiu contra nós (não nossa própria saída, nem cancelada/denegada). */
async function queueManifestation(c: PoolClient, xml: string, ctx: IngestContext): Promise<boolean> {
  try {
    const res = parseResNfe(xml);
    if (res.situation !== 1 || res.issuerId === ctx.cnpj) return false;
    const r = await c.query('INSERT INTO manifestations (company_id, access_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ctx.companyId, res.accessKey]);
    return r.rowCount === 1;
  } catch {
    return false;
  }
}
