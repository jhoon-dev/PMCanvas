// Disposable browser verification only. No production database or forwarding.
if(process.env.RUN_RESET_PREVIEW!=='1')throw Error('Set RUN_RESET_PREVIEW=1 for disposable browser verification.');
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {MemoryRepository} from './memory-repository.mjs';
import {smtpFixture,resetLink} from './smtp-fixture.mjs';
import {createMailer} from '../../server/mailer.mjs';
import {PasswordReset} from '../../server/password-reset.mjs';
import {createApplication} from '../../server/http.mjs';
import {hashPassword} from '../../server/security.mjs';
const smtp=await smtpFixture(),mailer=createMailer({from:'sender@example.com',transport:{host:'127.0.0.1',port:smtp.port,secure:true,tls:{ca:smtp.ca,servername:'localhost',rejectUnauthorized:true},disableFileAccess:true,disableUrlAccess:true}});
const repo=new MemoryRepository([{id:randomUUID(),email:'reset-preview@example.com',name:'재설정 검증 사용자',password_hash:await hashPassword('preview-original-password'),is_active:true,is_admin:false}]);
const origin='http://localhost:4183',basePath='/pmcanvas',passwordReset=new PasswordReset({repo,mailer,origin,basePath});
const app=createApplication({repo,origin,basePath,passwordReset}),mailbox=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({url:resetLink(smtp.messages.at(-1)||''),count:smtp.messages.length}));});
app.listen(4183,'127.0.0.1');mailbox.listen(4182,'127.0.0.1');console.log('Disposable password reset preview: '+origin+basePath+'/');
async function stop(){app.closeAllConnections();mailbox.closeAllConnections();app.close();mailbox.close();await passwordReset.idle();mailer.close();await smtp.close();process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);setTimeout(stop,10*60*1000).unref();
