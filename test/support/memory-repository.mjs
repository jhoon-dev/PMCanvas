// API contract tests only. PostgreSQL is exercised separately by postgres.integration.mjs.
import {randomUUID} from 'node:crypto';
import {fail} from '../../server/errors.mjs';
import {projectChanges} from '../../server/project.mjs';
import {publicUser} from '../../server/postgres.mjs';
export class MemoryRepository{
 constructor(users=[]){this.users=new Map(users.map(u=>[u.id,u]));this.sessions=new Map();this.projects=new Map();this.events=new Map();this.transients=new Map();this.identities=new Map();}
 async health(){}
 async findUserByEmail(email){return [...this.users.values()].find(u=>u.email===email);}
 async listUsers(){return [...this.users.values()].map(publicUser);}
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
 async createUser({email,name,passwordHash,isAdmin=false}){if(await this.findUserByEmail(email))fail(409,'EMAIL_EXISTS','이미 등록된 이메일입니다.');const u={id:randomUUID(),email,name,password_hash:passwordHash,is_admin:isAdmin};this.users.set(u.id,u);return {id:u.id,email,name,isAdmin};}
 async createSession({hash,passwordHash,...data}){const u=this.users.get(data.userId);if(!u||u.is_active===false||u.password_hash!==passwordHash)fail(401,'LOGIN_FAILED','계정 정보가 변경되었습니다.');this.sessions.set(hash,data);}
 async findSession(hash){const s=this.sessions.get(hash);if(!s||new Date(s.expires)<new Date())return null;const u=this.users.get(s.userId);if(!u||u.is_active===false)return null;return {user:publicUser(u),csrf:s.csrf};}
 async deleteSession(hash){this.sessions.delete(hash);}
 async changePassword(userId,expectedHash,passwordHash){const u=this.users.get(userId);if(!u||u.is_active===false||u.password_hash!==expectedHash)fail(409,'ACCOUNT_CHANGED','계정 정보가 변경되었습니다.');u.password_hash=passwordHash;this.revokeSessions(userId);return {ok:true};}
 revokeSessions(userId){for(const [key,s]of this.sessions)if(s.userId===userId)this.sessions.delete(key);}
 async manageUser(actorId,targetId,{isActive,passwordHash}){
  const actor=this.users.get(actorId),target=this.users.get(targetId);
  if(!actor?.is_admin||actor.is_active===false)fail(403,'FORBIDDEN','권한이 없습니다.');
  if(!target)fail(404,'USER_NOT_FOUND','계정이 없습니다.');
  if(target.is_admin||actorId===targetId)fail(403,'ADMIN_PROTECTED','관리자 계정은 보호됩니다.');
  if(isActive!==undefined)target.is_active=isActive;
  if(passwordHash!==undefined)target.password_hash=passwordHash;
  this.revokeSessions(targetId);return publicUser(target);
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
