import {createHmac,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {token,digest,safeEqual} from './security.mjs';
import {fail} from './errors.mjs';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buffer){let bits=0,value=0,out='';for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
function decode32(text){let bits=0,value=0,out=[];for(const c of text){const n=alphabet.indexOf(c);if(n<0)throw Error('Invalid TOTP secret.');value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function totp(secret,step=Math.floor(Date.now()/30000),digits=6){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const mac=createHmac('sha1',decode32(secret)).update(counter).digest(),offset=mac.at(-1)&15;return String((mac.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function seal(secret,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(secret),cipher.final(),cipher.getAuthTag()]).toString('base64');}
export function unseal(value,key){const data=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAuthTag(data.subarray(-16));return Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]).toString();}
export class AdminMfa{
 constructor(repo,key,{now=()=>Date.now()}={}){if(!Buffer.isBuffer(key)||key.length!==32)throw Error('MFA key must contain exactly 32 bytes.');Object.assign(this,{repo,key,now});}
 async begin(user,ip){
  const state=await this.repo.getMfa(user.id),challenge=token(),secret=state?null:base32(randomBytes(20));
  await this.repo.putTransient('mfa:'+digest(challenge),{userId:user.id,passwordHash:user.password_hash,email:user.email,ip,attempts:0,...(secret?{secret:seal(secret,this.key)}:{})},300000);
  return {mfaRequired:true,challenge,enrollment:!state,...(secret?{secret,uri:'otpauth://totp/'+encodeURIComponent('PMCanvas:'+user.email)+'?secret='+secret+'&issuer=PMCanvas&algorithm=SHA1&digits=6&period=30'}:{})};
 }
 async finish(challenge,code){
  if(!/^[A-Za-z0-9_-]{43}$/.test(challenge||'')||typeof code!=='string'||code.length>64)fail(401,'MFA_FAILED','인증 코드 또는 복구 코드를 확인해 주세요.');
  const key='mfa:'+digest(challenge),flow=await this.repo.reserveMfaChallenge(key);if(!flow)fail(401,'MFA_EXPIRED','인증 요청이 만료됐거나 시도 횟수를 초과했습니다. 다시 로그인해 주세요.');
  const current=await this.repo.findUserByEmail(flow.email);if(!current||current.id!==flow.userId||!current.is_admin||current.is_active===false||current.password_hash!==flow.passwordHash)fail(401,'MFA_EXPIRED','계정 정보가 변경되었습니다. 다시 로그인해 주세요.');
  const state=await this.repo.getMfa(flow.userId);if(!!flow.secret===!!state)fail(401,'MFA_EXPIRED','인증 설정이 변경되었습니다. 다시 로그인해 주세요.');
  const secret=unseal(flow.secret||state.secret,this.key),normalized=code.trim().toUpperCase(),step=Math.floor(this.now()/30000);
  let matched=null;for(const n of [step-1,step,step+1])if(n>=0&&safeEqual(totp(secret,n),normalized))matched=n;
  const recoveryHash=matched===null?digest(normalized):null;
  if(matched===null&&(!state||!state.recovery_hashes.includes(recoveryHash)))fail(401,'MFA_FAILED','인증 코드 또는 복구 코드를 확인해 주세요.');
  const recoveryCodes=flow.secret?Array.from({length:10},()=>base32(randomBytes(10)).match(/.{4}/g).join('-')):null;
  await this.repo.completeMfa({key,userId:flow.userId,passwordHash:flow.passwordHash,step:matched,recoveryHash,enrollment:flow.secret?{secret:flow.secret,recoveryHashes:recoveryCodes.map(digest)}:null});
  return {user:current,ip:flow.ip,recoveryCodes};
 }
}
