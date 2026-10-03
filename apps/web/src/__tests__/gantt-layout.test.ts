import { describe, it, expect } from 'vitest';
import { layoutProjects, virtualWindow, ROW_HEIGHT } from '../gantt-layout';
import type { GanttProject, GanttTask } from '../types';
const task = (i:number,parent_id:string|null=null):GanttTask => ({id:String(i),parent_id,wbs_code:String(i),sort_key:String(i),name:String(i),discipline_id:null,owner_user_id:null,milestone:false,summary:false,critical:false,status:'not_started',percent_complete:0,planned:{start:null,finish:null},baseline:{start:null,finish:null},actual:{start:null,finish:null}});
const project = (tasks:GanttTask[]):GanttProject => ({id:'p',code:'P',name:'P',status:'active',health:'normal',permit_filing_date:null,pm_user_id:null,tasks,dependencies:[],milestones:[]});
describe('large Gantt layout',()=>{
 it('5000 rows render a bounded viewport and reach the final task',()=>{
  const layouts=layoutProjects([project(Array.from({length:5000},(_,i)=>task(i)))],new Set());
  const first=virtualWindow(layouts,0,600);
  expect(first.visible.reduce((n,v)=>n+v.end-v.start,0)).toBeLessThan(40);
  const last=virtualWindow(layouts,layouts[0].height-600,600);
  expect(last.visible[0].end).toBe(5000);
  expect(last.visible[0].layout.rows[last.visible[0].end-1].task.id).toBe('4999');
  expect(first.before+first.after+layouts[0].height+ROW_HEIGHT).toBe(first.total);
 });
 it('deep imported hierarchy avoids recursion overflow and collapses descendants',()=>{
  const p=project(Array.from({length:5000},(_,i)=>task(i,i?String(i-1):null)));
  expect(layoutProjects([p],new Set())[0].rows).toHaveLength(5000);
  expect(layoutProjects([p],new Set(['0']))[0].rows).toHaveLength(1);
  expect(layoutProjects([p],new Set(['project:p']))[0].height).toBe(ROW_HEIGHT);
 });
 it('multi-project spacers preserve the full scroll height',()=>{
  const projects=Array.from({length:50},(_,i)=>({...project(Array.from({length:100},(_,j)=>task(j))),id:`p${i}`}));
  const layouts=layoutProjects(projects,new Set());
  const w=virtualWindow(layouts,60000,600);
  expect(w.visible.length).toBeLessThan(3);
  expect(w.before+w.after+w.visible.reduce((n,v)=>n+v.layout.height,0)+ROW_HEIGHT).toBe(w.total);
 });
});
