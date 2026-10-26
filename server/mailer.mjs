import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import {emailAddress} from './security.mjs';
import {fail} from './errors.mjs';

export function mailAddress(value){const address=emailAddress(value);if(/[<>,;:"\\()[\]]/.test(address))fail(400,'INVALID_EMAIL','이메일 주소 하나를 입력해 주세요.');return address;}

export function mailConfig(raw,{directory=process.cwd(),password}={}){
 if(!raw||typeof raw.enabled!=='boolean')throw Error('Mail configuration requires a boolean enabled flag.');
 if(!raw.enabled)return null;
 if(typeof raw.host!=='string'||!raw.host||raw.host.length>253||/[\s/@?#:]/.test(raw.host))throw Error('Invalid SMTP host.');
 if(!Number.isInteger(raw.port)||raw.port<1||raw.port>65535||typeof raw.secure!=='boolean')throw Error('SMTP port and secure flag are required.');
 const from=mailAddress(raw.from);
 let auth;
 if(raw.username||raw.passwordFile){
  if(typeof raw.username!=='string'||!raw.username||raw.username.length>254||(typeof password!=='string'&&(typeof raw.passwordFile!=='string'||!raw.passwordFile)))throw Error('SMTP username and passwordFile must be supplied together.');
  const pass=typeof password==='string'?password:fs.readFileSync(path.resolve(directory,raw.passwordFile),'utf8').replace(/\r?\n$/,'');
  if(!pass||pass.length>4096)throw Error('Invalid SMTP password file.');
  auth={user:raw.username,pass};
 }
 return {from,transport:{host:raw.host,port:raw.port,secure:raw.secure,requireTLS:!raw.secure,tls:{rejectUnauthorized:true},...(auth?{auth}:{}),connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false}};
}
export function createMailer(config,{createTransport=nodemailer.createTransport}={}){
 if(!config)return null;
 const transport=createTransport(config.transport);
 return {
  async sendReset({to,url}){
   const info=await transport.sendMail({from:{name:'PM Canvas',address:config.from},to:{address:mailAddress(to)},subject:'[PM Canvas] 비밀번호 재설정',text:'비밀번호 재설정을 요청하셨습니다.\n\n아래 링크에서 새 비밀번호를 설정하세요. 링크는 15분 동안 한 번만 사용할 수 있습니다.\n\n'+url+'\n\n요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 링크에서 변경을 완료하기 전까지 유지됩니다.'});
   if(!info.accepted?.length||info.rejected?.length)throw Object.assign(Error('SMTP recipient rejected'),{code:'MAIL_REJECTED'});
  },
  async sendTest(to){
   const info=await transport.sendMail({from:{name:'PM Canvas',address:config.from},to:{address:mailAddress(to)},subject:'[PM Canvas] 테스트 메일',text:'PM Canvas 관리자 화면에서 요청한 테스트 메일입니다.\n\n이 메일이 도착했다면 현재 SMTP 설정으로 메일을 전달할 수 있습니다.'});
   if(!info.accepted?.length||info.rejected?.length)throw Object.assign(Error('SMTP recipient rejected'),{code:'MAIL_REJECTED'});
  },
  verify:()=>transport.verify(),
  close:()=>transport.close()
 };
}
export function loadMailer(env=process.env){
 const file=env.MAIL_CONFIG_FILE||'config/mail.json';
 if(!fs.existsSync(file)){if(env.MAIL_CONFIG_FILE)throw Error('MAIL_CONFIG_FILE was not found.');return null;}
 let raw;try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Invalid mail configuration JSON.');}
 return createMailer(mailConfig(raw,{directory:path.dirname(path.resolve(file))}));
}
