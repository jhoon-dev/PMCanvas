import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MailSettings} from '../server/mail-settings.mjs';
import {MemoryRepository} from './support/memory-repository.mjs';
const key=Buffer.alloc(32,17),input={revision:0,enabled:true,host:'smtp.example.com',port:587,secure:false,from:'sender@example.com',authEnabled:true,username:'smtp-user',password:'test-only-secret'};
function fixture(makeMailer){const admin=randomUUID(),other=randomUUID(),repo=new MemoryRepository([{id:admin,email:'admin@example.com',is_admin:true},{id:other,email:'other@example.com',is_admin:false}]);return {repo,admin,other,service:new MailSettings({repo,key,makeMailer})};}
test('관리자 메일 설정: 암호화·비밀번호 유지·계정 변경 보호·동시 수정 충돌·인증 정보 삭제',async()=>{
 const f=fixture();assert.equal((await f.service.public()).enabled,false);
 await assert.rejects(f.service.save(f.other,input),e=>e.status===403);
 let saved=await f.service.save(f.admin,input);assert.equal(saved.hasPassword,true);assert.equal(saved.revision,1);assert.equal('password' in saved,false);assert.equal('password_encrypted' in saved,false);assert.equal(JSON.stringify(f.repo.mailSettings).includes(input.password),false);
 saved=await f.service.save(f.admin,{...input,password:'',revision:1});assert.equal(saved.hasPassword,true);
 await assert.rejects(f.service.save(f.admin,{...input,host:'different.example.com',password:'',revision:2}),e=>e.code==='MAIL_CONFIG');
 const attempts=await Promise.allSettled([0,1].map(()=>f.service.save(f.admin,{...input,password:'',revision:2})));assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'MAIL_CONFLICT');
 saved=await f.service.save(f.admin,{...input,password:'',revision:3,authEnabled:false});assert.equal(saved.hasPassword,false);assert.equal(saved.username,'');assert.equal(f.repo.mailSettings.password_encrypted,null);
});
test('메일 설정: 저장 즉시 다른 인스턴스에 반영, 재시작·기존 파일 전환·키 변조 보호',async()=>{
 const sent=[],f=fixture(config=>({sendTest:async to=>sent.push({to,host:config.transport.host,password:config.transport.auth?.pass}),sendReset:async m=>sent.push(m),close(){}}));
 await f.service.save(f.admin,input);await f.service.test('test@example.com');assert.deepEqual(sent[0],{to:'test@example.com',host:input.host,password:input.password});
 const restarted=new MailSettings({repo:f.repo,key,legacy:{config:{...input,host:'old.example.com'},password:'old-password'}});assert.equal((await restarted.public()).host,input.host);
 await restarted.save(f.admin,{...input,host:'new.example.com',password:'new-test-secret',revision:1});await f.service.test('test@example.com');assert.equal(sent[1].host,'new.example.com');assert.equal(sent[1].password,'new-test-secret');
 await assert.rejects(new MailSettings({repo:f.repo,key:Buffer.alloc(32,18)}).test('test@example.com'),e=>e.code==='MAIL_KEY');
 f.repo.mailSettings.password_encrypted='tampered';assert.equal((await f.service.public()).hasPassword,true);await assert.rejects(f.service.test('test@example.com'),e=>e.code==='MAIL_KEY');await f.service.save(f.admin,{...input,revision:2,password:'replacement-secret'});assert.equal((await f.service.public()).revision,3);
});
test('메일 테스트: 오류 비밀 미노출·고정 수신자·잘못된 설정·발송 중지와 동시 발송 제한',async()=>{
 const f=fixture(()=>({sendTest:async()=>{throw Object.assign(Error('server echoed test-only-secret'),{code:'EAUTH'});},close(){}}));await f.service.save(f.admin,input);
 await assert.rejects(f.service.test('test@example.com'),e=>e.code==='MAIL_TEST_FAILED'&&!e.message.includes(input.password)&&e.message.includes('인증'));
 await assert.rejects(f.service.test('one,two@example.com'),e=>e.status===400);
 for(const patch of [{host:'http://bad'},{port:0},{secure:'false'},{from:'x@example.com\r\nBcc:y@example.com'}])await assert.rejects(f.service.save(f.admin,{...input,revision:1,...patch}),e=>e.status===400);
 await f.service.save(f.admin,{...input,revision:1,password:'',enabled:false});await assert.rejects(f.service.test('test@example.com'),e=>e.code==='MAIL_DISABLED');
 let release;const wait=new Promise(resolve=>release=resolve),limited=fixture(()=>({sendTest:()=>wait,close(){}}));await limited.service.save(limited.admin,input);
 const jobs=[limited.service.test('test@example.com'),limited.service.test('test@example.com')];await assert.rejects(limited.service.test('test@example.com'),e=>e.code==='MAIL_BUSY');release();await Promise.all(jobs);
});
