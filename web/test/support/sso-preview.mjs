import { AdminMfa } from '../../server/admin-mfa.mjs';
// Local, disposable UI verification harness. Never used by server/main.mjs.
import http from 'node:http';
import { generateKeyPairSync, createHash, sign, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAuthConfig } from '../../server/auth-config.mjs';
import { Federation } from '../../server/federation.mjs';
import { createApplication } from '../../server/http.mjs';
import { hashPassword } from '../../server/security.mjs';
import { MemoryRepository } from './memory-repository.mjs';

if (process.env.RUN_SSO_PREVIEW !== '1') throw Error('Test harness requires RUN_SSO_PREVIEW=1.');
const issuer = 'http://127.0.0.1:4182',
  origin = 'http://localhost:4183',
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-sso-preview-'));
fs.writeFileSync(path.join(directory, 'secret.txt'), 'test-client-secret');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'preview', alg: 'RS256', use: 'sig' },
  codes = new Map();
const jwt = (payload) => {
  const input = [{ alg: 'RS256', kid: 'preview' }, payload]
    .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
    .join('.');
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
};
const idp = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, issuer);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/.well-known/openid-configuration')
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          jwks_uri: issuer + '/jwks',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        }),
      );
    if (url.pathname === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === '/authorize') {
      if (
        url.searchParams.get('redirect_uri') !== origin + '/pmcanvas/api/auth/sso/demo/callback' ||
        url.searchParams.get('client_id') !== 'pmcanvas'
      )
        throw Error('Invalid client.');
      const code = randomUUID();
      codes.set(code, {
        challenge: url.searchParams.get('code_challenge'),
        nonce: url.searchParams.get('nonce'),
      });
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: callback.href });
      return res.end();
    }
    if (url.pathname === '/token') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const saved = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      if (
        !saved ||
        form.get('client_secret') !== 'test-client-secret' ||
        createHash('sha256')
          .update(form.get('code_verifier') || '')
          .digest('base64url') !== saved.challenge
      )
        throw Error('Invalid grant.');
      const now = Math.floor(Date.now() / 1000);
      return res.end(
        JSON.stringify({
          access_token: 'preview-token',
          token_type: 'Bearer',
          id_token: jwt({
            iss: issuer,
            aud: 'pmcanvas',
            sub: 'preview-stable-subject',
            nonce: saved.nonce,
            iat: now,
            exp: now + 300,
            email: 'sso@example.com',
            email_verified: true,
            name: 'SSO 검증 사용자',
          }),
        }),
      );
    }
    res.statusCode = 404;
    res.end('{}');
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'invalid_request' }));
  }
});
const providers = parseAuthConfig(
  {
    providers: [
      {
        id: 'demo',
        type: 'oidc',
        label: '테스트 회사 SSO',
        issuer,
        clientId: 'pmcanvas',
        clientSecretFile: 'secret.txt',
        allowLoopbackHttp: true,
        autoProvision: true,
        allowedDomains: ['example.com'],
      },
      {
        id: 'ad-preview',
        type: 'ldap',
        label: '테스트 AD',
        url: 'ldaps://dc.example.com',
        bindDN: 'reader',
        bindPasswordFile: 'secret.txt',
        searchBase: 'dc=example,dc=com',
        searchFilter: '(sAMAccountName={{username}})',
        allowedDomains: ['example.com'],
        autoProvision: true,
      },
    ],
  },
  { directory, origin },
);
const repo = new MemoryRepository([
  {
    id: randomUUID(),
    email: 'admin@example.com',
    name: '테스트 관리자',
    password_hash: await hashPassword('preview-admin-password'),
    is_admin: true,
  },
]);
const app = createApplication({
  repo,
  origin,
  adminMfa: new AdminMfa(repo, Buffer.alloc(32, 8)),
  basePath: '/pmcanvas',
  federation: new Federation({ repo, origin, basePath: '/pmcanvas', providers }),
});
idp.listen(4182, '127.0.0.1');
app.listen(4183, '127.0.0.1');
console.log('Disposable SSO preview: ' + origin + '/pmcanvas/');
function stop() {
  app.closeAllConnections();
  idp.closeAllConnections();
  app.close();
  idp.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
process.once('SIGINT', () => {
  stop();
  process.exit(0);
});
process.once('SIGTERM', () => {
  stop();
  process.exit(0);
});
setTimeout(
  () => {
    stop();
    process.exit(0);
  },
  10 * 60 * 1000,
).unref();
