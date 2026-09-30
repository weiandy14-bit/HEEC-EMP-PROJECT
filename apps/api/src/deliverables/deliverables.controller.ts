import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { DeliverablesService } from './deliverables.service';
import { CreateDeliverableDto, UpdateDeliverableDto, ReviseDeliverableDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller({ path: 'projects/:p/deliverables', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DeliverablesController {
  constructor(private readonly deliverables: DeliverablesService) {}

  @Get()
  async list(@CurrentUser() user: UserContext, @Param('p', ParseUUIDPipe) projectId: string) {
    return { data: await this.deliverables.list(user, projectId) };
  }

  @Post()
  @Roles('PM', 'Lead', 'Admin')
  async create(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateDeliverableDto,
  ) {
    return this.deliverables.create(user, projectId, dto);
  }

  @Patch(':d')
  @Roles('PM', 'Lead', 'Admin')
  async update(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('d', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliverableDto,
  ) {
    return this.deliverables.update(user, projectId, id, dto);
  }

  @Post(':d/revise')
  @Roles('PM', 'Lead', 'Admin')
  async revise(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('d', ParseUUIDPipe) id: string,
    @Body() dto: ReviseDeliverableDto,
  ) {
    return this.deliverables.revise(user, projectId, id, dto);
  }

  @Delete(':d')
  @Roles('PM', 'Lead', 'Admin')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('d', ParseUUIDPipe) id: string,
  ) {
    await this.deliverables.archive(user, projectId, id);
  }
}
