import { ensureRoles } from './db.js';

/** Prepara os papéis de banco uma única vez antes dos testes de integração (só quando há banco de teste configurado). */
export default async function setup(): Promise<void> {
  const url = process.env.FISCAL_TEST_DATABASE_URL;
  if (url) await ensureRoles(url);
}
