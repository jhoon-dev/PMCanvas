import {token,digest,hashPassword} from './security.mjs';
import {fail} from './errors.mjs';

export class PasswordReset{
 constructor({repo,mailer,origin,basePath='',logger=console,now=()=>Date.now()}){Object.assign(this,{repo,mailer,origin,basePath,logger,now});this.jobs=[];this.running=0;this.waiters=[];}
 request(email,ipHash=null){
  if(this.jobs.length+this.running>=24)fail(503,'RESET_BUSY','요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  this.jobs.push({email,ipHash});this.pump();
 }
 pump(){
  while(this.running<2&&this.jobs.length){const job=this.jobs.shift();this.running++;this.deliver(job).catch(()=>this.logger.error('Password reset delivery failed.')).finally(()=>{this.running--;this.pump();if(!this.running&&!this.jobs.length)this.waiters.splice(0).forEach(resolve=>resolve());});}
 }
 idle(){return this.running||this.jobs.length?new Promise(resolve=>this.waiters.push(resolve)):Promise.resolve();}
 async deliver({email,ipHash}){
  const user=await this.repo.findUserByEmail(email);
  if(!user||user.is_active===false||user.local_login===false||user.registration_pending)return;
  const value=token(),hash=digest(value),expires=new Date(this.now()+15*60*1000);
  if(!await this.repo.issuePasswordReset({userId:user.id,passwordHash:user.password_hash,hash,expires}))return;
  const url=new URL((this.basePath||'')+'/',this.origin);url.hash='reset-password='+value;
  try{await this.mailer.sendReset({to:user.email,url:url.href});await this.repo.securityEvent?.({kind:'auth.password_reset.sent',ip:ipHash,details:{targetId:user.id}});}
  catch{
   await this.repo.revokePasswordReset(hash);
   await this.repo.securityEvent?.({kind:'auth.password_reset.delivery_failed',ip:ipHash,details:{targetId:user.id}});
   this.logger.error('Password reset delivery failed. Check mail configuration.');
  }
 }
 async finish(value,password,confirmation){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))fail(400,'RESET_INVALID','유효하지 않거나 만료된 링크입니다. 비밀번호 재설정을 다시 요청해 주세요.');
  if(password!==confirmation)fail(400,'PASSWORD_MISMATCH','비밀번호 확인이 일치하지 않습니다.');
  const passwordHash=await hashPassword(password);
  return this.repo.consumePasswordReset(digest(value),passwordHash);
 }
}
