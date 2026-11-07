// One-time authorized transfer to Font V's own protected Actions environment.
// Only the encrypted envelope leaves this runner.
import fs from 'node:fs';
import {createCipheriv,randomBytes} from 'node:crypto';
if(process.env.NODE_OPTIONS||process.env.NODE_DEBUG||process.env.NODE_V8_COVERAGE)throw Error('Private runtime required');
const key=Buffer.from(process.env.FONTV_SOURCE_KEY||'','base64');delete process.env.FONTV_SOURCE_KEY;
if(key.length!==32)throw Error('Transfer key missing');
const names=['MAS_CSC_LINK','MAS_CSC_KEY_PASSWORD','ASC_KEY_BASE64','ASC_KEY_ID','ASC_ISSUER_ID'];
const values={};for(const name of names){if(!process.env[name])throw Error(`Missing ${name}`);values[name]=process.env[name];delete process.env[name];}
const metadata={schema:1,destination:'jhoon-dev/fontv',environment:'apple-testflight',names};
const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
const plaintext=Buffer.from(JSON.stringify(values));const data=Buffer.concat([cipher.update(plaintext),cipher.final()]);plaintext.fill(0);
fs.mkdirSync('fontv-transfer',{recursive:true});
fs.writeFileSync('fontv-transfer/signing.enc.json',JSON.stringify({...metadata,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:data.toString('base64')})+'\n');
console.log('Created encrypted Font V signing transfer. No credential values are logged.');
