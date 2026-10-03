import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ProcessOutboxDto {
  @IsOptional() @IsInt() @Min(1) @Max(500) limit?: number;
}

export class EnqueueTestDto {
  @IsOptional() @IsBoolean() fail?: boolean;
}
