// API contract tests only. PostgreSQL is exercised separately by postgres.integration.mjs.
import {randomUUID} from 'node:crypto';
import {fail} from '../../server/errors.mjs';
import {digest} from '../../server/security.mjs';
import {projectChanges} from '../../server/project.mjs';
import {publicUser} from '../../server/postgres.mjs';
export class MemoryRepository{
 async reserveAttempt(key,limit,windowMs){this.attempts??=new Map();const old=this.attempts.get(key);const value=old&&old.until>Date.now()?old:{count:0,until:Date.now()+windowMs};if(value.count>=limit)fail(429,'RATE_LIMIT','로그인 시도가 많습니다.');value.count++;this.attempts.set(key,value);}
 async clearAttempt(key){this.attempts?.delete(key);}
 async upgradeHash(id,oldHash,newHash){const user=this.users.get(id);if(!user||user.password_hash!==oldHash)fail(401,'LOGIN_FAILED','계정 변경');user.password_hash=newHash;}
 async securityEvent(event){this.security??=[];this.security.push({...event,id:String(this.security.length+1),at:new Date().toISOString()});}
 async securityEvents(){return [...this.security||[]].reverse().slice(0,200);}
 async getMfa(id){return this.mfa?.get(id)||null;}
 async reserveMfaChallenge(key){const entry=this.transients.get(key);if(!entry||entry.until<=Date.now()||entry.value.attempts>=5)return null;entry.value.attempts++;return structuredClone(entry.value);}
 async completeMfa({key,userId,passwordHash,step,recoveryHash,enrollment}){const user=this.users.get(userId),entry=this.transients.get(key);if(!user?.is_admin||user.is_active===false||user.password_hash!==passwordHash||!entry||entry.until<=Date.now())fail(401,'MFA_EXPIRED','인증 만료');this.mfa??=new Map();let state=this.mfa.get(userId);
  if(enrollment){if(state)fail(401,'MFA_REPLAY','이미 등록');state={secret:enrollment.secret,recovery_hashes:enrollment.recoveryHashes,last_step:step};this.mfa.set(userId,state);}
  else if(step!=null){if(!state||state.last_step>=step)fail(401,'MFA_REPLAY','코드 재사용');state.last_step=step;}
  else{if(!state?.recovery_hashes.includes(recoveryHash))fail(401,'MFA_REPLAY','복구 코드 재사용');state.recovery_hashes=state.recovery_hashes.filter(h=>h!==recoveryHash);}
  this.transients.delete(key);
 }
 constructor(users=[]){this.users=new Map(users.map(u=>[u.id,u]));this.sessions=new Map();this.projects=new Map();this.events=new Map();this.transients=new Map();this.identities=new Map();this.resets=new Map();this.verifications=new Map();this.notices=new Map();}
 async health(){}
 async findUserByEmail(email){return [...this.users.values()].find(u=>u.email===email);}
 async listUsers(){return [...this.users.values()].map(u=>publicUser({...u,approval_mail_status:this.notices.get(u.id)?.state}));}
 async issueEmailVerification({userId,passwordHash,hash,expires}){const u=this.users.get(userId);if(!u?.registration_pending||u.local_login===false||u.email_verified_at||u.password_hash!==passwordHash)return false;this.verifications.set(userId,{hash,passwordHash,expires});return true;}
 async revokeEmailVerification(hash){for(const [id,v] of this.verifications)if(v.hash===hash)this.verifications.delete(id);}
 async consumeEmailVerification(hash,{passwordHash,name}){const entry=[...this.verifications].find(([,v])=>v.hash===hash&&new Date(v.expires)>new Date()),u=entry?this.users.get(entry[0]):null,v=entry?.[1];if(!u?.registration_pending||u.local_login===false||u.email_verified_at||u.password_hash!==v.passwordHash)fail(400,'VERIFICATION_INVALID','유효하지 않거나 만료된 링크입니다.');this.verifications.delete(u.id);u.email_verified_at=new Date();u.password_hash=passwordHash;u.name=name;this.revokeSessions(u.id);this.attempts?.delete(digest('local:'+u.email));return {id:u.id};}
 async claimApprovalNotification(){for(const [userId,n] of this.notices){const u=this.users.get(userId);if(u.is_active&&!u.registration_pending&&u.email_verified_at&&['pending','sending'].includes(n.state)&&n.available<=Date.now()){n.state='sending';n.attempts++;n.lease=randomUUID();n.available=Date.now()+120000;return {userId,email:u.email,lease:n.lease};}}return null;}
 async finishApprovalNotification(userId,lease,sent){const n=this.notices.get(userId);if(n?.state==='sending'&&n.lease===lease){n.state=sent?'sent':n.attempts>=3?'failed':'pending';n.lease=null;n.available=Date.now()+60000;}}
 async retryApprovalNotification(actorId,targetId){const a=this.users.get(actorId),u=this.users.get(targetId),n=this.notices.get(targetId);if(!a?.is_admin||a.is_active===false)fail(403,'FORBIDDEN','관리자 필요');if(!u?.is_active||u.registration_pending||!u.email_verified_at||n?.state!=='failed')fail(409,'NOTICE_UNAVAILABLE','재발송 불가');Object.assign(n,{state:'pending',attempts:0,lease:null,available:0});}
 async getMailSettings(){return this.mailSettings?structuredClone(this.mailSettings):null;}
 async saveMailSettings(actorId,{config,passwordEncrypted,revision}){const actor=this.users.get(actorId);if(!actor?.is_admin||actor.is_active===false)fail(403,'FORBIDDEN','관리자 권한이 필요합니다.');if((this.mailSettings?.revision||0)!==revision)fail(409,'MAIL_CONFLICT','다른 관리자가 설정을 변경했습니다.');this.mailSettings={config:structuredClone(config),password_encrypted:passwordEncrypted,revision:revision+1};}
 async issuePasswordReset({userId,passwordHash,hash,expires}){const u=this.users.get(userId);if(!u||u.is_active===false||u.local_login===false||u.registration_pending||u.password_hash!==passwordHash)return false;this.resets.set(userId,{userId,passwordHash,hash,expires});return true;}
 async revokePasswordReset(hash){for(const [id,r]of this.resets)if(r.hash===hash)this.resets.delete(id);}
 async consumePasswordReset(hash,passwordHash){const r=[...this.resets.values()].find(r=>r.hash===hash&&new Date(r.expires)>new Date()),u=r?this.users.get(r.userId):null;if(!u||u.is_active===false||u.local_login===false||u.registration_pending||u.password_hash!==r.passwordHash)fail(400,'RESET_INVALID','유효하지 않거나 만료된 링크입니다. 비밀번호 재설정을 다시 요청해 주세요.');this.resets.delete(u.id);u.password_hash=passwordHash;this.attempts?.delete(digest('local:'+u.email));this.revokeSessions(u.id);return {id:u.id};}
 async putTransient(key,value,ttlMs=600000){this.transients.set(key,{value:structuredClone(value),until:Date.now()+ttlMs});}
 async getTransient(key){const entry=this.transients.get(key);return entry&&entry.until>Date.now()?structuredClone(entry.value):null;}
 async takeTransient(key,browserHash=null){const value=await this.getTransient(key);if(!value||browserHash&&value.browserHash!==browserHash)return null;this.transients.delete(key);return value;}
 async externalSession({providerKey,subject,email,name,autoProvision,hash,csrf,expires}){
  const key=providerKey+'|'+subject;let user=this.users.get(this.identities.get(key));
  if(!user){if(!autoProvision)fail(403,'IDENTITY_UNLINKED','계정 연결이 필요합니다.');if(await this.findUserByEmail(email))fail(409,'IDENTITY_UNLINKED','자동 연결 불가');user={id:randomUUID(),email,name,password_hash:'',local_login:false,is_admin:false,is_active:true};this.users.set(user.id,user);this.identities.set(key,user.id);}
  if(user.is_admin)fail(403,'ADMIN_PROTECTED','관리자는 로컬 로그인을 사용합니다.');if(user.is_active===false)fail(403,'ACCOUNT_DISABLED','비활성 계정');
  this.sessions.set(hash,{userId:user.id,csrf,expires});return publicUser(user);
 }
 async listIdentities(){return [...this.identities].map(([key,id])=>{const [providerKey,...subject]=key.split('|'),u=this.users.get(id);return {providerKey,subject:subject.join('|'),email:u.email,name:u.name};});}
 async linkIdentity(actorId,{providerKey,subject,email}){const actor=this.users.get(actorId),u=await this.findUserByEmail(email);if(!actor?.is_admin)fail(403,'FORBIDDEN','관리자 필요');if(!u)fail(404,'USER_NOT_FOUND','계정 없음');if(u.is_admin)fail(403,'ADMIN_PROTECTED','관리자 보호');const key=providerKey+'|'+subject;if(this.identities.has(key))fail(409,'IDENTITY_EXISTS','연결 있음');this.identities.set(key,u.id);return {ok:true};}
 async unlinkIdentity(actorId,providerKey,subject){if(!this.users.get(actorId)?.is_admin)fail(403,'FORBIDDEN','관리자 필요');const key=providerKey+'|'+subject,id=this.identities.get(key);if(!id)fail(404,'IDENTITY_NOT_FOUND','연결 없음');this.identities.delete(key);this.revokeSessions(id);return {ok:true};}
 async createUser({email,name,passwordHash,isAdmin=false,registrationPending=false}){if(await this.findUserByEmail(email))fail(409,'EMAIL_EXISTS','이미 등록된 이메일입니다.');const u={id:randomUUID(),email,name,password_hash:passwordHash,is_admin:isAdmin,is_active:!registrationPending,registration_pending:registrationPending,email_verification_required:registrationPending,email_verified_at:null};this.users.set(u.id,u);return publicUser(u);}
 async createSession({hash,passwordHash,...data}){const u=this.users.get(data.userId);if(!u||u.is_active===false||u.password_hash!==passwordHash)fail(401,'LOGIN_FAILED','계정 정보가 변경되었습니다.');this.sessions.set(hash,data);}
 async findSession(hash){const s=this.sessions.get(hash);if(!s||new Date(s.expires)<new Date())return null;const u=this.users.get(s.userId);if(!u||u.is_active===false)return null;return {user:publicUser(u),csrf:s.csrf};}
 async deleteSession(hash){this.sessions.delete(hash);}
 async changePassword(userId,expectedHash,passwordHash){const u=this.users.get(userId);if(!u||u.is_active===false||u.password_hash!==expectedHash)fail(409,'ACCOUNT_CHANGED','계정 정보가 변경되었습니다.');u.password_hash=passwordHash;this.resets.delete(userId);this.revokeSessions(userId);return {ok:true};}
 revokeSessions(userId){for(const [key,s]of this.sessions)if(s.userId===userId)this.sessions.delete(key);}
 async manageUser(actorId,targetId,{isActive,passwordHash}){
  const actor=this.users.get(actorId),target=this.users.get(targetId);
  if(!actor?.is_admin||actor.is_active===false)fail(403,'FORBIDDEN','권한이 없습니다.');
  if(!target)fail(404,'USER_NOT_FOUND','계정이 없습니다.');
  if(target.is_admin||actorId===targetId)fail(403,'ADMIN_PROTECTED','관리자 계정은 보호됩니다.');
  if(isActive===true&&target.registration_pending&&!target.email_verified_at)fail(409,'EMAIL_UNVERIFIED','이메일 인증이 필요합니다.');
  if(isActive===true&&target.registration_pending&&!this.notices.has(targetId))this.notices.set(targetId,{state:'pending',attempts:0,available:0});
  if(isActive!==undefined)target.is_active=isActive;if(isActive===true)target.registration_pending=false;
  if(passwordHash!==undefined)target.password_hash=passwordHash;if(passwordHash||isActive===false)this.resets.delete(targetId);
  this.revokeSessions(targetId);return publicUser({...target,approval_mail_status:this.notices.get(targetId)?.state});
 }
 access(userId,id,minimum='viewer'){const p=this.projects.get(id),role=p?.roles[userId];if(!role)fail(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');if(minimum==='owner'&&role!=='owner'||minimum==='editor'&&role==='viewer')fail(403,'FORBIDDEN','권한이 없습니다.');return p;}
 document(p,userId){return {...structuredClone(p.data),id:p.id,_revision:p.revision,_role:p.roles[userId]};}
 async createProject(userId,id,p){
  const old=this.projects.get(id);if(old){this.access(userId,id,'owner');if(JSON.stringify(old.data)!==JSON.stringify(p))fail(409,'CREATE_CONFLICT','내용이 다릅니다.');return this.document(old,userId);}
  const entry={id,data:structuredClone(p),revision:1,roles:{[userId]:'owner'}};this.projects.set(id,entry);this.events.set(id,[{id:'1',revision:1,type:'project.created',changes:projectChanges(null,p),at:new Date(),actor:'테스트'}]);return this.document(entry,userId);
 }
 async getProject(userId,id){return this.document(this.access(userId,id),userId);}
 async listProjects(userId){return [...this.projects.values()].filter(p=>p.roles[userId]).map(p=>this.document(p,userId));}
 async updateProject(userId,id,p,revision){
  const entry=this.access(userId,id,'editor');if(entry.revision!==revision)fail(409,'REVISION_CONFLICT','다른 사용자가 먼저 수정했습니다.');
  const changes=projectChanges(entry.data,p);entry.data=structuredClone(p);if(changes.length){entry.revision++;this.events.get(id).unshift({id:String(entry.revision),revision:entry.revision,type:'project.updated',changes,at:new Date(),actor:'테스트'});}return this.document(entry,userId);
 }
 async listAccess(userId,id){const p=this.access(userId,id,'owner');return Object.entries(p.roles).map(([id,role])=>{const u=this.users.get(id);return {id,role,name:u.name,email:u.email};});}
 async grantAccess(userId,id,email,role){const p=this.access(userId,id,'owner'),u=await this.findUserByEmail(email);if(!u)fail(404,'USER_NOT_FOUND','계정이 없습니다.');if(p.roles[u.id]==='owner')fail(409,'OWNER_IMMUTABLE','소유자 변경 불가');p.roles[u.id]=role;return {ok:true};}
 async revokeAccess(userId,id,target){const p=this.access(userId,id,'owner');if(p.roles[target]==='owner')fail(409,'OWNER_IMMUTABLE','소유자 삭제 불가');delete p.roles[target];return {ok:true};}
 async listEvents(userId,id){this.access(userId,id);return structuredClone(this.events.get(id));}
}
