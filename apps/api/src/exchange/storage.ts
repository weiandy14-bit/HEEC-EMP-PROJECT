import {Injectable} from '@nestjs/common';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {resolve,join}from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DomainError} from '../common/errors';
import {LIMITS} from './model';
import {S3Client,s3ConfigFromEnv} from './s3';
const execute=promisify(execFile);
export const contentHash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export function stableHash(value:unknown):string{const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;return contentHash(JSON.stringify(sort(value)));}

/** 伺服器生成的物件鍵一律為 UUID，杜絕 path traversal。 */
const assertKey=(key:string)=>{if(!/^[0-9a-f-]{36}$/.test(key))throw DomainError.notFound('檔案');return key;};

/** 私有儲存驅動介面：write/read/remove/purge 與供掃描之本機落地。 */
interface StorageDriver{
 write(bytes:Buffer):Promise<string>;
 read(key:string):Promise<Buffer>;
 remove(key:string):Promise<void>;
 purge(key:string):Promise<void>;
 /** 取得可供 clamdscan 掃描的本機路徑；cleanup 於掃描後呼叫。 */
 scanTarget(key:string):Promise<{path:string;cleanup:()=>Promise<void>}>;
}

/** 本機私有目錄：開發預設；目錄 0700、檔案 0600；不映射公開靜態網站。 */
class LocalDriver implements StorageDriver{
 private get root(){return resolve(process.env.EXCHANGE_STORAGE_DIR??'.exchange-files');}
 private path(key:string){return join(this.root,assertKey(key));}
 async write(bytes:Buffer){await mkdir(this.root,{recursive:true,mode:0o700});const key=randomUUID();await writeFile(this.path(key),bytes,{mode:0o600,flag:'wx'});return key;}
 async read(key:string){try{return await readFile(this.path(key));}catch(e){if(e instanceof DomainError)throw e;throw new DomainError('infrastructure','storage_unavailable','檔案暫時無法讀取');}}
 async remove(key:string){await unlink(this.path(key)).catch(()=>undefined);}
 async purge(key:string){try{await unlink(this.path(key));}catch(e:any){if(e?.code==='ENOENT')return;throw new DomainError('infrastructure','storage_unavailable','檔案清理失敗，稍後重試');}}
 async scanTarget(key:string){return {path:this.path(key),cleanup:async()=>undefined};}
}

/** S3 相容私有物件儲存（AWS S3 / Cloudflare R2 / MinIO）：正式環境雲端 adapter。 */
class S3Driver implements StorageDriver{
 constructor(private readonly client:S3Client){}
 async write(bytes:Buffer){if(bytes.length>LIMITS.expandedBytes)throw new DomainError('validation','file_limit','檔案超限',undefined,413);const key=randomUUID();try{await this.client.put(key,bytes);}catch{throw new DomainError('infrastructure','storage_unavailable','物件儲存暫時不可用，請稍後重試');}return key;}
 async read(key:string){assertKey(key);let bytes:Buffer|null;try{bytes=await this.client.get(key);}catch{throw new DomainError('infrastructure','storage_unavailable','檔案暫時無法讀取');}if(!bytes)throw DomainError.notFound('檔案');return bytes;}
 async remove(key:string){try{await this.client.del(assertKey(key));}catch{/* best-effort */}}
 async purge(key:string){try{await this.client.del(assertKey(key));}catch{throw new DomainError('infrastructure','storage_unavailable','檔案清理失敗，稍後重試');}}
 async scanTarget(key:string){const bytes=await this.read(key);const p=join(tmpdir(),`scan-${randomUUID()}`);await writeFile(p,bytes,{mode:0o600,flag:'wx'});return {path:p,cleanup:async()=>{await unlink(p).catch(()=>undefined);}};}
}

@Injectable()
export class ExchangeStorage{
 private _driver?:StorageDriver;
 /** 依 STORAGE_DRIVER 選擇驅動（預設 local）；s3 需 S3_* 環境設定齊備。 */
 private driver():StorageDriver{
  if(this._driver)return this._driver;
  if((process.env.STORAGE_DRIVER??'local')==='s3'){
   const cfg=s3ConfigFromEnv();
   if(!cfg)throw new DomainError('infrastructure','storage_unconfigured','STORAGE_DRIVER=s3 但缺少 S3_* 環境設定');
   this._driver=new S3Driver(new S3Client(cfg));
  }else{
   this._driver=new LocalDriver();
  }
  return this._driver;
 }
 async write(bytes:Buffer){if(bytes.length>LIMITS.expandedBytes)throw new DomainError('validation','file_limit','檔案超限',undefined,413);return this.driver().write(bytes);}
 async read(key:string){return this.driver().read(key);}
 async remove(key:string){return this.driver().remove(key);}
 /** Retention purge: succeeds if the file is gone and throws on any other failure so the sweep can retry. */
 async purge(key:string){return this.driver().purge(key);}
 async scan(key:string){
  if(process.env.NODE_ENV==='test'&&process.env.EXCHANGE_TEST_SCANNER==='1')return; // explicit test-only adapter; production always scans
  const {path,cleanup}=await this.driver().scanTarget(key);
  try{await execute('clamdscan',['--no-summary','--',path],{timeout:30000,maxBuffer:4096});}
  catch(e:any){if(e.code===1)throw new DomainError('import','file_infected','檔案未通過病毒掃描');throw new DomainError('infrastructure','scan_unavailable','病毒掃描服務不可用，請稍後重試');}
  finally{await cleanup();}
 }
}
