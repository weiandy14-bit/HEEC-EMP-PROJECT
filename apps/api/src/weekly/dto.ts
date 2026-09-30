import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export const WEEKLY_STATUS = ['open', 'in_progress', 'done', 'carried'] as const;
export type WeeklyStatus = (typeof WEEKLY_STATUS)[number];

export class CreateWeeklyItemDto {
  @IsString() @Length(1, 200) title!: string;
  @IsString() @Length(1, 200) source_key!: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsDateString() due_at?: string;
  @IsOptional() @IsDateString() period_start?: string;
  @IsOptional() @IsDateString() period_end?: string;
  @IsOptional() @IsUUID() task_id?: string;
  @IsOptional() @IsUUID() owner_id?: string;
}

export class UpdateWeeklyItemDto {
  @IsOptional() @IsIn(WEEKLY_STATUS) status?: WeeklyStatus;
  @IsOptional() @IsDateString() due_at?: string;
  @IsOptional() @IsDateString() period_start?: string;
  @IsOptional() @IsDateString() period_end?: string;
}
