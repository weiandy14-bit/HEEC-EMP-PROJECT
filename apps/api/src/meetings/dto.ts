import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export const MEETING_STATUS = ['scheduled', 'held', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUS)[number];

export class CreateMeetingDto {
  @IsDateString() starts_at!: string;
  @IsOptional() @IsDateString() ends_at?: string;
  @IsString() @Length(1, 300) topic!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsUUID() organizer_id?: string;
}

export class UpdateMeetingDto {
  @IsOptional() @IsIn(MEETING_STATUS) status?: MeetingStatus;
  @IsOptional() @IsDateString() ends_at?: string;
  @IsOptional() @IsString() @Length(1, 300) topic?: string;
  @IsOptional() @IsUUID() minutes_attachment_id?: string;
  @IsOptional() @IsUUID() organizer_id?: string;
}
