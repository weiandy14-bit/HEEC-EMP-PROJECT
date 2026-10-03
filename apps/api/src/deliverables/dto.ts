import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export const DELIVERABLE_STATUS = ['draft', 'submitted', 'accepted', 'rejected', 'locked'] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUS)[number];

export class CreateDeliverableDto {
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() @Length(1, 20) revision?: string;
  @IsOptional() @IsUUID() task_id?: string;
  @IsOptional() @IsDateString() due_at?: string;
}

export class UpdateDeliverableDto {
  @IsOptional() @IsIn(DELIVERABLE_STATUS) status?: DeliverableStatus;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsDateString() due_at?: string;
  @IsOptional() @IsUUID() approver_id?: string;
}

export class ReviseDeliverableDto {
  @IsOptional() @IsString() @Length(1, 20) revision?: string; // 省略時自動由現版遞增
  @IsOptional() @IsDateString() due_at?: string;
}
