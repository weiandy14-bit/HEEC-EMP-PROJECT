import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto, UpdateReviewDto, CreateReviewStepDto, UpdateReviewStepDto } from './dto';
import { AuthGuard, CurrentUser, type UserContext } from '../auth/request-context';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller({ path: 'projects/:p/reviews', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  async list(@CurrentUser() user: UserContext, @Param('p', ParseUUIDPipe) projectId: string) {
    return { data: await this.reviews.list(user, projectId) };
  }

  @Post()
  @Roles('PM', 'Lead', 'Admin')
  async create(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(user, projectId, dto);
  }

  @Patch(':r')
  @Roles('PM', 'Lead', 'QA', 'Admin') // QA/Lead 可核准（§8 審核 A）
  async update(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('r', ParseUUIDPipe) reviewId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviews.update(user, projectId, reviewId, dto);
  }

  // 審查步驟（送審/補正多輪，P3-02）
  @Get(':r/steps')
  async listSteps(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('r', ParseUUIDPipe) reviewId: string,
  ) {
    return { data: await this.reviews.listSteps(user, projectId, reviewId) };
  }

  @Post(':r/steps')
  @Roles('PM', 'Lead', 'Admin')
  async createStep(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('r', ParseUUIDPipe) reviewId: string,
    @Body() dto: CreateReviewStepDto,
  ) {
    return this.reviews.createStep(user, projectId, reviewId, dto);
  }

  @Patch(':r/steps/:s')
  @Roles('PM', 'Lead', 'Admin')
  async updateStep(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('r', ParseUUIDPipe) reviewId: string,
    @Param('s', ParseUUIDPipe) stepId: string,
    @Body() dto: UpdateReviewStepDto,
  ) {
    return this.reviews.updateStep(user, projectId, reviewId, stepId, dto);
  }
}
