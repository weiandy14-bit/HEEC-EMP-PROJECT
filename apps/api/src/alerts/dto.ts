import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class EvaluateAlertDto {
  @IsOptional() @IsString() rule_code?: string; // 預設 SCHEDULE_SLIP
  @IsString() entity_type!: string;
  @IsOptional() @IsUUID() entity_id?: string;
  @IsOptional() @IsUUID() baseline_id?: string;
  @IsString() @Length(1, 60) period!: string; // 指紋之一部分（如 2027-W02）
  @IsOptional() @IsInt() @Min(0) late_working_days?: number; // 相對 Baseline 落後工作日
  @IsOptional() @IsBoolean() overdue?: boolean; // 已逾計畫完成且未完成
}

export class AckAlertDto {
  @IsString() @Length(1, 500) reason!: string;
}
export class SnoozeAlertDto {
  @IsString() @Length(1, 500) reason!: string;
  @IsString() snooze_until!: string; // ISO datetime
}
export class CloseAlertDto {
  @IsString() @Length(1, 500) reason!: string;
}
export class AssignAlertDto {
  @IsUUID() assignee_id!: string;
}
