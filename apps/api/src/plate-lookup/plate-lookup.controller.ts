import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { InvalidPlateError, PlateLookupService } from './plate-lookup.service.js';

@Controller('vehicles/plate-lookup')
export class PlateLookupController {
  constructor(private readonly plateLookupService: PlateLookupService) {}

  @Get(':placa')
  async lookup(@Param('placa') placa: string) {
    try {
      return await this.plateLookupService.lookup(placa);
    } catch (err) {
      if (err instanceof InvalidPlateError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
