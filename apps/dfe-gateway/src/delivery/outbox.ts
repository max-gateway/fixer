import type { PoolClient } from 'pg';

/**
 * Registra o aviso de "há documentos novos até este NSU" para cada assinante com transporte ativo.
 * No máximo UMA entrega pendente por assinatura: documentos novos só ampliam `to_nsu` (coalescência),
 * então um consumidor lento não acumula milhares de avisos. PULL não gera entrega: o consumidor consulta o cursor.
 */
export async function enqueueDeliveries(c: PoolClient, companyId: string, fromNsu: bigint, toNsu: bigint): Promise<void> {
  await c.query(
    `INSERT INTO deliveries (subscription_id, from_nsu, to_nsu)
     SELECT id, $2, $3 FROM subscriptions
      WHERE company_id = $1 AND transport <> 'PULL' AND status = 'ACTIVE'
     ON CONFLICT (subscription_id) WHERE state = 'PENDING'
     DO UPDATE SET to_nsu = GREATEST(deliveries.to_nsu, EXCLUDED.to_nsu), from_nsu = LEAST(deliveries.from_nsu, EXCLUDED.from_nsu)`,
    [companyId, fromNsu.toString(), toNsu.toString()],
  );
}
