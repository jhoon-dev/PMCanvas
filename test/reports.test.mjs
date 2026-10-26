import test from 'node:test';
import assert from 'node:assert/strict';
import {csvText,wbsRows,completionRecords,completionRows} from '../public/reports.js';
import {forecast} from '../public/engine.js';
const makeProject=()=>({name:'테스트, 프로젝트',holidays:[],members:[{id:'a',name:'김PM',grade:'고급',role:'PM',hours:8,allocation:100},{id:'b',name:'이개발',grade:'중급',role:'개발',hours:8,allocation:50}],tasks:[
 {id:'t1',name:'요구사항',phase:'기획',owner:'a',start:'2026-10-19',end:'2026-10-23',items:[{id:'i1',title:'인터뷰',hours:8,doneDate:'2026-10-19'},{id:'i2',title:'검토',hours:2,doneDate:null}]},
 {id:'t2',name:'개발',phase:'개발',owner:'b',start:'2026-10-20',end:'2026-10-23',predecessor:'t1',items:[{id:'i3',title:'API',hours:8,doneDate:'2026-10-21'},{id:'i4',title:'테스트',hours:8,doneDate:'2026-10-23'}]}
]});
test('CSV의 한글 BOM, 쉼표·따옴표·줄바꿈 보존',()=>{
 assert.equal(csvText([['업무','메모'],['A,B','그가 "확인"\n완료']]),'\uFEFF"업무","메모"\r\n"A,B","그가 ""확인""\n완료"\r\n');
});
test('사용자가 입력한 Excel 수식과 선행 공백·탭을 텍스트 처리',()=>{
 const output=csvText([['=1+1',' +2','@SUM(A1)','-10','\t=1',8,'2026-10-21']]);
 assert.equal(output,'\uFEFF"\'=1+1","\' +2","\'@SUM(A1)","\'-10","\'\t=1","8","2026-10-21"\r\n');
});
test('WBS 출력은 보고일의 가중 진척과 전체 프로젝트에서 계산한 예상일 사용',()=>{
 const p=makeProject(),f=forecast(p,'2026-10-21'),rows=wbsRows(p,'2026-10-21',f,[p.tasks[1]]);
 assert.equal(rows.length,2);assert.equal(rows[1][2],'02');assert.equal(rows[1][12],50);assert.equal(rows[1][14],f.tasks.t2.end);assert.equal(rows[1][17],'요구사항');assert.equal(rows[1][13],'진행 중');
 assert.equal(wbsRows(p,'2026-10-21',f)[1][12],80);
 assert.ok(rows.every(row=>row.length===rows[0].length));
});
test('기간 양끝 포함, 담당자 필터, 최신순 및 미래 완료 배제',()=>{
 const p=makeProject(),query={from:'2026-10-19',to:'2026-10-21'};
 const records=completionRecords(p,query);
 assert.deepEqual(records.map(r=>r.date),['2026-10-21','2026-10-19']);
 assert.equal(records.reduce((sum,r)=>sum+r.hours,0),16);
 assert.deepEqual(completionRecords(p,{...query,owner:'b'}).map(r=>r.title),['API']);
 assert.equal(completionRecords(p,{from:'2026-10-21',to:'2026-10-21'}).length,1);
});
test('체크 취소 반영 및 원본 데이터 보존',()=>{
 const p=makeProject(),snapshot=JSON.stringify(p),query={from:'2026-10-19',to:'2026-10-23'};
 const records=completionRecords(p,query);assert.equal(JSON.stringify(p),snapshot);
 p.tasks[0].items[0].doneDate=null;
 assert.equal(completionRecords(p,query).length,2);assert.equal(records.length,3);
});
test('빈 결과·미지정 담당자·잘못된 날짜 처리',()=>{
 const p=makeProject();assert.throws(()=>completionRecords(p,{from:'2026-02-30',to:'2026-10-23'}));
 assert.throws(()=>completionRecords(p,{from:'2026-10-24',to:'2026-10-23'}));
 assert.equal(completionRows(p,[]).length,1);
 p.tasks[0].owner='';assert.equal(completionRecords(p,{from:'2026-10-19',to:'2026-10-19'})[0].owner,'미지정');
});

