import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { DomainError } from '../common/errors';

@Controller({ path: 'projects', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(
    @CurrentUser() user: UserContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const rows = await this.projects.list(user, limit ? Number(limit) : 50, cursor);
    return { data: rows, next_cursor: rows.length ? rows[rows.length - 1].id : null };
  }

  @Get(':id')
  async get(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(user, id);
  }

  @Post()
  @Roles('PM', 'Admin')
  async create(
    @CurrentUser() user: UserContext,
    @Body() dto: CreateProjectDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.projects.create(user, dto);
    res.setHeader('ETag', String(row.version));
    return row;
  }

  @Patch(':id')
  @Roles('PM', 'Admin')
  async update(
    @CurrentUser() user: UserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const version = parseIfMatch(ifMatch);
    const row = await this.projects.update(user, id, dto, version);
    res.setHeader('ETag', String(row.version));
    return row;
  }
}

/** 解析 If-Match 版本；缺少或非法 → 428/400。 */
function parseIfMatch(ifMatch: string | undefined): number {
  if (!ifMatch) {
    throw new DomainError('conflict', 'if_match_required', '更新須提供 If-Match 版本', undefined, 428 as any);
  }
  const n = Number(ifMatch.replace(/"/g, '').trim());
  if (!Number.isInteger(n) || n < 0) {
    throw DomainError.validation('If-Match 版本格式錯誤');
  }
  return n;
}
