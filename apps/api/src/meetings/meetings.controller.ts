import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto, UpdateMeetingDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller({ path: 'projects/:p/meetings', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  async list(@CurrentUser() user: UserContext, @Param('p', ParseUUIDPipe) projectId: string) {
    return { data: await this.meetings.list(user, projectId) };
  }

  @Post()
  @Roles('PM', 'Lead', 'Admin')
  async create(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateMeetingDto,
  ) {
    return this.meetings.create(user, projectId, dto);
  }

  @Patch(':m')
  @Roles('PM', 'Lead', 'Admin')
  async update(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('m', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.meetings.update(user, projectId, id, dto);
  }
}
