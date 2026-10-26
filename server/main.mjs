import fs from 'node:fs';
import {AdminMfa} from './admin-mfa.mjs';
import {createPool,migrate,PgRepository} from './postgres.mjs';
import {createApplication} from './http.mjs';
import {hashPassword,emailAddress} from './security.mjs';
import {loadAuthConfig} from './auth-config.mjs';
import {Federation} from './federation.mjs';
import {registrationConfig,RegistrationEmail} from './registration.mjs';
import {MailSettings,legacyMailSettings} from './mail-settings.mjs';
import {PasswordReset} from './password-reset.mjs';
const pool=await createPool(),repo=new PgRepository(pool);
try{
 await migrate(pool);
 if(await repo.countUsers()===0){
  if(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD)throw Error('First start requires ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters).');
  await repo.createUser({email:emailAddress(process.env.ADMIN_EMAIL),name:process.env.ADMIN_NAME||'관리자',passwordHash:await hashPassword(process.env.ADMIN_PASSWORD),isAdmin:true});
  console.log('Initial administrator created.');
 }
 const origin=process.env.PUBLIC_ORIGIN||'http://localhost:3000';
 if(new URL(origin).protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)&&process.env.ALLOW_HTTP!=='true')throw Error('Use HTTPS for PUBLIC_ORIGIN, or explicitly ALLOW_HTTP=true for a private test network.');
 if(new URL(origin).protocol==='https:'&&!process.env.TRUSTED_PROXIES)throw Error('HTTPS reverse proxy deployments require exact TRUSTED_PROXIES IP addresses and an overwritten X-Forwarded-For header.');
 const basePath=process.env.BASE_PATH||'',providers=loadAuthConfig();
 const federation=new Federation({repo,origin,basePath,providers});
 const keyFile=process.env.MFA_KEY_FILE||'config/secrets/mfa.key';const key=fs.readFileSync(keyFile);if(key.length!==32)throw Error('MFA_KEY_FILE must contain 32 random bytes. Run npm run setup or npm run service:up.');
 const mailer=new MailSettings({repo,key,legacy:(await repo.getMailSettings())?undefined:legacyMailSettings()}),passwordReset=new PasswordReset({repo,mailer,origin,basePath});
 const registrationEmail=new RegistrationEmail({repo,mailer,origin,basePath});registrationEmail.start();
 const server=createApplication({repo,origin,basePath,federation,passwordReset,registrationEmail,mailSettings:mailer,registration:registrationConfig(process.env),adminMfa:new AdminMfa(repo,key),trustProxies:process.env.TRUSTED_PROXIES||''});
 console.log('Password reset email:',await mailer.enabled()?'enabled':'not configured');
 console.log('Authentication connections:',providers.map(p=>p.id+' ('+p.type+')').join(', ')||'local only');
 const port=Number(process.env.PORT||3000),host=process.env.HOST||'0.0.0.0';
 server.listen(port,host,()=>console.log('PM Canvas API listening on port '+port));
 const stop=()=>{server.close(async()=>{await registrationEmail.close();await passwordReset?.idle();mailer?.close();await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch(error){console.error('Startup failed:',error.message);await pool.end();process.exitCode=1;}
