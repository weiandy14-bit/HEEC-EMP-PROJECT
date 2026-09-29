import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { ScheduleModule } from './schedule/schedule.module';

@Module({
  imports: [DatabaseModule, HealthModule, ProjectsModule, TasksModule, ScheduleModule],
})
export class AppModule {}
