import JSZip from 'jszip';
import yauzl from 'yauzl';
import {createHash} from 'node:crypto';
import {readCsv,writeCsv,protectText} from './formats';
import {LIMITS,SCHEMA_VERSION,ExchangeParseError,type SheetRow,type ParseOptions} from './model';

const TABLES=['Tasks','Assignments','Resources','Resource Calendars','Calendars','Exceptions','Baselines','Metadata'];
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export async function writeCsvPackage(sheets:Record<string,{columns:string[];rows:SheetRow[]}>):Promise<Buffer>{
 const zip=new JSZip();const files:Record<string,{sha256:string;rows:number}>={};
 for(const [name,sheet]of Object.entries(sheets)){if(!TABLES.includes(name))throw new Error('Unknown exchange table');const bytes=writeCsv(sheet.rows,sheet.columns);zip.file(name+'.csv',bytes);files[name+'.csv']={sha256:hash(bytes),rows:sheet.rows.length};}
 zip.file('manifest.json',JSON.stringify({schema_version:SCHEMA_VERSION,encoding:'utf-8',text_protection:'apostrophe-v1',files}));
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});if(bytes.length>LIMITS.bytes)throw new ExchangeParseError('file_limit','輸出package超過10 MiB');return bytes;
}
async function entries(bytes:Buffer):Promise<Record<string,Buffer>>{
 return new Promise((resolve,reject)=>{yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(err,zip)=>{
  if(err||!zip)return reject(new ExchangeParseError('package_invalid','無效CSV package'));
  const files:Record<string,Buffer>=Object.create(null);let total=0,count=0,failed=false;
  const fail=()=>{if(failed)return;failed=true;zip.close();reject(new ExchangeParseError('package_unsafe','CSV package內容、路徑或解壓大小不符限制'));};
  zip.on('error',fail);zip.on('end',()=>{if(!failed)resolve(files);});
  zip.on('entry',entry=>{
   if(++count>TABLES.length+1||entry.isEncrypted()||Object.hasOwn(files,entry.fileName)||!['manifest.json',...TABLES.map(n=>n+'.csv')].includes(entry.fileName)||entry.uncompressedSize>LIMITS.expandedBytes||entry.uncompressedSize>Math.max(1024*1024,entry.compressedSize*1000))return fail();
   zip.openReadStream(entry,(error,stream)=>{if(error||!stream)return fail();const chunks:Buffer[]=[];let size=0;
    stream.on('data',(chunk:Buffer)=>{total+=chunk.length;size+=chunk.length;if(total>LIMITS.expandedBytes||size>entry.uncompressedSize){stream.destroy();fail();}else chunks.push(chunk);});stream.on('error',fail);stream.on('end',()=>{if(!failed){files[entry.fileName]=Buffer.concat(chunks);zip.readEntry();}});
   });
  });zip.readEntry();
 });});
}
function unprotect(value:string):string{if(!value.startsWith("'"))return value;const raw=value.slice(1);return protectText(raw)===value?raw:value;}
export async function readCsvPackage(bytes:Buffer,options:ParseOptions):Promise<Record<string,SheetRow[]>>{
 const files=await entries(bytes);let manifest:any;try{manifest=JSON.parse(files['manifest.json']?.toString('utf8'));}catch{throw new ExchangeParseError('manifest_invalid','缺少有效manifest');}
 if(manifest?.schema_version!==SCHEMA_VERSION||manifest.encoding!=='utf-8'||manifest.text_protection!=='apostrophe-v1'||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw new ExchangeParseError('manifest_invalid','manifest版本/編碼/文字防護無效');
 const sheets:Record<string,SheetRow[]>={};
 for(const [name,bytes]of Object.entries(files)){if(name==='manifest.json')continue;const meta=manifest.files[name];if(!meta||meta.sha256!==hash(bytes))throw new ExchangeParseError('package_hash','CSV內容checksum不符');const rows=readCsv(bytes,{...options,encoding:'utf-8',delimiter:','});if(!Number.isInteger(meta.rows)||rows.length!==meta.rows)throw new ExchangeParseError('package_rows','CSV列數不符manifest');sheets[name.slice(0,-4)]=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,unprotect(value)])));}
 if(Object.keys(manifest.files).some(name=>!Object.hasOwn(files,name))||!sheets.Tasks)throw new ExchangeParseError('manifest_invalid','package缺少宣告工作表');return sheets;
}
