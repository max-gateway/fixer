import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { AccessAudit } from './access-audit.service.js';
import { AuditQuerySchema, CreateRoleSchema, InviteSchema, SetRolesSchema, UpdateRoleSchema } from './access.schemas.js';
import { AccessService } from './access.service.js';

/**
 * Controle de acesso da oficina: pessoas (`:sub` = id da pessoa no diretório), papéis e trilha de auditoria.
 * Leitura com `access.read`, mudanças com `access.manage`; as regras de negócio ficam no domínio, não aqui.
 */
@Controller('access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly audit: AccessAudit,
  ) {}

  /** Sem permissão exigida: cada usuário pode saber o que ele mesmo pode fazer. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.access.me(user);
  }

  @Get('catalog')
  @RequirePermission('access.read')
  catalog() {
    return this.access.catalog();
  }

  @Get('roles')
  @RequirePermission('access.read')
  roles() {
    return this.access.roles();
  }

  @Post('roles')
  @RequirePermission('access.manage')
  createRole(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.access.createRole(parse(CreateRoleSchema, body), user);
  }

  @Patch('roles/:id')
  @RequirePermission('access.manage')
  updateRole(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.access.updateRole(id, parse(UpdateRoleSchema, body), user);
  }

  @Delete('roles/:id')
  @RequirePermission('access.manage')
  deleteRole(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.access.deleteRole(id, user);
  }

  @Get('members')
  @RequirePermission('access.read')
  members(@CurrentUser() user: AuthUser) {
    return this.access.members(user);
  }

  @Post('members')
  @RequirePermission('access.manage')
  invite(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.access.invite(parse(InviteSchema, body), user);
  }

  @Put('members/:sub/roles')
  @RequirePermission('access.manage')
  setRoles(@Param('sub') sub: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.access.setRoles(sub, parse(SetRolesSchema, body).roleIds, user);
  }

  @Post('members/:sub/deactivate')
  @HttpCode(200)
  @RequirePermission('access.manage')
  deactivate(@Param('sub') sub: string, @CurrentUser() user: AuthUser) {
    return this.access.setActive(sub, false, user);
  }

  @Post('members/:sub/reactivate')
  @HttpCode(200)
  @RequirePermission('access.manage')
  reactivate(@Param('sub') sub: string, @CurrentUser() user: AuthUser) {
    return this.access.setActive(sub, true, user);
  }

  @Post('members/:sub/setup-email')
  @HttpCode(200)
  @RequirePermission('access.manage')
  setupEmail(@Param('sub') sub: string, @CurrentUser() user: AuthUser) {
    return this.access.sendSetupEmail(sub, user);
  }

  @Delete('members/:sub')
  @RequirePermission('access.manage')
  remove(@Param('sub') sub: string, @CurrentUser() user: AuthUser) {
    return this.access.remove(sub, user);
  }

  @Get('audit')
  @RequirePermission('access.read')
  auditLog(@Query() query: unknown) {
    return this.audit.list(parse(AuditQuerySchema, query));
  }
}
