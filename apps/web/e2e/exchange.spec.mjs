import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Project exchange: upload, invalid preview, correction, commit and private download',async({page},info)=>{
 let previews=0;
 await page.route('**/api/v1/**',async route=>{
  const url=route.request().url();
  let data={projects:[],next_cursor:null};
  if(url.includes('/gantt/options'))data={projects:[{id:'p1',name:'交換測試案'}],pms:[],resources:[],disciplines:[]};
  else if(url.includes('/exchange/schema'))data={columns:['Task Name','Duration','GUID'],extras:[]};
  else if(url.includes('/exchange/options'))data={resources:[],anchors:[]};
  else if(url.endsWith('/imports'))data={id:'job1',version:2,state:'pending',scan_state:'clean',result:{file_info:{headers:['Task Name','Duration','GUID'],anchor_candidates:[{key:'uid:2',name:'掛件',wbs:'0.0'}]}}};
  else if(url.endsWith('/previews')){previews++;data={id:'v'+previews,payload_hash:'a'.repeat(64),job_version:previews+2,task_count:2,can_commit:previews>1,issues:previews===1?[{row:2,field:'Work',severity:'error',message:'請修正工時'}]:[],changes:[]};}
  else if(url.endsWith('/commit'))data={id:'job1',version:5,state:'succeeded',result:{}};
  else if(url.endsWith('/exports'))data={id:'export1',state:'succeeded',report:{warnings:[]}};
  else if(url.endsWith('/download'))return route.fulfill({contentType:'application/octet-stream',body:'download fixture'});
  return route.fulfill({json:data});
 });
 await page.goto('/');await page.getByTestId('nav-exchange').click();
 await page.getByLabel('交換案件').selectOption('p1');
 await page.getByLabel('檔案',{exact:true}).setInputFiles({name:'project.csv',mimeType:'text/csv',buffer:Buffer.from('Task Name,Duration,GUID\n掛件,0d,uid:2')});
 await page.getByRole('button',{name:'上傳與掃描'}).click();
 await page.getByLabel('掛件錨點',{exact:true}).selectOption('uid:2');
 await page.getByRole('button',{name:'產生預覽／重新驗證'}).click();
 await expect(page.getByText('請修正工時',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'確認提交全部變更'})).toBeDisabled();
 await page.getByRole('button',{name:'產生預覽／重新驗證'}).click();
 await page.getByRole('button',{name:'確認提交全部變更'}).click();
 await expect(page.getByRole('status')).toContainText('匯入成功');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'產生並下載'}).click();await download;
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations).toEqual([]);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
 await page.screenshot({path:info.outputPath('exchange-completed.png'),fullPage:true});
});

test('Project exchange: permission wall and recoverable network error',async({page})=>{
 await page.route('**/api/v1/**',route=>route.fulfill({status:403,json:{category:'authorization',code:'forbidden',message:'無權限'}}));
 await page.goto('/');await page.getByTestId('nav-exchange').click();
 await expect(page.getByRole('button',{name:'重新載入'})).toBeVisible();
 await expect(page.getByRole('button',{name:'確認提交全部變更'})).toHaveCount(0);
});
