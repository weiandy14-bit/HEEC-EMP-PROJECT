import { IsIn, IsOptional, IsString, IsUUID, IsDateString, IsInt, Min, Max, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class GanttQueryDto {
  @IsOptional() @IsIn(['day', 'week', 'month']) zoom?: 'day' | 'week' | 'month';
  // 進行中預設；接受 in_progress 別名（對應 projects.status='active'）
  @IsOptional() @IsIn(['in_progress', 'active', 'planning', 'on_hold', 'completed', 'cancelled'])
  status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() discipline?: string;
  @IsOptional() @IsUUID() pm_id?: string;
  @IsOptional() @IsUUID() resource_id?: string;
  @IsOptional() @IsUUID() project_id?: string;
  @IsOptional() @IsString() cursor?: string; // base64url(code)，游標分頁
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

export class WorkloadQueryDto {
  @IsOptional() @Matches(/^\d{4}-W\d{2}$/) from_week?: string; // 起始週（ISO 'YYYY-Www'）
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) weeks?: number;
  @IsOptional() @IsUUID() team_id?: string;
  @IsOptional() @IsUUID() resource_id?: string;
}

export class WeeklyBoardQueryDto {
  @IsOptional() @Matches(/^(prev|this|next|\d{4}-W\d{2})$/) week?: string;
  @IsOptional() @IsIn(['交圖', '送審', '補正', '會議']) type?: string;
  @IsOptional() @IsUUID() assignee?: string;
}
