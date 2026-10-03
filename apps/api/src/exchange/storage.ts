import {Injectable} from '@nestjs/common';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DomainError} from '../common/errors';
import {LIMITS} from './model';
const execute=promisify(execFile);
export const contentHash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export function stableHash(value:unknown):string{const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;return contentHash(JSON.stringify(sort(value)));}
@Injectable()
export class ExchangeStorage{
 private get root(){return resolve(process.env.EXCHANGE_STORAGE_DIR??'.exchange-files');}
 private path(key:string){if(!/^[0-9a-f-]{36}$/.test(key))throw DomainError.notFound('檔案');return join(this.root,key);}
 async write(bytes:Buffer){if(bytes.length>LIMITS.expandedBytes)throw new DomainError('validation','file_limit','檔案超限',undefined,413);await mkdir(this.root,{recursive:true,mode:0o700});const key=randomUUID();await writeFile(this.path(key),bytes,{mode:0o600,flag:'wx'});return key;}
 async read(key:string){try{return await readFile(this.path(key));}catch(e){if(e instanceof DomainError)throw e;throw new DomainError('infrastructure','storage_unavailable','檔案暫時無法讀取');}}
 async remove(key:string){await unlink(this.path(key)).catch(()=>undefined);}
 async scan(key:string){
  if(process.env.NODE_ENV==='test'&&process.env.EXCHANGE_TEST_SCANNER==='1')return; // explicit test-only adapter; production always scans
  try{await execute('clamdscan',['--no-summary','--',this.path(key)],{timeout:30000,maxBuffer:4096});}catch(e:any){if(e.code===1)throw new DomainError('import','file_infected','檔案未通過病毒掃描');throw new DomainError('infrastructure','scan_unavailable','病毒掃描服務不可用，請稍後重試');}
 }
}
