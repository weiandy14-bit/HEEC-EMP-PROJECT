import {stableHash} from './storage';
import type {SheetRow} from './model';

/** Compare each exchange field. IDs are source identifiers, never physical file rows. */
export function compareTables(expected:Record<string,{columns:string[];rows:SheetRow[]}>,actual:Record<string,SheetRow[]>){
 const differences:{table:string;row:number;field:string;expected:string;actual:string}[]=[];let total=0;
 const before:Record<string,SheetRow[]>={},after:Record<string,SheetRow[]>={};
 for(const [table,sheet]of Object.entries(expected)){
  before[table]=sheet.rows.map(row=>Object.fromEntries(sheet.columns.map(column=>[column,row[column]??''])));
  const rows=actual[table]??[];after[table]=rows.map(row=>Object.fromEntries(sheet.columns.map(column=>[column,row[column]??''])));
  for(let i=0;i<Math.max(sheet.rows.length,rows.length);i++){
   if(!sheet.rows[i]||!rows[i]){total++;if(differences.length<200)differences.push({table,row:i+2,field:'row',expected:sheet.rows[i]?'present':'absent',actual:rows[i]?'present':'absent'});continue;}
   for(const column of sheet.columns){const source=sheet.rows[i][column]??'',target=rows[i][column]??'';if(source!==target){total++;if(differences.length<200)differences.push({table,row:i+2,field:column,expected:source,actual:target});}}
  }
 }
 for(const table of Object.keys(actual))if(!Object.hasOwn(expected,table)){total++;if(differences.length<200)differences.push({table,row:0,field:'table',expected:'absent',actual:'present'});}
 return{equal:total===0,difference_count:total,differences,truncated:total>200,source_hash:stableHash(before),parsed_hash:stableHash(after)};
}
