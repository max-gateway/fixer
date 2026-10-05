import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { parse } from '../common/parse.js';
import { CustomersService } from './customers.service.js';
import { CreateCustomerSchema, UpdateCustomerSchema } from './schema.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query('search') search?: string) {
    return this.customers.list(search);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.customers.create(parse(CreateCustomerSchema, body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(id, parse(UpdateCustomerSchema, body));
  }
}
