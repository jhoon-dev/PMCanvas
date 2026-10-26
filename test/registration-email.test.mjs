import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RegistrationEmail} from '../server/registration.mjs';
import {createMailer} from '../server/mailer.mjs';
import {digest,hashPassword,verifyPassword} from '../server/security.mjs';
import {MemoryRepository} from './support/memory-repository.mjs';
const PASSWORD='verified-owner-password-123',HASH=await hashPassword(PASSWORD);
async function fixture(send={}){
 const admin=randomUUID(),repo=new MemoryRepository([{id:admin,is_admin:true,is_active:true}]);
 const u=await repo.createUser({email:'pending@example.com',name:'미인증',passwordHash:HASH,registrationPending:true}),mails=[];
 const options={repo,mailer:{sendVerification:async m=>mails.push(m),sendApproval:async m=>mails.push(m),sendReviewRequest:async()=>{},...send},origin:'https://pm.example.com',basePath:'/pmcanvas',logger:{error(){}}};
 const service=new RegistrationEmail(options);return {repo,admin,u,mails,service,options,value:()=>new URL(mails.at(-1).url).hash.slice('#verify-email='.length)};
}
test('이메일 인증: 최신 링크만 유효·해시 저장·만료·동시 사용·메일 소유자의 자격 증명 확정',async()=>{
 const f=await fixture();f.service.request(f.u.email);await f.service.idle();const first=f.value();
 assert.equal(f.repo.verifications.get(f.u.id).hash,digest(first));assert.equal(JSON.stringify([...f.repo.verifications]).includes(first),false);
 f.service.request(f.u.email);await f.service.idle();const current=f.value();assert.notEqual(first,current);
 await assert.rejects(f.service.finish(first,'본인',PASSWORD,PASSWORD),e=>e.code==='VERIFICATION_INVALID');
 const attempts=await Promise.allSettled([0,1].map(()=>f.service.finish(current,'메일 소유자','mailbox-owner-password-123','mailbox-owner-password-123')));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'VERIFICATION_INVALID');
 const stored=await f.repo.findUserByEmail(f.u.email);assert.equal(stored.name,'메일 소유자');assert.equal(await verifyPassword(PASSWORD,stored.password_hash),false);assert.equal(await verifyPassword('mailbox-owner-password-123',stored.password_hash),true);assert.equal(stored.is_active,false);assert.equal(stored.registration_pending,true);
 const expired=await fixture();expired.service.now=()=>Date.now()-31*60000;expired.service.request(expired.u.email);await expired.service.idle();await assert.rejects(expired.service.finish(expired.value(),'본인',PASSWORD,PASSWORD),e=>e.code==='VERIFICATION_INVALID');
});
test('이메일 인증: 실패한 링크 폐기·검증된 계정과 기존 관리자/외부 계정 보호',async()=>{
 const f=await fixture({sendVerification:async()=>{throw Error('test-only-secret');}});f.service.request(f.u.email);await f.service.idle();assert.equal(f.repo.verifications.size,0);assert.ok(f.repo.security.some(e=>e.kind==='account.verification.delivery_failed'));
 const protectedUser=await f.repo.createUser({email:'active@example.com',name:'기존 계정',passwordHash:HASH});
 const before=structuredClone([...f.repo.users]);f.service.request('absent@example.com');f.service.request(protectedUser.email);await f.service.idle();assert.deepEqual([...f.repo.users],before);
});
test('인증 메일 대기열 제한과 실패 후 토큰 폐기',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=await fixture({sendVerification:async()=>{await wait;throw Error('SMTP offline');}});
 for(let i=0;i<24;i++)f.service.request(f.u.email);assert.throws(()=>f.service.request(f.u.email),e=>e.code==='VERIFICATION_BUSY');release();await f.service.idle();assert.equal(f.repo.verifications.size,0);
});
test('가입 승인 알림: 승인과 원자적 보관·중복 승인 무발송·실패 재시도·재시작 후 처리',async()=>{
 let fails=true;const f=await fixture({sendApproval:async m=>{if(fails)throw Error('SMTP offline');f.mails.push(m);}});
 await assert.rejects(f.repo.manageUser(f.admin,f.u.id,{isActive:true}),e=>e.code==='EMAIL_UNVERIFIED');assert.equal(f.repo.notices.size,0);
 f.service.request(f.u.email);await f.service.idle();await f.service.finish(f.value(),'본인',PASSWORD,PASSWORD);
 await f.repo.manageUser(f.admin,f.u.id,{isActive:true});assert.equal(f.repo.notices.get(f.u.id).state,'pending');
 for(let i=0;i<3;i++){f.repo.notices.get(f.u.id).available=0;f.service.notify();await f.service.idle();}
 assert.equal(f.repo.notices.get(f.u.id).state,'failed');assert.equal((await f.repo.findUserByEmail(f.u.email)).is_active,true);
 await assert.rejects(f.repo.retryApprovalNotification(f.u.id,f.u.id),e=>e.status===403);
 await f.repo.retryApprovalNotification(f.admin,f.u.id);fails=false;
 const restarted=new RegistrationEmail(f.options);restarted.notify();await restarted.idle();assert.equal(f.repo.notices.get(f.u.id).state,'sent');assert.equal(f.mails.length,2);
 await f.repo.manageUser(f.admin,f.u.id,{isActive:true});restarted.notify();await restarted.idle();assert.equal(f.mails.length,2);
 await assert.rejects(f.repo.retryApprovalNotification(f.admin,f.u.id),e=>e.code==='NOTICE_UNAVAILABLE');
});
test('승인 알림: 만료된 작업만 회수하며 오래된 작업 결과는 새 발송 상태를 덮지 않는다',async()=>{
 const f=await fixture();const u=f.repo.users.get(f.u.id);u.email_verified_at=new Date();await f.repo.manageUser(f.admin,u.id,{isActive:true});
 const first=await f.repo.claimApprovalNotification();assert.equal(await f.repo.claimApprovalNotification(),null);
 f.repo.notices.get(u.id).available=0;const recovered=await f.repo.claimApprovalNotification();assert.notEqual(first.lease,recovered.lease);
 await f.repo.finishApprovalNotification(u.id,first.lease,true);assert.equal(f.repo.notices.get(u.id).state,'sending');
 await f.repo.finishApprovalNotification(u.id,recovered.lease,true);assert.equal(f.repo.notices.get(u.id).state,'sent');
});
test('인증 완료 후 활성 관리자에게만 승인 요청, 재사용 무발송·관리자별 재시도·승인 후 중지',async()=>{
 const requests=[],f=await fixture({sendReviewRequest:async m=>{requests.push(m);if(m.to==='admin2@example.com')throw Error('SMTP offline');}});
 Object.assign(f.repo.users.get(f.admin),{email:'admin1@example.com'});
 const second=randomUUID(),disabled=randomUUID(),ordinary=randomUUID();
 f.repo.users.set(second,{id:second,email:'admin2@example.com',is_admin:true,is_active:true});f.repo.users.set(disabled,{id:disabled,email:'disabled@example.com',is_admin:true,is_active:false});f.repo.users.set(ordinary,{id:ordinary,email:'ordinary@example.com',is_admin:false,is_active:true});
 f.service.request(f.u.email);await f.service.idle();assert.equal(requests.length,0);assert.equal(f.repo.reviewNotices.size,0);
 const value=f.value();await f.service.finish(value,'메일 소유자',PASSWORD,PASSWORD);await f.service.idle();assert.equal(f.repo.reviewNotices.size,2);assert.deepEqual(requests.map(m=>m.to).sort(),['admin1@example.com','admin2@example.com']);
 for(const m of requests){assert.equal(m.name,'메일 소유자');assert.equal(m.email,f.u.email);assert.equal(m.url,'https://pm.example.com/pmcanvas/#registration-approvals');assert.equal(JSON.stringify(m).includes(PASSWORD),false);}
 await assert.rejects(f.service.finish(value,'다시',PASSWORD,PASSWORD),e=>e.code==='VERIFICATION_INVALID');await f.service.idle();assert.equal(requests.length,2);
 const failed=f.repo.reviewNotices.get(f.u.id+'|'+second);
 for(let i=0;i<2;i++){failed.available=0;f.service.notify();await f.service.idle();}assert.equal(failed.state,'failed');assert.equal(requests.filter(m=>m.to==='admin1@example.com').length,1);
 assert.equal((await f.repo.listUsers()).find(u=>u.id===f.u.id).reviewMailStatus,'failed');
 await assert.rejects(f.repo.retryApprovalNotification(ordinary,f.u.id,'review'),e=>e.status===403);await f.repo.retryApprovalNotification(f.admin,f.u.id,'review');
 const restarted=new RegistrationEmail({...f.options,mailer:{...f.options.mailer,sendReviewRequest:async m=>requests.push(m)}});restarted.notify();await restarted.idle();assert.equal(failed.state,'sent');assert.equal(requests.filter(m=>m.to==='admin1@example.com').length,1);
 await f.repo.manageUser(f.admin,f.u.id,{isActive:true});Object.assign(failed,{state:'pending',available:0});restarted.notify();await restarted.idle();assert.equal(requests.length,5);
 await assert.rejects(f.repo.retryApprovalNotification(f.admin,f.u.id,'review'),e=>e.code==='NOTICE_UNAVAILABLE');
});
test('인증과 승인 요청 작업의 보관은 발송과 분리되며 수신자의 관리자 자격을 다시 검사',async()=>{
 const f=await fixture(),admin=f.repo.users.get(f.admin);admin.email='admin@example.com';
 const hash=digest('test-proof');await f.repo.issueEmailVerification({userId:f.u.id,passwordHash:HASH,hash,expires:new Date(Date.now()+60000)});await f.repo.consumeEmailVerification(hash,{name:'본인',passwordHash:HASH});
 assert.equal(f.repo.reviewNotices.size,1);assert.equal((await f.repo.listUsers()).find(u=>u.id===f.u.id).reviewMailStatus,'pending');
 admin.is_active=false;assert.equal(await f.repo.claimApprovalNotification(),null);admin.is_active=true;admin.is_admin=false;assert.equal(await f.repo.claimApprovalNotification(),null);admin.is_admin=true;
 const job=await f.repo.claimApprovalNotification();assert.equal(job.kind,'review');assert.equal(job.recipientId,f.admin);assert.equal(job.userId,f.u.id);await f.repo.finishApprovalNotification(job.userId,job.lease,true);assert.equal(f.repo.reviewNotices.get(f.u.id+'|'+f.admin).state,'sent');
});
test('관리자 승인 요청 템플릿은 단일 수신자·고정 제목·평문 정보만 사용',async()=>{
 const mails=[],mailer=createMailer({from:'sender@example.com',transport:{}},{createTransport:()=>({sendMail:async m=>{mails.push(m);return {accepted:['admin@example.com'],rejected:[]};}})});
 await mailer.sendReviewRequest({to:'admin@example.com',name:'본인\r\n<script>alert(1)</script>',email:'applicant@example.com',url:'https://pm.example.com/pmcanvas/#registration-approvals'});
 assert.equal(mails[0].subject,'[PM Canvas] 회원가입 승인 요청');assert.deepEqual(mails[0].to,{address:'admin@example.com'});assert.equal('html' in mails[0],false);assert.equal('attachments' in mails[0],false);assert.ok(mails[0].text.includes('신청자 이름: 본인  <script>'));assert.ok(mails[0].text.includes('관리자 계정으로 로그인'));
 await assert.rejects(mailer.sendReviewRequest({to:'one,two@example.com',name:'본인',email:'applicant@example.com',url:'x'}),e=>e.status===400);
});
