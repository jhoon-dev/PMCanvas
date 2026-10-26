import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {fail} from './errors.mjs';
const rawScrypt=promisify(scryptCallback);let running=0;const waiting=[];
async function scrypt(...args){
 if(running>=2){if(waiting.length>=24)fail(503,'AUTH_BUSY','인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.');await new Promise(resolve=>waiting.push(resolve));}else running++;
 try{return await rawScrypt(...args);}finally{const next=waiting.shift();if(next)next();else running--;}
}
export const token=()=>randomBytes(32).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function emailAddress(value){
 if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))fail(400,'INVALID_EMAIL','이메일 주소를 확인해 주세요.');
 return value.trim().toLowerCase();
}
export function passwordValue(value){
 if(typeof value!=='string'||value.length<12||value.length>256)fail(400,'INVALID_PASSWORD','비밀번호는 12~256자로 입력해 주세요.');
 return value;
}
export async function hashPassword(value){
 passwordValue(value);const salt=randomBytes(16).toString('hex');
 const hash=await scrypt(value,salt,64,{N:131072,r:8,p:1,maxmem:160*1024*1024});
 return 'scrypt-v2:'+salt+':'+hash.toString('hex');
}
export async function verifyPassword(value,stored){
 if(typeof value!=='string'||value.length>256)return false;
 const [version,salt,expected]=String(stored).split(':');
 if(!['scrypt-v1','scrypt-v2'].includes(version)||!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(expected||''))return false;
 const actual=await scrypt(value,salt,64,{N:version==='scrypt-v1'?16384:131072,r:8,p:1,maxmem:160*1024*1024});
 return timingSafeEqual(actual,Buffer.from(expected,'hex'));
}
export function cookieValue(req,name){
 const entry=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
 if(!entry)return null;
 const value=entry.slice(name.length+1);
 return /^[a-zA-Z0-9_-]{43}$/.test(value)?value:null;
}
export function sessionCookie(value,{secure,basePath='',maxAge=43200}){
 return 'pmcanvas_session='+value+'; Path='+(basePath||'')+'/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':'');
}
export class LoginLimiter{
 constructor({limit=8,windowMs=15*60*1000,now=()=>Date.now()}={}){Object.assign(this,{limit,windowMs,now});this.entries=new Map();}
 check(key){
  const now=this.now();for(const [k,v]of this.entries)if(v.until<=now)this.entries.delete(k);
  const entry=this.entries.get(key);
  if(entry&&entry.count>=this.limit)fail(429,'RATE_LIMIT','로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
  if(this.entries.size>=5000&&!entry)fail(429,'RATE_LIMIT','잠시 후 다시 시도해 주세요.');
 }
 failure(key){const old=this.entries.get(key);this.entries.set(key,old&&old.until>this.now()?{...old,count:old.count+1}:{count:1,until:this.now()+this.windowMs});}
 clear(key){this.entries.delete(key);}
}
