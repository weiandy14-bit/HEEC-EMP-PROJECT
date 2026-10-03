import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async health() {
    const dbOk = await this.db.healthy();
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'up' : 'down',
      time: new Date().toISOString(),
    };
  }
}
