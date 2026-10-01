import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { GanttService } from './gantt.service';
import { GanttQueryDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { RolesGuard } from '../auth/roles.guard';

/** 頁 A 多案總控甘特（唯讀；任一 org 角色可讀，含 Viewer）。 */
@Controller({ path: 'dashboard', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly gantt: GanttService) {}

  @Get('gantt')
  async portfolioGantt(@CurrentUser() user: UserContext, @Query() q: GanttQueryDto) {
    return this.gantt.portfolio(user, q);
  }
}

/** 單案甘特 drill-down（跨案/跨 org → 404）。 */
@Controller({ path: 'projects/:p/dashboard', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class ProjectDashboardController {
  constructor(private readonly gantt: GanttService) {}

  @Get('gantt')
  async projectGantt(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
  ) {
    return this.gantt.projectGantt(user, projectId);
  }
}
