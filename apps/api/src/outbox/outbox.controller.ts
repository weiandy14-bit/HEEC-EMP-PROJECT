import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { ProcessOutboxDto, EnqueueTestDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

/** 內部維運端點：手動觸發 worker 派工／入列測試事件（Admin）。 */
@Controller({ path: 'internal/outbox', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class OutboxController {
  constructor(private readonly outbox: OutboxService) {}

  @Post('process')
  @Roles('Admin')
  async process(@Body() dto: ProcessOutboxDto) {
    return this.outbox.process(dto.limit ?? 20);
  }

  @Post('enqueue-test')
  @Roles('Admin')
  async enqueueTest(@CurrentUser() user: UserContext, @Body() dto: EnqueueTestDto) {
    return this.outbox.enqueueTest(user, dto.fail ?? false);
  }
}
