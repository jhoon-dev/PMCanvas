import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../server/http.mjs';
import {hashPassword} from '../server/security.mjs';
import {MemoryRepository} from './support/memory-repository.mjs';
const networkTest=(name,fn)=>test(name,{skip:process.env.RUN_HTTP_TESTS!=='1'},fn);
const PASSWORD='a-test-password-12345',HASH=await hashPassword(PASSWORD);
const ORIGIN='http://localhost:3000';
async function fixture(t,{basePath=''}={}){
 const users=[{id:randomUUID(),email:'owner@example.com',name:'소유자',password_hash:HASH,is_admin:true},{id:randomUUID(),email:'other@example.com',name:'팀원',password_hash:HASH,is_admin:false}];
 const repo=new MemoryRepository(users),server=createApplication({repo,origin:ORIGIN,basePath,logger:{error(){}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const base='http://127.0.0.1:'+server.address().port+basePath+'/api/';
 const client=()=>({cookie:'',csrf:''});
 async function call(c,path,{method='GET',body,headers={}}={}){
  const response=await fetch(base+path,{method,headers:{...(c.cookie?{Cookie:c.cookie}:{}),...(method==='GET'?{}:{Origin:ORIGIN,'Content-Type':'application/json','X-CSRF-Token':c.csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const cookie=response.headers.get('set-cookie');if(cookie)c.cookie=cookie.split(';')[0];
  const data=await response.json();if(data.csrf)c.csrf=data.csrf;
  return {status:response.status,data,headers:response.headers};
 }
 async function login(email){const c=client(),r=await call(c,'auth/login',{method:'POST',body:{email,password:PASSWORD}});assert.equal(r.status,200);return c;}
 return {repo,server,base,users,client,call,login};
}
const project=()=>({id:randomUUID(),name:'팀 프로젝트',description:'',holidays:[],members:[{id:'m1',name:'개발자',grade:'고급',role:'개발',hours:8,allocation:100}],tasks:[{id:'t1',name:'기능 개발',phase:'개발',owner:'m1',start:'2026-10-19',end:'2026-10-23',predecessor:'',memo:'',items:[{id:'i1',title:'기능 구현',hours:8,doneDate:null}]}]});
networkTest('로그인·쿠키·세션 만료·로그아웃',async t=>{
 const f=await fixture(t),c=f.client();
 assert.equal((await f.call(c,'projects')).status,401);
 const r=await f.call(c,'auth/login',{method:'POST',body:{email:'owner@example.com',password:PASSWORD}});
 assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Lax/);
 assert.equal(JSON.stringify(r.data).includes('scrypt'),false);assert.equal((await f.call(c,'auth/me')).data.user.isAdmin,true);
 assert.equal((await f.call(c,'auth/logout',{method:'POST',body:{}})).status,200);
 assert.equal((await f.call(c,'auth/me')).status,401);
});
networkTest('교차 출처 요청·CSRF 누락은 거절',async t=>{
 const f=await fixture(t),c=await f.login('owner@example.com');
 assert.equal((await f.call(c,'projects',{method:'POST',body:{project:project()},headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.call(c,'projects',{method:'POST',body:{project:project()},headers:{'X-CSRF-Token':'invalid'}})).status,403);
 assert.equal((await f.call(c,'projects')).data.projects.length,0);
});
networkTest('프로젝트 DB 계약: 생성·재조회·응답 유실 재시도·동시 수정 충돌',async t=>{
 const f=await fixture(t),c=await f.login('owner@example.com'),p=project();
 const created=await f.call(c,'projects',{method:'POST',body:{project:p}});assert.equal(created.status,201);
 assert.equal((await f.call(c,'projects',{method:'POST',body:{project:p}})).status,201);
 assert.equal((await f.call(c,'projects')).data.projects.length,1);
 const changed={...p,name:'변경됨'};
 const saved=await f.call(c,'projects/'+p.id,{method:'PUT',body:{project:changed,revision:1}});assert.equal(saved.status,200);assert.equal(saved.data.project._revision,2);
 const conflict=await f.call(c,'projects/'+p.id,{method:'PUT',body:{project:{...p,name:'덮어쓰기'},revision:1}});assert.equal(conflict.status,409);
 assert.equal((await f.call(c,'projects/'+p.id)).data.project.name,'변경됨');
});
networkTest('계정별 격리·조회자 쓰기 차단·편집 권한·공유 해제',async t=>{
 const f=await fixture(t),owner=await f.login('owner@example.com'),other=await f.login('other@example.com'),p=project();
 await f.call(owner,'projects',{method:'POST',body:{project:p}});
 assert.equal((await f.call(other,'projects/'+p.id)).status,404);
 assert.equal((await f.call(other,'projects')).data.projects.length,0);
 await f.call(owner,'projects/'+p.id+'/access',{method:'POST',body:{email:'other@example.com',role:'viewer'}});
 assert.equal((await f.call(other,'projects/'+p.id)).data.project._role,'viewer');
 assert.equal((await f.call(other,'projects/'+p.id,{method:'PUT',body:{project:p,revision:1}})).status,403);
 assert.equal((await f.call(other,'projects/'+p.id+'/access')).status,403);
 await f.call(owner,'projects/'+p.id+'/access',{method:'POST',body:{email:'other@example.com',role:'editor'}});
 assert.equal((await f.call(other,'projects/'+p.id,{method:'PUT',body:{project:{...p,name:'편집 가능'},revision:1}})).status,200);
 assert.equal((await f.call(owner,'projects/'+p.id+'/access/'+f.users[1].id,{method:'DELETE',body:{}})).status,200);
 assert.equal((await f.call(other,'projects/'+p.id)).status,404);
 assert.equal((await f.call(owner,'projects/'+p.id+'/access/'+f.users[0].id,{method:'DELETE',body:{}})).status,409);
});
networkTest('관리자만 계정 생성, 잘못된 데이터는 저장하지 않음',async t=>{
 const f=await fixture(t),owner=await f.login('owner@example.com'),other=await f.login('other@example.com');
 const body={email:'new@example.com',name:'신규',password:PASSWORD};
 assert.equal((await f.call(other,'users',{method:'POST',body})).status,403);
 assert.equal((await f.call(owner,'users',{method:'POST',body:{...body,password:'123'}})).status,400);
 assert.equal((await f.call(owner,'users',{method:'POST',body})).status,201);
 const p=project();p.tasks[0].items[0].hours=0;
 assert.equal((await f.call(owner,'projects',{method:'POST',body:{project:p}})).status,400);
 assert.equal((await f.call(owner,'projects')).data.projects.length,0);
});
networkTest('완료 체크·취소·삭제 전 값을 서버 이력에 보존',async t=>{
 const f=await fixture(t),owner=await f.login('owner@example.com'),p=project();
 await f.call(owner,'projects',{method:'POST',body:{project:p}});
 p.tasks[0].items[0].doneDate='2026-10-23';
 await f.call(owner,'projects/'+p.id,{method:'PUT',body:{project:p,revision:1}});
 p.tasks[0].items[0].doneDate=null;
 await f.call(owner,'projects/'+p.id,{method:'PUT',body:{project:p,revision:2}});
 p.tasks=[];
 await f.call(owner,'projects/'+p.id,{method:'PUT',body:{project:p,revision:3}});
 const events=(await f.call(owner,'projects/'+p.id+'/events')).data.events;
 assert.ok(events.some(e=>e.changes.some(c=>c.entity==='item'&&c.before?.doneDate==='2026-10-23'&&c.after?.doneDate===null)));
 assert.ok(events.some(e=>e.changes.some(c=>c.entity==='item'&&c.action==='delete'&&c.before.title==='기능 구현')));
});
networkTest('하위 경로 /pmcanvas에서 화면과 API 실행, 임의 파일은 비공개',async t=>{
 const f=await fixture(t,{basePath:'/pmcanvas'}),c=await f.login('owner@example.com');
 assert.match(c.cookie,/pmcanvas_session/);assert.equal((await f.call(c,'projects')).status,200);
 const origin=f.base.replace('/pmcanvas/api/','');
 assert.equal((await fetch(origin+'/pmcanvas/')).status,200);
 assert.equal((await fetch(origin+'/pmcanvas/api-client.js')).status,200);
 assert.equal((await fetch(origin+'/pmcanvas/server/main.mjs')).status,404);
 assert.equal((await fetch(origin+'/api/projects')).status,404);
});

networkTest('회원가입 HTTP: 세션 없는 접수·승인 전 로그인 차단·승인 후 로그인',async t=>{
 const f=await fixture(t,{basePath:'/pmcanvas'}),c=f.client(),body={name:'가입 통신 검증',email:'network@example.com',password:PASSWORD,confirmPassword:PASSWORD};
 const applied=await f.call(c,'auth/register',{method:'POST',body});assert.equal(applied.status,202);assert.equal(applied.headers.get('set-cookie'),null);
 assert.equal((await f.call(c,'auth/login',{method:'POST',body})).data.error.code,'APPROVAL_PENDING');
 const admin=await f.login('owner@example.com'),user=await f.repo.findUserByEmail(body.email);
 assert.equal((await f.call(admin,'users/'+user.id,{method:'PATCH',body:{isActive:true}})).status,200);
 const logged=await f.call(c,'auth/login',{method:'POST',body});assert.equal(logged.status,200);assert.match(logged.headers.get('set-cookie'),/HttpOnly/);assert.equal((await f.call(c,'auth/me')).data.user.email,body.email);
});
