// Public runner: decrypt source only in the ephemeral runner, encrypt diagnostics.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createDecipheriv,createCipheriv,createHash,randomBytes} from 'node:crypto';
if(process.env.NODE_OPTIONS||process.env.NODE_DEBUG||process.env.NODE_V8_COVERAGE)throw Error('Private runtime required');
const key=Buffer.from(process.env.FONTV_SOURCE_KEY||'','base64');delete process.env.FONTV_SOURCE_KEY;
if(key.length!==32)throw Error('Missing source key');
const source=JSON.parse(fs.readFileSync('.github/ci/fontv-source.enc.json','utf8'));
const metadata={schema:source.schema,sourceCommit:source.sourceCommit,archiveSha256:source.archiveSha256};
if(metadata.schema!==1||!/^([a-f0-9]{40})$/.test(metadata.sourceCommit))throw Error('Invalid source metadata');
if(process.env.EXPECTED_COMMIT!==metadata.sourceCommit)throw Error('Unexpected source commit');
const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'fontv-'));fs.chmodSync(root,0o700);
let output=Buffer.from('No build output'),status=1;
try{
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(source.iv,'base64'));decipher.setAAD(Buffer.from(JSON.stringify(metadata)));decipher.setAuthTag(Buffer.from(source.tag,'base64'));
 const zip=Buffer.concat([decipher.update(Buffer.from(source.ciphertext,'base64')),decipher.final()]);
 if(createHash('sha256').update(zip).digest('hex')!==metadata.archiveSha256)throw Error('Archive hash mismatch');
 const archive=path.join(root,'source.zip');fs.writeFileSync(archive,zip,{mode:0o600});
 const dest=path.join(root,'source');fs.mkdirSync(dest,{mode:0o700});
 execFileSync('python3',['-c',`import zipfile,sys,pathlib,stat
z=zipfile.ZipFile(sys.argv[1])
for i in z.infolist():
 p=pathlib.PurePosixPath(i.filename)
 assert not p.is_absolute() and '..' not in p.parts and not stat.S_ISLNK(i.external_attr>>16)
z.extractall(sys.argv[2])`,archive,dest],{stdio:'pipe'});
 console.log(`Building Font V source ${metadata.sourceCommit}; diagnostics remain encrypted.`);
 const result=spawnSync(process.execPath,['tool/ios_ci.mjs'],{cwd:dest,env:process.env,encoding:null,maxBuffer:100*1024*1024,timeout:65*60*1000});
 output=Buffer.concat([result.stdout||Buffer.alloc(0),result.stderr||Buffer.alloc(0),Buffer.from(result.error?.message||'')]);status=result.status??1;
}catch(e){output=Buffer.from(e.stack||String(e));}
finally{
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(output),cipher.final()]);
 fs.mkdirSync('fontv-result',{recursive:true});
 fs.writeFileSync('fontv-result/diagnostics.enc.json',JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));
 fs.writeFileSync('fontv-result/status.json',JSON.stringify({...metadata,status,build:process.env.FONTV_BUILD_NUMBER}));
 fs.rmSync(root,{recursive:true,force:true});
}
console.log(`Font V build finished with status ${status}.`);process.exitCode=status;
