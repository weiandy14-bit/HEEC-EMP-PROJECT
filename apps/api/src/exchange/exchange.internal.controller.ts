import {Body,Controller,Post,Req,UseGuards} from '@nestjs/common';
import type {Request} from 'express';
import {AuthGuard,CurrentUser,type UserContext} from '../auth/request-context';
import {Roles,RolesGuard} from '../auth/roles.guard';
import {ExchangeService} from './exchange.service';
/** 內部維運端點：手動觸發交換保存期限清理（Admin）。保留作業歷史與稽核，僅清除過期檔案與不可變預覽。 */
@Controller({path:'internal/exchange',version:'1'})
@UseGuards(AuthGuard,RolesGuard)
export class ExchangeInternalController{
 constructor(private exchange:ExchangeService){}
 @Post('retention') @Roles('Admin') retention(@CurrentUser()u:UserContext,@Body()_body:unknown,@Req()req:Request){return this.exchange.retentionSweep(u,(req as Request & {correlationId:string}).correlationId);}
}
