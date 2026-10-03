import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, IsDateString, Min } from 'class-validator';
import { ScheduleService } from './schedule.service';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

class RunScheduleDto {
  @IsOptional() @IsInt() @Min(0) expected_version?: number;
  @IsOptional() @IsDateString() status_date?: string;
}

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  /** 觸發重算（PM/Lead）。Idempotency-Key 冪等（§8）。 */
  @Post('projects/:p/schedule-runs')
  @Roles('PM', 'Lead', 'Admin')
  async run(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: RunScheduleDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.scheduleService.run(user, projectId, {
      expectedVersion: dto.expected_version,
      idempotencyKey: idempotencyKey,
      statusDate: dto.status_date,
    });
  }

  @Get('schedule-runs/:id')
  async getRun(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduleService.getRun(user, id);
  }
}
