import fs from 'node:fs';
import path from 'node:path';
import {hkdfSync} from 'node:crypto';
import {seal,unseal} from './admin-mfa.mjs';
import {fail} from './errors.mjs';
import {mailConfig,createMailer,mailAddress} from './mailer.mjs';

export function reviewRecipients(value=[]){
 if(typeof value==='string'){if(value.length>4096)fail(400,'MAIL_RECIPIENTS','승인 요청 수신 이메일은 최대 10개까지 입력해 주세요.');value=value.split(/[,\r\n]+/).map(s=>s.trim()).filter(Boolean);}
 if(!Array.isArray(value)||value.length>10||value.some(v=>typeof v!=='string'))fail(400,'MAIL_RECIPIENTS','승인 요청 수신 이메일은 쉼표나 줄바꿈으로 구분해 최대 10개까지 입력해 주세요.');
 return [...new Set(value.map(v=>mailAddress(v.trim())))];
}
const empty=()=>({enabled:false,host:'',port:587,secure:false,from:'',authEnabled:true,username:'',reviewRecipients:[]});
export function legacyMailSettings(env=process.env){
 const file=env.MAIL_CONFIG_FILE||'config/mail.json';
 if(!fs.existsSync(file)){if(env.MAIL_CONFIG_FILE)throw Error('MAIL_CONFIG_FILE was not found.');return {config:empty(),password:''};}
 let raw;try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Invalid mail configuration JSON.');}
 mailConfig(raw,{directory:path.dirname(path.resolve(file))});
 let password='';
 if(raw.username&&raw.passwordFile){const secret=path.resolve(path.dirname(file),raw.passwordFile);if(fs.existsSync(secret))password=fs.readFileSync(secret,'utf8').replace(/\r?\n$/,'');}
 return {config:{enabled:raw.enabled,host:raw.host||'',port:raw.port||587,secure:!!raw.secure,from:raw.from||'',authEnabled:!!raw.username,username:raw.username||'',reviewRecipients:reviewRecipients(raw.reviewRecipients)},password};
}
export class MailSettings{
 constructor({repo,key,legacy={config:empty(),password:''},makeMailer=createMailer}){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Mail settings require a 32-byte encryption key.');
  this.repo=repo;this.key=Buffer.from(hkdfSync('sha256',key,Buffer.alloc(0),'pmcanvas-smtp-settings-v1',32));this.legacy=legacy;this.makeMailer=makeMailer;this.sending=0;
 }
 async current({decrypt=true}={}){
  const row=await this.repo.getMailSettings();
  if(!row)return {...this.legacy,hasPassword:!!this.legacy.password,revision:0};
  let password='';try{password=decrypt&&row.password_encrypted?unseal(row.password_encrypted,this.key):'';}catch{fail(503,'MAIL_KEY','메일 인증 정보를 읽지 못했습니다. 서버 설정을 확인해 주세요.');}
  return {config:row.config,password,hasPassword:!!row.password_encrypted,revision:row.revision};
 }
 async public(){const state=await this.current({decrypt:false});return {...state.config,reviewRecipients:reviewRecipients(state.config.reviewRecipients),hasPassword:state.hasPassword,revision:state.revision};}
 reviewRecipients(){return reviewRecipients(this.legacy.config.reviewRecipients);}
 async enabled(){return (await this.public()).enabled;}
 async save(actorId,body){
  const old=await this.current({decrypt:false});
  if(!Number.isSafeInteger(body.revision)||body.revision!==old.revision)fail(409,'MAIL_CONFLICT','다른 관리자가 설정을 변경했습니다. 다시 열어 최신 설정을 확인해 주세요.');
  for(const flag of ['enabled','secure','authEnabled'])if(typeof body[flag]!=='boolean')fail(400,'MAIL_CONFIG','메일 사용·보안 연결·인증 설정을 확인해 주세요.');
  if(typeof body.host!=='string'||body.host.length>253||/[\s/@?#:]/.test(body.host)||!Number.isInteger(body.port)||body.port<1||body.port>65535)fail(400,'MAIL_CONFIG','SMTP 서버 주소와 포트를 확인해 주세요.');
  if(typeof body.from!=='string'||typeof body.username!=='string'||body.username.length>254||/[\r\n]/.test(body.username)||typeof body.password!=='string'||body.password.length>4096)fail(400,'MAIL_CONFIG','발신 이메일과 인증 계정을 확인해 주세요.');
  const config={enabled:body.enabled,host:body.host,port:body.port,secure:body.secure,from:body.from?mailAddress(body.from):'',authEnabled:body.authEnabled,username:body.authEnabled?body.username:'',reviewRecipients:reviewRecipients(body.reviewRecipients===undefined?old.config.reviewRecipients:body.reviewRecipients)};
  const sameIdentity=config.host===old.config.host&&config.username===old.config.username;
  const password=config.authEnabled?(body.password||(sameIdentity&&old.hasPassword?(await this.current()).password:'')):'';
  if(config.enabled&&(!config.host||!config.from||config.authEnabled&&(!config.username||!password)))fail(400,'MAIL_CONFIG','서버·발신 이메일·인증 정보를 입력해 주세요. 서버나 계정을 바꾸면 비밀번호를 다시 입력해야 합니다.');
  if(config.enabled)mailConfig({...config,username:config.authEnabled?config.username:''},{password});
  await this.repo.saveMailSettings(actorId,{config,passwordEncrypted:password?seal(password,this.key):null,revision:body.revision});
  return this.public();
 }
 async #send(method,argument){
  if(this.sending>=2)fail(503,'MAIL_BUSY','메일 발송 중입니다. 잠시 후 다시 시도해 주세요.');
  this.sending++;let mailer;
  try{const state=await this.current();if(!state.config.enabled)fail(400,'MAIL_DISABLED','이메일 발송을 사용하도록 설정을 저장해 주세요.');
   mailer=this.makeMailer(mailConfig({...state.config,username:state.config.authEnabled?state.config.username:''},{password:state.password}));
   if(method==='sendReset')await mailer.sendReset(argument);
   else if(method==='sendVerification')await mailer.sendVerification(argument);
   else if(method==='sendApproval')await mailer.sendApproval(argument);
   else if(method==='sendReviewRequest')await mailer.sendReviewRequest(argument);
   else await mailer.sendTest(argument);
  }finally{mailer?.close();this.sending--;}
 }
 sendReset(message){return this.#send('sendReset',message);}
 sendVerification(message){return this.#send('sendVerification',message);}
 sendApproval(message){return this.#send('sendApproval',message);}
 sendReviewRequest(message){return this.#send('sendReviewRequest',message);}
 async test(to){
  to=mailAddress(to);
  try{await this.#send('sendTest',to);}catch(error){
   if(error.status)throw error;
   fail(502,'MAIL_TEST_FAILED',error.code==='EAUTH'?'SMTP 인증에 실패했습니다. 계정과 비밀번호를 확인해 주세요.':['ETLS','ESOCKET','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(error.code)?'보안 연결에 실패했습니다. 포트·연결 방식·서버 인증서를 확인해 주세요.':'메일을 보내지 못했습니다. 서버 주소·포트·발신 권한과 수신 주소를 확인해 주세요.');
  }
 }
 close(){}
}
