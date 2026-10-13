import { TenantContext } from '../src/tenancy/tenant-context.js';

/** Organização padrão dos testes que não se importam com tenancy (os de isolamento usam `TenantContext.run`). */
export const TEST_ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

TenantContext.useFallbackForTests(TEST_ORG);
