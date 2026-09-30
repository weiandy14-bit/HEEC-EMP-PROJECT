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

export class UpdateReviewDto {
  @IsOptional() @IsIn(APPLICABILITY) applicability?: Applicability;
  @IsOptional() @IsString() na_reason?: string;
  @IsOptional() @IsUUID() confirmation_owner_id?: string;
  @IsOptional() @IsDateString() confirmation_due_date?: string;
  @IsOptional() @IsString() authority?: string;
  @IsOptional() @IsString() responsible_org?: string;
  @IsOptional() @IsDateString() legal_due_date?: string;
  @IsOptional() @IsString() notes?: string;
}
