// Disposable administrator UI verification. TLS mail is received on loopback only.
if(process.env.RUN_MAIL_ADMIN_PREVIEW!=='1')throw Error('Set RUN_MAIL_ADMIN_PREVIEW=1.');
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {MemoryRepository} from './memory-repository.mjs';
import {smtpFixture} from './smtp-fixture.mjs';
import {createMailer} from '../../server/mailer.mjs';
import {MailSettings} from '../../server/mail-settings.mjs';
import {PasswordReset} from '../../server/password-reset.mjs';
import {AdminMfa} from '../../server/admin-mfa.mjs';
import {createApplication} from '../../server/http.mjs';
import {hashPassword} from '../../server/security.mjs';
const smtp=await smtpFixture(),key=Buffer.alloc(32,7),hash=await hashPassword('preview-admin-password'),repo=new MemoryRepository([{id:randomUUID(),email:'admin@example.com',name:'테스트 관리자',password_hash:hash,is_admin:true,is_active:true},{id:randomUUID(),email:'member@example.com',name:'테스트 일반 계정',password_hash:hash,is_admin:false,is_active:true}]);
const makeMailer=config=>createMailer({...config,transport:{...config.transport,tls:{...config.transport.tls,ca:smtp.ca,servername:'localhost'}}});
const mailSettings=new MailSettings({repo,key,makeMailer}),origin='http://localhost:4183',basePath='/pmcanvas',passwordReset=new PasswordReset({repo,mailer:mailSettings,origin,basePath});
const app=createApplication({repo,origin,basePath,passwordReset,mailSettings,adminMfa:new AdminMfa(repo,key)}),mailbox=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({port:smtp.port,count:smtp.messages.length}));});
app.listen(4183,'127.0.0.1');mailbox.listen(4182,'127.0.0.1');console.log('Disposable SMTP admin preview: '+origin+basePath+'/');
async function stop(){app.closeAllConnections();mailbox.closeAllConnections();app.close();mailbox.close();await passwordReset.idle();await smtp.close();process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);setTimeout(stop,10*60*1000).unref();
