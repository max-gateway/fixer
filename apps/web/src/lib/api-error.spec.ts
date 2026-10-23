import { describe, expect, it, vi } from 'vitest';

// api.ts busca o token pelo next-auth, que não carrega fora do Next; aqui só interessa a classe de erro.
vi.mock('@/auth', () => ({ getAccessToken: vi.fn() }));
vi.mock('./org-server', () => ({ orgHeader: vi.fn() }));

const { ApiError } = await import('./api');

describe('ApiError.permissionDenied', () => {
  it('só é falta de permissão quando o 403 vem do PermissionGuard (ou sem corpo)', () => {
    expect(new ApiError(403, '/x', 'Sem permissão: access.read').permissionDenied).toBe(true);
    expect(new ApiError(403, '/x').permissionDenied).toBe(true);
    expect(new ApiError(403, '/x', 'Token sem organização (o login deve pedir o escopo organization:*)').permissionDenied).toBe(false);
    expect(new ApiError(401, '/x', 'Sem permissão').permissionDenied).toBe(false);
  });
});
