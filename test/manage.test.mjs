import test from 'node:test';
import assert from 'node:assert/strict';
import {setupValues} from '../scripts/manage.mjs';

test('설치 설정은 서로 다른 비밀번호와 지정한 접속 주소를 생성',()=>{
 const config=setupValues({email:' Admin@Example.com ',origin:'http://localhost:4180',port:'4180'});
 assert.equal(config.ADMIN_EMAIL,'admin@example.com');
 assert.equal(config.PUBLIC_ORIGIN,'http://localhost:4180');
 assert.equal(config.APP_PORT,'4180');
 assert.equal(new Set([config.DB_PASSWORD,config.DB_ADMIN_PASSWORD,config.ADMIN_PASSWORD]).size,3);
 assert.match(config.ADMIN_PASSWORD,/^[a-f0-9]{64}$/);
 assert.notEqual(config.ADMIN_PASSWORD,setupValues({email:'a@example.com'}).ADMIN_PASSWORD);
});
test('설치 설정은 잘못된 이메일·포트·공개 HTTP·경로와 환경변수 삽입을 거절',()=>{
 for(const options of [{email:'bad'}, {port:'0'}, {port:'65536'}, {port:'3000\nX=1'}, {origin:'http://public.example.com'}, {origin:'https://example.com/pmcanvas'}, {origin:'https://example.com/'}, {origin:'https://example.com\nX=1'}]){
  assert.throws(()=>setupValues({email:'admin@example.com',...options}));
 }
 assert.equal(setupValues({email:'admin@example.com',origin:'https://example.com'}).PUBLIC_ORIGIN,'https://example.com');
});
