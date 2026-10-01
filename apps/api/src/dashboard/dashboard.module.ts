import { Module } from '@nestjs/common';
import { DashboardController, ProjectDashboardController } from './dashboard.controller';
import { GanttService } from './gantt.service';
import { WorkloadService } from './workload.service';

@Module({
  controllers: [DashboardController, ProjectDashboardController],
  providers: [GanttService, WorkloadService],
  exports: [GanttService, WorkloadService],
})
export class DashboardModule {}
