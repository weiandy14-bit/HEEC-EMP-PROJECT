import {Controller,UseGuards,Get,Post,Param,ParseUUIDPipe,Body,Headers,Res,UploadedFile,UseInterceptors,Query,ParseIntPipe,DefaultValuePipe,Req} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import type {Response,Request} from 'express';
import {AuthGuard,CurrentUser,type UserContext} from '../auth/request-context';
import {Roles,RolesGuard} from '../auth/roles.guard';
import {DomainError} from '../common/errors';
import {ExchangeService} from './exchange.service';
import {UploadDto,PreviewDto,CommitDto,ExportDto,RoundTripDto} from './dto';
import {TASK_COLUMNS,EXTRA_COLUMNS,LIMITS,SCHEMA_VERSION} from './model';
function version(v:string|undefined){const n=Number(v?.replace(/"/g,''));if(!v||!Number.isSafeInteger(n)||n<1)throw DomainError.validation('須提供有效If-Match');return n;}
@Controller({path:'projects/:p',version:'1'})
@UseGuards(AuthGuard,RolesGuard)
@Roles('PM','Admin')
export class ExchangeController{
 constructor(private exchange:ExchangeService){}
 @Get('exchange/schema') async schema(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string){await this.exchange.options(u,p);return{version:SCHEMA_VERSION,columns:TASK_COLUMNS,extras:EXTRA_COLUMNS,limits:LIMITS,formats:['csv','xlsx','csv-package']};}
 @Get('exchange/options') options(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string){return this.exchange.options(u,p);}
 @Post('imports') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:LIMITS.bytes,files:1,fields:5}}))
 upload(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@UploadedFile()file:Express.Multer.File,@Body()dto:UploadDto,@Headers('idempotency-key')key:string|undefined,@Req()req:Request){if(!file)throw DomainError.validation('請上傳檔案');if(!file.originalname.toLowerCase().endsWith('.'+(dto.format==='csv-package'?'zip':dto.format))||!['application/zip','text/csv','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'].includes(file.mimetype))throw DomainError.validation('檔案副檔名或MIME不符');if(dto.format!=='csv'&&file.buffer.subarray(0,4).toString('hex')!=='504b0304')throw DomainError.validation('XLSX signature不符');return this.exchange.upload(u,p,file.buffer,dto,key,(req as Request & {correlationId:string}).correlationId);}
 @Get('imports/:j') get(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string){return this.exchange.getImport(u,p,j);}
 @Post('imports/:j/previews') preview(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Body()dto:PreviewDto,@Headers('if-match')v:string|undefined,@Req()req:Request){return this.exchange.preview(u,p,j,dto,version(v),(req as Request & {correlationId:string}).correlationId);}
 @Get('imports/:j/previews/:v') getPreview(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Param('v',ParseUUIDPipe)v:string,@Query('offset',new DefaultValuePipe(0),ParseIntPipe)offset:number,@Query('limit',new DefaultValuePipe(100),ParseIntPipe)limit:number){if(offset<0||limit<1||limit>200)throw DomainError.validation('分頁範圍無效');return this.exchange.getPreview(u,p,j,v,offset,limit);}
 @Post('imports/:j/commit') commit(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Body()dto:CommitDto,@Headers('idempotency-key')key:string|undefined,@Headers('if-match')v:string|undefined,@Req()req:Request){return this.exchange.commit(u,p,j,dto,key,version(v),(req as Request & {correlationId:string}).correlationId);}
 @Post('exports') export(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Body()dto:ExportDto,@Headers('idempotency-key')key:string|undefined,@Req()req:Request){return this.exchange.export(u,p,dto,key,(req as Request & {correlationId:string}).correlationId);}
 @Post('exchange/round-trip') roundTrip(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Body()dto:RoundTripDto,@Req()req:Request){return this.exchange.roundTrip(u,p,dto.exportJobId,(req as Request & {correlationId:string}).correlationId);}
 @Get('exports/:j') getExport(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string){return this.exchange.getExport(u,p,j);}
 @Get('exports/:j/download') async download(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Res()res:Response){const output=await this.exchange.download(u,p,j);res.type(output.format==='csv'?'text/csv; charset=utf-8':output.format==='csv-package'?'application/zip':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="project-${j}.${output.format==='csv-package'?'zip':output.format}"`);res.setHeader('Cache-Control','no-store');res.send(output.bytes);}
}
