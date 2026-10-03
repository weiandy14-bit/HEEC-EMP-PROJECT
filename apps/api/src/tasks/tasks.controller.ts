import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { TasksService } from './tasks.service';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

class CreateTaskDto {
  @IsString() @Length(1, 40) wbs_code!: string;
  @IsString() @Length(1, 300) name!: string;
  @IsOptional() @IsIn(['task', 'milestone', 'summary', 'anchor']) type?: string;
  @IsOptional() @IsUUID() discipline_id?: string;
  @IsOptional() @IsInt() @Min(0) duration_minutes?: number;
  @IsOptional() @IsUUID() parent_task_id?: string;
  @IsOptional() @IsUUID() calendar_id?: string;
  @IsOptional() @IsIn(['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'])
  constraint_type?: string;
  @IsOptional() @IsString() constraint_date?: string;
  @IsOptional() @IsBoolean() milestone?: boolean;
  @IsOptional() @IsUUID() owner_user_id?: string;
}

@Controller({ path: 'projects/:p/tasks', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  async list(@CurrentUser() user: UserContext, @Param('p', ParseUUIDPipe) projectId: string) {
    return { data: await this.tasks.list(user, projectId) };
  }

  @Post()
  @Roles('PM', 'Lead', 'Admin')
  async create(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(user, projectId, dto);
  }
}
