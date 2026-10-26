import {hierarchy,ordered,rollup,setParent,captureBaseline,baselineDiff,criticalPath,scheduleWarnings} from './planning.js';
import {openExcelImport} from './wbs-import.js';
import {columns,tsvText,newTask,checkDraft,setCell,editCell,pasteCells,moveSchedule,duplicateTasks,removeTasks,reorderTasks,alignSuccessors} from './wbs-model.js';
import {today,addDays,daysBetween,taskHours,progress,summary} from './engine.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=structuredClone;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export class WbsWorkspace{
 constructor(options){this.options=options;this.selected=new Set();this.pending=new Map();this.undoStack=[];this.redoStack=[];this.query='';this.owner='';this.zoom=24;this.cascade=false;this.error='';this.saving=false;this.collapsed=new Set();this.recovery=null;this.localError='';}
 get dirty(){return !!this.draft&&(this.pending.size>0||this.changedFlag);}
 get interacting(){return !!this.drag||!!this.root?.contains(document.activeElement);}
 get readOnly(){return this.base?._role==='viewer';}
 ensure(project,at){
  this.at=at;
  if(!this.draft||this.base.id!==project.id||!this.dirty&&(this.base._revision!==project._revision||this.base._role!==project._role)){if(this.base?.id!==project.id){this.query='';this.owner='';}this.reset(project);}
 }
 reset(project){this.base=clone(project);this.draft=clone(project);this.changedFlag=false;this.pending.clear();this.undoStack=[];this.redoStack=[];this.selected.clear();this.error='';this.collapsed=new Set();this.recovery=null;try{this.recovery=this.options.getDraftStore?.()?.read(project.id);}catch{this.localError='이 브라우저의 복구 초안을 읽지 못했습니다.';}}
 queueDraft(){clearTimeout(this.draftTimer);this.draftTimer=setTimeout(()=>{this.persistDraft();this.refresh(false);},300);}
 persistDraft(){
  if(!this.draft||this.readOnly)return;
  try{const store=this.options.getDraftStore?.();if(!store)return;if(this.dirty){store.write(this.base,this.draft,this.pending);this.localError='';}else if(!this.recovery)store.remove(this.base.id);}catch{this.localError='브라우저 초안 보관에 실패했습니다. JSON 백업을 사용해 주세요.';}
 }
 clearRecovery(){try{this.options.getDraftStore?.()?.remove(this.base.id);this.recovery=null;}catch{this.localError='복구 초안을 삭제하지 못했습니다.';}}
 snapshot(){const p=clone(this.draft);if(this.pending.size)p._wbsPendingCells=[...this.pending.values()];return p;}
 visible({includeCollapsed=false}={}){const q=this.query.toLowerCase(),h=hierarchy(this.draft);return ordered(this.draft).filter(t=>(!this.owner||t.owner===this.owner)&&(!q||[t.name,t.phase,t.memo].some(v=>(v||'').toLowerCase().includes(q)))&&((includeCollapsed||q||this.owner)||!h.get(t.id).ancestors.some(id=>this.collapsed.has(id))));}
 value(task,field){if(field==='hours')return taskHours(task);return task[field]||'';}
 pendingProject(){const p=clone(this.draft);for(const cell of this.pending.values()){const task=p.tasks.find(t=>t.id===cell.id);if(task)setCell(p,task,cell.field,cell.value);}return p;}
 changed(p,{paint=true,focus=null}={}){
  if(this.readOnly||this.saving)throw Error('현재는 WBS를 편집할 수 없습니다.');
  checkDraft(p);
  if(!equal(p,this.draft)){this.undoStack.push(clone(this.draft));if(this.undoStack.length>20)this.undoStack.shift();this.redoStack=[];this.draft=p;}
  this.changedFlag=!equal(this.draft,this.base);this.error='';this.selected=new Set([...this.selected].filter(id=>p.tasks.some(t=>t.id===id)));
  this.persistDraft();if(paint)this.repaint(focus);else this.refresh();this.options.onStatus?.();
 }
 commitAll(){
  if(!this.pending.size)return;
  const p=this.pendingProject();if(this.cascade)alignSuccessors(p,[...this.pending.values()].map(c=>c.id));checkDraft(p);
  this.pending.clear();this.changed(p,{paint:false});
 }
 commitCell(el){
  const id=el.dataset.row,field=el.dataset.cell,key=id+'|'+field;if(!this.pending.has(key))return true;
  try{const p=editCell(this.draft,id,field,el.value,{cascade:this.cascade});this.pending.delete(key);this.changed(p,{paint:false});el.removeAttribute('aria-invalid');return true;}
  catch(error){this.error=error.message;el.setAttribute('aria-invalid','true');this.refresh();return false;}
 }
 markup(project,at){this.ensure(project,at);return '<div id="wbsWorkspace" tabindex="-1">'+this.inner()+'</div>';}
 controls(){return (this.recovery?'<div class="wbs-recovery" role="status">이 브라우저에 '+esc(this.recovery.savedAt)+' 초안이 있습니다. '+(this.recovery.revision!==this.base._revision?'서버 버전이 변경되었습니다. 복구 후 저장하면 충돌할 수 있으므로 백업해 주세요.':'')+'<button class="button" data-wbs-action="recover">초안 복구</button><button class="button" data-wbs-action="forget">보관 초안 삭제</button></div>':'')+'<div class="wbs-toolbar"><div class="wbs-tools">'+
  '<button class="button primary" data-wbs-action="save">WBS 저장</button><button class="button" data-wbs-action="discard">변경 취소 · 새로 읽기</button><button class="button small" data-wbs-action="undo" aria-label="WBS 실행 취소">↶</button><button class="button small" data-wbs-action="redo" aria-label="WBS 다시 실행">↷</button><span class="wbs-state" role="status"></span></div>'+
  '<div class="wbs-tools"><button class="button small" data-wbs-action="add">＋ 행 추가</button><button class="button small" data-wbs-action="duplicate">선택 복제</button><button class="button small" data-wbs-action="remove">선택 삭제</button><button class="button small" data-wbs-action="up" aria-label="선택 업무 위로">↑</button><button class="button small" data-wbs-action="down" aria-label="선택 업무 아래로">↓</button><button class="button small" data-wbs-action="copy">표 복사</button></div></div>'+
  '<div class="wbs-tools"><button class="button" data-wbs-action="indent">들여쓰기 →</button><button class="button" data-wbs-action="outdent">← 내어쓰기</button><button class="button" data-wbs-action="expand">모두 펼치기</button><button class="button" data-wbs-action="collapse">모두 접기</button><button class="button" data-wbs-action="import-excel">Excel 가져오기</button><button class="button" data-wbs-action="baseline">기준 계획 저장</button><button class="button" data-wbs-action="baseline-clear">기준 계획 삭제</button></div><div class="wbs-filters"><label>업무 검색<input id="wbsQuery" type="search" value="'+esc(this.query)+'" placeholder="업무명 · 단계 · 메모"></label><label>담당자<select id="wbsOwner"><option value="">전체 인력</option>'+this.draft.members.map(m=>'<option value="'+esc(m.id)+'" '+(this.owner===m.id?'selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label><label class="wbs-cascade"><input type="checkbox" id="wbsCascade" '+(this.cascade?'checked':'')+'>일정 변경 시 후속 업무 밀기</label></div>'+
  '<p class="wbs-help">상위 행 합계는 자체 작업과 하위 작업을 포함합니다. 입력 칸은 자체 작업 값입니다. · 셀에서 바로 입력 · Tab 다음 셀 · Enter 다음 행 · Alt+↑↓ 행 이동 · Ctrl+Z / Ctrl+Y · Ctrl+S 저장. 엑셀의 여러 셀을 복사해 붙여넣을 수 있습니다.</p><p class="wbs-error" role="alert"></p><p class="wbs-warning"></p>';}
 cell(task,field,index,row){
  const pending=this.pending.get(task.id+'|'+field),value=pending?pending.value:this.value(task,field),disabled=this.readOnly?'disabled':'',common=' data-row="'+esc(task.id)+'" data-cell="'+field+'" data-index="'+index+'" aria-label="'+row+'행 '+columns[index][1]+'" '+disabled;
  if(field==='owner'||field==='predecessor'){
   const rows=field==='owner'?this.draft.members:this.draft.tasks.filter(t=>t.id!==task.id);
   return '<select'+common+'><option value="">'+(field==='owner'?'미지정':'없음')+'</option>'+rows.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===value?'selected':'')+'>'+esc(field==='predecessor'?(this.draft.tasks.indexOf(r)+1)+'. '+r.name:r.name)+'</option>').join('')+'</select>';
  }
  if(field==='memo')return '<textarea rows="1" maxlength="2000"'+common+'>'+esc(value)+'</textarea>';
  const type=['start','end'].includes(field)?'date':field==='hours'?'number':'text',locked=field==='hours'&&(task.items.length!==1||task.items[0].doneDate);
  return '<input type="'+type+'" value="'+esc(value)+'"'+common+(field==='hours'?' min="0.1" max="10000" step="0.1"':' maxlength="'+(field==='name'?200:50)+'"')+(locked?' readonly title="세부 작업이 여러 개이거나 완료 기록이 있습니다. 상세 편집에서 공수를 수정하세요."':'')+'>';
 }
 grid(){
  const visible=this.visible(),s=summary(this.draft,this.at),tree=hierarchy(this.draft);
  return '<section class="panel wbs-grid-panel"><div class="panel-head"><h2>업무 입력표 <span class="count">'+visible.length+' / '+this.draft.tasks.length+'</span></h2><span class="subtle">변경사항은 WBS 저장 후 서버에 반영됩니다</span></div><div class="wbs-grid-scroll"><table class="wbs-grid"><thead><tr><th><input type="checkbox" data-wbs-all aria-label="표시된 업무 모두 선택" '+(visible.length&&visible.every(t=>this.selected.has(t.id))?'checked':'')+'></th><th>WBS</th>'+columns.map(c=>'<th>'+c[1]+'</th>').join('')+'<th>진척</th><th>예상 완료일</th><th>상세</th></tr></thead><tbody>'+visible.map(t=>{
   const row=this.draft.tasks.indexOf(t)+1,node=tree.get(t.id),aggregate=rollup(this.draft,t.id,this.at);return '<tr data-grid-row="'+esc(t.id)+'" class="'+(this.selected.has(t.id)?'selected':'')+'"><td><input type="checkbox" data-wbs-select="'+esc(t.id)+'" aria-label="'+row+'행 선택" '+(this.selected.has(t.id)?'checked':'')+'></td><td class="wbs-number">'+esc(node.number)+(node.children.length?'<button class="button small" data-wbs-fold="'+esc(t.id)+'" aria-label="하위 업무 접기 펼치기" aria-expanded="'+!this.collapsed.has(t.id)+'">'+(this.collapsed.has(t.id)?'＋':'−')+'</button><small class="wbs-aggregate" data-rollup="'+esc(t.id)+'">합계 '+aggregate.hours.toFixed(1)+'h · '+Math.round(aggregate.progress*100)+'%<br>'+aggregate.start+' ~ '+aggregate.end+'</small>':'')+'</td>'+columns.map(([field],i)=>'<td>'+this.cell(t,field,i,row)+'</td>').join('')+'<td data-progress="'+esc(t.id)+'">'+Math.round(progress(t,this.at)*100)+'%</td><td data-row-forecast="'+esc(t.id)+'">'+(s.forecast.tasks[t.id]?.end||'계산 대기')+'</td><td><button class="button small" data-wbs-detail="'+esc(t.id)+'">세부 작업</button></td></tr>';
  }).join('')+'</tbody></table></div>'+(!visible.length?'<div class="calm-state">'+(this.draft.tasks.length?'검색 조건에 맞는 업무가 없습니다.':'행 추가를 누르거나 아래 붙여넣기 영역에 엑셀 데이터를 붙여넣으세요.')+'</div>':'')+
  '<textarea class="wbs-paste" '+(this.readOnly?'disabled':'')+' aria-label="새 업무 여러 행 붙여넣기" placeholder="새 업무 붙여넣기: 업무명 → 단계 → 담당자 → 시작일 → 종료일 → 공수(h) → 선행 업무 → 메모 (탭으로 열 구분)"></textarea></section>';
 }
 chart(){
  const p=this.draft,ts=this.visible();if(!p.tasks.length)return '<div class="calm-state">업무를 입력하면 간트가 표시됩니다.</div>';
  const cp=criticalPath(p),baseDates=(p.baseline?.tasks||[]).flatMap(t=>[t.start,t.end]),s=summary(p,this.at),from=addDays([s.start,...baseDates].filter(Boolean).sort()[0],-3),to=addDays([s.end,s.forecast.end,this.at,...baseDates].filter(Boolean).sort().at(-1),5),span=daysBetween(from,to)+1,width=Math.max(680,Math.min(20000,span*this.zoom)),day=width/span,left=d=>daysBetween(from,d)*day;
  this.geometry={from,span,width,day};
  const step=Math.max(1,Math.ceil(span/Math.min(32,width/70))),ticks=[];
  for(let i=0;i<span;i+=step)ticks.push('<span style="left:'+i*day+'px">'+addDays(from,i).slice(5)+'</span>');
  const mondayOffset=-((new Date(from+'T00:00:00Z').getUTCDay()+6)%7)*day,links=ts.filter(t=>t.predecessor&&ts.some(x=>x.id===t.predecessor)).map(t=>{
   const pred=p.tasks.find(x=>x.id===t.predecessor),a=left(addDays(pred.end,1)),b=left(t.start),y1=ts.findIndex(x=>x.id===pred.id)*44+22,y2=ts.indexOf(t)*44+22,m=Math.max(a+8,b-10);
   return '<path class="'+(t.start<=pred.end?'conflict':'')+'" d="M'+a+' '+y1+' H'+m+' V'+y2+' H'+b+'" marker-end="url(#wbsArrow)"/>';
  }).join('');
  return '<div class="wbs-gantt-scroll"><div class="wbs-gantt" style="width:'+(width+220)+'px;--day:'+day+'px;--week:'+(day*7)+'px;--weekday:'+(day*5)+'px;--week-offset:'+mondayOffset+'px"><div class="wbs-gantt-head"><div class="wbs-gantt-name">업무 · 담당자</div><div class="wbs-time-scale" style="width:'+width+'px">'+ticks.join('')+'</div></div><div class="wbs-gantt-body">'+
   '<svg class="wbs-links" width="'+width+'" height="'+ts.length*44+'" style="left:220px" aria-hidden="true"><defs><marker id="wbsArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#8b9aaf"/></marker></defs>'+links+'</svg>'+
   ts.map(t=>{const start=left(t.start),size=(daysBetween(t.start,t.end)+1)*day,f=s.forecast.tasks[t.id],row=p.tasks.indexOf(t)+1;return '<div class="wbs-gantt-row"><div class="wbs-gantt-name"><strong>'+row+'. '+esc(t.name)+'</strong><small>'+esc(p.members.find(m=>m.id===t.owner)?.name||'미지정')+'</small></div><div class="wbs-time-track" style="width:'+width+'px">'+this.baselineBar(t,left,day)+(f?.start&&f?.end?'<div class="wbs-forecast" style="left:'+left(f.start)+'px;width:'+((daysBetween(f.start,f.end)+1)*day)+'px" title="예상 '+esc(f.start)+' ~ '+esc(f.end)+'"></div>':'')+'<div role="button" tabindex="'+(this.readOnly?'-1':'0')+'" aria-label="'+esc(t.name)+' 계획 일정 '+t.start+'부터 '+t.end+'" aria-disabled="'+this.readOnly+'" data-gantt-task="'+esc(t.id)+'" data-drag="move" class="wbs-plan '+(cp.ids.has(t.id)?'critical ':'')+(this.selected.has(t.id)?'selected':'')+'" style="left:'+start+'px;width:'+size+'px"><span class="wbs-resize start" data-drag="start" role="button" tabindex="'+(this.readOnly?'-1':'0')+'" aria-label="'+esc(t.name)+' 시작일 조절"></span><i style="width:'+progress(t,this.at)*100+'%"></i><span class="wbs-bar-label">'+Math.round(progress(t,this.at)*100)+'%</span><span class="wbs-resize end" data-drag="end" role="button" tabindex="'+(this.readOnly?'-1':'0')+'" aria-label="'+esc(t.name)+' 종료일 조절"></span></div>'+(this.at>=from?'<div class="wbs-report-line" style="left:'+left(this.at)+'px"></div>':'')+'</div></div>';}).join('')+'</div></div></div>';
 }
 baselineBar(task,left,day){const h=hierarchy(this.draft),a=h.get(task.id).children.length?rollup(this.draft,task.id,this.at):null;const group=a?'<div class="wbs-group-range" style="left:'+left(a.start)+'px;width:'+((daysBetween(a.start,a.end)+1)*day)+'px" title="하위 업무 포함 일정"></div>':'';const b=this.draft.baseline?.tasks.find(t=>t.id===task.id);return group+(b?'<div class="wbs-baseline" style="left:'+left(b.start)+'px;width:'+((daysBetween(b.start,b.end)+1)*day)+'px" title="기준 '+b.start+' ~ '+b.end+'"></div>':'');}
 planningPanel(){
  const warnings=scheduleWarnings(this.draft),cp=criticalPath(this.draft),diff=baselineDiff(this.draft),changed=diff.rows.filter(r=>r.added||r.start||r.end||r.hours||r.renamed||r.reparented);
  return '<section class="panel wbs-planning"><h2>일정 점검 · 기준 계획 비교</h2><p>선행 충돌 '+warnings.dependencies.length+'건 · 담당자 과부하 '+warnings.overloads.length+'구간 · 임계 업무 '+cp.ids.size+'개</p><p class="subtle">임계 경로는 근무일·선행 관계·현재 시작 제약 기준 CPM입니다. 인력 배정으로 발생하는 지연은 포함하지 않습니다. 과부하는 계획 공수를 근무일에 균등 배분한 값입니다.</p><details><summary>충돌·과부하·임계 업무 보기</summary>'+warnings.dependencies.map(t=>'<p>선행 충돌: '+esc(t.name)+'</p>').join('')+warnings.overloads.slice(0,100).map(w=>'<p>과부하: '+esc(w.name)+' · '+w.from+' ~ '+w.to+' · '+w.load.toFixed(1)+' / '+w.capacity.toFixed(1)+'h/일</p>').join('')+'<p>임계 업무: '+this.draft.tasks.filter(t=>cp.ids.has(t.id)).map(t=>esc(t.name)).join(' · ')+'</p></details>'+(this.draft.baseline?'<details><summary>기준 계획 '+esc(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(this.draft.baseline.createdAt)))+' · 변경 '+changed.length+'개 / 삭제 '+diff.removed.length+'개</summary><p>날짜 차이는 달력일, +는 지연입니다. 간트 하단 회색 선은 기준 일정입니다.</p>'+changed.map(r=>'<p>'+esc(r.name)+' · '+(r.added?'추가됨':'시작 '+r.start+'일 / 종료 '+r.end+'일 / 공수 '+r.hours.toFixed(1)+'h'+(r.renamed?' / 이름 변경':'')+(r.reparented?' / 상위 업무 변경':''))+'</p>').join('')+diff.removed.map(t=>'<p>삭제됨: '+esc(t.name)+'</p>').join('')+'</details>':'<p>기준 계획 저장을 누르면 현재 일정을 비교 기준으로 보관합니다. WBS 저장 시 서버에 반영됩니다.</p>')+'</section>';
 }
 inner(){return this.controls()+this.planningPanel()+this.grid()+'<section class="panel wbs-chart-panel"><div class="panel-head"><div><h2>간트 일정 편집</h2><p>막대 이동 · 양 끝으로 기간 조절 · 방향키로 하루 이동 (Shift: 종료일, Alt: 시작일)</p></div><label class="wbs-zoom">보기<select id="wbsZoom"><option value="24" '+(this.zoom===24?'selected':'')+'>일 단위</option><option value="10" '+(this.zoom===10?'selected':'')+'>주 단위</option><option value="4" '+(this.zoom===4?'selected':'')+'>월 단위</option></select></label></div><div class="wbs-shift"><label>선택 일정 일괄 이동 <input type="number" id="wbsShift" min="-3652" max="3652" value="1" aria-label="선택 일정 이동 일수"> 일</label><button class="button small" data-wbs-action="shift">적용</button><button class="button small" data-wbs-action="align">선행 관계에 맞추기</button><span class="wbs-drag-hint" role="status"></span></div><div class="wbs-chart-host">'+this.chart()+'</div><p class="wbs-help">빨간 테두리: 임계 업무 / 회색 선: 기준 계획 / 초록 선: 하위 포함 일정 / 실선: 계획·진척 / 점선: 예상 작업 기간 / 화살표: 선행 관계 / 주말 음영. 이동은 달력일 기준이며 근무일·휴무일 검증과 예상일 계산은 저장 전에도 반영됩니다.</p></section>';}
 repaint(focus=null){
  if(!this.root?.isConnected)return;const gridScroll=this.root.querySelector('.wbs-grid-scroll'),chartScroll=this.root.querySelector('.wbs-gantt-scroll'),scroll={grid:gridScroll?.scrollLeft||0,chart:chartScroll?.scrollLeft||0,top:gridScroll?.scrollTop||0};
  this.root.innerHTML=this.inner();this.root.querySelector('.wbs-grid-scroll').scrollLeft=scroll.grid;this.root.querySelector('.wbs-grid-scroll').scrollTop=scroll.top;const c=this.root.querySelector('.wbs-gantt-scroll');if(c)c.scrollLeft=scroll.chart;this.refresh(false);
  if(focus){let el;if(focus.gantt){el=[...this.root.querySelectorAll('[data-gantt-task]')].find(e=>e.dataset.ganttTask===focus.gantt);if(focus.mode!=='move')el=el?.querySelector('[data-drag='+focus.mode+']');}else if(focus.id)el=[...this.root.querySelectorAll('[data-cell]')].find(e=>e.dataset.row===focus.id&&e.dataset.cell===focus.field);else el=this.root.querySelector('#'+focus.filter);el?.focus();try{if(focus.pos!==undefined)el.setSelectionRange(focus.pos,focus.pos);else el?.select?.();}catch{}}
 }
 refresh(chart=true){
  if(!this.root?.isConnected)return;
  const status=this.root.querySelector('.wbs-state');status.textContent=this.readOnly?'조회 권한':this.saving?'저장 중…':this.dirty?'저장하지 않은 변경사항':'서버에 저장됨';
  this.root.querySelector('.wbs-error').textContent=this.error?this.error+(this.pending.size?' · 확인할 셀 '+this.pending.size+'개':''):'';
  const conflicts=this.draft.tasks.filter(t=>t.predecessor&&t.start<=this.draft.tasks.find(p=>p.id===t.predecessor)?.end).length;
  this.root.querySelector('.wbs-warning').textContent=this.localError||(conflicts?'계획 일정의 선행 관계 충돌 '+conflicts+'건 · 예상 일정은 선행 업무 완료 후로 계산합니다.':'');
  this.root.querySelectorAll('[data-wbs-action]').forEach(b=>{const a=b.dataset.wbsAction;b.disabled=this.saving||(this.readOnly&&!['copy','discard','expand','collapse','forget'].includes(a))||(a==='save'&&!this.dirty)||(a==='undo'&&!this.undoStack.length&&!this.pending.size)||(a==='redo'&&!this.redoStack.length);});
  this.root.querySelector('#wbsCascade').disabled=this.readOnly;
  if(chart){const host=this.root.querySelector('.wbs-chart-host'),old=host.querySelector('.wbs-gantt-scroll')?.scrollLeft||0;host.innerHTML=this.chart();const c=host.querySelector('.wbs-gantt-scroll');if(c)c.scrollLeft=old;const s=summary(this.draft,this.at);this.root.querySelectorAll('[data-row-forecast]').forEach(el=>el.textContent=s.forecast.tasks[el.dataset.rowForecast]?.end||'계산 대기');}
  this.root.querySelectorAll('[data-rollup]').forEach(el=>{const a=rollup(this.draft,el.dataset.rollup,this.at);el.textContent='합계 '+a.hours.toFixed(1)+'h · '+Math.round(a.progress*100)+'% / '+a.start+' ~ '+a.end;});
  this.root.querySelectorAll('[data-progress]').forEach(el=>el.textContent=Math.round(progress(this.draft.tasks.find(t=>t.id===el.dataset.progress),this.at)*100)+'%');
  const planning=this.root.querySelector('.wbs-planning');if(planning&&chart)planning.outerHTML=this.planningPanel();
  this.options.onStatus?.();
 }
 attach(){
  this.root=document.querySelector('#wbsWorkspace');if(!this.root)return;this.refresh(false);
  this.root.addEventListener('input',e=>{
   const el=e.target;if(el.dataset.cell){if(this.readOnly)return;const cell={id:el.dataset.row,field:el.dataset.cell,value:el.value},key=cell.id+'|'+cell.field,task=this.draft.tasks.find(t=>t.id===cell.id);if(String(this.value(task,cell.field))===el.value){this.pending.delete(key);el.removeAttribute('aria-invalid');this.error='';}else this.pending.set(key,cell);this.queueDraft();this.refresh(false);}
   if(el.id==='wbsQuery'){this.query=el.value;this.selected.clear();this.repaint({filter:'wbsQuery',pos:el.selectionStart});}
  });
  this.root.addEventListener('change',e=>{const el=e.target;if(el.dataset.cell)this.commitCell(el);if(el.dataset.wbsSelect){el.checked?this.selected.add(el.dataset.wbsSelect):this.selected.delete(el.dataset.wbsSelect);this.repaint();}if(el.hasAttribute('data-wbs-all')){for(const t of this.visible())el.checked?this.selected.add(t.id):this.selected.delete(t.id);this.repaint();}if(el.id==='wbsOwner'){this.owner=el.value;this.selected.clear();this.repaint();}if(el.id==='wbsZoom'){this.zoom=Number(el.value);this.repaint();}if(el.id==='wbsCascade')this.cascade=el.checked;});
  this.root.addEventListener('paste',e=>{
   const cell=e.target.closest('[data-cell]'),area=e.target.closest('.wbs-paste');if(!cell&&!area||this.readOnly)return;e.preventDefault();
   try{const visible=this.visible(),row=cell?visible.findIndex(t=>t.id===cell.dataset.row):visible.length,col=cell?Number(cell.dataset.index):0,p=pasteCells(this.pendingProject(),visible.map(t=>t.id),row,col,e.clipboardData.getData('text/plain'),{cascade:this.cascade});this.pending.clear();this.query='';this.owner='';this.changed(p);this.options.toast('붙여넣었습니다. 일정을 확인한 뒤 WBS 저장을 눌러 주세요.');}catch(error){this.error=error.message;this.refresh(false);}
  });
  this.root.addEventListener('keydown',e=>this.keydown(e));
  this.root.addEventListener('click',async e=>{
   const fold=e.target.closest('[data-wbs-fold]');if(fold){const id=fold.dataset.wbsFold;this.collapsed.has(id)?this.collapsed.delete(id):this.collapsed.add(id);this.repaint();return;}const detail=e.target.closest('[data-wbs-detail]');if(detail){if(this.dirty)this.options.toast('WBS 변경사항을 먼저 저장한 뒤 세부 작업을 열어 주세요.');else this.options.onDetails(detail.dataset.wbsDetail);return;}
   const action=e.target.closest('[data-wbs-action]');if(action)await this.action(action.dataset.wbsAction);
  });
  this.root.addEventListener('pointerdown',e=>this.startDrag(e));this.root.addEventListener('pointermove',e=>this.moveDrag(e));this.root.addEventListener('pointerup',e=>this.endDrag(e));this.root.addEventListener('pointercancel',()=>{this.drag=null;this.repaint();});
 }
 async action(action){
  try{
   if(action==='forget'){this.clearRecovery();this.repaint();return;}
   if(action==='recover'){
    if(this.readOnly||!this.recovery)return;
    if(this.dirty)throw Error('현재 초안을 먼저 저장하거나 취소해 주세요.');
    const saved=this.recovery,p=clone(saved.draft);p._role=this.base._role;p._revision=saved.revision;checkDraft(p);
    this.changed(p);this.pending=new Map(saved.pending.filter(c=>p.tasks.some(t=>t.id===c.id)&&columns.some(([f])=>f===c.field)&&typeof c.value==='string').map(c=>[c.id+'|'+c.field,c]));this.recovery=null;this.persistDraft();this.repaint();return;
   }
   if(action==='expand'||action==='collapse'){this.collapsed=action==='expand'?new Set():new Set(this.draft.tasks.map(t=>t.id));this.repaint();return;}
   if(action==='discard'){
    if(this.dirty){if(!confirm('WBS 변경사항을 버리고 서버의 최신 업무를 읽을까요? 필요한 내용은 먼저 백업하세요.'))return;this.clearRecovery();this.reset(this.base);this.repaint();}
    const p=await this.options.onReload(this.base.id);this.clearRecovery();this.reset(p);this.options.onRender();return;
   }
   if(action==='undo'||action==='redo'){
    if(this.readOnly)return;
    if(this.pending.size){this.pending.clear();this.error='';this.persistDraft();this.repaint();return;}
    const from=action==='undo'?this.undoStack:this.redoStack,to=action==='undo'?this.redoStack:this.undoStack;if(!from.length)return;to.push(clone(this.draft));this.draft=from.pop();this.changedFlag=!equal(this.draft,this.base);this.error='';this.persistDraft();this.repaint();return;
   }
   this.commitAll();
   if(action==='save'){
    if(!this.dirty||this.readOnly)return;this.saving=true;this.refresh(false);
    try{const p=await this.options.onSave(clone(this.draft));this.clearRecovery();this.reset(p);this.options.onRender();this.options.toast('WBS와 일정을 서버에 저장했습니다.');}
    finally{this.saving=false;this.refresh(false);}return;
   }
   if(action==='copy'){
    const tasks=this.selected.size?this.visible().filter(t=>this.selected.has(t.id)):this.visible();
    const rows=[columns.map(c=>c[1]),...tasks.map(t=>columns.map(([f])=>f==='owner'?this.draft.members.find(m=>m.id===t.owner)?.name||'':f==='predecessor'?this.draft.tasks.findIndex(x=>x.id===t.predecessor)+1||'':this.value(t,f)))];
    await navigator.clipboard.writeText(tsvText(rows));this.options.toast('표를 복사했습니다. 엑셀에 붙여넣을 수 있습니다.');return;
   }
   if(this.readOnly)return;
   if(action==='import-excel'){openExcelImport(this,this.options.readExcel);return;}
   if(action==='baseline'){if(this.draft.baseline&&!confirm('기존 기준 계획을 현재 초안으로 교체할까요?'))return;const p=clone(this.draft);p.baseline=captureBaseline(p);this.changed(p);return;}
   if(action==='baseline-clear'){if(!this.draft.baseline)return;if(!confirm('기준 계획을 삭제할까요? 저장 전에는 실행 취소할 수 있습니다.'))return;const p=clone(this.draft);delete p.baseline;this.changed(p);return;}
   if(action==='add'){const p=clone(this.draft),t=newTask(p);p.tasks.push(t);this.query='';this.owner='';this.changed(p,{focus:{id:t.id,field:'name'}});return;}
   const ids=[...this.selected];if(action!=='align'&&!ids.length)throw Error('먼저 업무 행을 선택해 주세요.');
   if(action==='indent'||action==='outdent')this.changed(checkDraft(setParent(this.draft,ids,action==='indent'?1:-1)));
   if(action==='duplicate')this.changed(duplicateTasks(this.draft,ids));
   if(action==='remove'){if(!confirm('선택한 업무와 완료 기록을 삭제하고, 연결된 후속 업무의 선행 관계를 해제할까요? 저장 전에는 실행 취소할 수 있습니다.'))return;this.changed(removeTasks(this.draft,ids));}
   if(action==='up'||action==='down')this.changed(reorderTasks(this.draft,ids,action==='up'?-1:1));
   if(action==='shift')this.changed(moveSchedule(this.draft,ids,Number(this.root.querySelector('#wbsShift').value),{cascade:this.cascade}));
   if(action==='align')this.changed(checkDraft(alignSuccessors(clone(this.draft))));
  }catch(error){this.error=error.status===409?'다른 사용자가 먼저 저장했습니다. 현재 내용을 JSON 백업한 뒤 변경 취소 · 새로 읽기를 선택해 주세요.':error.message;this.refresh(false);this.options.toast(this.error);}
 }
 keydown(e){
  if(e.isComposing)return;
  if((e.ctrlKey||e.metaKey)&&['s','z','y'].includes(e.key.toLowerCase())){if(e.key.toLowerCase()==='z'&&this.pending.size)return;e.preventDefault();this.action(e.key.toLowerCase()==='s'?'save':e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');return;}
  if(e.key==='Escape'&&this.drag){this.drag=null;this.repaint();return;}
  const bar=e.target.closest('[data-gantt-task]');
  if(bar&&['ArrowLeft','ArrowRight'].includes(e.key)&&!this.readOnly){e.preventDefault();try{this.commitAll();const mode=e.target.dataset.drag==='start'||e.altKey?'start':e.target.dataset.drag==='end'||e.shiftKey?'end':'move';this.changed(moveSchedule(this.draft,[bar.dataset.ganttTask],e.key==='ArrowLeft'?-1:1,{mode,cascade:this.cascade}),{focus:{gantt:bar.dataset.ganttTask,mode}});}catch(error){this.error=error.message;this.refresh(false);}return;}
  const cell=e.target.closest('[data-cell]');if(!cell||this.readOnly)return;
  if(e.key==='Escape'){this.pending.delete(cell.dataset.row+'|'+cell.dataset.cell);this.error='';this.repaint({id:cell.dataset.row,field:cell.dataset.cell});return;}
  if(!['Tab','Enter'].includes(e.key)&&!(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)))return;
  e.preventDefault();if(!this.commitCell(cell))return;
  let tasks=this.visible(),r=tasks.findIndex(t=>t.id===cell.dataset.row),c=Number(cell.dataset.index),direction=e.shiftKey||e.key==='ArrowUp'?-1:1;
  if(e.key==='Tab'){c+=direction;if(c<0){c=columns.length-1;r--;}if(c>=columns.length){c=0;r++;}}else r+=direction;
  if(r>=tasks.length&&direction>0){const p=clone(this.draft),t=newTask(p);p.tasks.push(t);try{this.query='';this.owner='';this.changed(p,{paint:false});tasks=this.visible();r=tasks.length-1;}catch(error){this.error=error.message;this.refresh(false);return;}}
  r=Math.max(0,Math.min(tasks.length-1,r));if(tasks[r])this.repaint({id:tasks[r].id,field:columns[c][0]});
 }
 startDrag(e){
  const original=e.target.closest('[data-gantt-task]');if(!original||this.readOnly||e.button!==0)return;
  e.preventDefault();const id=original.dataset.ganttTask,mode=e.target.closest('[data-drag]')?.dataset.drag||'move';
  try{this.commitAll();}catch(error){this.error=error.message;this.refresh(false);return;}
  const ids=mode==='move'&&this.selected.has(id)?[...this.selected]:[id],task=this.draft.tasks.find(t=>t.id===id);
  this.root.focus();this.root.setPointerCapture(e.pointerId);this.drag={id,ids,mode,x:e.clientX,delta:0,geometry:{...this.geometry},task:clone(task),pointer:e.pointerId};
 }
 moveDrag(e){
  const d=this.drag;if(!d)return;let delta=Math.max(-3652,Math.min(3652,Math.round((e.clientX-d.x)/d.geometry.day)));const length=daysBetween(d.task.start,d.task.end);
  if(d.mode==='start')delta=Math.min(delta,length);if(d.mode==='end')delta=Math.max(delta,-length);d.delta=delta;
  for(const bar of this.root.querySelectorAll('[data-gantt-task]'))if(d.ids.includes(bar.dataset.ganttTask)){
   const t=this.draft.tasks.find(t=>t.id===bar.dataset.ganttTask),start=daysBetween(d.geometry.from,t.start)*d.geometry.day,width=(daysBetween(t.start,t.end)+1)*d.geometry.day;
   bar.style.left=(start+(d.mode!=='end'?delta*d.geometry.day:0))+'px';bar.style.width=(width+(d.mode==='end'?delta*d.geometry.day:d.mode==='start'?-delta*d.geometry.day:0))+'px';
  }
  this.root.querySelector('.wbs-drag-hint').textContent=addDays(d.task.start,d.mode==='end'?0:delta)+' → '+addDays(d.task.end,d.mode==='start'?0:delta)+' · '+d.ids.length+'개 업무';
 }
 endDrag(e){const d=this.drag;if(!d)return;this.drag=null;try{this.root.releasePointerCapture(e.pointerId);const focus={gantt:d.id,mode:d.mode};if(d.delta)this.changed(moveSchedule(this.draft,d.ids,d.delta,{mode:d.mode,cascade:this.cascade}),{focus});else this.repaint(focus);}catch(error){this.error=error.message;this.repaint();}}
}
