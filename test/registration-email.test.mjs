import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RegistrationEmail} from '../server/registration.mjs';
import {digest,hashPassword,verifyPassword} from '../server/security.mjs';
import {MemoryRepository} from './support/memory-repository.mjs';
const PASSWORD='verified-owner-password-123',HASH=await hashPassword(PASSWORD);
async function fixture(send={}){
 const admin=randomUUID(),repo=new MemoryRepository([{id:admin,is_admin:true,is_active:true}]);
 const u=await repo.createUser({email:'pending@example.com',name:'미인증',passwordHash:HASH,registrationPending:true}),mails=[];
 const options={repo,mailer:{sendVerification:async m=>mails.push(m),sendApproval:async m=>mails.push(m),...send},origin:'https://pm.example.com',basePath:'/pmcanvas',logger:{error(){}}};
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
