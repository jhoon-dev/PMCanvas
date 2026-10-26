import {AdminMfa,totp} from '../server/admin-mfa.mjs';
import {MailSettings} from '../server/mail-settings.mjs';
import {captureBaseline,setParent} from '../public/planning.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool,migrate,PgRepository} from '../server/postgres.mjs';
import {cleanProject} from '../server/project.mjs';
import {hashPassword,token,digest} from '../server/security.mjs';
import {pasteCells,duplicateTasks,reorderTasks,moveSchedule} from '../public/wbs-model.js';

test('실제 PostgreSQL: WBS 일괄 입력·복제·행 이동·간트 일정 저장과 완료 기록 보존',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');
 const pool=await createPool(),repo=new PgRepository(pool),projectId=randomUUID();let user;
 try{
  await migrate(pool);user=await repo.createUser({email:randomUUID()+'@example.com',name:'WBS 검증',passwordHash:'not-used'});
  const p=cleanProject({name:'표 편집 검증',holidays:[],members:[{id:'m',name:'개발자',role:'개발',grade:'중급',hours:8,allocation:100}],tasks:[{id:'t',name:'완료 업무',phase:'기획',owner:'m',start:'2026-10-19',end:'2026-10-23',predecessor:'',memo:'',items:[{id:'i',title:'완료 기록 유지',hours:8,doneDate:'2026-10-23'}]}]});
  let saved=await repo.createProject(user.id,projectId,p);
  let edited=pasteCells(saved,['t'],1,0,'설계\t설계\t개발자\t2026-10-26\t2026-10-28\t12\t1\t메모\n개발\t개발\t개발자\t2026-10-29\t2026-11-04\t24\t2\t');
  edited=duplicateTasks(edited,['t']);edited=reorderTasks(edited,[edited.tasks.at(-1).id],-1);
  saved=await repo.updateProject(user.id,projectId,cleanProject(edited),saved._revision);
  const design=edited.tasks.find(t=>t.name==='설계');edited=moveSchedule(saved,[design.id],2,{cascade:true});
  saved=await repo.updateProject(user.id,projectId,cleanProject(edited),saved._revision);
  const loaded=await repo.getProject(user.id,projectId);assert.equal(loaded._revision,3);assert.deepEqual(loaded.tasks.map(t=>t.id),edited.tasks.map(t=>t.id));
  assert.equal(loaded.tasks.find(t=>t.id==='t').items[0].doneDate,'2026-10-23');assert.equal(loaded.tasks.find(t=>t.name==='완료 업무 (복사)').items[0].doneDate,null);
  assert.equal(loaded.tasks.find(t=>t.name==='설계').start,'2026-10-28');assert.equal(loaded.tasks.find(t=>t.name==='개발').start,'2026-11-02');
  assert.ok((await repo.listEvents(user.id,projectId)).some(e=>e.changes.some(c=>c.entity==='task'&&c.action==='update')));
 }finally{await pool.query('DELETE FROM pm_projects WHERE id=$1',[projectId]);if(user)await pool.query('DELETE FROM pm_users WHERE id=$1',[user.id]);await pool.end();}
});

test('실제 PostgreSQL: 외부 계정 생성·이메일 자동 연결 차단·권한·만료·세션 폐기',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');
 const pool=await createPool(),repo=new PgRepository(pool),suffix=randomUUID(),ids=[],providerKey='test:'+suffix;
 try{
  await migrate(pool);await migrate(pool);
  const passwordHash=await hashPassword('test-only-password-123');
  const admin=await repo.createUser({email:'admin-'+suffix+'@example.com',name:'관리자',passwordHash,isAdmin:true});ids.push(admin.id);
  const local=await repo.createUser({email:'local-'+suffix+'@example.com',name:'기존 사용자',passwordHash});ids.push(local.id);
  const login=async(subject,email,autoProvision=true)=>{const hash=digest(token());const user=await repo.externalSession({providerKey,subject,email,name:'외부 사용자',autoProvision,hash,csrf:token(),expires:new Date(Date.now()+60000)});return {hash,user};};
  await assert.rejects(login('local-subject',local.email),e=>e.code==='IDENTITY_UNLINKED');
  await assert.rejects(login('missing','missing-'+suffix+'@example.com',false),e=>e.code==='IDENTITY_UNLINKED');
  await assert.rejects(repo.linkIdentity(local.id,{providerKey,subject:'local-subject',email:local.email}),e=>e.status===403);
  await assert.rejects(repo.linkIdentity(admin.id,{providerKey,subject:'admin-subject',email:admin.email}),e=>e.code==='ADMIN_PROTECTED');
  await repo.linkIdentity(admin.id,{providerKey,subject:'local-subject',email:local.email});
  assert.equal((await login('local-subject',local.email)).user.id,local.id);
  await assert.rejects(repo.linkIdentity(admin.id,{providerKey,subject:'local-subject',email:local.email}),e=>e.status===409);
  const created=await login('new-subject','external-'+suffix+'@example.com');ids.push(created.user.id);
  assert.equal(created.user.localLogin,false);assert.equal(created.user.isAdmin,false);
  assert.equal((await login('new-subject','renamed-'+suffix+'@example.com')).user.id,created.user.id);
  const external=await repo.findUserByEmail(created.user.email);
  await assert.rejects(repo.createSession({hash:digest(token()),userId:external.id,csrf:token(),expires:new Date(Date.now()+60000),passwordHash:external.password_hash}),e=>e.status===401);
  await assert.rejects(repo.manageUser(admin.id,external.id,{passwordHash}),e=>e.code==='EXTERNAL_PASSWORD');
  await repo.manageUser(admin.id,external.id,{isActive:false});assert.equal(await repo.findSession(created.hash),null);
  await assert.rejects(login('new-subject',created.user.email),e=>e.code==='ACCOUNT_DISABLED');
  await repo.manageUser(admin.id,external.id,{isActive:true});const active=await login('new-subject',created.user.email);
  await repo.unlinkIdentity(admin.id,providerKey,'new-subject');assert.equal(await repo.findSession(active.hash),null);
  assert.ok((await repo.listIdentities()).some(i=>i.providerKey===providerKey&&i.subject==='local-subject'));
  const transient='flow:'+suffix;await repo.putTransient(transient,{browserHash:'correct',nonce:'nonce'});
  assert.equal(await repo.takeTransient(transient,'incorrect'),null);
  const takes=await Promise.all([repo.takeTransient(transient,'correct'),repo.takeTransient(transient,'correct')]);assert.equal(takes.filter(Boolean).length,1);
  await repo.putTransient(transient,{browserHash:'correct'},-1);assert.equal(await repo.takeTransient(transient,'correct'),null);
 }finally{await pool.query('DELETE FROM pm_auth_transient WHERE key=$1',['flow:'+suffix]);for(const id of ids.reverse())await pool.query('DELETE FROM pm_users WHERE id=$1',[id]);await pool.end();}
});
test('실제 PostgreSQL: 마이그레이션·FK·트랜잭션·동시성·권한·완료 이력',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async t=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Set PGDATABASE to a dedicated database ending in _test.');
 const pool=await createPool(),repo=new PgRepository(pool),suffix=randomUUID(),projectId=randomUUID();
 const ids=[];
 try{
  await migrate(pool);await migrate(pool);
  const user=await repo.createUser({email:'owner-'+suffix+'@example.com',name:'소유자',passwordHash:'not-used-in-this-test',isAdmin:false});ids.push(user.id);
  const other=await repo.createUser({email:'other-'+suffix+'@example.com',name:'다른 사용자',passwordHash:'not-used-in-this-test'});ids.push(other.id);
  const p=cleanProject({name:'통합 검증',description:'',holidays:['2026-10-26'],members:[{id:'m',name:'개발',grade:'중급',role:'개발',hours:8,allocation:50}],tasks:[{id:'t',name:'업무',phase:'개발',owner:'m',start:'2026-10-19',end:'2026-10-23',memo:'',items:[{id:'i',title:'세부 작업',hours:8,doneDate:null}]}]});
  const created=await repo.createProject(user.id,projectId,p);assert.equal(created._revision,1);
  const loaded=await repo.getProject(user.id,projectId);assert.equal(loaded.tasks[0].start,'2026-10-19');assert.equal(loaded.members[0].allocation,50);assert.equal(loaded.tasks[0].items[0].doneDate,null);
  await assert.rejects(repo.getProject(other.id,projectId),e=>e.status===404);
  await repo.grantAccess(user.id,projectId,other.email,'viewer');
  await assert.rejects(repo.updateProject(other.id,projectId,p,1),e=>e.status===403);
  await repo.grantAccess(user.id,projectId,other.email,'editor');
  const a=structuredClone(p),b=structuredClone(p);a.name='A';b.name='B';
  const competing=await Promise.allSettled([repo.updateProject(user.id,projectId,a,1),repo.updateProject(other.id,projectId,b,1)]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);assert.equal(competing.find(x=>x.status==='rejected').reason.status,409);
  const current=await repo.getProject(user.id,projectId),invalid=cleanProject(current);invalid.tasks[0].owner='missing-member';
  await assert.rejects(repo.updateProject(user.id,projectId,invalid,current._revision),e=>e.code==='23503');
  const unchanged=await repo.getProject(user.id,projectId);assert.equal(unchanged._revision,current._revision);assert.equal(unchanged.tasks[0].owner,'m');
  const done=cleanProject(unchanged);done.tasks[0].items[0].doneDate='2026-10-23';
  const saved=await repo.updateProject(user.id,projectId,done,unchanged._revision);
  done.tasks[0].items[0].doneDate=null;
  await repo.updateProject(user.id,projectId,done,saved._revision);
  const events=await repo.listEvents(user.id,projectId);
  assert.ok(events.some(e=>e.changes.some(c=>c.before?.doneDate==='2026-10-23'&&c.after?.doneDate===null)));
  await repo.revokeAccess(user.id,projectId,other.id);
  await assert.rejects(repo.getProject(other.id,projectId),e=>e.status===404);
 }finally{
  await pool.query('DELETE FROM pm_projects WHERE id=$1',[projectId]);
  for(const id of ids)await pool.query('DELETE FROM pm_users WHERE id=$1',[id]);
  await pool.end();
 }
});

test('실제 PostgreSQL: 계정 마이그레이션·세션 폐기·비활성화·로그인 경합',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');
 const pool=await createPool(),repo=new PgRepository(pool),suffix=randomUUID(),ids=[];
 try{
  await migrate(pool);await migrate(pool);
  const hash=await hashPassword('original-password-123'),next=await hashPassword('updated-password-123');
  const admin=await repo.createUser({email:'admin-'+suffix+'@example.com',name:'관리자',passwordHash:hash,isAdmin:true});ids.push(admin.id);
  const user=await repo.createUser({email:'member-'+suffix+'@example.com',name:'사용자',passwordHash:hash});ids.push(user.id);
  assert.equal(user.isActive,true);
  const login=async(passwordHash=hash)=>{const value=digest(token());await repo.createSession({hash:value,userId:user.id,csrf:token(),expires:new Date(Date.now()+60000),passwordHash});return value;};
  const first=await login(),second=await login();
  await repo.changePassword(user.id,hash,next);
  assert.equal(await repo.findSession(first),null);assert.equal(await repo.findSession(second),null);
  await assert.rejects(login(),e=>e.status===401);
  await assert.rejects(repo.changePassword(user.id,hash,next),e=>e.status===409);
  const third=await login(next);
  assert.equal((await repo.manageUser(admin.id,user.id,{isActive:false})).isActive,false);
  assert.equal(await repo.findSession(third),null);await assert.rejects(login(next),e=>e.status===401);
  await assert.rejects(repo.manageUser(user.id,admin.id,{isActive:false}),e=>e.status===403);
  await assert.rejects(repo.manageUser(admin.id,admin.id,{isActive:false}),e=>e.status===403);
  await repo.manageUser(admin.id,user.id,{isActive:true});
  const fourth=await login(next);assert.ok(await repo.findSession(fourth));
  await repo.manageUser(admin.id,user.id,{passwordHash:hash});assert.equal(await repo.findSession(fourth),null);
  await assert.rejects(login(next),e=>e.status===401);assert.ok(await repo.findSession(await login()));
 }finally{for(const id of ids.reverse())await pool.query('DELETE FROM pm_users WHERE id=$1',[id]);await pool.end();}
});

test('실제 PostgreSQL: 계층·기준 계획 저장/재조회·수정 응답·이력 유지',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');
 const pool=await createPool(),repo=new PgRepository(pool),id=randomUUID();let user;
 try{
  await migrate(pool);user=await repo.createUser({email:randomUUID()+'@example.com',name:'계획 검증',passwordHash:'not-used'});
  let p=cleanProject({name:'계층',description:'',holidays:[],members:[],tasks:['a','b'].map(id=>({id,name:id,phase:'',owner:'',start:'2026-10-26',end:'2026-10-27',predecessor:'',memo:'',items:[{id:'i'+id,title:id,hours:8,doneDate:null}]}))});
  p=setParent(p,['b'],1);p.baseline=captureBaseline(p);let saved=await repo.createProject(user.id,id,cleanProject(p));assert.equal(saved.tasks[1].parentId,'a');assert.deepEqual(saved.baseline,p.baseline);
  saved.tasks[1].end='2026-10-28';saved=await repo.updateProject(user.id,id,cleanProject(saved),saved._revision);assert.equal(saved.tasks[1].parentId,'a');assert.equal(saved.baseline.tasks[1].end,'2026-10-27');
  let loaded=await repo.getProject(user.id,id);assert.deepEqual(loaded.baseline,p.baseline);assert.equal(loaded.tasks[1].parentId,'a');
  delete loaded.baseline;delete loaded.tasks[1].parentId;loaded=await repo.updateProject(user.id,id,cleanProject(loaded),loaded._revision);assert.equal(loaded.baseline,undefined);assert.equal(loaded.tasks[1].parentId,undefined);
  assert.ok((await repo.listEvents(user.id,id)).some(e=>e.changes.some(c=>c.entity==='project'&&c.after?.baseline===null)));
 }finally{await pool.query('DELETE FROM pm_projects WHERE id=$1',[id]);if(user)await pool.query('DELETE FROM pm_users WHERE id=$1',[user.id]);await pool.end();}
});

test('실제 PostgreSQL: 공유 시도 제한·MFA 원자 처리·복구 코드·감사 로그',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');const pool=await createPool(),repo=new PgRepository(pool),other=new PgRepository(pool),key=randomUUID();let user;
 try{
  await migrate(pool);const attempts=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?repo:other).reserveAttempt(key,8,60000)));assert.equal(attempts.filter(r=>r.status==='fulfilled').length,8);assert.equal(attempts.filter(r=>r.status==='rejected').length,4);
  user=await repo.createUser({email:randomUUID()+'@example.com',name:'MFA 통합 검증',passwordHash:'fixture-hash',isAdmin:true});const stored=await repo.findUserByEmail(user.email),mfa=new AdminMfa(repo,Buffer.alloc(32,4)),challenge=await mfa.begin(stored,null),otp=totp(challenge.secret);
  const result=await mfa.finish(challenge.challenge,otp);assert.equal(result.recoveryCodes.length,10);await assert.rejects(mfa.finish(challenge.challenge,otp));
  const next=await mfa.begin(stored,null);const recoveries=await Promise.allSettled([mfa.finish(next.challenge,result.recoveryCodes[0]),mfa.finish(next.challenge,result.recoveryCodes[0])]);assert.equal(recoveries.filter(r=>r.status==='fulfilled').length,1);assert.equal((await repo.getMfa(user.id)).recovery_hashes.length,9);
  await repo.securityEvent({actorId:user.id,kind:'test.security.audit',details:{action:'verified'}});assert.ok((await repo.securityEvents()).some(e=>e.actorId===user.id&&e.kind==='test.security.audit'));
 }finally{await pool.query('DELETE FROM pm_auth_attempts WHERE key=$1',[key]);if(user){await pool.query('DELETE FROM pm_security_events WHERE actor_id=$1',[user.id]);await pool.query('DELETE FROM pm_auth_transient WHERE value->>\'userId\'=$1',[user.id]);await pool.query('DELETE FROM pm_users WHERE id=$1',[user.id]);}await pool.end();}
});

test('실제 PostgreSQL: 가입 신청 중복 원자성·대기 상태 제약·승인 전 세션 금지와 관리자 승인',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');
 const pool=await createPool(),repo=new PgRepository(pool),suffix=randomUUID(),ids=[];
 try{
  await migrate(pool);await migrate(pool);
  const admin=await repo.createUser({email:'admin-'+suffix+'@example.com',name:'관리자',passwordHash:'test-hash',isAdmin:true});ids.push(admin.id);assert.equal(admin.registrationPending,false);
  const email='pending-'+suffix+'@example.com';
  const results=await Promise.allSettled([0,1].map(()=>repo.createUser({email,name:'가입 신청',passwordHash:'test-hash',registrationPending:true})));
  for(const result of results)if(result.status==='fulfilled')ids.push(result.value.id);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'EMAIL_EXISTS');
  const pending=await repo.findUserByEmail(email);assert.equal(pending.registration_pending,true);assert.equal(pending.is_active,false);assert.equal(pending.is_admin,false);
  assert.equal((await repo.listUsers()).find(u=>u.id===pending.id).registrationPending,true);
  await assert.rejects(pool.query('UPDATE pm_users SET is_active=true WHERE id=$1',[pending.id]),e=>e.code==='23514');
  const session={hash:digest(token()),userId:pending.id,csrf:token(),expires:new Date(Date.now()+60000),passwordHash:'test-hash'};
  await assert.rejects(repo.createSession(session),e=>e.status===401);
  await assert.rejects(repo.manageUser(pending.id,pending.id,{isActive:true}),e=>e.status===403);
  const approved=await repo.manageUser(admin.id,pending.id,{isActive:true});assert.equal(approved.registrationPending,false);assert.equal(approved.isActive,true);
  await repo.createSession(session);assert.equal((await repo.findSession(session.hash)).user.id,pending.id);
  assert.deepEqual(await repo.listProjects(pending.id),[]);
  await repo.manageUser(admin.id,pending.id,{isActive:false});assert.equal(await repo.findSession(session.hash),null);assert.equal((await repo.findUserByEmail(email)).registration_pending,false);
 }finally{for(const id of ids.reverse())await pool.query('DELETE FROM pm_users WHERE id=$1',[id]);await pool.end();}
});

test('실제 PostgreSQL: 재설정 링크 교체·동시 소비·세션 폐기·비밀번호 변경·비활성화 경합',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');
 const pool=await createPool(),repo=new PgRepository(pool),other=new PgRepository(pool),ids=[];
 try{
  await migrate(pool);await migrate(pool);const suffix=randomUUID(),admin=await repo.createUser({email:'reset-admin-'+suffix+'@example.com',name:'관리자',passwordHash:'original-hash',isAdmin:true}),user=await repo.createUser({email:'reset-user-'+suffix+'@example.com',name:'사용자',passwordHash:'original-hash'});ids.push(admin.id,user.id);
  const issue=(hash,expires=new Date(Date.now()+60000),passwordHash='original-hash')=>repo.issuePasswordReset({userId:user.id,passwordHash,hash,expires});
  const first=digest(token()),current=digest(token());assert.equal(await issue(first),true);assert.equal(await issue(current),true);await assert.rejects(repo.consumePasswordReset(first,'new-hash'),e=>e.code==='RESET_INVALID');
  const session={hash:digest(token()),userId:user.id,csrf:token(),expires:new Date(Date.now()+60000),passwordHash:'original-hash'};await repo.createSession(session);
  const results=await Promise.allSettled([repo.consumePasswordReset(current,'new-hash'),other.consumePasswordReset(current,'other-new-hash')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'RESET_INVALID');assert.equal(await repo.findSession(session.hash),null);
  const stored=await repo.findUserByEmail(user.email),stale=digest(token());assert.equal(await issue(stale,new Date(Date.now()+60000),stored.password_hash),true);await repo.changePassword(user.id,stored.password_hash,'original-hash');await assert.rejects(repo.consumePasswordReset(stale,'new-hash'),e=>e.code==='RESET_INVALID');
  const expired=digest(token());await issue(expired,new Date(Date.now()-1000));await assert.rejects(repo.consumePasswordReset(expired,'new-hash'),e=>e.code==='RESET_INVALID');
  const disabled=digest(token());await issue(disabled);await repo.manageUser(admin.id,user.id,{isActive:false});await repo.manageUser(admin.id,user.id,{isActive:true});await assert.rejects(repo.consumePasswordReset(disabled,'new-hash'),e=>e.code==='RESET_INVALID');
  assert.equal(await repo.issuePasswordReset({userId:user.id,passwordHash:'wrong-snapshot',hash:digest(token()),expires:new Date(Date.now()+60000)}),false);
 }finally{for(const id of ids.reverse())await pool.query('DELETE FROM pm_users WHERE id=$1',[id]);await pool.end();}
});

test('실제 PostgreSQL: 관리자 SMTP 암호화·재시작 복구·권한·동시 설정 저장 충돌',{skip:process.env.RUN_POSTGRES_TESTS!=='1'},async()=>{
 if(!/_test$/.test(process.env.PGDATABASE||''))throw Error('Use a dedicated _test database.');
 const pool=await createPool(),repo=new PgRepository(pool),ids=[];
 try{
  await migrate(pool);await migrate(pool);const suffix=randomUUID(),admin=await repo.createUser({email:'smtp-admin-'+suffix+'@example.com',name:'관리자',passwordHash:'fixture',isAdmin:true}),user=await repo.createUser({email:'smtp-user-'+suffix+'@example.com',name:'일반 사용자',passwordHash:'fixture'});ids.push(admin.id,user.id);
  const key=Buffer.alloc(32,23),service=new MailSettings({repo,key}),body={revision:0,enabled:true,host:'smtp.example.com',port:587,secure:false,from:'sender@example.com',authEnabled:true,username:'fixture',password:'test-only-smtp-secret'};
  await assert.rejects(service.save(user.id,body),e=>e.status===403);await service.save(admin.id,body);const row=await repo.getMailSettings();assert.equal(row.revision,1);assert.equal(JSON.stringify(row).includes(body.password),false);
  let restoredPassword;const restarted=new MailSettings({repo:new PgRepository(pool),key,makeMailer:config=>({sendTest:async()=>{restoredPassword=config.transport.auth.pass;},close(){}})});await restarted.test('recipient@example.com');assert.equal(restoredPassword,body.password);assert.equal((await restarted.public()).hasPassword,true);
  const attempts=await Promise.allSettled([service.save(admin.id,{...body,password:'',revision:1}),restarted.save(admin.id,{...body,password:'',revision:1})]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'MAIL_CONFLICT');assert.equal((await service.public()).revision,2);
 }finally{await pool.query('DELETE FROM pm_mail_settings WHERE id=true');for(const id of ids.reverse())await pool.query('DELETE FROM pm_users WHERE id=$1',[id]);await pool.end();}
});
