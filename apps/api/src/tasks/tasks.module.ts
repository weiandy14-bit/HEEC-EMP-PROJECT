import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { DependenciesController } from './dependencies.controller';
import { DependenciesService } from './dependencies.service';

@Module({
  controllers: [TasksController, DependenciesController],
  providers: [TasksService, DependenciesService],
})
export class TasksModule {}
