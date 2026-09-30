import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto, UpdateReviewDto } from './dto';
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
  @Roles('PM', 'Lead', 'Admin')
  async update(
    @CurrentUser() user: UserContext,
    @Param('p', ParseUUIDPipe) projectId: string,
    @Param('r', ParseUUIDPipe) reviewId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviews.update(user, projectId, reviewId, dto);
  }
}
