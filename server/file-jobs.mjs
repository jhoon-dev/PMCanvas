import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fail} from './errors.mjs';
let active=0;
export async function fileJob(kind,input){
 if(active>=2)fail(429,'FILE_BUSY','파일 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
 active++;
 try{return await new Promise((resolve,reject)=>{
  const env={NODE_ENV:'production'};for(const k of ['SystemRoot','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
  const child=spawn(process.execPath,['--max-old-space-size=192',fileURLToPath(new URL('./file-job-child.mjs',import.meta.url)),'--file-job',kind],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  const chunks=[];let size=0,error='',exceeded=false;
  const timer=setTimeout(()=>{exceeded=true;child.kill();},15000);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){exceeded=true;child.kill();}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{if(error.length<2000)error+=chunk.toString();});
  child.stdin.on('error',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(Error('파일 작업 프로세스를 시작하지 못했습니다.'));});
  child.once('close',code=>{clearTimeout(timer);if(exceeded)return reject(Error('파일 처리 한도를 초과했습니다. 출력 범위 또는 파일 크기를 줄여 주세요.'));if(code!==0)return reject(Error(error.trim().slice(0,300)||'파일을 처리하지 못했습니다.'));resolve(Buffer.concat(chunks));});
  child.stdin.end(JSON.stringify(input));
 });}finally{active--;}
}
