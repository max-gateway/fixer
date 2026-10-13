import { AsyncLocalStorage } from 'node:async_hooks';

interface Store {
  orgId: string;
}

const als = new AsyncLocalStorage<Store>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Só testes: organização assumida quando não há `run` (ligada pelo setup do vitest; nunca em produção). */
let testFallback: string | undefined;

const isThenable = (v: unknown): v is PromiseLike<unknown> => typeof (v as { then?: unknown } | null)?.then === 'function';

export class TenantContextMissing extends Error {
  constructor() {
    super('Operação sem organização no contexto (TenantContext.run ausente): recusada para não vazar dados entre organizações');
  }
}

/**
 * Organização da operação em andamento (requisição HTTP, evento consumido, rodada de um job).
 * Tudo que toca tabelas de oficina precisa rodar dentro de `TenantContext.run`; o PrismaService lê daqui
 * para gravar `app.org_id` na transação, que é o que as políticas de RLS do Postgres usam.
 */
export const TenantContext = {
  run<T>(orgId: string, fn: () => T): T {
    if (!UUID.test(orgId)) throw new Error(`orgId inválido: "${orgId}"`);
    return als.run({ orgId: orgId.toLowerCase() }, () => {
      const result = fn();
      // As promessas do Prisma são PREGUIÇOSAS: só executam quando alguém dá `then`. Se `fn` devolvesse uma delas sem
      // executar, ela rodaria depois, FORA deste escopo, sem organização. `Promise.resolve` chama o `then` aqui dentro.
      return (isThenable(result) ? Promise.resolve(result) : result) as T;
    });
  },

  /** `undefined` fora de uma organização. */
  current(): string | undefined {
    return als.getStore()?.orgId ?? testFallback;
  },

  require(): string {
    const id = als.getStore()?.orgId ?? testFallback;
    if (!id) throw new TenantContextMissing();
    return id;
  },

  /**
   * SOMENTE TESTES. Liga (ou desliga, com `undefined`) uma organização padrão para testes unitários que chamam serviços
   * sem passar pelo middleware. Os testes de isolamento a desligam para provar que sem organização nada funciona.
   */
  useFallbackForTests(orgId: string | undefined): void {
    testFallback = orgId;
  },

  isUuid: (s: string) => UUID.test(s),
};
