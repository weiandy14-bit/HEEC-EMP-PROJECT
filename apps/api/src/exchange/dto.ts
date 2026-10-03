import {IsIn,IsOptional,IsString,MaxLength,IsObject,IsUUID,IsBoolean,IsArray} from 'class-validator';
export class UploadDto{@IsIn(['csv','xlsx','csv-package']) format:'csv'|'xlsx'|'csv-package';@IsOptional() @IsString() @MaxLength(100) timezone?:string;@IsOptional() @IsIn(['utf-8','big5']) encoding?:'utf-8'|'big5';@IsOptional() @IsString() @MaxLength(1) delimiter?:string;}
export class PreviewDto{
 @IsOptional() @IsIn(['create-only','upsert']) mode?:'create-only'|'upsert';
 @IsOptional() @IsObject() mapping?:Record<string,string>;
 @IsOptional() @IsString() @MaxLength(100) dateFormat?:string;
 @IsOptional() @IsString() @MaxLength(5) startTime?:string;
 @IsOptional() @IsString() @MaxLength(5) finishTime?:string;
 @IsOptional() @IsString() @MaxLength(1) delimiter?:string;
 @IsOptional() @IsIn(['id','uid']) predecessorMode?:'id'|'uid';
 @IsOptional() @IsUUID() anchorTaskId?:string;
 @IsOptional() @IsString() @MaxLength(100) anchorKey?:string;
 @IsOptional() @IsObject() calendarMap?:Record<string,string>;
 @IsOptional() @IsObject() resourceMap?:Record<string,string>;
 @IsOptional() @IsObject() workAllocations?:Record<string,Record<string,number>>;
 @IsOptional() @IsObject() units?:Record<string,number>;
 @IsOptional() @IsArray() @IsString({each:true}) createResources?:string[];
 @IsOptional() @IsBoolean() acknowledgeWarnings?:boolean;
 @IsOptional() @IsBoolean() activateBaseline?:boolean;
}
export class CommitDto{@IsUUID() previewId:string;@IsString() @MaxLength(64) previewHash:string;}
export class ExportDto{@IsIn(['csv','xlsx','csv-package']) format:'csv'|'xlsx'|'csv-package';@IsOptional() @IsUUID() baselineId?:string;}

export class RoundTripDto{@IsUUID() exportJobId:string;}
