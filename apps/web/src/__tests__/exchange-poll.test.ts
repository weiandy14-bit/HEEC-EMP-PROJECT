import {vi,expect,test,afterEach} from 'vitest';
import {pollExchange} from '../api';
afterEach(()=>vi.unstubAllGlobals());
test('pollExchange 重複輪詢直到條件成立（反映 202 背景作業完成）',async()=>{
 const seq=[{scan_state:'pending'},{scan_state:'pending'},{scan_state:'clean'}];let i=0;
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>seq[Math.min(i++,seq.length-1)]})));
 const j=await pollExchange('/projects/x/imports/j',(x:any)=>x.scan_state!=='pending',{attempts:5,interval:1});
 expect(j.scan_state).toBe('clean');
 expect(i).toBeGreaterThanOrEqual(3);
});
test('pollExchange 逾時擲出 408，不無限等待',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({scan_state:'pending'})})));
 await expect(pollExchange('/p',(x:any)=>x.scan_state!=='pending',{attempts:2,interval:1})).rejects.toMatchObject({status:408});
});
