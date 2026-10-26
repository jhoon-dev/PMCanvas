import test from 'node:test';
import assert from 'node:assert/strict';
import {hierarchy,rollup,setParent,captureBaseline,baselineDiff,criticalPath,scheduleWarnings} from '../public/planning.js';
import {DraftStore} from '../public/draft-store.js';
import {WbsWorkspace} from '../public/wbs-workspace.js';
import {cleanProject} from '../server/project.mjs';
import {projectWorkbook} from '../server/excel.mjs';
import {parseWorkbook,readWorkbook} from '../server/excel-import.mjs';
import {suggestMapping,previewImport} from '../public/wbs-import.js';
import ExcelJS from 'exceljs';
const task=(id,hours=8,start='2026-10-19',end='2026-10-19')=>({id,name:id,phase:'개발',owner:'m',start,end,predecessor:'',memo:'',items:[{id:'i'+id,title:id,hours,doneDate:null}]});
const project=()=>({id:'p',name:'계획 검증',description:'',_revision:1,_role:'owner',holidays:[],members:[{id:'m',name:'개발자',hours:8,allocation:100,role:'개발',grade:'중급'}],tasks:[task('a'),task('b',16),task('c')]});
test('WBS 들여쓰기·번호·가중 집계·내어쓰기와 계층 순환 거절',()=>{
 let p=setParent(project(),['b','c'],1);assert.equal(p.tasks[1].parentId,'a');assert.equal(hierarchy(p).get('c').number,'1.2');
 p.tasks[1].items[0].doneDate='2026-10-19';const r=rollup(p,'a','2026-10-26');assert.equal(r.hours,32);assert.equal(r.progress,.5);
 assert.equal(setParent(p,['b'],-1).tasks[1].parentId,'');p.tasks[0].parentId='c';assert.throws(()=>hierarchy(p),/순환/);
});
test('서버는 상위 업무·기준 계획을 보존하고 잘못된 참조·중복 기준 ID를 거절',()=>{
 const p=setParent(project(),['b'],1);p.baseline=captureBaseline(p);const saved=cleanProject(p);assert.equal(saved.tasks[1].parentId,'a');assert.deepEqual(saved.baseline,p.baseline);
 p.tasks[1].parentId='missing';assert.throws(()=>cleanProject(p));delete p.tasks[1].parentId;p.baseline.tasks.push(p.baseline.tasks[0]);assert.throws(()=>cleanProject(p));
});
test('기준 계획 비교는 일정·공수·추가·삭제를 원본 변경 없이 계산',()=>{
 const p=project();p.baseline=captureBaseline(p);p.tasks[0].end='2026-10-20';p.tasks[0].items[0].hours=12;p.tasks.pop();p.tasks.push(task('d'));
 const diff=baselineDiff(p);assert.equal(diff.rows[0].end,1);assert.equal(diff.rows[0].hours,4);assert.equal(diff.rows[2].added,true);assert.equal(diff.removed[0].id,'c');assert.equal(p.baseline.tasks[0].end,'2026-10-19');
});
test('CPM 분기·시작 제약·휴무일과 여유일을 계산',()=>{
 const p=project();p.tasks[1].end='2026-10-21';p.tasks[2].predecessor='a';p.tasks[2].start='2026-10-20';p.tasks[2].end='2026-10-20';
 let cp=criticalPath(p);assert.deepEqual([...cp.ids],['b']);assert.equal(cp.slack.a,1);assert.equal(cp.slack.c,1);p.holidays=['2026-10-20'];cp=criticalPath(p);assert.equal(cp.duration,2);
});
test('과부하는 인력 투입률·휴무일·계획 공수와 선행 충돌을 반영',()=>{
 const p=project();p.tasks[2].predecessor='a';let w=scheduleWarnings(p);assert.equal(w.dependencies.length,1);assert.equal(w.overloads.length,1);assert.equal(w.overloads[0].load,32);
 p.members[0].allocation=50;assert.equal(scheduleWarnings(p).overloads[0].capacity,4);
 p.tasks=p.tasks.slice(0,1);p.tasks[0].end='2026-10-20';p.holidays=['2026-10-20'];assert.equal(scheduleWarnings(p).overloads[0].load,8);
});
test('초안은 계정·프로젝트별 분리, 미입력 셀과 원래 revision을 복구',async()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const a=new DraftStore('a',storage),b=new DraftStore('b',storage),p=project();const w=new WbsWorkspace({getDraftStore:()=>a,toast(){}});w.ensure(p,'2026-10-26');
 w.pending.set('a|name',{id:'a',field:'name',value:'복구할 이름'});w.persistDraft();assert.equal(b.read('p'),null);
 const fresh=new WbsWorkspace({getDraftStore:()=>a,toast(){}});fresh.ensure({...p,_revision:2},'2026-10-26');assert.ok(fresh.recovery);await fresh.action('recover');assert.equal(fresh.draft._revision,1);assert.equal(fresh.pending.get('a|name').value,'복구할 이름');assert.equal(a.read('p').revision,1);
 fresh.clearRecovery();assert.equal(a.read('p'),null);
});
test('저장 공간 실패는 메모리 초안을 보존하고 오류를 알림',()=>{
 const store=new DraftStore('u',{getItem(){return null;},setItem(){throw Error('quota');},removeItem(){}}),w=new WbsWorkspace({getDraftStore:()=>store,toast(){}});w.ensure(project(),'2026-10-26');const p=project();p.tasks[0].name='변경';w.changed(p,{paint:false});assert.equal(w.draft.tasks[0].name,'변경');assert.match(w.localError,/실패/);
});
test('XLSX 출력→읽기→ID 갱신은 계층·완료 기록을 유지, 새 행 추가도 지원',async()=>{
 const p=setParent(project(),['b'],1);p.tasks[0].items[0].doneDate='2026-10-19';const buffer=await projectWorkbook(p,'2026-10-26');const sheets=await readWorkbook(buffer.toString('base64')),sheet=sheets.find(s=>s.name==='WBS');
 const mapping=suggestMapping(sheet.rows[0]);assert.equal(mapping.id,12);assert.equal(mapping.parent,13);const result=previewImport(p,sheet.rows.slice(1),mapping,{mode:'update'});assert.deepEqual(result.errors,[]);assert.equal(result.project.tasks[1].parentId,'a');assert.equal(result.project.tasks[0].items[0].doneDate,'2026-10-19');
 const added=previewImport(p,[['새 업무','2026-10-26','2026-10-27',12]],{name:0,start:1,end:2,hours:3,owner:-1,predecessor:-1,parent:-1,id:-1,phase:-1,memo:-1});assert.deepEqual(added.errors,[]);assert.equal(added.project.tasks.length,4);
});
test('Excel 미리보기 오류는 원본을 바꾸지 않고 잘못된 ID·날짜를 표시',()=>{
 const p=project(),original=structuredClone(p),mapping={name:0,start:1,end:2,id:3};
 assert.ok(previewImport(p,[['잘못됨','2026-02-30','2026-03-03','missing']],mapping,{mode:'update'}).errors.length);assert.deepEqual(p,original);
 assert.throws(()=>previewImport(p,[],{name:-1,start:1,end:2}),/열/);
});
test('Excel 읽기는 수식·잘못된 압축·파일 크기 초과를 거절',async()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('업무');s.addRow(['업무명']);s.addRow([{formula:'1+1',result:2}]);await assert.rejects(parseWorkbook(Buffer.from(await book.xlsx.writeBuffer())),/수식/);
 await assert.rejects(readWorkbook('not a workbook'),/형식/);await assert.rejects(parseWorkbook(Buffer.alloc(4*1024*1024+1)),/4MB/);
});
