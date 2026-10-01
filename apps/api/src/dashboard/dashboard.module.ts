import { Module } from '@nestjs/common';
import { DashboardController, ProjectDashboardController } from './dashboard.controller';
import { GanttService } from './gantt.service';

@Module({
  controllers: [DashboardController, ProjectDashboardController],
  providers: [GanttService],
  exports: [GanttService],
})
export class DashboardModule {}
