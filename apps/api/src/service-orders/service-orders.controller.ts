import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { parse } from '../common/parse.js';
import {
  ChecklistItemSchema,
  CreateServiceOrderSchema,
  MessageSchema,
  ServiceOrderStatusSchema,
  TransitionSchema,
} from './schema.js';
import { ServiceOrdersService } from './service-orders.service.js';

@Controller('service-orders')
export class ServiceOrdersController {
  constructor(private readonly orders: ServiceOrdersService) {}

  @Get()
  list(@Query('status') status?: string, @Query('search') search?: string) {
    return this.orders.list({
      status: status ? parse(ServiceOrderStatusSchema, status) : undefined,
      search,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.orders.create(parse(CreateServiceOrderSchema, body), user);
  }

  @Post(':id/status')
  transition(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.orders.transition(id, parse(TransitionSchema, body), user);
  }

  @Post(':id/messages')
  message(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.orders.addMessage(id, parse(MessageSchema, body), user);
  }

  @Post(':id/checklist')
  addChecklistItem(@Param('id') id: string, @Body() body: unknown) {
    return this.orders.addChecklistItem(id, parse(ChecklistItemSchema, body));
  }
}
