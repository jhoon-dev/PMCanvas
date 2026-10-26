import test from 'node:test';
import assert from 'node:assert/strict';
import {columns,tsvText,parseTsv,pasteCells,editCell,moveSchedule,duplicateTasks,removeTasks,reorderTasks,normalizeDate,alignSuccessors} from '../public/wbs-model.js';
import {WbsWorkspace} from '../public/wbs-workspace.js';
const fixture=()=>({id:'p',name:'WBS',description:'',holidays:[],members:[{id:'m',name:'홍길동',grade:'중급',role:'개발',hours:8,allocation:100}],tasks:[{id:'a',name:'기획',phase:'기획',owner:'m',start:'2026-10-26',end:'2026-10-28',predecessor:'',memo:'',items:[{id:'ia',title:'기획안',hours:8,doneDate:null}]},{id:'b',name:'개발',phase:'개발',owner:'m',start:'2026-10-29',end:'2026-11-02',predecessor:'a',memo:'',items:[{id:'ib',title:'구현',hours:16,doneDate:null}]}]});
test('엑셀 TSV: 따옴표·탭·여러 줄·마지막 줄바꿈 보존 및 크기 제한',()=>{
 assert.deepEqual(parseTsv('A\t"메모\n둘째줄"\t"따옴표 ""인용"""\r\nB\tC\t\r\n'),[['A','메모\n둘째줄','따옴표 "인용"'],['B','C','']]);
 assert.throws(()=>parseTsv('"unfinished'));assert.throws(()=>parseTsv('x'.repeat(1024*1024+1)));
 assert.equal(normalizeDate('2026/2/3'),'2026-02-03');assert.throws(()=>normalizeDate('2026-02-30'));
});
test('여러 행 붙여넣기는 담당자·날짜·선행 번호를 해석하고 전체를 한 번에 검증',()=>{
 const p=fixture(),text='설계\t설계\t홍길동\t2026/10/26\t2026/10/30\t12\t\t메모\n구현\t개발\t홍길동\t2026-11-02\t2026-11-06\t24\t1\t';
 const next=pasteCells(p,['a','b'],0,0,text);assert.equal(next.tasks[0].name,'설계');assert.equal(next.tasks[1].predecessor,'a');assert.equal(next.tasks[0].items[0].hours,12);assert.equal(p.tasks[0].name,'기획');
 let seq=0;const added=pasteCells(p,['a','b'],2,0,'QA\tQA\t홍길동\t2026-11-02\t2026-11-06\t8',{id:()=>`new-${seq++}`});assert.equal(added.tasks.length,3);
 assert.throws(()=>pasteCells(p,['a','b'],0,0,'잘못된 행\t기획\t없는 사람'));assert.equal(p.tasks[0].name,'기획');
 assert.throws(()=>pasteCells(p,['a','b'],0,7,'메모\t초과 열'));
});
test('셀 편집: 선행 순환·잘못된 일정·중복 담당자 이름·완료 공수 변경 거절',()=>{
 const p=fixture();assert.throws(()=>editCell(p,'a','predecessor','b'));assert.throws(()=>editCell(p,'a','end','2026-10-20'));
 p.members.push({...p.members[0],id:'m2'});assert.throws(()=>editCell(p,'a','owner','홍길동'));
 p.tasks[0].items[0].doneDate='2026-10-01';assert.throws(()=>editCell(p,'a','hours','16'));assert.equal(editCell(p,'a','hours','8').tasks[0].items[0].hours,8);
});
test('간트 이동·기간 조절·후속 업무 밀기·휴무일 반영',()=>{
 const p=fixture();p.holidays=['2026-11-02'];
 const moved=moveSchedule(p,['a'],3,{cascade:true});assert.equal(moved.tasks[0].start,'2026-10-29');assert.equal(moved.tasks[0].end,'2026-10-31');assert.equal(moved.tasks[1].start,'2026-11-03');assert.equal(moved.tasks[1].end,'2026-11-07');
 assert.equal(p.tasks[1].start,'2026-10-29');assert.equal(moveSchedule(p,['a'],1,{mode:'end'}).tasks[0].end,'2026-10-29');
 assert.throws(()=>moveSchedule(p,['a'],8,{mode:'start'}));assert.throws(()=>moveSchedule(p,['a'],1.5));
 assert.equal(alignSuccessors(structuredClone(p)).tasks[1].start,p.tasks[1].start);
});
test('복제는 새 ID·미완료 상태로 만들고, 함께 복제한 선행 관계를 유지',()=>{
 const p=fixture();p.tasks[0].items[0].doneDate='2026-10-01';let seq=0;
 const next=duplicateTasks(p,['a','b'],{id:()=>`copy-${seq++}`}),a=next.tasks[1],b=next.tasks[3];
 assert.notEqual(a.id,'a');assert.notEqual(a.items[0].id,'ia');assert.equal(a.items[0].doneDate,null);assert.equal(b.predecessor,a.id);assert.equal(p.tasks.length,2);
});
test('삭제는 후속 참조를 정리하고, 행 이동은 ID와 선행 관계를 보존',()=>{
 const p=fixture(),removed=removeTasks(p,['a']);assert.equal(removed.tasks[0].predecessor,'');
 const reordered=reorderTasks(p,['b'],-1);assert.equal(reordered.tasks[0].id,'b');assert.equal(reordered.tasks[0].predecessor,'a');
});
test('선행 업무명은 모든 붙여넣기 행이 만들어진 뒤 해석',()=>{
 const p=fixture();const n=pasteCells(p,['a','b'],0,0,'새 기획\t기획\t홍길동\t2026-10-26\t2026-10-28\t8\t\n새 개발\t개발\t홍길동\t2026-10-29\t2026-11-02\t16\t새 기획');assert.equal(n.tasks[1].predecessor,'a');
});
test('표 복사는 Excel 수식 주입을 막고 탭·여러 줄·따옴표를 보존',()=>{
 const text=tsvText([['=HYPERLINK("https://example.com")',' +1','@SUM(A1)','메모\n둘째줄','값\t탭']]),row=parseTsv(text)[0];
 assert.ok(row[0].startsWith("'="));assert.equal(row[1],"' +1");assert.equal(row[2],"'@SUM(A1)");assert.equal(row[3],'메모\n둘째줄');assert.equal(row[4],'값\t탭');
});
test('붙여넣기 머리글은 정확한 열 목록일 때만 제외하고 500행 제한을 지킴',()=>{
 const p=fixture(),header=columns.map(c=>c[1]).join('\t'),text=header+'\n테스트\t기획\t홍길동\t2026-10-26\t2026-10-28\t8\t\t';
 assert.equal(pasteCells(p,['a','b'],2,0,text).tasks.length,3);
 assert.equal(pasteCells(p,['a','b'],0,0,'업무명').tasks[0].name,'업무명');
 p.tasks=Array.from({length:500},(_,i)=>({...structuredClone(p.tasks[0]),id:'task-'+i,predecessor:'',items:[{id:'item-'+i,title:'작업',hours:8,doneDate:null}]}));
 assert.throws(()=>pasteCells(p,p.tasks.map(t=>t.id),500,0,'추가 업무'));assert.equal(p.tasks.length,500);
});
test('WBS 초안의 실행 취소·다시 실행은 원본과 분리되고 저장 시 초기화',async()=>{
 const base={...fixture(),_revision:1,_role:'editor'},w=new WbsWorkspace({toast(){},onRender(){},onSave:async p=>({...p,_revision:2})});
 w.ensure(base,'2026-10-25');w.changed(editCell(w.draft,'a','name','초안 수정'),{paint:false});assert.equal(w.dirty,true);assert.equal(base.tasks[0].name,'기획');
 await w.action('undo');assert.equal(w.dirty,false);assert.equal(w.draft.tasks[0].name,'기획');
 await w.action('redo');assert.equal(w.dirty,true);await w.action('save');assert.equal(w.dirty,false);assert.equal(w.base._revision,2);assert.equal(w.undoStack.length,0);
});
test('WBS 저장 충돌은 초안을 유지하고, 명시적 취소·조회자 권한 변경도 반영',async t=>{
 const base={...fixture(),_revision:1,_role:'editor'},w=new WbsWorkspace({toast(){},onRender(){},onSave:async()=>{throw Object.assign(Error('conflict'),{status:409});}});
 w.ensure(base,'2026-10-25');w.changed(editCell(w.draft,'a','name','보존할 초안'),{paint:false});await w.action('save');
 assert.equal(w.dirty,true);assert.equal(w.draft.tasks[0].name,'보존할 초안');assert.match(w.error,/다른 사용자/);assert.equal(w.saving,false);
 const previous=globalThis.confirm;globalThis.confirm=()=>true;t.after(()=>{if(previous===undefined)delete globalThis.confirm;else globalThis.confirm=previous;});
 w.options.onReload=async()=>{throw Object.assign(Error('프로젝트 접근이 해제되었습니다.'),{status:404});};await w.action('discard');assert.equal(w.dirty,false);assert.equal(w.draft.tasks[0].name,'기획');
 w.reset(base);w.ensure({...base,_role:'viewer'},'2026-10-25');assert.equal(w.readOnly,true);assert.throws(()=>w.changed(editCell(base,'a','name','거절'),{paint:false}));
});
