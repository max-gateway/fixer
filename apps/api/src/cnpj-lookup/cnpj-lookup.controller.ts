import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { CnpjLookupService, InvalidCnpjError } from './cnpj-lookup.service.js';

@Controller('customers/cnpj-lookup')
export class CnpjLookupController {
  constructor(private readonly cnpjLookup: CnpjLookupService) {}

  @Get(':cnpj')
  async lookup(@Param('cnpj') cnpj: string) {
    try {
      return await this.cnpjLookup.lookup(cnpj);
    } catch (err) {
      if (err instanceof InvalidCnpjError) throw new BadRequestException('CNPJ inválido.');
      throw err;
    }
  }
}
