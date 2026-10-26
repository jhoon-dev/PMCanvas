import {clientAddress,proxyList,requestLimiter} from './request-security.mjs';
import {readWorkbook} from './excel-import.mjs';
import {projectWorkbook} from './excel.mjs';
import {validDate,today} from '../public/engine.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {HttpError,fail} from './errors.mjs';
import {token,digest,safeEqual,hashPassword,verifyPassword,emailAddress,cookieValue,sessionCookie} from './security.mjs';
import {cleanProject,uuid} from './project.mjs';
import {Federation} from './federation.mjs';
import {registrationConfig} from './registration.mjs';
import {mailAddress} from './mailer.mjs';

export function createHandler({repo,origin='http://localhost:3000',basePath='',logger=console,trustProxies='',adminMfa=null,passwordReset=null,registrationEmail=null,mailSettings=null,registration=registrationConfig(),federation=new Federation({repo,origin,basePath})}){
 if(new URL(origin).origin!==origin)throw Error('PUBLIC_ORIGIN must contain only scheme and host, without a path or trailing slash.');
 if(basePath&&!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath))throw Error('BASE_PATH must be empty or a path without a trailing slash.');
 const secure=new URL(origin).protocol==='https:',reserve=requestLimiter(repo),trusted=proxyList(trustProxies);
 const audit=async(req,kind,details={})=>{if(kind==='security.request.rejected')try{await reserve('audit:'+(req.clientIp||'local')+':'+details.code,30,60000);}catch{return;}if(repo.securityEvent)await repo.securityEvent({actorId:req.actorId||null,kind,ip:req.clientIp?digest(req.clientIp):null,details:{...details,...(req.loginHash?{accountHash:req.loginHash}:{})}});};
 const cookieConfig={secure,basePath};
 const completeLogin=async(req,res,user,{recoveryCodes=null}={})=>{
  const old=cookieValue(req,'pmcanvas_session');if(old)await repo.deleteSession(digest(old));
  const value=token(),csrf=token();await repo.createSession({hash:digest(value),userId:user.id,csrf,expires:new Date(Date.now()+12*60*60*1000),passwordHash:user.password_hash});
  req.actorId=user.id;await audit(req,'auth.login.success');
  if(repo.clearAttempt)await repo.clearAttempt(digest('local:'+user.email));
  return json(res,200,{user:{id:user.id,email:user.email,name:user.name,isAdmin:!!user.is_admin,localLogin:true},csrf,...(recoveryCodes?{recoveryCodes}:{})},{'Set-Cookie':sessionCookie(value,cookieConfig)});
 };
 const flowCookie=(value,type,maxAge=600)=>'pmcanvas_sso='+value+'; Path='+(basePath||'')+'/api/auth/sso/; HttpOnly; Max-Age='+maxAge+'; SameSite='+(type==='saml'?'None':'Lax')+(secure?'; Secure':'');
 const externalLogin=async identity=>{
  const value=token(),csrf=token();
  const seconds=identity.sessionMinutes*60;
  const user=await repo.externalSession({...identity,hash:digest(value),csrf,expires:new Date(Date.now()+seconds*1000)});
  return {user,csrf,cookie:sessionCookie(value,{...cookieConfig,maxAge:seconds})};
 };
 const staticFiles=new Map([['/','index.html'],['/index.html','index.html'],...['app.js','api-client.js','styles.css','engine.js','reports.js','wbs-model.js','wbs-workspace.js','wbs.css','planning.js','draft-store.js','wbs-import.js'].map(f=>['/'+f,f])]);
 const dummyHash=hashPassword('constant-timing-placeholder-password');
 const json=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(body));};
 const readJson=async(req,maxBytes=8*1024*1024)=>{
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)fail(413,'BODY_TOO_LARGE','요청 본문이 허용 크기를 초과했습니다.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_JSON','JSON 객체가 필요합니다.');return value;}catch(error){if(error.status)throw error;fail(400,'INVALID_JSON','JSON 형식을 확인해 주세요.');}
 };
 const authenticate=async req=>{
  const value=cookieValue(req,'pmcanvas_session');
  const session=value?await repo.findSession(digest(value)):null;
  if(!session)fail(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  return {...session,hash:digest(value)};
 };
 const handler=async(req,res)=>{
  if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  let auditPath='';
  try{
   let path=new URL(req.url,origin).pathname;
   if(basePath&&path===basePath){res.writeHead(308,{Location:basePath+'/'});return res.end();}
   if(basePath){if(!path.startsWith(basePath+'/'))fail(404,'NOT_FOUND','페이지를 찾을 수 없습니다.');path=path.slice(basePath.length);}
   auditPath=path;const method=req.method;
   if(path==='/api/health'&&method==='GET'){try{await repo.health();return json(res,200,{ok:true});}catch{return json(res,503,{ok:false});}}
   req.clientIp=clientAddress(req,trusted);
   if(path==='/api/auth/providers'&&method==='GET')return json(res,200,{providers:federation.list(),registration:{...registration,emailVerification:true,emailEnabled:!!registrationEmail&&(!mailSettings||await mailSettings.enabled())},passwordReset:{enabled:!!passwordReset&&(!mailSettings||await mailSettings.enabled())}});
   const sso=path.match(/^\/api\/auth\/sso\/([a-z][a-z0-9_-]{0,39})\/(start|callback|metadata)$/);
   if(sso){
    const [,id,action]=sso,p=federation.provider(id);
    if(action==='metadata'&&method==='GET'){
     res.writeHead(200,{'Content-Type':'application/samlmetadata+xml; charset=utf-8','Cache-Control':'no-store'});return res.end(federation.metadata(id));
    }
    if(action==='start'&&method==='GET'){
     await reserve('sso:'+id+':'+(req.clientIp||'local'),30,60000);
     const started=await federation.begin(id);
     res.writeHead(302,{Location:started.location,'Set-Cookie':flowCookie(started.browser,started.type),'Cache-Control':'no-store'});return res.end();
    }
    if(action==='callback'&&((p.type==='oidc'&&method==='GET')||(p.type==='saml'&&method==='POST'))){
     try{
      let form;
      if(method==='POST'){
       if((req.headers['content-type']||'').split(';')[0].trim()!=='application/x-www-form-urlencoded')fail(415,'CONTENT_TYPE','SAML form POST required.');
       const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)fail(413,'BODY_TOO_LARGE','SAML response too large.');chunks.push(chunk);}
       const params=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
       if(params.getAll('SAMLResponse').length!==1||params.getAll('RelayState').length!==1)fail(400,'INVALID_FLOW','Invalid SAML response.');
       form=Object.fromEntries(params);
      }
      const identity=await federation.finish(id,{url:new URL(req.url,origin),form,browser:cookieValue(req,'pmcanvas_sso')});
      const result=await externalLogin(identity);req.actorId=result.user.id;await audit(req,'auth.sso.success',{provider:id});
      const old=cookieValue(req,'pmcanvas_session');if(old)await repo.deleteSession(digest(old));
      res.writeHead(303,{Location:basePath+'/', 'Set-Cookie':[result.cookie,flowCookie('',p.type,0)],'Cache-Control':'no-store'});return res.end();
     }catch(error){
      logger.error('Federated login rejected:',error.code||error.name);
      const reason=['IDENTITY_UNLINKED','DOMAIN_DENIED','ACCOUNT_DISABLED','UNVERIFIED_EMAIL'].includes(error.code)?error.code:'SSO_FAILED';
      res.writeHead(303,{Location:basePath+'/?authError='+reason,'Set-Cookie':flowCookie('',p.type,0),'Cache-Control':'no-store'});return res.end();
     }
    }
    fail(404,'NOT_FOUND','인증 경로가 올바르지 않습니다.');
   }
   if(!path.startsWith('/api/')){
    if(!['GET','HEAD'].includes(method)||!staticFiles.has(path))fail(404,'NOT_FOUND','페이지를 찾을 수 없습니다.');
    const file=staticFiles.get(path),body=await fs.readFile(new URL('../public/'+file,import.meta.url));
    const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-cache'});return res.end(method==='HEAD'?undefined:body);
   }
   const mutation=!['GET','HEAD'].includes(method);
   if(mutation){
    if(req.headers.origin!==origin)fail(403,'INVALID_ORIGIN','접속 주소를 확인한 뒤 다시 시도해 주세요.');
    if((req.headers['content-type']||'').split(';')[0].trim()!=='application/json')fail(415,'CONTENT_TYPE','application/json 요청이 필요합니다.');
   }
   if(path==='/api/auth/directory'&&method==='POST'){
    const body=await readJson(req,16384);if(req.clientIp)await reserve('directory-ip:'+req.clientIp,40);
    if(typeof body.provider!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(body.provider)||typeof body.username!=='string'||!body.username.trim()||body.username.length>254||typeof body.password!=='string'||!body.password||body.password.length>1024)fail(400,'INVALID_LOGIN','디렉터리 계정 정보를 확인해 주세요.');
    const key=String(body.provider)+'|'+String(body.username).trim().toLowerCase();await reserve('directory:'+key);
    try{
     const identity=await federation.directory(body.provider,body.username,body.password),result=await externalLogin(identity);
     if(repo.clearAttempt)await repo.clearAttempt(digest('directory:'+key));req.actorId=result.user.id;await audit(req,'auth.directory.success',{provider:body.provider});const old=cookieValue(req,'pmcanvas_session');if(old)await repo.deleteSession(digest(old));
     return json(res,200,{user:result.user,csrf:result.csrf},{'Set-Cookie':result.cookie});
    }catch(error){if(error.status===403||error.code==='IDENTITY_UNLINKED')throw error;fail(401,'LOGIN_FAILED','디렉터리 인증에 실패했습니다. 계정 정보와 연결 설정을 확인해 주세요.');}
   }
   if((path==='/api/auth/forgot-password'||path==='/api/auth/reset-password')&&method==='POST'){
    if(!passwordReset||(path.endsWith('/forgot-password')&&mailSettings&&!await mailSettings.enabled()))fail(503,'RESET_UNAVAILABLE','현재 이메일 재설정을 사용할 수 없습니다. 관리자에게 문의해 주세요.');
    const request=path.endsWith('/forgot-password');
    await reserve(request?'reset-request-global':'reset-finish-global',request?100:200,request?3600000:900000);
    if(req.clientIp)await reserve((request?'reset-request-ip:':'reset-finish-ip:')+req.clientIp,request?10:20,900000);
    const body=await readJson(req,16384);
    if(request){const email=emailAddress(body.email);req.loginHash=digest(email);await reserve('reset-request-email:'+email,3,3600000);passwordReset.request(email,req.clientIp?digest(req.clientIp):null);return json(res,202,{ok:true,message:'재설정 가능한 계정이라면 이메일을 보내드립니다. 받은 편지함과 스팸함을 확인해 주세요.'});}
    if(typeof body.token==='string'&&body.token.length<=128)await reserve('reset-token:'+body.token,5,900000);
    const result=await passwordReset.finish(body.token,body.newPassword,body.confirmPassword);req.actorId=result.id;await audit(req,'auth.password_reset.completed');
    return json(res,200,{ok:true},{'Set-Cookie':sessionCookie('',{...cookieConfig,maxAge:0})});
   }
   if((path==='/api/auth/verify-email'||path==='/api/auth/resend-verification')&&method==='POST'){
    if(!registrationEmail)fail(503,'VERIFICATION_UNAVAILABLE','현재 이메일 인증을 사용할 수 없습니다. 관리자에게 문의해 주세요.');
    const resend=path.endsWith('/resend-verification');
    await reserve(resend?'verification-resend-global':'verification-finish-global',resend?100:200,resend?3600000:900000);
    if(req.clientIp)await reserve((resend?'verification-resend-ip:':'verification-finish-ip:')+req.clientIp,resend?10:20,900000);
    const body=await readJson(req,16384);
    if(resend){
     if(registration.mode!=='approval')fail(403,'REGISTRATION_DISABLED','현재 회원가입을 받지 않습니다.');
     if(mailSettings&&!await mailSettings.enabled())fail(503,'VERIFICATION_UNAVAILABLE','현재 이메일 인증을 사용할 수 없습니다. 관리자에게 문의해 주세요.');
     const email=mailAddress(body.email);req.loginHash=digest(email);await reserve('registration-email:'+email,3,3600000);
     registrationEmail.request(email,req.clientIp?digest(req.clientIp):null);
     return json(res,202,{ok:true,message:'이메일 인증이 필요한 가입 신청이라면 인증 메일을 보내드립니다. 받은 편지함과 스팸함을 확인해 주세요.'});
    }
    if(typeof body.token==='string'&&body.token.length<=128)await reserve('verification-token:'+body.token,5,900000);
    const result=await registrationEmail.finish(body.token,body.name,body.newPassword,body.confirmPassword);req.actorId=result.id;await audit(req,'account.verification.completed');
    return json(res,200,{ok:true,message:'이메일 인증을 완료했습니다. 관리자 승인 후 안내 메일을 보내드립니다.'});
   }
   if(path==='/api/auth/register'&&method==='POST'){
    if(registration.mode!=='approval')fail(403,'REGISTRATION_DISABLED','현재 회원가입을 받지 않습니다. 관리자에게 문의해 주세요.');
    if(!registrationEmail||(mailSettings&&!await mailSettings.enabled()))fail(503,'VERIFICATION_UNAVAILABLE','회원가입에는 이메일 인증이 필요합니다. 관리자에게 메일 설정을 요청해 주세요.');
    await reserve('registration-global',100,3600000);if(req.clientIp)await reserve('registration-ip:'+req.clientIp,10,900000);
    const body=await readJson(req,16384),email=mailAddress(body.email);
    req.loginHash=digest(email);await reserve('registration-email:'+email,3,3600000);
    if(registration.domains.length&&!registration.domains.includes(email.split('@')[1]))fail(400,'REGISTRATION_DOMAIN','가입 가능한 회사 이메일을 입력해 주세요.');
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)fail(400,'INVALID_NAME','이름은 1~80자로 입력해 주세요.');
    if(body.password!==body.confirmPassword)fail(400,'PASSWORD_MISMATCH','비밀번호 확인이 일치하지 않습니다.');
    const passwordHash=await hashPassword(body.password===undefined&&body.confirmPassword===undefined?token():body.password);
    try{
     const created=await repo.createUser({email,name:body.name.trim(),passwordHash,isAdmin:false,registrationPending:true});
     await audit(req,'account.registration.requested',{targetId:created.id});
    }catch(error){if(error.code!=='EMAIL_EXISTS')throw error;}
    registrationEmail.request(email,req.clientIp?digest(req.clientIp):null);
    return json(res,202,{ok:true,message:'가입 신청을 접수했습니다. 인증 메일에서 이메일 인증을 완료해 주세요. 인증 후 관리자 승인이 필요합니다.'});
   }
   if(path==='/api/auth/login'&&method==='POST'){
    const body=await readJson(req,16384),email=emailAddress(body.email);
    req.loginHash=digest(email);await reserve('local:'+email);if(req.clientIp)await reserve('login-ip:'+req.clientIp,40);
    const user=await repo.findUserByEmail(email),valid=await verifyPassword(body.password,user?.password_hash||await dummyHash);
    if(user&&valid&&user.registration_pending&&!user.email_verified_at)fail(403,'EMAIL_UNVERIFIED','이메일 인증이 필요합니다. 받은 인증 메일을 확인하거나 인증 메일을 다시 요청해 주세요.');
    if(user&&valid&&user.registration_pending)fail(403,'APPROVAL_PENDING','가입 승인 대기 중입니다. 관리자에게 승인 여부를 확인해 주세요.');
    if(!user||!valid||user.is_active===false||user.local_login===false)fail(401,'LOGIN_FAILED','이메일 또는 비밀번호를 확인해 주세요.');
    req.actorId=user.id;
    if(user.password_hash.startsWith('scrypt-v1:')&&repo.upgradeHash){const upgraded=await hashPassword(body.password);await repo.upgradeHash(user.id,user.password_hash,upgraded);user.password_hash=upgraded;await audit(req,'auth.password.rehashed');}
    if(user.is_admin&&adminMfa)return json(res,200,await adminMfa.begin(user,req.clientIp));
    return completeLogin(req,res,user);
   }
   if(path==='/api/auth/mfa/verify'&&method==='POST'){
    if(!adminMfa)fail(404,'NOT_FOUND','MFA를 사용할 수 없습니다.');
    const body=await readJson(req,16384);if(req.clientIp)await reserve('mfa-ip:'+req.clientIp,40);
    const result=await adminMfa.finish(body.challenge,body.code);req.actorId=result.user.id;await audit(req,result.recoveryCodes?'auth.mfa.enrolled':'auth.mfa.success');
    return completeLogin(req,res,result.user,result);
   }
   const session=await authenticate(req),user=session.user;req.actorId=user.id;
   if(mutation&&!safeEqual(req.headers['x-csrf-token'],session.csrf))fail(403,'CSRF_FAILED','보안 토큰을 갱신하려면 다시 로그인해 주세요.');
   if(path==='/api/admin/mail-settings'||path==='/api/admin/mail-settings/test'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자 권한이 필요합니다.');
    if(!mailSettings)fail(503,'MAIL_ADMIN_UNAVAILABLE','메일 설정 관리 기능을 사용할 수 없습니다.');
    if(path.endsWith('/test')&&method==='POST'){
     await reserve('smtp-test:'+user.id,5,600000);await reserve('smtp-test-global',20,600000);const body=await readJson(req,16384);
     try{await mailSettings.test(body.to);await audit(req,'mail.test.sent');return json(res,200,{ok:true,message:'SMTP 서버가 테스트 메일을 수락했습니다. 받은 편지함과 스팸함을 확인해 주세요.'});}
     catch(error){await audit(req,'mail.test.failed',{code:error.code||'MAIL_ERROR'});throw error;}
    }
    if(path==='/api/admin/mail-settings'&&method==='GET')return json(res,200,{settings:await mailSettings.public()});
    if(path==='/api/admin/mail-settings'&&method==='PUT'){await reserve('smtp-settings:'+user.id,20,600000);const settings=await mailSettings.save(user.id,await readJson(req,16384));await audit(req,'mail.settings.updated',{enabled:settings.enabled});return json(res,200,{settings});}
    fail(405,'METHOD_NOT_ALLOWED','지원하지 않는 요청입니다.');
   }
   if(path==='/api/auth/security-events'&&method==='GET'){if(!user.isAdmin)fail(403,'FORBIDDEN','관리자 권한이 필요합니다.');return json(res,200,{events:repo.securityEvents?await repo.securityEvents():[]});}
   if(path==='/api/auth/mfa/status'&&method==='GET'){if(!user.isAdmin)fail(403,'FORBIDDEN','관리자 권한이 필요합니다.');const state=adminMfa?await repo.getMfa(user.id):null;return json(res,200,{enabled:!!state,required:!!adminMfa,recoveryRemaining:state?.recovery_hashes.length||0});}
   if(path==='/api/auth/me'&&method==='GET')return json(res,200,{user,csrf:session.csrf});
   if(path==='/api/auth/logout'&&method==='POST'){
    await repo.deleteSession(session.hash);await audit(req,'auth.logout');return json(res,200,{ok:true},{'Set-Cookie':sessionCookie('',{...cookieConfig,maxAge:0})});
   }
   if(path==='/api/auth/password'&&method==='POST'){
    const body=await readJson(req);await reserve('password:'+user.id);
    const stored=await repo.findUserByEmail(user.email);
    if(stored?.local_login===false)fail(400,'EXTERNAL_PASSWORD','외부 인증 계정의 비밀번호는 인증 서버에서 변경해 주세요.');
    if(!stored||!await verifyPassword(body.currentPassword,stored.password_hash)){
     fail(400,'CURRENT_PASSWORD','현재 비밀번호가 일치하지 않습니다.');
    }
    if(body.currentPassword===body.newPassword)fail(400,'SAME_PASSWORD','현재와 다른 새 비밀번호를 입력해 주세요.');
    const passwordHash=await hashPassword(body.newPassword);
    await repo.changePassword(user.id,stored.password_hash,passwordHash);await audit(req,'account.password.changed');
    return json(res,200,{ok:true},{'Set-Cookie':sessionCookie('',{...cookieConfig,maxAge:0})});
   }
   if(path==='/api/auth/connections'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자 권한이 필요합니다.');
    if(method==='GET')return json(res,200,{providers:federation.status(),identities:await repo.listIdentities()});
    if(method==='POST'||method==='DELETE'){
     const body=await readJson(req),p=federation.provider(body.provider);
     if(typeof body.subject!=='string'||!body.subject||body.subject.length>1024)fail(400,'INVALID_SUBJECT','외부 계정의 고유 ID를 입력해 주세요.');
     const result=method==='POST'?await repo.linkIdentity(user.id,{providerKey:p.key,subject:body.subject,email:emailAddress(body.email)}):await repo.unlinkIdentity(user.id,p.key,body.subject);await audit(req,method==='POST'?'account.identity.linked':'account.identity.unlinked',{provider:p.id});return json(res,200,result);
    }
   }
   const noticeMatch=path.match(/^\/api\/users\/([^/]+)\/approval-notice$/);
   if(noticeMatch&&method==='POST'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자 권한이 필요합니다.');
    if(!uuid(noticeMatch[1]))fail(404,'USER_NOT_FOUND','계정을 찾을 수 없습니다.');
    if(!registrationEmail)fail(503,'NOTICE_UNAVAILABLE','안내 메일 발송을 사용할 수 없습니다.');
    await reserve('approval-notice:'+noticeMatch[1],3,3600000);await reserve('approval-notice-global',100,3600000);
    await repo.retryApprovalNotification(user.id,noticeMatch[1]);await audit(req,'account.approval_notice.retried',{targetId:noticeMatch[1]});registrationEmail.notify();
    return json(res,202,{ok:true});
   }
   const userMatch=path.match(/^\/api\/users\/([^/]+)$/);
   if(userMatch&&method==='PATCH'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자만 계정을 관리할 수 있습니다.');
    if(!uuid(userMatch[1]))fail(404,'USER_NOT_FOUND','계정을 찾을 수 없습니다.');
    const body=await readJson(req),keys=Object.keys(body);
    if(keys.length!==1||!['isActive','password'].includes(keys[0]))fail(400,'INVALID_UPDATE','계정 상태 또는 비밀번호 중 하나를 지정해 주세요.');
    if('isActive' in body&&typeof body.isActive!=='boolean')fail(400,'INVALID_STATUS','계정 상태가 올바르지 않습니다.');
    const update='password' in body?{passwordHash:await hashPassword(body.password)}:{isActive:body.isActive};
    const managed=await repo.manageUser(user.id,userMatch[1],update);if(managed.approvalMailStatus==='pending')registrationEmail?.notify();await audit(req,'account.user.updated',{targetId:userMatch[1],change:keys[0]});return json(res,200,{user:managed});
   }
   if(path==='/api/users'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자만 계정을 관리할 수 있습니다.');
    if(method==='GET')return json(res,200,{users:await repo.listUsers()});
    if(method==='POST'){
     const body=await readJson(req),email=emailAddress(body.email);
     if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)fail(400,'INVALID_NAME','이름을 확인해 주세요.');
     const passwordHash=await hashPassword(body.password);
     const created=await repo.createUser({email,name:body.name.trim(),passwordHash,isAdmin:false});await audit(req,'account.user.created',{targetId:created.id});return json(res,201,{user:created});
    }
   }
   const importMatch=path.match(/^\/api\/projects\/([^/]+)\/import-excel$/);
   if(importMatch&&method==='POST'){
    if(!uuid(importMatch[1]))fail(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');
    const project=await repo.getProject(user.id,importMatch[1]);if(project._role==='viewer')fail(403,'FORBIDDEN','편집 권한이 필요합니다.');
    await reserve('file:'+user.id,20,60000);const body=await readJson(req);try{return json(res,200,{sheets:await readWorkbook(body.file)});}catch(e){if(e.status)throw e;fail(400,'INVALID_EXCEL',e.message);}
   }
   const exportMatch=path.match(/^\/api\/projects\/([^/]+)\/export\.xlsx$/);
   if(exportMatch&&method==='POST'){
    if(!uuid(exportMatch[1]))fail(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');
    await reserve('file:'+user.id,20,60000);const saved=await repo.getProject(user.id,exportMatch[1]),body=await readJson(req);
    if(!validDate(body.asOf)||body.asOf>today())fail(400,'INVALID_DATE','보고 기준일을 확인해 주세요.');
    const project=cleanProject(body.project),ids=body.taskIds;
    if(!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length||ids.some(id=>!project.tasks.some(t=>t.id===id)))fail(400,'INVALID_SELECTION','출력할 업무를 확인해 주세요.');
    const buffer=await projectWorkbook(project,body.asOf,ids,{draft:JSON.stringify(project)!==JSON.stringify(cleanProject(saved))});
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',"attachment; filename=PMCanvas-WBS.xlsx; filename*=UTF-8''"+encodeURIComponent('PMCanvas-'+project.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')+'-'+body.asOf+'.xlsx'));
    res.setHeader('Content-Length',buffer.length);res.statusCode=200;return res.end(buffer);
   }
   if(path==='/api/projects'){
    if(method==='GET')return json(res,200,{projects:await repo.listProjects(user.id)});
    if(method==='POST'){
     const body=await readJson(req);if(!uuid(body.project?.id))fail(400,'INVALID_ID','프로젝트 ID가 올바르지 않습니다.');
     const project=cleanProject(body.project);return json(res,201,{project:await repo.createProject(user.id,body.project.id,project)});
    }
   }
   const match=path.match(/^\/api\/projects\/([^/]+)(?:\/(access|events)(?:\/([^/]+))?)?$/);
   if(match){
    const [,id,resource,target]=match;if(!uuid(id))fail(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');
    if(!resource){
     if(method==='GET')return json(res,200,{project:await repo.getProject(user.id,id)});
     if(method==='PUT'){
      const body=await readJson(req);
      if(!Number.isSafeInteger(body.revision)||body.revision<1)fail(400,'REVISION_REQUIRED','프로젝트 버전이 필요합니다.');
      return json(res,200,{project:await repo.updateProject(user.id,id,cleanProject(body.project),body.revision)});
     }
    }
    if(resource==='events'&&!target&&method==='GET')return json(res,200,{events:await repo.listEvents(user.id,id)});
    if(resource==='access'){
     if(!target&&method==='GET')return json(res,200,{access:await repo.listAccess(user.id,id)});
     if(!target&&method==='POST'){
      const body=await readJson(req);if(!['editor','viewer'].includes(body.role))fail(400,'INVALID_ROLE','편집자 또는 조회자를 선택해 주세요.');
      return json(res,200,await repo.grantAccess(user.id,id,emailAddress(body.email),body.role));
     }
     if(target&&method==='DELETE'&&uuid(target))return json(res,200,await repo.revokeAccess(user.id,id,target));
    }
   }
   fail(404,'NOT_FOUND','API를 찾을 수 없습니다.');
  }catch(error){
   if(auditPath.startsWith('/api/auth/')||auditPath.startsWith('/api/users')||auditPath.startsWith('/api/admin/'))try{await audit(req,'security.request.rejected',{path:auditPath,code:error.code||'INTERNAL_ERROR'});}catch{logger.error('Security audit write failed');}
   if(res.headersSent)return res.destroy();
   if(!(error instanceof HttpError))logger.error('API request failed:',error.code||error.name);
   json(res,error.status||500,{error:{code:error.code&&error.status?error.code:'INTERNAL_ERROR',message:error.status?(error.status===429&&auditPath.startsWith('/api/admin/mail-settings')?'메일 설정 요청이 많습니다. 잠시 후 다시 시도해 주세요.':error.message):'서버 처리 중 오류가 발생했습니다.'}});
  }
 };
 return handler;
}
export function createApplication(options){
 const server=http.createServer(createHandler(options));
 server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 return server;
}
