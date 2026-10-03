import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
const {weekly,workload}=vi.hoisted(()=>({weekly:vi.fn(),workload:vi.fn()}));
vi.mock('../api',()=>({fetchWeekly:(...a:unknown[])=>weekly(...a),fetchWorkload:(...a:unknown[])=>workload(...a),fetchWeeklyOptions:async()=>({status:200,body:{projects:[],owners:[]}}),fetchWorkloadOptions:async()=>({status:200,body:{projects:[],teams:[],resources:[]}})}));
import {WeeklyBoardPage} from '../WeeklyBoardPage';
import {WorkloadPage} from '../WorkloadPage';
afterEach(cleanup);
it('B partial sources and 101 items support bounded loading',async()=>{
 const items=Array.from({length:50},(_,i)=>({id:String(i),type:'會議',title:`事項${i}`,project_id:'p',project_name:'案',assignee_id:null,assignee_name:null,source:{kind:'meeting',id:String(i)},due_at:'2027-03-08T01:00:00Z',status:'scheduled',overdue:false}));
 weekly.mockResolvedValue({status:200,body:{weekStart:'2027-03-07T16:00:00Z',weekEnd:'2027-03-14T16:00:00Z',items,next_offset:50,partial_errors:[{kind:'deliverable',message:'來源暫時無法載入'}]}});
 render(<WeeklyBoardPage/>);expect(await screen.findByTestId('state-partial')).toBeInTheDocument();expect(screen.getByTestId('partial-placeholder')).toBeInTheDocument();expect(screen.getByTestId('large-volume')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('自訂週'),{target:{value:'2027-W10'}});
 await screen.findByTestId('state-partial');expect(weekly).toHaveBeenLastCalledWith(expect.objectContaining({week:'2027-W10'}));
});
it('C partial resource preserves healthy rows, 101 engineers display 50 per page and can reach last',async()=>{
 const resources=Array.from({length:101},(_,i)=>({resource_id:String(i),name:`工程師${String(i).padStart(3,'0')}`,max_units:1,team_id:null,error:i===0,cells:[{week:'2027-W10',capacity_minutes:2400,demand_minutes:480,load_rate:.2,flags:[],sources:[]}]}));
 workload.mockResolvedValue({status:200,body:{weeks:['2027-W10'],resources,unassigned:[],teamSummary:[]}});
 render(<WorkloadPage/>);await screen.findByTestId('state-partial');expect(screen.getAllByTestId('wl-row')).toHaveLength(50);expect(screen.getByTestId('partial-placeholder')).toBeInTheDocument();
 fireEvent.click(screen.getByText('下一頁工程師'));fireEvent.click(screen.getByText('下一頁工程師'));expect(screen.getByText('工程師100')).toBeInTheDocument();
});
