import * as oidc from 'openid-client';
import {SAML} from '@node-saml/node-saml';
import {DOMParser} from '@xmldom/xmldom';
import {Client as LdapClient} from 'ldapts';
import {token,digest,emailAddress} from './security.mjs';
import {fail} from './errors.mjs';

const lifetime=10*60*1000;
const text=v=>typeof v==='string'?v:'';
export const escapeLdapFilter=value=>String(value).replace(/[\\*()\0]/g,c=>'\\'+c.charCodeAt(0).toString(16).padStart(2,'0'));
export function identity(p,{subject,email,name,verified=false}){
 if(typeof subject!=='string'||!subject||subject.length>1024)fail(403,'INVALID_IDENTITY','인증 서버의 고유 사용자 ID가 필요합니다.');
 email=emailAddress(email);
 if(p.allowedDomains.length&&!p.allowedDomains.includes(email.split('@')[1]))fail(403,'DOMAIN_DENIED','허용된 조직 계정이 아닙니다.');
 if(p.autoProvision&&p.type==='oidc'&&!verified&&!p.trustEmail)fail(403,'UNVERIFIED_EMAIL','인증 서버의 이메일 검증 또는 명시적인 trustEmail 설정이 필요합니다.');
 return {providerKey:p.key,subject,email,name:(text(name).trim()||email).slice(0,80),autoProvision:p.autoProvision,sessionMinutes:p.sessionMinutes??60};
}
function xmlDocument(xml){
 if(typeof xml!=='string'||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsupported SAML XML.');
 return new DOMParser({errorHandler:{warning:()=>{},error:()=>{throw Error('Invalid XML.');},fatalError:()=>{throw Error('Invalid XML.');}}}).parseFromString(xml,'text/xml');
}
export function checkSamlEnvelope(profile,p,callbackUrl,requestId){
 const protocol='urn:oasis:names:tc:SAML:2.0:protocol',assertion='urn:oasis:names:tc:SAML:2.0:assertion';
 const response=xmlDocument(profile.getSamlResponseXml()).documentElement;
 if(response.localName!=='Response'||response.namespaceURI!==protocol||response.getAttribute('Destination')!==callbackUrl||response.getAttribute('InResponseTo')!==requestId)throw Error('SAML destination or request mismatch.');
 const status=response.getElementsByTagNameNS(protocol,'StatusCode');
 if(status.length!==1||status[0].getAttribute('Value')!=='urn:oasis:names:tc:SAML:2.0:status:Success')throw Error('SAML authentication failed.');
 const verified=xmlDocument(profile.getAssertionXml()).documentElement;
 const confirmations=Array.from(verified.getElementsByTagNameNS(assertion,'SubjectConfirmationData'));
 if(!confirmations.some(n=>n.getAttribute('Recipient')===callbackUrl&&n.getAttribute('InResponseTo')===requestId))throw Error('SAML recipient mismatch.');
 if(profile.issuer!==p.idpIssuer)throw Error('SAML issuer mismatch.');
 if(profile.nameIDFormat==='urn:oasis:names:tc:SAML:2.0:nameid-format:transient')throw Error('Persistent SAML NameID is required.');
}
export class Federation{
 constructor({providers=[],repo,origin,basePath='',ldapClient=LdapClient}){Object.assign(this,{providers,repo,origin,basePath,ldapClient});this.clients=new Map();}
 provider(id){const p=this.providers.find(p=>p.id===id);if(!p)fail(404,'PROVIDER_NOT_FOUND','인증 연결을 찾을 수 없습니다.');return p;}
 callback(p){return this.origin+this.basePath+'/api/auth/sso/'+p.id+'/callback';}
 list(){return this.providers.map(p=>({id:p.id,label:p.label,type:p.type}));}
 status(){return this.providers.map(p=>({...this.list().find(x=>x.id===p.id),key:p.key,autoProvision:p.autoProvision,allowedDomains:p.allowedDomains,callbackUrl:p.type==='ldap'?null:this.callback(p),metadataUrl:p.type==='saml'?this.origin+this.basePath+'/api/auth/sso/'+p.id+'/metadata':null}));}
 async client(p){
  if(!this.clients.has(p.key)){
   const auth=p.clientAuth==='client_secret_basic'?oidc.ClientSecretBasic(p.clientSecret):oidc.ClientSecretPost(p.clientSecret);
   const promise=oidc.discovery(new URL(p.issuer),p.clientId,{id_token_signed_response_alg:p.signingAlgorithm},auth,{timeout:10,execute:[oidc.enableNonRepudiationChecks,...(p.allowLoopbackHttp?[oidc.allowInsecureRequests]:[])]});
   this.clients.set(p.key,promise);promise.catch(()=>this.clients.delete(p.key));
  }
  return this.clients.get(p.key);
 }
 saml(p,requestId){
  const prefix='saml:'+p.key+':';
  const cacheProvider={
   saveAsync:async(key,value)=>{await this.repo.putTransient(prefix+digest(key),{value},lifetime);return {value,createdAt:Date.now()};},
   getAsync:async key=>(await this.repo.getTransient(prefix+digest(key)))?.value??null,
   removeAsync:async key=>key?(await this.repo.takeTransient(prefix+digest(key)))?.value??null:null,
  };
  return new SAML({entryPoint:p.entryPoint,issuer:p.entityId,idpIssuer:p.idpIssuer,audience:p.entityId,callbackUrl:this.callback(p),idpCert:p.idpCert,privateKey:p.privateKey,publicCert:p.publicCert,
   signatureAlgorithm:'sha256',digestAlgorithm:'sha256',wantAssertionsSigned:true,wantAuthnResponseSigned:true,validateInResponseTo:'always',cacheProvider,requestIdExpirationPeriodMs:lifetime,maxAssertionAgeMs:lifetime,acceptedClockSkewMs:60000,disableRequestedAuthnContext:true,identifierFormat:'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',...(requestId?{generateUniqueId:()=>requestId}:{})});
 }
 async begin(id){
  const p=this.provider(id);if(p.type==='ldap')fail(400,'INVALID_FLOW','디렉터리 로그인 양식을 사용해 주세요.');
  const state=token(),browser=token(),flow={providerKey:p.key,browserHash:digest(browser)};let location;
  if(p.type==='oidc'){
   const config=await this.client(p);flow.verifier=oidc.randomPKCECodeVerifier();flow.nonce=oidc.randomNonce();
   location=oidc.buildAuthorizationUrl(config,{redirect_uri:this.callback(p),scope:p.scopes.join(' '),response_type:'code',response_mode:'query',code_challenge:await oidc.calculatePKCECodeChallenge(flow.verifier),code_challenge_method:'S256',state,nonce:flow.nonce}).href;
  }else{
   flow.requestId='_'+token();location=await this.saml(p,flow.requestId).getAuthorizeUrlAsync(state,undefined,{});
  }
  await this.repo.putTransient('flow:'+digest(state),flow,lifetime);return {location,browser,type:p.type};
 }
 async finish(id,{url,form,browser}){
  const p=this.provider(id),state=p.type==='saml'?form?.RelayState:url.searchParams.get('state');
  if(!/^[a-zA-Z0-9_-]{43}$/.test(state||'')||!/^[a-zA-Z0-9_-]{43}$/.test(browser||''))fail(400,'INVALID_FLOW','인증 요청이 없거나 만료되었습니다. 다시 시작해 주세요.');
  const flow=await this.repo.takeTransient('flow:'+digest(state),digest(browser));
  if(!flow||flow.providerKey!==p.key)fail(400,'INVALID_FLOW','인증 요청이 없거나 만료되었습니다. 다시 시작해 주세요.');
  if(p.type==='oidc'){
   const config=await this.client(p),result=await oidc.authorizationCodeGrant(config,url,{pkceCodeVerifier:flow.verifier,expectedState:state,expectedNonce:flow.nonce,idTokenExpected:true});
   const claims=result.claims();
   const userInfo=(p.useUserInfo||!claims?.[p.emailClaim])&&config.serverMetadata().userinfo_endpoint?await oidc.fetchUserInfo(config,result.access_token,claims.sub):null;
   const source=userInfo||claims;
   return identity(p,{subject:claims?.sub,email:source?.[p.emailClaim],name:source?.[p.nameClaim],verified:source?.email_verified===true});
  }
  if(p.type!=='saml')fail(400,'INVALID_FLOW','인증 방식이 올바르지 않습니다.');
  const {profile,loggedOut}=await this.saml(p).validatePostResponseAsync(form);
  if(!profile||loggedOut)throw Error('SAML identity missing.');
  checkSamlEnvelope(profile,p,this.callback(p),flow.requestId);
  return identity(p,{subject:profile.nameID,email:profile[p.emailClaim],name:profile[p.nameClaim],verified:true});
 }
 metadata(id){const p=this.provider(id);if(p.type!=='saml')fail(404,'NOT_FOUND','SAML 연결이 아닙니다.');return this.saml(p).generateServiceProviderMetadata(null,p.publicCert);}
 async directory(id,username,password){
  const p=this.provider(id);if(p.type!=='ldap')fail(400,'INVALID_FLOW','디렉터리 연결이 아닙니다.');
  if(typeof username!=='string'||!username.trim()||username.length>254||typeof password!=='string'||!password||password.length>1024)fail(401,'LOGIN_FAILED','디렉터리 계정 정보를 확인해 주세요.');
  const options={url:p.url,timeout:10000,connectTimeout:10000,tlsOptions:{rejectUnauthorized:true,minVersion:'TLSv1.2',...(p.ca?{ca:p.ca}:{})}};
  const search=new this.ldapClient(options);let entry;
  try{
   await search.bind(p.bindDN,p.bindPassword);
   const result=await search.search(p.searchBase,{scope:'sub',filter:p.searchFilter.replace('{{username}}',escapeLdapFilter(username.trim())),sizeLimit:2,timeLimit:10,attributes:[p.subjectAttribute,p.emailAttribute,p.nameAttribute],explicitBufferAttributes:p.subjectAttribute==='objectGUID'?['objectGUID']:[]});
   if(result.searchReferences?.length||result.searchEntries.length!==1)throw Error('Directory entry is not unique.');
   entry=result.searchEntries[0];
  }finally{await search.unbind().catch(()=>{});}
  const auth=new this.ldapClient(options);
  try{await auth.bind(entry.dn,password);}finally{await auth.unbind().catch(()=>{});}
  const subject=entry[p.subjectAttribute];
  return identity(p,{subject:Buffer.isBuffer(subject)?'base64:'+subject.toString('base64'):subject,email:entry[p.emailAttribute],name:entry[p.nameAttribute],verified:true});
 }
}
