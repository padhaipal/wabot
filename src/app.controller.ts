import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  /* c8 ignore next -- TS emitDecoratorMetadata generates a defensive typeof-guard ternary that is not meaningfully reachable in tests */
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
