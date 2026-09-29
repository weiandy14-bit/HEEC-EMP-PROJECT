import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

const PROJECT_STATUS = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;

export class CreateProjectDto {
  @IsString() @Length(1, 64) code!: string;
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsString() @Length(0, 100) short_name?: string;
  @IsOptional() @IsString() client_name?: string;
  @IsOptional() @IsString() architect_name?: string;
  @IsOptional() @IsString() pm_user_id?: string;
  @IsOptional() @IsIn(PROJECT_STATUS) status?: (typeof PROJECT_STATUS)[number];
  @IsOptional() @IsInt() @Min(1) @Max(5) priority?: number;
  @IsOptional() @IsDateString() design_start_date?: string;
  @IsOptional() @IsDateString() permit_filing_date?: string;
  @IsOptional() @IsUUID() default_calendar_id?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsString() @Length(0, 100) short_name?: string;
  @IsOptional() @IsString() client_name?: string;
  @IsOptional() @IsString() architect_name?: string;
  @IsOptional() @IsString() pm_user_id?: string;
  @IsOptional() @IsIn(PROJECT_STATUS) status?: (typeof PROJECT_STATUS)[number];
  @IsOptional() @IsInt() @Min(1) @Max(5) priority?: number;
  @IsOptional() @IsDateString() permit_filing_date?: string;
  @IsOptional() @IsDateString() permit_issued_date?: string;
  @IsOptional() @IsString() notes?: string;
}
