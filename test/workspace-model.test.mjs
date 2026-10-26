import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registrationDecision,deletedTaskBundle,restoreTaskBundle,backupSettings} from '../server/workspace-model.mjs';
const task=(id,extra={})=>({id,name:id,phase:'개발',owner:'m',start:'2026-10-19',end:'2026-10-23',predecessor:'',memo:'',items:[{id:'i'+id,title:'작업',hours:8,doneDate:'2026-10-23'}],...extra});
const project=()=>({name:'복구',description:'',holidays:[],members:[{id:'m',name:'팀원',role:'개발',grade:'중급',hours:8,allocation:100}],tasks:[task('a'),task('b',{predecessor:'a'})]});
test('가입 결정은 프로젝트 중복·소유자 권한 주입·거절 시 권한 부여를 거부',()=>{
 const id=randomUUID(),grant={projectId:id,role:'editor'};assert.deepEqual(registrationDecision({decision:'approve',grants:[grant]}).grants,[grant]);
 for(const body of [{decision:'approve',grants:[grant,grant]},{decision:'approve',grants:[{...grant,role:'owner'}]},{decision:'reject',grants:[grant]},{decision:'approve',reason:'a'.repeat(501)},{decision:'other'}])assert.throws(()=>registrationDecision(body),e=>e.status===400);
 assert.equal(registrationDecision({decision:'reject',reason:' 사유 '}).reason,'사유');
});
test('휴지통은 원래 ID·완료 기록·행 순서와 연결을 복원하고 현재 편집을 보존',()=>{
 const before=project(),after=structuredClone(before);after.tasks.shift();after.tasks[0].predecessor='';const bundle=deletedTaskBundle(before,after);after.tasks[0].memo='삭제 후 변경';
 const r=restoreTaskBundle(after,bundle);assert.deepEqual(r.project.tasks.map(t=>t.id),['a','b']);assert.equal(r.project.tasks[0].items[0].doneDate,'2026-10-23');assert.equal(r.project.tasks[1].predecessor,'a');assert.equal(r.project.tasks[1].memo,'삭제 후 변경');assert.deepEqual(r.adjustments,[]);assert.equal(deletedTaskBundle(before,before),null);
 assert.throws(()=>restoreTaskBundle(before,bundle),e=>e.code==='RESTORE_CONFLICT');
});
test('담당자·상위·선행 업무가 사라졌으면 연결을 해제하고 조정 내용을 표시',()=>{
 const before=project();before.tasks[1].parentId='a';const after={...structuredClone(before),members:[],tasks:[]},bundle={tasks:[before.tasks[1]],positions:{b:1},links:[]};const r=restoreTaskBundle(after,bundle);assert.equal(r.project.tasks[0].owner,'');assert.equal(r.project.tasks[0].predecessor,'');assert.equal(r.project.tasks[0].parentId,undefined);assert.equal(r.adjustments.length,3);
});
test('백업 설정은 범위와 낙관적 잠금 버전을 엄격히 검증',()=>{
 const b={enabled:true,verifyRestore:true,hour:3,retentionDays:14,revision:0};assert.deepEqual(backupSettings(b),b);
 for(const patch of [{hour:24},{hour:1.5},{retentionDays:0},{retentionDays:366},{revision:-1},{enabled:'true'},{verifyRestore:null}])assert.throws(()=>backupSettings({...b,...patch}),e=>e.status===400);
});
