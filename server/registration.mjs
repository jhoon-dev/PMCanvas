import {token,digest,hashPassword} from './security.mjs';
import {fail} from './errors.mjs';

export function registrationConfig(env={}){
 const mode=env.REGISTRATION_MODE??'approval';
 if(!['approval','disabled'].includes(mode))throw Error('REGISTRATION_MODE must be approval or disabled.');
 const domains=(env.REGISTRATION_DOMAINS||'').split(',').map(d=>d.trim().toLowerCase()).filter(Boolean);
 if(domains.length>50||domains.some(d=>d.length>253||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)))throw Error('REGISTRATION_DOMAINS must contain exact email domains, separated by commas.');
 return {mode,domains:[...new Set(domains)]};
}

export class RegistrationEmail{
 constructor({repo,mailer,origin,basePath='',logger=console,now=()=>Date.now()}){Object.assign(this,{repo,mailer,origin,basePath,logger,now});this.jobs=[];this.verifying=null;this.notifying=null;}
 request(email,ipHash=null){
  if(this.jobs.length+(this.verifying?1:0)>=24)fail(503,'VERIFICATION_BUSY','요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  this.jobs.push({email,ipHash});
  this.pump();
 }
 pump(){if(!this.verifying&&this.jobs.length)this.verifying=this.deliverAll().finally(()=>{this.verifying=null;this.pump();});}
 async deliverAll(){while(this.jobs.length){try{await this.deliver(this.jobs.shift());}catch{this.logger.error('Registration verification delivery failed.');}}}
 async deliver({email,ipHash}){
  const u=await this.repo.findUserByEmail(email);
  if(!u?.registration_pending||u.local_login===false||u.email_verified_at)return;
  const value=token(),hash=digest(value);
  if(!await this.repo.issueEmailVerification({userId:u.id,passwordHash:u.password_hash,hash,expires:new Date(this.now()+30*60*1000)}))return;
  const url=new URL((this.basePath||'')+'/',this.origin);url.hash='verify-email='+value;
  try{await this.mailer.sendVerification({to:u.email,url:url.href});await this.repo.securityEvent?.({kind:'account.verification.sent',ip:ipHash,details:{targetId:u.id}});}
  catch{await this.repo.revokeEmailVerification(hash);await this.repo.securityEvent?.({kind:'account.verification.delivery_failed',ip:ipHash,details:{targetId:u.id}});this.logger.error('Registration verification delivery failed. Check mail configuration.');}
 }
 async finish(value,name,password,confirmation){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))fail(400,'VERIFICATION_INVALID','유효하지 않거나 만료된 링크입니다. 인증 메일을 다시 요청해 주세요.');
  if(typeof name!=='string'||!name.trim()||name.length>80)fail(400,'INVALID_NAME','이름은 1~80자로 입력해 주세요.');
  if(password!==confirmation)fail(400,'PASSWORD_MISMATCH','비밀번호 확인이 일치하지 않습니다.');
  return this.repo.consumeEmailVerification(digest(value),{name:name.trim(),passwordHash:await hashPassword(password)});
 }
 notify(){
  if(!this.notifying)this.notifying=this.deliverApprovals().catch(()=>this.logger.error('Approval notification processing failed.')).finally(()=>{this.notifying=null;});
 }
 async deliverApprovals(){
  for(let i=0;i<20;i++){
   const job=await this.repo.claimApprovalNotification();if(!job)return;
   let sent=false;
   try{await this.mailer.sendApproval({to:job.email,url:new URL((this.basePath||'')+'/',this.origin).href});sent=true;}
   catch{this.logger.error('Approval notification delivery failed. Will retry.');}
   await this.repo.finishApprovalNotification(job.userId,job.lease,sent);
   await this.repo.securityEvent?.({kind:sent?'account.approval_notice.sent':'account.approval_notice.delivery_failed',details:{targetId:job.userId}});
  }
 }
 start(){if(!this.timer){this.notify();this.timer=setInterval(()=>this.notify(),30000);this.timer.unref();}}
 async idle(){while(this.verifying||this.notifying)await Promise.all([this.verifying,this.notifying]);}
 async close(){clearInterval(this.timer);this.timer=null;await this.idle();}
}
