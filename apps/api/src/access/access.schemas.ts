import { z } from 'zod';

const id = z.string().trim().min(1).max(64);
const permissions = z.array(z.string().trim().min(1).max(64)).max(200);

export const InviteSchema = z.object({
  email: z.string({ required_error: 'Informe o e-mail' }).trim().toLowerCase().email('E-mail inválido').max(254),
  name: z.string().trim().max(120).optional(),
  roleIds: z.array(id).min(1, 'Escolha ao menos um papel').max(20),
});
export type InviteInput = z.infer<typeof InviteSchema>;

export const SetRolesSchema = z.object({ roleIds: z.array(id).max(20) });

export const CreateRoleSchema = z.object({
  name: z.string({ required_error: 'Informe o nome do papel' }).max(80),
  description: z.string().trim().max(280).optional().nullable(),
  permissions,
});
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z
  .object({
    name: z.string().max(80).optional(),
    description: z.string().trim().max(280).optional().nullable(),
    permissions: permissions.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.permissions !== undefined, 'Nada para alterar');
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;

export const AuditQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(64).optional(),
  targetId: z.string().max(64).optional(),
});
