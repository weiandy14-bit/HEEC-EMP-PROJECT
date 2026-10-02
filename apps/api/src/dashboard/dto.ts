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
  @IsOptional() @IsString() task_cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) task_limit?: number;
  @IsOptional() @IsString() cursor?: string; // base64url(code)，游標分頁
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

export class WorkloadQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unassigned_offset?: number;
  @IsOptional() @IsUUID() project_id?: string;
  @IsOptional() @IsUUID() after_resource?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() @Matches(/^\d{4}-W\d{2}$/) from_week?: string; // 起始週（ISO 'YYYY-Www'）
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) weeks?: number;
  @IsOptional() @IsUUID() team_id?: string;
  @IsOptional() @IsUUID() resource_id?: string;
}

export class WeeklyBoardQueryDto {
  @IsOptional() @IsUUID() project_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Matches(/^(prev|this|next|\d{4}-W\d{2})$/) week?: string;
  @IsOptional() @IsIn(['交圖', '送審', '補正', '會議','里程碑','內部審查','協調','工作']) type?: string;
  @IsOptional() @IsUUID() assignee?: string;
}
