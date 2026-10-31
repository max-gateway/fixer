import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { callerFrom, type PlatformRequest } from '../catalog-platform/catalog-platform.controller.js';
import { parse } from '../common/parse.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkforceService } from './workforce.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD');
const key = z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/, 'Função inválida');
const text = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

/** Contrato do workforce (`CreatePerson` etc.): o Fixer repete a forma, não as regras de CPF, que são do dono do dado. */
const ListQuery = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const CreatePerson = z
  .object({
    cpf: z.string().trim().min(11).max(14),
    name: z.string().trim().min(2).max(200),
    socialName: text(200),
    birthDate: isoDate.nullable().optional(),
    email: z.string().trim().email('E-mail inválido').max(254).nullable().optional(),
    phone: text(32),
  })
  .strict();

const UpdatePerson = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(2).max(200).optional(),
    socialName: text(200),
    birthDate: isoDate.nullable().optional(),
    email: z.string().trim().email('E-mail inválido').max(254).nullable().optional(),
    phone: text(32),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();

const CreateEngagement = z
  .object({
    kind: z.enum(['clt', 'pj', 'autonomo', 'socio', 'estagio', 'temporario']),
    unitId: z.string().uuid().nullable().optional(),
    admittedOn: isoDate,
    positionKey: key.optional(),
  })
  .strict();

const AssignPosition = z.object({ positionKey: key, validFrom: isoDate }).strict();
const Terminate = z.object({ terminatedOn: isoDate, reason: z.string().trim().min(3, 'Informe o motivo').max(500) }).strict();

/**
 * Equipe da oficina: BFF fino do serviço workforce da plataforma. As permissões do Fixer (`workforce.*`) decidem quem vê a tela; o workforce decide de novo
 * pelo papel de plataforma do token (RH, folha…), então as duas camadas precisam concordar para a operação passar.
 */
@Controller('workforce')
export class WorkforceController {
  constructor(
    private readonly workforce: WorkforceService,
    private readonly prisma: PrismaService,
  ) {}

  /** O que a pessoa pode fazer na tela (esconde botões; a API continua sendo quem recusa). */
  @Get('access')
  @RequirePermission('workforce.read')
  async access(@CurrentUser() user: AuthUser) {
    const manage = (await this.prisma.rolePermission.count({ where: { permission: { key: 'workforce.manage' }, role: { users: { some: { userId: user.id } } } } })) > 0;
    return { manage };
  }

  @Get('people')
  @RequirePermission('workforce.read')
  list(@Query() query: unknown, @Req() req: PlatformRequest) {
    return this.workforce.listPeople(callerFrom(req), parse(ListQuery, query));
  }

  @Get('people/:id')
  @RequirePermission('workforce.read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: PlatformRequest) {
    return this.workforce.getPerson(callerFrom(req), id);
  }

  @Post('people')
  @RequirePermission('workforce.manage')
  create(@Body() body: unknown, @Req() req: PlatformRequest) {
    return this.workforce.createPerson(callerFrom(req), parse(CreatePerson, body));
  }

  @Patch('people/:id')
  @RequirePermission('workforce.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: PlatformRequest) {
    return this.workforce.updatePerson(callerFrom(req), id, parse(UpdatePerson, body));
  }

  @Post('people/:id/engagements')
  @RequirePermission('workforce.manage')
  addEngagement(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: PlatformRequest) {
    return this.workforce.addEngagement(callerFrom(req), id, parse(CreateEngagement, body));
  }

  @Post('engagements/:id/positions')
  @RequirePermission('workforce.manage')
  assignPosition(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: PlatformRequest) {
    return this.workforce.assignPosition(callerFrom(req), id, parse(AssignPosition, body));
  }

  @Post('engagements/:id/terminate')
  @HttpCode(200)
  @RequirePermission('workforce.manage')
  terminate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: PlatformRequest) {
    return this.workforce.terminate(callerFrom(req), id, parse(Terminate, body));
  }

  @Get('units')
  @RequirePermission('workforce.read')
  units(@Req() req: PlatformRequest) {
    return this.workforce.units(callerFrom(req));
  }

  @Get('positions')
  @RequirePermission('workforce.read')
  positions(@Req() req: PlatformRequest) {
    return this.workforce.positions(callerFrom(req));
  }
}
