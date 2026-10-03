import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { EvaluateAlertDto, AckAlertDto, SnoozeAlertDto, CloseAlertDto, AssignAlertDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller({ path: 'projects/:p/alerts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  async list(@CurrentUser() user: UserContext, @Param('p', ParseUUIDPipe) projectId: string) {
    return { data: await this.alerts.list(user, projectId) };
  }

  @Post('evaluate')
  @Roles('PM', 'Lead', 'Admin')
  async evaluate(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: EvaluateAlertDto,
  ) {
    return this.alerts.evaluate(user, projectId, dto);
  }

  @Post(':a/ack')
  @Roles('PM', 'Lead', 'Admin')
  async ack(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('a', ParseUUIDPipe) alertId: string,
    @Body() dto: AckAlertDto,
  ) {
    return this.alerts.ack(user, projectId, alertId, dto.reason);
  }

  @Post(':a/snooze')
  @Roles('PM', 'Lead', 'Admin')
  async snooze(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('a', ParseUUIDPipe) alertId: string,
    @Body() dto: SnoozeAlertDto,
  ) {
    return this.alerts.snooze(user, projectId, alertId, dto.reason, dto.snooze_until);
  }

  @Post(':a/close')
  @Roles('PM', 'Lead', 'Admin')
  async close(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('a', ParseUUIDPipe) alertId: string,
    @Body() dto: CloseAlertDto,
  ) {
    return this.alerts.close(user, projectId, alertId, dto.reason);
  }

  @Post(':a/assign')
  @Roles('PM', 'Lead', 'Admin')
  async assign(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('a', ParseUUIDPipe) alertId: string,
    @Body() dto: AssignAlertDto,
  ) {
    return this.alerts.assign(user, projectId, alertId, dto.assignee_id);
  }
}
