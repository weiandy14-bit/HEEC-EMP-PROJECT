import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export const APPLICABILITY = ['applicable', 'not_applicable', 'pending'] as const;
export type Applicability = (typeof APPLICABILITY)[number];

export class CreateReviewDto {
  @IsUUID() template_id!: string;
  @IsOptional() @IsInt() @Min(1) template_version?: number;
  @IsOptional() @IsIn(APPLICABILITY) applicability?: Applicability;
  @IsOptional() @IsString() na_reason?: string;
  @IsOptional() @IsUUID() confirmation_owner_id?: string;
  @IsOptional() @IsDateString() confirmation_due_date?: string;
  @IsOptional() @IsString() authority?: string;
  @IsOptional() @IsString() responsible_org?: string;
  @IsOptional() @IsDateString() legal_due_date?: string;
  @IsOptional() @IsString() notes?: string;
}

export const REVIEW_STATUS = ['pending', 'in_review', 'revision', 'approved', 'rejected', 'na'] as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[number];

export class UpdateReviewDto {
  @IsOptional() @IsIn(APPLICABILITY) applicability?: Applicability;
  @IsOptional() @IsString() na_reason?: string;
  @IsOptional() @IsUUID() confirmation_owner_id?: string;
  @IsOptional() @IsDateString() confirmation_due_date?: string;
  @IsOptional() @IsString() authority?: string;
  @IsOptional() @IsString() responsible_org?: string;
  @IsOptional() @IsDateString() legal_due_date?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(REVIEW_STATUS) status?: ReviewStatus;
  @IsOptional() @IsString() approval_number?: string;
  @IsOptional() @IsDateString() approval_date?: string;
}

export const STEP_STATUS = ['pending', 'in_progress', 'submitted', 'passed', 'revision', 'failed'] as const;
export type StepStatus = (typeof STEP_STATUS)[number];

export class CreateReviewStepDto {
  @IsString() step_code!: string;
  @IsOptional() @IsInt() @Min(1) cycle_no?: number; // 省略時自動取該 step_code 之次一循環
  @IsOptional() @IsIn(STEP_STATUS) status?: StepStatus;
  @IsOptional() @IsUUID() template_step_id?: string;
  @IsOptional() @IsUUID() owner_id?: string;
  @IsOptional() @IsDateString() planned_at?: string;
  @IsOptional() @IsDateString() actual_at?: string;
  @IsOptional() @IsDateString() due_at?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateReviewStepDto {
  @IsOptional() @IsIn(STEP_STATUS) status?: StepStatus;
  @IsOptional() @IsDateString() actual_at?: string;
  @IsOptional() @IsUUID() owner_id?: string;
  @IsOptional() @IsString() notes?: string;
}
