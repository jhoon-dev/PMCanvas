import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PasswordReset} from '../server/password-reset.mjs';
import {mailConfig,createMailer,loadMailer} from '../server/mailer.mjs';
import {hashPassword} from '../server/security.mjs';
import {MemoryRepository} from './support/memory-repository.mjs';
const PASSWORD='original-password-12345',HASH=await hashPassword(PASSWORD);
function fixture({now,send}={}){
 const id=randomUUID(),repo=new MemoryRepository([{id,email:'user@example.com',name:'사용자',password_hash:HASH,is_admin:true,is_active:true}]),mails=[];
 const reset=new PasswordReset({repo,mailer:{sendReset:send|| (async mail=>mails.push(mail))},origin:'https://pm.example.com',basePath:'/pmcanvas',now,logger:{error(){}}});
 if(!now)reset.now=()=>Date.now();
 return {repo,reset,mails,id,value:()=>new URL(mails.at(-1).url).hash.slice('#reset-password='.length)};
}
test('재설정 링크: 재발급·만료·동시 사용·비밀번호 변경 뒤 무효화, MFA 보존',async()=>{
 const f=fixture();f.repo.mfa=new Map([[f.id,{secret:'preserved',recovery_hashes:['preserved'],last_step:123}]]);
 f.reset.request('user@example.com');await f.reset.idle();const first=f.value();
 f.reset.request('user@example.com');await f.reset.idle();const current=f.value();assert.notEqual(current,first);
 await assert.rejects(f.reset.finish(first,'changed-password-123','changed-password-123'),e=>e.code==='RESET_INVALID');
 const results=await Promise.allSettled([0,1].map(()=>f.reset.finish(current,'changed-password-123','changed-password-123')));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'RESET_INVALID');
 assert.deepEqual(f.repo.mfa.get(f.id),{secret:'preserved',recovery_hashes:['preserved'],last_step:123});
 f.reset.request('user@example.com');await f.reset.idle();const stale=f.value(),u=f.repo.users.get(f.id);await f.repo.changePassword(f.id,u.password_hash,HASH);
 await assert.rejects(f.reset.finish(stale,'another-password-123','another-password-123'),e=>e.code==='RESET_INVALID');
 const expired=fixture({now:()=>Date.now()-16*60*1000});expired.reset.request('user@example.com');await expired.reset.idle();await assert.rejects(expired.reset.finish(expired.value(),'changed-password-123','changed-password-123'),e=>e.code==='RESET_INVALID');
});
test('메일 설정: 필수 TLS·인증 파일·발신 주소 검사, 메일은 고정 수신자와 본문만 사용',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pmcanvas-mail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'password.txt'),'test-only-secret\n');
 const raw={enabled:true,host:'smtp.example.com',port:587,secure:false,from:'sender@example.com',username:'sender@example.com',passwordFile:'password.txt'};
 const config=mailConfig(raw,{directory:dir});assert.equal(config.transport.requireTLS,true);assert.equal(config.transport.tls.rejectUnauthorized,true);assert.equal(config.transport.auth.pass,'test-only-secret');assert.equal(config.transport.disableUrlAccess,true);assert.equal(config.transport.disableFileAccess,true);
 assert.equal(mailConfig({enabled:false}),null);
 const invalid=path.join(dir,'invalid.json');fs.writeFileSync(invalid,'{"password":"do-not-log-this-secret",');assert.throws(()=>loadMailer({MAIL_CONFIG_FILE:invalid}),e=>!e.message.includes('do-not-log-this-secret')&&e.message.includes('configuration'));
 for(const patch of [{host:'smtp.example.com/secret'},{from:'sender@example.com\r\nBcc:evil@example.com'},{secure:'false'},{port:0},{passwordFile:''}])assert.throws(()=>mailConfig({...raw,...patch},{directory:dir}));
 const mails=[],mailer=createMailer(config,{createTransport:()=>({sendMail:async mail=>{mails.push(mail);return {accepted:['user@example.com'],rejected:[]};}})});
 await mailer.sendReset({to:'user@example.com',url:'https://pm.example.com/pmcanvas/#reset-password=test'});assert.equal(mails[0].to.address,'user@example.com');assert.equal('attachments' in mails[0],false);assert.equal(mails[0].text.includes('15분'),true);assert.equal(mails[0].text.includes('password.txt'),false);
 await assert.rejects(mailer.sendReset({to:'bad@example.com\r\nBcc:x@example.com',url:'x'}));
});
test('메일 작업 대기열은 제한되며 실패한 링크는 폐기한다',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=fixture({send:async()=>{await wait;throw Error('mail failure');}});
 for(let i=0;i<24;i++)f.reset.request('user@example.com');assert.throws(()=>f.reset.request('other@example.com'),e=>e.code==='RESET_BUSY');release();await f.reset.idle();assert.equal(f.repo.resets.size,0);assert.ok(f.repo.security.some(e=>e.kind==='auth.password_reset.delivery_failed'));
});
