import { z } from 'zod';
import { parseCatalogList } from '../catalog-platform/catalogs.js';

// Validado na subida (fail fast): é melhor a API recusar iniciar com uma lista
// clara do que falta do que quebrar na primeira requisição.
const schema = z.object({
  DATABASE_URL: z.string().url(),
  /** Papel que ignora RLS (BYPASSRLS), só para jobs de sistema. Ausente = usa DATABASE_URL (instalação legada). */
  SYSTEM_DATABASE_URL: z.string().url().optional(),
  KEYCLOAK_AUTH_SERVER_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  /** Audiência (`aud`) desta API: o token precisa trazê-la. Sem isso, token de outro client do realm passaria. */
  AUTH_AUDIENCE: z.string().min(1),
  /** Catálogos globais da plataforma (parts-search) que as oficinas leem, separados por vírgula. */
  PARTS_SEARCH_CATALOGS: z
    .string()
    .optional()
    .transform((raw) => parseCatalogList(raw)),
  PLATE_LOOKUP_SERVICE_URL: z.string().url().default('http://localhost:8081'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export function validateEnv(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida (veja apps/api/.env.example):\n${problems}`);
  }
  return parsed.data;
}
