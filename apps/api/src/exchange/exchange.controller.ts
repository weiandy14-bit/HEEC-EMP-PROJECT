import {Controller,UseGuards,Get,Post,Param,ParseUUIDPipe,Body,Headers,Res,UploadedFile,UseInterceptors,Query,ParseIntPipe,DefaultValuePipe} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import type {Response} from 'express';
import {AuthGuard,CurrentUser,type UserContext} from '../auth/request-context';
import {Roles,RolesGuard} from '../auth/roles.guard';
import {DomainError} from '../common/errors';
import {ExchangeService} from './exchange.service';
import {UploadDto,PreviewDto,CommitDto,ExportDto} from './dto';
import {TASK_COLUMNS,EXTRA_COLUMNS,LIMITS,SCHEMA_VERSION} from './model';
function version(v:string|undefined){const n=Number(v?.replace(/"/g,''));if(!v||!Number.isSafeInteger(n)||n<1)throw DomainError.validation('須提供有效If-Match');return n;}
@Controller({path:'projects/:p',version:'1'})
@UseGuards(AuthGuard,RolesGuard)
@Roles('PM','Admin')
export class ExchangeController{
 constructor(private exchange:ExchangeService){}
 @Get('exchange/schema') schema(){return{version:SCHEMA_VERSION,columns:TASK_COLUMNS,extras:EXTRA_COLUMNS,limits:LIMITS,formats:['csv','xlsx']};}
 @Get('exchange/options') options(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string){return this.exchange.options(u,p);}
 @Post('imports') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:LIMITS.bytes,files:1,fields:5}}))
 upload(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@UploadedFile()file:Express.Multer.File,@Body()dto:UploadDto,@Headers('idempotency-key')key:string|undefined,@Headers('x-correlation-id')correlation:string){if(!file)throw DomainError.validation('請上傳檔案');return this.exchange.upload(u,p,file.buffer,dto,key,correlation);}
 @Get('imports/:j') get(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string){return this.exchange.getImport(u,p,j);}
 @Post('imports/:j/previews') preview(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Body()dto:PreviewDto,@Headers('if-match')v:string|undefined,@Headers('x-correlation-id')correlation:string){return this.exchange.preview(u,p,j,dto,version(v),correlation);}
 @Get('imports/:j/previews/:v') getPreview(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Param('v',ParseUUIDPipe)v:string,@Query('offset',new DefaultValuePipe(0),ParseIntPipe)offset:number,@Query('limit',new DefaultValuePipe(100),ParseIntPipe)limit:number){if(offset<0||limit<1||limit>200)throw DomainError.validation('分頁範圍無效');return this.exchange.getPreview(u,p,j,v,offset,limit);}
 @Post('imports/:j/commit') commit(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Body()dto:CommitDto,@Headers('idempotency-key')key:string|undefined,@Headers('if-match')v:string|undefined,@Headers('x-correlation-id')correlation:string){return this.exchange.commit(u,p,j,dto,key,version(v),correlation);}
 @Post('exports') export(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Body()dto:ExportDto,@Headers('idempotency-key')key:string|undefined,@Headers('x-correlation-id')correlation:string){return this.exchange.export(u,p,dto,key,correlation);}
 @Get('exports/:j') getExport(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string){return this.exchange.getExport(u,p,j);}
 @Get('exports/:j/download') async download(@CurrentUser()u:UserContext,@Param('p',ParseUUIDPipe)p:string,@Param('j',ParseUUIDPipe)j:string,@Res()res:Response){const output=await this.exchange.download(u,p,j);res.type(output.format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="project-${j}.${output.format}"`);res.setHeader('Cache-Control','no-store');res.send(output.bytes);}
}
