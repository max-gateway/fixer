import { Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { Prisma, PrismaClient } from '@fixer/db';
import { TenantContext } from '../tenancy/tenant-context.js';

/**
 * Tabelas sem `orgId`: referência compartilhada entre todas as organizações (sem RLS). Qualquer outra tabela é de
 * oficina e só pode ser tocada dentro de uma organização. Mantido em sincronia com `packages/db/prisma/schema.prisma`.
 */
const SHARED_MODELS = new Set<string>([
  'Permission',
  'PlateLookup',
  'VehicleComponent',
  'ServiceFiscalProfile',
  'ServiceDefinition',
  'ServiceSuggestedPart',
  'VehicleVariant',
  'CatalogState',
]);

const SET_ORG = (orgId: string) => Prisma.sql`SELECT set_config('app.org_id', ${orgId}, true)`;

type RawFn = (...args: unknown[]) => Promise<unknown>;
const RAW_METHODS = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'] as const;

/**
 * Cliente Prisma da API, sujeito a Row Level Security. Cada operação (ou transação) roda com `app.org_id` da
 * organização atual (TenantContext) gravado com `set_config(..., true)`, que vale só até o fim da transação:
 * a conexão volta ao pool sem organização, então nada vaza para a próxima requisição.
 *
 * - operação simples em tabela de oficina: vira uma mini-transação [set_config, operação];
 * - `$transaction(async tx => ...)`: grava a organização no início e entrega o `tx` cru (as operações dentro dele já
 *   estão na mesma transação, então enxergam a organização);
 * - `$queryRaw` e similares: idem, numa transação própria;
 * - sem organização no contexto, tabela de oficina lança `TenantContextMissing` (falha alto, nunca "zero linhas").
 *
 * Para varrer várias organizações (relay da outbox, agendadores) use o SystemPrismaService.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor() {
    super();
    // eslint-disable-next-line no-constructor-return
    return tenantScoped(this) as this;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

export function tenantScoped(raw: PrismaClient): PrismaClient {
  const scoped = raw.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          if (SHARED_MODELS.has(model)) return query(args);
          const orgId = TenantContext.require();
          const [, result] = await raw.$transaction([raw.$executeRaw(SET_ORG(orgId)), query(args)]);
          return result;
        },
      },
    },
  });

  // Transação sem organização no contexto é permitida (ex.: bootstrap do catálogo, que só mexe em tabelas
  // compartilhadas). Se ela tocar uma tabela de oficina a RLS responde com zero linhas / recusa a escrita: falha fechada.
  const interactive = async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) => {
    const orgId = TenantContext.current();
    return raw.$transaction(async (tx) => {
      if (orgId) await tx.$executeRaw(SET_ORG(orgId));
      return fn(tx);
    }, options as never);
  };

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === '$transaction') {
        return (arg: unknown, options?: unknown) => {
          if (typeof arg === 'function') return interactive(arg as never, options);
          // Forma em lote ([op1, op2]): as operações já foram criadas pelo cliente com escopo, cada uma com a sua
          // transação. Para manter a atomicidade, o chamador deve usar a forma interativa.
          throw new Error('$transaction([...]) não é suportado no PrismaService com escopo de organização: use $transaction(async (tx) => ...)');
        };
      }
      if (typeof prop === 'string' && (RAW_METHODS as readonly string[]).includes(prop)) {
        return (...args: unknown[]) => interactive(async (tx) => (tx as unknown as Record<string, RawFn>)[prop]!(...args));
      }
      if (typeof prop === 'string' && !prop.startsWith('$') && !prop.startsWith('_') && prop in scoped) {
        return (scoped as unknown as Record<string, unknown>)[prop];
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}
