import {readCsvPackage} from './csv-package';
import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import {ExchangeParseError,LIMITS, type ParseOptions,type SheetRow} from './model';

export function readCsv(bytes:Buffer,options:ParseOptions):SheetRow[]{
 let text:string;try{text=new TextDecoder(options.encoding??'utf-8',{fatal:true}).decode(bytes);}catch{throw new ExchangeParseError('encoding_invalid','請明確選擇正確檔案編碼');}
 if(text.includes('\0'))throw new ExchangeParseError('format_invalid','CSV 不可包含 NUL');
 const delimiter=options.delimiter??',';if(delimiter.length!==1||/[\r\n"\0]/.test(delimiter))throw new ExchangeParseError('delimiter_invalid','分隔符格式錯誤');
 try{return parse(text,{bom:true,delimiter,skip_empty_lines:true,max_record_size:LIMITS.record,columns:(headers:string[])=>validateHeaders(headers),on_record:(record:SheetRow,info:{records:number})=>{if(info.records>LIMITS.assignments)throw new ExchangeParseError('row_limit','資料列超過上限');return record;}}) as SheetRow[];}catch(e){if(e instanceof ExchangeParseError)throw e;throw new ExchangeParseError('csv_invalid','CSV 欄數或引號格式錯誤');}
}
function validateHeaders(headers:string[]):string[]{const names=headers.map(h=>h.trim());if(names.some(h=>!h)||new Set(names).size!==names.length)throw new ExchangeParseError('header_invalid','表頭不可空白或重複');if(names.length>100)throw new ExchangeParseError('column_limit','欄數超過100');return names;}

/** Never extract uploaded ZIP; inspect declared AND actual decompressed bytes. */
export async function inspectWorkbookZip(bytes:Buffer):Promise<void>{
 await new Promise<void>((resolve,reject)=>{
  yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(err,zip)=>{
   if(err||!zip){reject(new ExchangeParseError('xlsx_invalid','不是有效 XLSX ZIP'));return;}
   let count=0,total=0,declared=0;const names=new Set<string>();let failed=false;
   const fail=(message:string)=>{if(failed)return;failed=true;zip.close();reject(new ExchangeParseError('xlsx_unsafe',message));};
   zip.on('error',()=>fail('XLSX 解壓失敗'));zip.on('end',()=>{if(!failed){if(!names.has('xl/workbook.xml')||!names.has('[Content_Types].xml'))fail('缺少 XLSX workbook');else resolve();}});
   zip.on('entry',(entry:yauzl.Entry)=>{
    const name=entry.fileName;
    if(++count>LIMITS.entries||names.has(name)||/(^|\/)\.\.(\/|$)|^\/|\\/.test(name)||entry.isEncrypted())return fail('非法或過量 ZIP 項目');
    names.add(name);declared+=entry.uncompressedSize;
    if(declared>LIMITS.expandedBytes||entry.uncompressedSize>LIMITS.expandedBytes||entry.uncompressedSize>Math.max(1024*1024,entry.compressedSize*1000))return fail('解壓大小或壓縮比超限');
    if(/vbaProject|externalLinks|macros/i.test(name))return fail('不接受巨集或外部連結');
    if(name.endsWith('/')){zip.readEntry();return;}
    zip.openReadStream(entry,(error,stream)=>{
     if(error||!stream)return fail('無法讀取 ZIP 項目');let actual=0;const chunks:Buffer[]=[];const inspect=/\.rels$|\[Content_Types\]\.xml$/.test(name);
     stream.on('data',(chunk:Buffer)=>{actual+=chunk.length;total+=chunk.length;if(total>LIMITS.expandedBytes||actual>entry.uncompressedSize){stream.destroy();fail('實際解壓內容超限');}else if(inspect)chunks.push(chunk);});
     stream.on('error',()=>fail('ZIP 內容不完整'));stream.on('end',()=>{if(failed)return;if(inspect&&/TargetMode\s*=\s*["']External["']|macroEnabled|vbaProject/i.test(Buffer.concat(chunks).toString('utf8')))return fail('不接受外部關聯或巨集');zip.readEntry();});
    });
   });zip.readEntry();
  });
 });
}
export async function readXlsx(bytes:Buffer):Promise<Record<string,SheetRow[]>>{
 await inspectWorkbookZip(bytes);const book=new ExcelJS.Workbook();try{await book.xlsx.load(bytes as any);}catch{throw new ExchangeParseError('xlsx_invalid','無法讀取 XLSX');}
 const sheets:Record<string,SheetRow[]>={};
 for(const sheet of book.worksheets){if(sheet.rowCount>LIMITS.assignments+1||sheet.columnCount>100)throw new ExchangeParseError('row_limit','工作表超過列/欄上限');
  const headers=validateHeaders(Array.from({length:sheet.columnCount},(_,i)=>sheet.getRow(1).getCell(i+1).text));const rows:SheetRow[]=[];
  for(let n=2;n<=sheet.rowCount;n++){const row:SheetRow=Object.create(null);let nonempty=false;
   headers.forEach((header,i)=>{const cell=sheet.getRow(n).getCell(i+1);const v=cell.value;if(v&&typeof v==='object'&&!(v instanceof Date)&&('formula'in v||'sharedFormula'in v||'hyperlink'in v||'error'in v))throw new ExchangeParseError('cell_unsafe',`工作表 ${sheet.name} 第 ${n} 列不接受公式、連結或錯誤儲存格`);const s=v instanceof Date?v.toISOString().replace(/Z$/,''):cell.text;row[header]=s;nonempty ||=s!=='';});if(nonempty)rows.push(row);
  }sheets[sheet.name]=rows;
 }if(!sheets.Tasks)throw new ExchangeParseError('tasks_missing','XLSX 須有 Tasks 工作表');return sheets;
}
export async function readTables(bytes:Buffer,options:ParseOptions):Promise<Record<string,SheetRow[]>>{if(bytes.length>LIMITS.bytes)throw new ExchangeParseError('file_limit','檔案超過10 MiB');return options.format==='csv-package'?readCsvPackage(bytes,options):options.format==='csv'?{Tasks:readCsv(bytes,options)}:readXlsx(bytes);}
export function protectText(value:string):string{let i=0;while(i<value.length&&(value.charCodeAt(i)<=32||/\s/.test(value[i])))i++;return "=+-@".includes(value[i]??" ")||value.startsWith("'")?"'"+value:value;}
export function writeCsv(rows:SheetRow[],columns:string[]):Buffer{return Buffer.from('\ufeff'+stringify(rows,{header:true,columns,record_delimiter:'\r\n',cast:{string:(s,ctx)=>ctx.header?s:protectText(s)}}),'utf8');}
export async function writeXlsx(sheets:Record<string,{columns:string[];rows:SheetRow[]}>):Promise<Buffer>{const book=new ExcelJS.Workbook();for(const [name,{columns,rows}]of Object.entries(sheets)){const sheet=book.addWorksheet(name);sheet.addRow(columns);for(const row of rows)sheet.addRow(columns.map(c=>row[c]??''));sheet.views=[{state:'frozen',ySplit:1}];}return Buffer.from(await book.xlsx.writeBuffer());}
