import {readWorkbook} from './excel-import.mjs';
import {projectWorkbook} from './excel.mjs';
import {validDate,today} from '../public/engine.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {HttpError,fail} from './errors.mjs';
import {token,digest,safeEqual,hashPassword,verifyPassword,emailAddress,cookieValue,sessionCookie,LoginLimiter} from './security.mjs';
import {cleanProject,uuid} from './project.mjs';
import {Federation} from './federation.mjs';

export function createHandler({repo,origin='http://localhost:3000',basePath='',logger=console,federation=new Federation({repo,origin,basePath})}){
 if(new URL(origin).origin!==origin)throw Error('PUBLIC_ORIGIN must contain only scheme and host, without a path or trailing slash.');
 if(basePath&&!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath))throw Error('BASE_PATH must be empty or a path without a trailing slash.');
 const secure=new URL(origin).protocol==='https:',limiter=new LoginLimiter(),ipLimiter=new LoginLimiter({limit:40}),passwordLimiter=new LoginLimiter();
 const cookieConfig={secure,basePath};
 const federationLimiter=new LoginLimiter({limit:30}),directoryLimiter=new LoginLimiter();
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
 const readJson=async req=>{
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)fail(413,'BODY_TOO_LARGE','요청은 8MB 이하로 보내 주세요.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_JSON','JSON 객체가 필요합니다.');return value;}catch(error){if(error.status)throw error;fail(400,'INVALID_JSON','JSON 형식을 확인해 주세요.');}
 };
 const authenticate=async req=>{
  const value=cookieValue(req,'pmcanvas_session');
  const session=value?await repo.findSession(digest(value)):null;
  if(!session)fail(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  return {...session,hash:digest(value)};
 };
 const handler=async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try{
   let path=new URL(req.url,origin).pathname;
   if(basePath&&path===basePath){res.writeHead(308,{Location:basePath+'/'});return res.end();}
   if(basePath){if(!path.startsWith(basePath+'/'))fail(404,'NOT_FOUND','페이지를 찾을 수 없습니다.');path=path.slice(basePath.length);}
   const method=req.method;
   if(path==='/api/health'&&method==='GET'){try{await repo.health();return json(res,200,{ok:true});}catch{return json(res,503,{ok:false});}}
   if(path==='/api/auth/providers'&&method==='GET')return json(res,200,{providers:federation.list()});
   const sso=path.match(/^\/api\/auth\/sso\/([a-z][a-z0-9_-]{0,39})\/(start|callback|metadata)$/);
   if(sso){
    const [,id,action]=sso,p=federation.provider(id);
    if(action==='metadata'&&method==='GET'){
     res.writeHead(200,{'Content-Type':'application/samlmetadata+xml; charset=utf-8','Cache-Control':'no-store'});return res.end(federation.metadata(id));
    }
    if(action==='start'&&method==='GET'){
     federationLimiter.check(req.socket.remoteAddress||'unknown');federationLimiter.failure(req.socket.remoteAddress||'unknown');
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
      const result=await externalLogin(identity);
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
    const body=await readJson(req),ip=req.socket.remoteAddress||'unknown';
    federationLimiter.check(ip);federationLimiter.failure(ip);
    if(typeof body.provider!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(body.provider)||typeof body.username!=='string'||!body.username.trim()||body.username.length>254||typeof body.password!=='string'||!body.password||body.password.length>1024)fail(400,'INVALID_LOGIN','디렉터리 계정 정보를 확인해 주세요.');
    const key=String(body.provider)+'|'+String(body.username).trim().toLowerCase();directoryLimiter.check(key);
    try{
     const identity=await federation.directory(body.provider,body.username,body.password),result=await externalLogin(identity);
     directoryLimiter.clear(key);const old=cookieValue(req,'pmcanvas_session');if(old)await repo.deleteSession(digest(old));
     return json(res,200,{user:result.user,csrf:result.csrf},{'Set-Cookie':result.cookie});
    }catch(error){directoryLimiter.failure(key);if(error.status===403||error.code==='IDENTITY_UNLINKED')throw error;fail(401,'LOGIN_FAILED','디렉터리 인증에 실패했습니다. 계정 정보와 연결 설정을 확인해 주세요.');}
   }
   if(path==='/api/auth/login'&&method==='POST'){
    const body=await readJson(req),email=emailAddress(body.email),ip=req.socket.remoteAddress||'unknown';
    limiter.check(email);ipLimiter.check(ip);
    const user=await repo.findUserByEmail(email);
    const valid=await verifyPassword(body.password,user?.password_hash||await dummyHash);
    if(!user||!valid||user.is_active===false||user.local_login===false){limiter.failure(email);ipLimiter.failure(ip);fail(401,'LOGIN_FAILED','이메일 또는 비밀번호를 확인해 주세요.');}
    limiter.clear(email);ipLimiter.clear(ip);
    const old=cookieValue(req,'pmcanvas_session');if(old)await repo.deleteSession(digest(old));
    const value=token(),csrf=token();
    await repo.createSession({hash:digest(value),userId:user.id,csrf,expires:new Date(Date.now()+12*60*60*1000),passwordHash:user.password_hash});
    return json(res,200,{user:{id:user.id,email:user.email,name:user.name,isAdmin:!!user.is_admin,localLogin:true},csrf},{'Set-Cookie':sessionCookie(value,cookieConfig)});
   }
   const session=await authenticate(req),user=session.user;
   if(mutation&&!safeEqual(req.headers['x-csrf-token'],session.csrf))fail(403,'CSRF_FAILED','보안 토큰을 갱신하려면 다시 로그인해 주세요.');
   if(path==='/api/auth/me'&&method==='GET')return json(res,200,{user,csrf:session.csrf});
   if(path==='/api/auth/logout'&&method==='POST'){
    await repo.deleteSession(session.hash);return json(res,200,{ok:true},{'Set-Cookie':sessionCookie('',{...cookieConfig,maxAge:0})});
   }
   if(path==='/api/auth/password'&&method==='POST'){
    const body=await readJson(req);passwordLimiter.check(user.id);
    const stored=await repo.findUserByEmail(user.email);
    if(stored?.local_login===false)fail(400,'EXTERNAL_PASSWORD','외부 인증 계정의 비밀번호는 인증 서버에서 변경해 주세요.');
    if(!stored||!await verifyPassword(body.currentPassword,stored.password_hash)){
     passwordLimiter.failure(user.id);fail(400,'CURRENT_PASSWORD','현재 비밀번호가 일치하지 않습니다.');
    }
    if(body.currentPassword===body.newPassword)fail(400,'SAME_PASSWORD','현재와 다른 새 비밀번호를 입력해 주세요.');
    const passwordHash=await hashPassword(body.newPassword);
    await repo.changePassword(user.id,stored.password_hash,passwordHash);passwordLimiter.clear(user.id);
    return json(res,200,{ok:true},{'Set-Cookie':sessionCookie('',{...cookieConfig,maxAge:0})});
   }
   if(path==='/api/auth/connections'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자 권한이 필요합니다.');
    if(method==='GET')return json(res,200,{providers:federation.status(),identities:await repo.listIdentities()});
    if(method==='POST'||method==='DELETE'){
     const body=await readJson(req),p=federation.provider(body.provider);
     if(typeof body.subject!=='string'||!body.subject||body.subject.length>1024)fail(400,'INVALID_SUBJECT','외부 계정의 고유 ID를 입력해 주세요.');
     if(method==='POST')return json(res,200,await repo.linkIdentity(user.id,{providerKey:p.key,subject:body.subject,email:emailAddress(body.email)}));
     return json(res,200,await repo.unlinkIdentity(user.id,p.key,body.subject));
    }
   }
   const userMatch=path.match(/^\/api\/users\/([^/]+)$/);
   if(userMatch&&method==='PATCH'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자만 계정을 관리할 수 있습니다.');
    if(!uuid(userMatch[1]))fail(404,'USER_NOT_FOUND','계정을 찾을 수 없습니다.');
    const body=await readJson(req),keys=Object.keys(body);
    if(keys.length!==1||!['isActive','password'].includes(keys[0]))fail(400,'INVALID_UPDATE','계정 상태 또는 비밀번호 중 하나를 지정해 주세요.');
    if('isActive' in body&&typeof body.isActive!=='boolean')fail(400,'INVALID_STATUS','계정 상태가 올바르지 않습니다.');
    const update='password' in body?{passwordHash:await hashPassword(body.password)}:{isActive:body.isActive};
    return json(res,200,{user:await repo.manageUser(user.id,userMatch[1],update)});
   }
   if(path==='/api/users'){
    if(!user.isAdmin)fail(403,'FORBIDDEN','관리자만 계정을 관리할 수 있습니다.');
    if(method==='GET')return json(res,200,{users:await repo.listUsers()});
    if(method==='POST'){
     const body=await readJson(req),email=emailAddress(body.email);
     if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)fail(400,'INVALID_NAME','이름을 확인해 주세요.');
     const passwordHash=await hashPassword(body.password);
     return json(res,201,{user:await repo.createUser({email,name:body.name.trim(),passwordHash,isAdmin:false})});
    }
   }
   const importMatch=path.match(/^\/api\/projects\/([^/]+)\/import-excel$/);
   if(importMatch&&method==='POST'){
    if(!uuid(importMatch[1]))fail(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');
    const project=await repo.getProject(user.id,importMatch[1]);if(project._role==='viewer')fail(403,'FORBIDDEN','편집 권한이 필요합니다.');
    const body=await readJson(req);try{return json(res,200,{sheets:await readWorkbook(body.file)});}catch(e){fail(400,'INVALID_EXCEL',e.message);}
   }
   const exportMatch=path.match(/^\/api\/projects\/([^/]+)\/export\.xlsx$/);
   if(exportMatch&&method==='POST'){
    if(!uuid(exportMatch[1]))fail(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');
    const saved=await repo.getProject(user.id,exportMatch[1]),body=await readJson(req);
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
   if(res.headersSent)return res.destroy();
   if(!(error instanceof HttpError))logger.error('API request failed:',error.code||error.name);
   json(res,error.status||500,{error:{code:error.code&&error.status?error.code:'INTERNAL_ERROR',message:error.status?error.message:'서버 처리 중 오류가 발생했습니다.'}});
  }
 };
 return handler;
}
export function createApplication(options){
 const server=http.createServer(createHandler(options));
 server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 return server;
}
