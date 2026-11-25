import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION = 'requiredPermission';

/**
 * Exige que o usuário tenha a permissão (`Permission.key`) por algum de seus papéis. Opt-in por rota;
 * o `PermissionGuard` falha fechado: sem papel com a permissão, 403.
 */
export const RequirePermission = (key: string) => SetMetadata(REQUIRED_PERMISSION, key);
