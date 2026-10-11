import { PrismaClient } from '@fixer/db';

/** Chave do advisory lock que serializa os arquivos de integração fiscal (eles compartilham tabelas singleton). */
const LOCK_KEY = 7_201_900;

/**
 * O vitest roda arquivos de teste em paralelo, mas os testes de integração fiscal usam as mesmas linhas
 * singleton (credencial, estado de sync) e limpam o banco entre os casos: dois arquivos ao mesmo tempo se
 * atropelam. Um advisory lock de sessão, numa conexão dedicada, faz um arquivo esperar o outro terminar.
 */
export async function acquireDbLock(url: string): Promise<() => Promise<void>> {
  const sep = url.includes('?') ? '&' : '?';
  const holder = new PrismaClient({ datasourceUrl: `${url}${sep}connection_limit=1` });
  await holder.$executeRaw`SELECT pg_advisory_lock(${LOCK_KEY})`;
  return async () => {
    await holder.$executeRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    await holder.$disconnect();
  };
}
