import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { ScheduleModule } from './schedule/schedule.module';
import { ReviewsModule } from './reviews/reviews.module';
import { DeliverablesModule } from './deliverables/deliverables.module';
import { MeetingsModule } from './meetings/meetings.module';
import { WeeklyModule } from './weekly/weekly.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    HealthModule,
    ProjectsModule,
    TasksModule,
    ScheduleModule,
    ReviewsModule,
    DeliverablesModule,
    MeetingsModule,
    WeeklyModule,
  ],
})
export class AppModule {}
