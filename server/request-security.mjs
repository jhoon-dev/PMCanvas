import {isIP} from 'node:net';
import {digest,LoginLimiter} from './security.mjs';
import {fail} from './errors.mjs';
export const normalizedIp=value=>String(value||'').replace(/^::ffff:/,'');
export function proxyList(value=''){
 const ips=value.split(',').map(v=>normalizedIp(v.trim())).filter(Boolean);
 if(ips.some(ip=>!isIP(ip)))throw Error('TRUSTED_PROXIES must contain exact proxy IP addresses.');return new Set(ips);
}
export function clientAddress(req,trusted=new Set()){
 const peer=normalizedIp(req.socket?.remoteAddress);
 if(trusted.has(peer)){
  const forwarded=req.headers['x-forwarded-for'];
  if(typeof forwarded!=='string'||!isIP(forwarded.trim()))fail(400,'INVALID_PROXY','프록시의 클라이언트 IP 설정을 확인해 주세요.');
  return normalizedIp(forwarded.trim());
 }
 // Shared local ingress must not create a global 15-minute login lockout.
 const privateIngress=/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd]|fe80:)/i.test(peer);
 return privateIngress?null:peer;
}
export function requestLimiter(repo){
 const local=new Map();
 return async(key,limit=8,windowMs=900000)=>{
  const hashed=digest(key);
  if(repo.reserveAttempt)return repo.reserveAttempt(hashed,limit,windowMs);
  if(!local.has(limit+':'+windowMs))local.set(limit+':'+windowMs,new LoginLimiter({limit,windowMs}));
  const limiter=local.get(limit+':'+windowMs);limiter.check(hashed);limiter.failure(hashed);
 };
}
