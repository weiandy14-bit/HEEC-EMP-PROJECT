import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { ScheduleModule } from './schedule/schedule.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    HealthModule,
    ProjectsModule,
    TasksModule,
    ScheduleModule,
    ReviewsModule,
  ],
})
export class AppModule {}
