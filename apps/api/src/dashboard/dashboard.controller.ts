import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { GanttService } from './gantt.service';
import { WorkloadService } from './workload.service';
import { GanttQueryDto, WorkloadQueryDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { RolesGuard } from '../auth/roles.guard';

/** 頁 A 多案總控甘特、頁 C 工程師負荷（唯讀；任一 org 角色可讀，含 Viewer）。 */
@Controller({ path: 'dashboard', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DashboardController {
  constructor(
    private readonly gantt: GanttService,
    private readonly workload: WorkloadService,
  ) {}

  @Get('gantt')
  async portfolioGantt(@CurrentUser() user: UserContext, @Query() q: GanttQueryDto) {
    return this.gantt.portfolio(user, q);
  }

  @Get('workload')
  async workloadMatrix(@CurrentUser() user: UserContext, @Query() q: WorkloadQueryDto) {
    return this.workload.matrix(user, q);
  }

  @Get('workload/resources/:r')
  async workloadResource(
    @CurrentUser() user: UserContext,
    @Param('r', ParseUUIDPipe) resourceId: string,
    @Query() q: WorkloadQueryDto,
  ) {
    return this.workload.resourceDetail(user, resourceId, q);
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
