import fs from 'node:fs';
import path from 'node:path';
import {digest} from './security.mjs';

const required=(value,name)=>{if(typeof value!=='string'||!value.trim()||value.length>4096)throw Error('Invalid authentication config: '+name);return value;};
const attribute=(value,name)=>{required(value,name);if(!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value))throw Error('Invalid LDAP attribute: '+name);return value;};
function endpoint(value,{ldap=false,loopback=false}={}){
 const u=new URL(required(value,'URL'));
 if(u.username||u.password||u.hash||(!ldap&&u.protocol!=='https:'&&!(loopback&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))||(ldap&&u.protocol!=='ldaps:'))throw Error('Authentication endpoints require HTTPS or LDAPS.');
 return u.href;
}
export function parseAuthConfig(input,{directory=process.cwd(),origin='https://localhost'}={}){
 if(!input||!Array.isArray(input.providers)||input.providers.length>20)throw Error('Authentication config requires providers (maximum 20).');
 if(input.providers.some(p=>!p||typeof p!=='object'||Array.isArray(p)||(p.enabled!==undefined&&typeof p.enabled!=='boolean')))throw Error('Provider entries require an object and boolean enabled flag.');
 const seen=new Set();
 return input.providers.filter(p=>p.enabled!==false).map(raw=>{
  const p={...raw};
  if(!/^[a-z][a-z0-9_-]{0,39}$/.test(p.id)||seen.has(p.id))throw Error('Authentication provider IDs must be unique lowercase names.');seen.add(p.id);
  if(!['oidc','saml','ldap'].includes(p.type))throw Error('Supported authentication types: oidc, saml, ldap.');
  p.label=required(p.label||p.id,'label').slice(0,80);
  for(const flag of ['autoProvision','trustEmail','allowLoopbackHttp','useUserInfo'])if(p[flag]!==undefined&&typeof p[flag]!=='boolean')throw Error('Authentication flags must be boolean.');
  p.autoProvision=p.autoProvision===true;
  p.sessionMinutes=p.sessionMinutes??60;
  if(!Number.isInteger(p.sessionMinutes)||p.sessionMinutes<5||p.sessionMinutes>720)throw Error('sessionMinutes must be 5–720.');
  p.allowedDomains=p.allowedDomains||[];
  if(!Array.isArray(p.allowedDomains)||p.allowedDomains.some(d=>typeof d!=='string'||!/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(d)))throw Error('allowedDomains must contain exact lowercase email domains.');
  if(p.autoProvision&&!p.allowedDomains.length)throw Error('autoProvision requires allowedDomains.');
  const file=name=>fs.readFileSync(path.resolve(directory,required(p[name],name)),'utf8');
  if(p.type==='oidc'){
   const localOrigin=new URL(origin);
   if(p.allowLoopbackHttp&&!['localhost','127.0.0.1','[::1]'].includes(localOrigin.hostname))throw Error('Loopback HTTP is limited to local testing.');
   p.issuer=endpoint(p.issuer,{loopback:p.allowLoopbackHttp});
   if(new URL(p.issuer).search)throw Error('OIDC issuer must not have a query.');
   p.clientId=required(p.clientId,'clientId');p.clientSecret=file('clientSecretFile').replace(/\r?\n$/,'');required(p.clientSecret,'clientSecretFile');
   p.clientAuth=p.clientAuth||'client_secret_post';if(!['client_secret_post','client_secret_basic'].includes(p.clientAuth))throw Error('Unsupported clientAuth.');
   p.emailClaim=p.emailClaim||'email';p.nameClaim=p.nameClaim||'name';
   p.scopes=p.scopes||['openid','email','profile'];
   if(!Array.isArray(p.scopes)||!p.scopes.includes('openid')||p.scopes.includes('offline_access')||p.scopes.some(s=>typeof s!=='string'||!/^[A-Za-z0-9:._/-]{1,200}$/.test(s)))throw Error('OIDC scopes require openid and cannot request offline_access.');
   p.signingAlgorithm=p.signingAlgorithm||'RS256';if(!['RS256','PS256','ES256'].includes(p.signingAlgorithm))throw Error('Unsupported ID token signing algorithm.');
   p.authority=p.issuer;
  }else if(p.type==='saml'){
   if(new URL(origin).protocol!=='https:')throw Error('SAML requires HTTPS PUBLIC_ORIGIN for cross-site POST cookies.');
   p.entryPoint=endpoint(p.entryPoint);p.idpIssuer=required(p.idpIssuer,'idpIssuer');p.entityId=required(p.entityId,'entityId');
   p.idpCert=file('idpCertFile');p.privateKey=file('privateKeyFile');p.publicCert=file('publicCertFile');
   p.emailClaim=p.emailClaim||'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
   p.nameClaim=p.nameClaim||'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name';
   p.authority=p.idpIssuer;
  }else{
   p.url=endpoint(p.url,{ldap:true});
   p.bindDN=required(p.bindDN,'bindDN');p.bindPassword=file('bindPasswordFile').replace(/\r?\n$/,'');required(p.bindPassword,'bindPassword');
   p.searchBase=required(p.searchBase,'searchBase');p.searchFilter=required(p.searchFilter,'searchFilter');
   if(p.searchFilter.split('{{username}}').length!==2)throw Error('LDAP filter must contain exactly one {{username}}.');
   p.subjectAttribute=attribute(p.subjectAttribute||'objectGUID','subjectAttribute');
   p.emailAttribute=attribute(p.emailAttribute||'mail','emailAttribute');p.nameAttribute=attribute(p.nameAttribute||'displayName','nameAttribute');
   if(p.caFile)p.ca=file('caFile');
   p.authority=p.url+'|'+p.searchBase+'|'+p.subjectAttribute;
  }
  // The same config ID with a different tenant/issuer never reuses old identities.
  p.key=p.id+':'+digest(p.type+'|'+p.authority);return p;
 });
}
export function loadAuthConfig(env=process.env){
 if(!env.AUTH_CONFIG_FILE)return [];
 return parseAuthConfig(JSON.parse(fs.readFileSync(env.AUTH_CONFIG_FILE,'utf8')),{directory:path.dirname(path.resolve(env.AUTH_CONFIG_FILE)),origin:env.PUBLIC_ORIGIN||'http://localhost:3000'});
}
