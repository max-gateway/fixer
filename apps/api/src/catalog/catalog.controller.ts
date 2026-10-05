import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { parse } from '../common/parse.js';
import { CatalogService, CreatePartSchema, CreateServiceSchema, PurchaseSchema } from './catalog.service.js';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('parts')
  listParts(@Query('search') search?: string) {
    return this.catalog.listParts(search);
  }

  @Post('parts')
  createPart(@Body() body: unknown) {
    return this.catalog.createPart(parse(CreatePartSchema, body));
  }

  @Post('parts/:id/purchases')
  purchase(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.catalog.purchase(id, parse(PurchaseSchema, body), user);
  }

  @Get('services')
  listServices() {
    return this.catalog.listServices();
  }

  @Post('services')
  createService(@Body() body: unknown) {
    return this.catalog.createService(parse(CreateServiceSchema, body));
  }
}
