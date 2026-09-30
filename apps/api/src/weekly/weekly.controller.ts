import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { WeeklyService } from './weekly.service';
import { CreateWeeklyItemDto, UpdateWeeklyItemDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller({ path: 'projects/:p/weekly-items', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class WeeklyController {
  constructor(private readonly weekly: WeeklyService) {}

  @Get()
  async list(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Query('week') week?: string,
  ) {
    return { data: await this.weekly.listForWeek(user, projectId, week) };
  }

  @Post()
  @Roles('PM', 'Lead', 'Admin')
  async create(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateWeeklyItemDto,
  ) {
    return this.weekly.create(user, projectId, dto);
  }

  @Patch(':w')
  @Roles('PM', 'Lead', 'Engineer', 'Admin')
  async update(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('w', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWeeklyItemDto,
  ) {
    return this.weekly.update(user, projectId, id, dto);
  }
}
