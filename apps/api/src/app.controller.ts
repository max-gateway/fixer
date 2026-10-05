import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/auth.decorators.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Probes do Kubernetes (readiness/liveness no chart) — não podem exigir token.
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
