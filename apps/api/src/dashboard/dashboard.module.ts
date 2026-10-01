import { Module } from '@nestjs/common';
import { DashboardController, ProjectDashboardController } from './dashboard.controller';
import { GanttService } from './gantt.service';
import { WorkloadService } from './workload.service';
import { WeeklyBoardService } from './weekly.service';

@Module({
  controllers: [DashboardController, ProjectDashboardController],
  providers: [GanttService, WorkloadService, WeeklyBoardService],
  exports: [GanttService, WorkloadService, WeeklyBoardService],
})
export class DashboardModule {}
