import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { DependenciesService } from './dependencies.service';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

class CreateDepDto {
  @IsUUID() predecessor_task_id!: string;
  @IsUUID() successor_task_id!: string;
  @IsOptional() @IsIn(['FS', 'SS', 'FF', 'SF']) relation?: string;
  @IsOptional() @IsInt() lag_minutes?: number;
  @IsOptional() @IsString() note?: string;
}

@Controller({ path: 'projects/:p/dependencies', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DependenciesController {
  constructor(private readonly deps: DependenciesService) {}

  @Post()
  @Roles('PM', 'Lead', 'Admin')
  async create(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateDepDto,
  ) {
    return this.deps.create(user, projectId, dto);
  }

  @Delete(':id')
  @Roles('PM', 'Lead', 'Admin')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.deps.remove(user, projectId, id);
  }
}
