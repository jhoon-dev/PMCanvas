export const DAY=86400000;
export const dateValue=s=>Date.parse(s+'T00:00:00Z');
export const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(dateValue(s))&&new Date(dateValue(s)).toISOString().slice(0,10)===s;
export const addDays=(s,n)=>new Date(dateValue(s)+n*DAY).toISOString().slice(0,10);
export const daysBetween=(a,b)=>Math.round((dateValue(b)-dateValue(a))/DAY);
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
export function working(s,h=[]){const d=new Date(dateValue(s)).getUTCDay();return d!==0&&d!==6&&!h.includes(s);}
export function workdays(a,b,h=[]){if(b<a)return 0;let n=0;for(let d=a;d<=b;d=addDays(d,1))if(working(d,h))n++;return n;}
export function nextWorkday(s,h=[]){let d=s;for(let i=0;i<3700;i++,d=addDays(d,1))if(working(d,h))return d;throw Error('근무일을 찾을 수 없습니다.');}
export function shiftWorkday(s,n,h=[]){let d=s;for(let i=0;i<Math.abs(n);){d=addDays(d,n<0?-1:1);if(working(d,h))i++;}return d;}
export const taskHours=t=>t.items.reduce((s,i)=>s+i.hours,0);
export const earned=(t,at)=>t.items.reduce((s,i)=>s+(i.doneDate&&i.doneDate<=at?i.hours:0),0);
export const progress=(t,at)=>taskHours(t)?earned(t,at)/taskHours(t):0;
export function planned(t,at,h=[]){const d=workdays(t.start,t.end,h);return d?taskHours(t)*Math.min(1,workdays(t.start,at<t.end?at:t.end,h)/d):0;}
export function orderTasks(tasks){
 const map=new Map(tasks.map(t=>[t.id,t])),out=[],visiting=new Set(),seen=new Set();
 function visit(t){if(visiting.has(t.id))throw Error('선행 업무가 서로 순환합니다. 연결을 확인해 주세요.');if(seen.has(t.id))return;visiting.add(t.id);if(t.predecessor){const p=map.get(t.predecessor);if(!p)throw Error('존재하지 않는 선행 업무입니다.');visit(p);}visiting.delete(t.id);seen.add(t.id);out.push(t);}
 [...tasks].sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)).forEach(visit);return out;
}
export function forecast(project,at){
 const h=project.holidays||[],tasks=orderTasks(project.tasks),results=Object.create(null),pace=Object.create(null),usage=new Map();
 const firstWindow=shiftWorkday(working(at,h)?at:shiftWorkday(nextWorkday(at,h),-1,h),-9,h);
 for(const member of project.members){
  const owned=tasks.filter(t=>t.owner===member.id),earliest=owned.length?owned.reduce((m,t)=>t.start<m?t.start:m,owned[0].start):at,from=earliest>firstWindow?earliest:firstWindow;
  const actualDays=new Set(),done=owned.reduce((sum,t)=>sum+t.items.reduce((s,i)=>{if(i.doneDate&&i.doneDate>=from&&i.doneDate<=at){actualDays.add(i.doneDate);return s+i.hours;}return s;},0),0),span=workdays(from,at,h);
  let expected=0;for(const t of owned)expected+=Math.max(0,planned(t,at,h)-planned(t,addDays(from,-1),h));
  const observed=span>=3&&actualDays.size>=2&&expected>0&&done>0;
  pace[member.id]={observed,ratio:observed?done/expected:1,completedHours:done,windowDays:span,capacity:member.hours*member.allocation/100};
 }
 for(const t of tasks){
  const total=taskHours(t),done=earned(t,at),remaining=Math.max(0,total-done);
  if(remaining<0.00001){const dates=t.items.filter(i=>i.doneDate&&i.doneDate<=at).map(i=>i.doneDate).sort();results[t.id]={start:dates[0]||t.start,end:dates.at(-1)||t.end,method:'actual',remaining:0,late:Math.max(0,workdays(addDays(t.end,1),dates.at(-1)||t.end,h))};continue;}
  const member=project.members.find(m=>m.id===t.owner),p=pace[t.owner],pred=t.predecessor?results[t.predecessor]:null;
  if(!member||!p||pred?.end===null){results[t.id]={start:null,end:null,method:'unavailable',reason:!member?'담당자 미지정':'선행 업무의 예상일 없음',remaining};continue;}
  const nominal=total/Math.max(1,workdays(t.start,t.end,h)),dailyRate=Math.min(p.capacity,nominal*p.ratio);
  let start=nextWorkday([t.start,addDays(at,1),pred?.end?addDays(pred.end,1):t.start].sort().at(-1),h),d=start,left=remaining,finish=null,first=null;
  for(let guard=0;guard<3653&&left>0.00001;guard++,d=addDays(d,1)){
   if(!working(d,h))continue;
   const key=member.id+':'+d,used=usage.get(key)||0,amount=Math.min(left,dailyRate,Math.max(0,p.capacity-used));
   if(amount>0){first??=d;left-=amount;usage.set(key,used+amount);finish=d;}
  }
  results[t.id]={start:first||start,end:left>0.00001?null:finish,method:p.observed?'velocity':'plan',remaining,reason:left>0.00001?'약 10년 계산 범위 초과':null,late:finish?Math.max(0,workdays(addDays(t.end,1),finish,h)):0};
 }
 const values=Object.values(results),ends=values.map(x=>x.end).filter(Boolean).sort();
 return {tasks:results,pace,end:values.length&&values.every(x=>x.end)?ends.at(-1):null,observed:values.some(x=>x.method==='velocity')};
}
export function summary(project,at){
 const total=project.tasks.reduce((s,t)=>s+taskHours(t),0),done=project.tasks.reduce((s,t)=>s+earned(t,at),0),plan=project.tasks.reduce((s,t)=>s+planned(t,at,project.holidays),0),f=forecast(project,at),starts=project.tasks.map(t=>t.start).sort(),ends=project.tasks.map(t=>t.end).sort();
 return {total,done,progress:total?done/total:0,planned:total?plan/total:0,completed:project.tasks.filter(t=>progress(t,at)===1).length,overdue:project.tasks.filter(t=>t.end<at&&progress(t,at)<1).length,start:starts[0]||null,end:ends.at(-1)||null,forecast:f};
}
export function validateProject(p){
 if(!p||typeof p!=='object'||!Array.isArray(p.members)||!Array.isArray(p.tasks)||typeof p.name!=='string'||!p.name.trim()||p.name.length>120)throw Error('프로젝트 형식 또는 이름이 올바르지 않습니다.');
 if(p.members.length>200||p.tasks.length>500)throw Error('첫 버전은 인력 200명, 업무 500개까지 지원합니다.');
 if(p.holidays!==undefined&&(!Array.isArray(p.holidays)||p.holidays.length>3660||p.holidays.some(d=>!validDate(d))))throw Error('휴무일 날짜를 확인해 주세요.');
 const memberIds=new Set(),taskIds=new Set(),itemIds=new Set();
 for(const m of p.members){if(typeof m.id!=='string'||memberIds.has(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>80||!(m.hours>0&&m.hours<=16)||!(m.allocation>0&&m.allocation<=100)||typeof m.grade!=='string'||typeof m.role!=='string')throw Error('참여인력의 이름·근무시간·투입률을 확인해 주세요.');memberIds.add(m.id);}
 for(const t of p.tasks){
  if(typeof t.id!=='string'||taskIds.has(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>200||!validDate(t.start)||!validDate(t.end)||t.end<t.start||daysBetween(t.start,t.end)>3652||!workdays(t.start,t.end,p.holidays)||!Array.isArray(t.items)||!t.items.length||t.items.length>200||(!memberIds.has(t.owner)&&t.owner!==''))throw Error('업무 이름·담당자·일정·체크 항목을 확인해 주세요.');
  for(const i of t.items){if(typeof i.id!=='string'||itemIds.has(i.id)||typeof i.title!=='string'||!i.title.trim()||i.title.length>300||!Number.isFinite(i.hours)||i.hours<=0||i.hours>10000||(i.doneDate&&(!validDate(i.doneDate)||i.doneDate>today())))throw Error('세부 작업의 이름·예상 시간·완료일을 확인해 주세요.');itemIds.add(i.id);}taskIds.add(t.id);
 }
 orderTasks(p.tasks);return p;
}