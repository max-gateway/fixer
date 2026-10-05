import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { parse } from '../common/parse.js';
import { PortalService } from './portal.service.js';
import { MessageSchema } from '../service-orders/schema.js';
import { ChecklistAnswerSchema, CustomerDataSchema, DocumentSchema, ProblemReportSchema } from './schema.js';

/** Rotas públicas do portal do cliente: a credencial é o token na URL. */
@Public()
@Controller('portal/:token')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  view(@Param('token') token: string) {
    return this.portal.view(token);
  }

  @Post('messages')
  message(@Param('token') token: string, @Body() body: unknown) {
    return this.portal.sendMessage(token, parse(MessageSchema, body));
  }

  @Post('problem')
  problem(@Param('token') token: string, @Body() body: unknown) {
    return this.portal.reportProblem(token, parse(ProblemReportSchema, body));
  }

  @Patch('checklist/:itemId')
  checklist(@Param('token') token: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    return this.portal.answerChecklist(token, itemId, parse(ChecklistAnswerSchema, body));
  }

  @Get('customer-lookup')
  lookup(@Param('token') token: string, @Query('document') document: string) {
    return this.portal.lookupCustomer(token, parse(DocumentSchema, document ?? ''));
  }

  @Put('customer')
  customer(@Param('token') token: string, @Body() body: unknown) {
    return this.portal.updateCustomer(token, parse(CustomerDataSchema, body));
  }
}
