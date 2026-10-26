import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import selfsigned from 'selfsigned';
import { SignedXml } from 'xml-crypto';
import { parseAuthConfig, loadAuthConfig } from '../server/auth-config.mjs';
import { Federation, identity, escapeLdapFilter } from '../server/federation.mjs';
import { digest } from '../server/security.mjs';
import { MemoryRepository } from './support/memory-repository.mjs';
import { createApplication } from '../server/http.mjs';

function files(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'secret.txt'), 'client-secret');
  return directory;
}
const oidcConfig = {
  id: 'company',
  type: 'oidc',
  label: '회사',
  issuer: 'https://idp.example.com/realm',
  clientId: 'pmcanvas',
  clientSecretFile: 'secret.txt',
  allowedDomains: ['example.com'],
  autoProvision: true,
};
test('인증 컨피그: 여러 연결·기본 비활성·도메인·TLS·중복 ID·issuer 격리', (t) => {
  const directory = files(t),
    parse = (p) => parseAuthConfig({ providers: p }, { directory });
  assert.deepEqual(loadAuthConfig({}), []);
  assert.deepEqual(parse([{ enabled: false }]), []);
  const [p] = parse([oidcConfig]);
  assert.equal(p.clientSecret, 'client-secret');
  assert.equal(p.type, 'oidc');
  assert.notEqual(
    p.key,
    parse([{ ...oidcConfig, issuer: 'https://different.example.com/realm' }])[0].key,
  );
  for (const providers of [
    [oidcConfig, oidcConfig],
    [{ ...oidcConfig, issuer: 'http://idp.example.com' }],
    [{ ...oidcConfig, allowedDomains: [] }],
    [{ ...oidcConfig, type: 'magic' }],
    [{ ...oidcConfig, clientAuth: 'none' }],
  ])
    assert.throws(() => parse(providers));
  assert.throws(() =>
    parseAuthConfig(
      { providers: [{ ...oidcConfig, issuer: 'http://127.0.0.1:9876', allowLoopbackHttp: true }] },
      { directory, origin: 'https://pm.example.com' },
    ),
  );
});
test('자동 생성은 검증한 이메일과 정확한 도메인만 허용하며 외부 고유 ID 필수', () => {
  const p = { ...oidcConfig, key: 'key' };
  assert.throws(
    () => identity(p, { subject: 'user', email: 'a@example.com' }),
    (e) => e.code === 'UNVERIFIED_EMAIL',
  );
  assert.throws(
    () => identity(p, { subject: 'user', email: 'a@evil-example.com', verified: true }),
    (e) => e.code === 'DOMAIN_DENIED',
  );
  assert.throws(() => identity(p, { subject: '', email: 'a@example.com', verified: true }));
  assert.equal(
    identity(p, { subject: 'user', email: 'A@example.com', verified: true }).email,
    'a@example.com',
  );
});
async function oidcFixture(t) {
  const directory = files(t),
    { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  let issuer,
    claims = {},
    badSignature = false,
    userInfo = {
      sub: 'stable-subject',
      email: 'person@example.com',
      email_verified: true,
      name: 'UserInfo 사용자',
    };
  const codes = new Map();
  const jwt = (payload) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url'),
      b = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return (
      h +
      '.' +
      b +
      '.' +
      (badSignature
        ? Buffer.alloc(256)
        : sign('RSA-SHA256', Buffer.from(h + '.' + b), privateKey)
      ).toString('base64url')
    );
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/.well-known/openid-configuration'))
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          userinfo_endpoint: issuer + '/userinfo',
          jwks_uri: issuer + '/jwks',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        }),
      );
    if (url.pathname === '/userinfo') return res.end(JSON.stringify(userInfo));
    if (url.pathname === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === '/token') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const code = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      if (!code || digest(form.get('code_verifier') || '') !== code.verifierDigest) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      const now = Math.floor(Date.now() / 1000);
      return res.end(
        JSON.stringify({
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          id_token: jwt({
            iss: issuer,
            aud: 'pmcanvas',
            sub: 'stable-subject',
            nonce: code.nonce,
            iat: now,
            exp: now + 300,
            email: 'person@example.com',
            email_verified: true,
            name: '테스트 사용자',
            ...claims,
          }),
        }),
      );
    }
    res.statusCode = 404;
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  issuer = 'http://127.0.0.1:' + server.address().port;
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const [p] = parseAuthConfig(
    { providers: [{ ...oidcConfig, issuer, allowLoopbackHttp: true }] },
    { directory, origin: 'http://localhost:3000' },
  );
  const repo = new MemoryRepository(),
    f = new Federation({
      repo,
      providers: [p],
      origin: 'http://localhost:3000',
      basePath: '/pmcanvas',
    });
  async function completeUrl(location) {
    const url = new URL(location),
      state = url.searchParams.get('state'),
      flow = await repo.getTransient('flow:' + digest(state)),
      code = randomUUID();
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_type'), 'code');
    codes.set(code, {
      nonce: url.searchParams.get('nonce'),
      verifierDigest: digest(flow.verifier),
    });
    return new URL(f.callback(p) + '?state=' + state + '&code=' + code);
  }
  async function start() {
    const begun = await f.begin(p.id);
    return { begun, url: await completeUrl(begun.location) };
  }
  return {
    f,
    p,
    repo,
    start,
    completeUrl,
    claims: (value) => (claims = value),
    badSignature: () => (badSignature = true),
    userInfo: (value) => (userInfo = { ...userInfo, ...value }),
  };
}
test('OIDC UserInfo 이메일 조회 및 다른 sub 응답 거부', async (t) => {
  const x = await oidcFixture(t);
  x.claims({ email: undefined, email_verified: undefined });
  const a = await x.start(),
    user = await x.f.finish(x.p.id, { url: a.url, browser: a.begun.browser });
  assert.equal(user.name, 'UserInfo 사용자');
  x.userInfo({ sub: 'another-person' });
  const b = await x.start();
  await assert.rejects(x.f.finish(x.p.id, { url: b.url, browser: b.begun.browser }));
});
test('OIDC HTTP: 공개 연결 목록에 비밀 제외·콜백 쿠키·로컬 로그인 차단·재사용 차단', async (t) => {
  const x = await oidcFixture(t),
    server = createApplication({
      repo: x.repo,
      federation: x.f,
      origin: x.f.origin,
      basePath: '/pmcanvas',
      logger: { error() {} },
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/pmcanvas/api/';
  let r = await fetch(base + 'auth/providers');
  const publicText = await r.text();
  assert.equal(publicText.includes('client-secret'), false);
  assert.equal(publicText.includes('issuer'), false);
  r = await fetch(base + 'auth/sso/company/start', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
  const browser = r.headers.get('set-cookie').split(';')[0],
    callback = await x.completeUrl(r.headers.get('location'));
  r = await fetch(base + 'auth/sso/company/callback' + callback.search, {
    redirect: 'manual',
    headers: { Cookie: browser },
  });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/pmcanvas/');
  const cookie = r.headers
    .getSetCookie()
    .find((c) => c.startsWith('pmcanvas_session='))
    .split(';')[0];
  assert.match(r.headers.getSetCookie()[0], /Max-Age=3600/);
  r = await fetch(base + 'auth/me', { headers: { Cookie: cookie } });
  const session = await r.json();
  assert.equal(session.user.localLogin, false);
  assert.equal(session.user.isAdmin, false);
  r = await fetch(base + 'auth/password', {
    method: 'POST',
    headers: {
      Origin: x.f.origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrf,
    },
    body: JSON.stringify({ currentPassword: 'anything', newPassword: 'new-password-123' }),
  });
  assert.equal(r.status, 400);
  r = await fetch(base + 'auth/connections', { headers: { Cookie: cookie } });
  assert.equal(r.status, 403);
  r = await fetch(base + 'auth/sso/company/callback' + callback.search, {
    redirect: 'manual',
    headers: { Cookie: browser },
  });
  assert.match(r.headers.get('location'), /authError=SSO_FAILED/);
  r = await fetch(base + 'auth/sso/company/callback', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'SAMLResponse=anything',
  });
  assert.equal(r.status, 404);
});
test('OIDC 실제 discovery·PKCE·ID 토큰 서명·브라우저 바인딩·일회성 state', async (t) => {
  const x = await oidcFixture(t),
    a = await x.start();
  await assert.rejects(
    x.f.finish(x.p.id, { url: a.url, browser: 'a'.repeat(43) }),
    (e) => e.code === 'INVALID_FLOW',
  );
  const id = await x.f.finish(x.p.id, { url: a.url, browser: a.begun.browser });
  assert.equal(id.subject, 'stable-subject');
  await assert.rejects(
    x.f.finish(x.p.id, { url: a.url, browser: a.begun.browser }),
    (e) => e.code === 'INVALID_FLOW',
  );
  const b = await x.start();
  x.badSignature();
  await assert.rejects(x.f.finish(x.p.id, { url: b.url, browser: b.begun.browser }));
});
for (const [name, claims] of [
  ['issuer', { iss: 'https://attacker.example.com' }],
  ['audience', { aud: 'another-client' }],
  ['nonce', { nonce: 'wrong-nonce' }],
  ['expiry', { exp: 1 }],
])
  test('OIDC 잘못된 ' + name + ' 거부', async (t) => {
    const x = await oidcFixture(t),
      a = await x.start();
    x.claims(claims);
    await assert.rejects(x.f.finish(x.p.id, { url: a.url, browser: a.begun.browser }));
  });
const xmlEsc = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function signed(xml, element, cert) {
  const sig = new SignedXml({
    privateKey: cert.private,
    publicCert: cert.cert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: "//*[local-name()='" + element + "']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  sig.computeSignature(xml, {
    location: {
      reference: "//*[local-name()='" + element + "']/*[local-name()='Issuer']",
      action: 'after',
    },
  });
  return sig.getSignedXml();
}
async function samlFixture(t) {
  const directory = files(t),
    cert = await selfsigned.generate([{ name: 'commonName', value: 'test-only-idp' }], {
      keySize: 2048,
      days: 1,
      algorithm: 'sha256',
    });
  for (const [file, value] of [
    ['idp.crt', cert.cert],
    ['sp.crt', cert.cert],
    ['sp.key', cert.private],
  ])
    fs.writeFileSync(path.join(directory, file), value);
  const [p] = parseAuthConfig(
    {
      providers: [
        {
          id: 'saml',
          type: 'saml',
          label: 'SAML',
          entryPoint: 'https://idp.example.com/sso',
          idpIssuer: 'https://idp.example.com/issuer',
          entityId: 'pmcanvas-test',
          idpCertFile: 'idp.crt',
          privateKeyFile: 'sp.key',
          publicCertFile: 'sp.crt',
          allowedDomains: ['example.com'],
          autoProvision: true,
        },
      ],
    },
    { directory, origin: 'https://pm.example.com' },
  );
  const repo = new MemoryRepository(),
    f = new Federation({
      repo,
      providers: [p],
      origin: 'https://pm.example.com',
      basePath: '/pmcanvas',
    });
  async function start(overrides = {}) {
    const begun = await f.begin(p.id),
      url = new URL(begun.location),
      state = url.searchParams.get('RelayState'),
      request = inflateRawSync(
        Buffer.from(url.searchParams.get('SAMLRequest'), 'base64'),
      ).toString();
    assert.match(request, /AuthnRequest/);
    assert.ok(url.searchParams.get('Signature'));
    const flow = await repo.getTransient('flow:' + digest(state)),
      now = new Date().toISOString(),
      expires = new Date(Date.now() + 300000).toISOString(),
      acs = f.callback(p),
      recipient = overrides.recipient || acs;
    let assertion =
      '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_' +
      randomUUID() +
      '" Version="2.0" IssueInstant="' +
      now +
      '"><saml:Issuer>' +
      p.idpIssuer +
      '</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">stable-name-id</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="' +
      xmlEsc(recipient) +
      '" InResponseTo="' +
      flow.requestId +
      '" NotOnOrAfter="' +
      expires +
      '"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="' +
      new Date(Date.now() - 10000).toISOString() +
      '" NotOnOrAfter="' +
      expires +
      '"><saml:AudienceRestriction><saml:Audience>' +
      p.entityId +
      '</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="' +
      now +
      '" SessionIndex="test-session"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="' +
      p.emailClaim +
      '"><saml:AttributeValue>person@example.com</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>';
    if (!overrides.unsigned) assertion = signed(assertion, 'Assertion', cert);
    let response =
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_' +
      randomUUID() +
      '" Version="2.0" IssueInstant="' +
      now +
      '" Destination="' +
      xmlEsc(acs) +
      '" InResponseTo="' +
      flow.requestId +
      '"><saml:Issuer>' +
      p.idpIssuer +
      '</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' +
      assertion +
      '</samlp:Response>';
    if (!overrides.unsigned) response = signed(response, 'Response', cert);
    return {
      begun,
      form: { RelayState: state, SAMLResponse: Buffer.from(response).toString('base64') },
    };
  }
  return { p, f, start };
}
test('SAML 실제 서명 응답·assertion·메타데이터·SP 요청·재사용 차단', async (t) => {
  const x = await samlFixture(t),
    a = await x.start();
  assert.match(x.f.metadata(x.p.id), /EntityDescriptor/);
  const id = await x.f.finish(x.p.id, { form: a.form, browser: a.begun.browser });
  assert.equal(id.subject, 'stable-name-id');
  await assert.rejects(x.f.finish(x.p.id, { form: a.form, browser: a.begun.browser }));
});
test('SAML 서명 없는 응답 및 잘못된 Recipient 거부', async (t) => {
  const x = await samlFixture(t);
  for (const overrides of [{ unsigned: true }, { recipient: 'https://attacker.example.com/acs' }]) {
    const a = await x.start(overrides);
    await assert.rejects(x.f.finish(x.p.id, { form: a.form, browser: a.begun.browser }));
  }
});
test('SAML HTTP: 교차 출처 POST는 바인딩된 요청만 허용, SameSite None·Secure', async (t) => {
  const x = await samlFixture(t),
    repo = x.f.repo,
    server = createApplication({
      repo,
      federation: x.f,
      origin: 'https://pm.example.com',
      basePath: '/pmcanvas',
      logger: { error() {} },
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/pmcanvas/api/auth/sso/saml/';
  let r = await fetch(base + 'start', { redirect: 'manual' });
  assert.match(r.headers.get('set-cookie'), /SameSite=None; Secure/);
  const a = await x.start();
  r = await fetch(base + 'callback', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://idp.example.com',
      Cookie: 'pmcanvas_sso=' + a.begun.browser,
    },
    body: new URLSearchParams(a.form),
  });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/pmcanvas/');
  const b = await x.start();
  r = await fetch(base + 'callback', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://idp.example.com',
    },
    body: new URLSearchParams(b.form),
  });
  assert.match(r.headers.get('location'), /authError=SSO_FAILED/);
});
test('AD LDAPS: TLS 검증·검색 필터 이스케이프·별도 사용자 bind·고유 GUID', async () => {
  const calls = [];
  class Client {
    constructor(options) {
      calls.push(['options', options]);
    }
    async bind(dn, password) {
      calls.push(['bind', dn, password]);
    }
    async search(base, options) {
      calls.push(['search', base, options]);
      return {
        searchEntries: [
          {
            dn: 'CN=Person,DC=example,DC=com',
            objectGUID: Buffer.from('stable-guid'),
            mail: 'person@example.com',
            displayName: '사용자',
          },
        ],
        searchReferences: [],
      };
    }
    async unbind() {
      calls.push(['unbind']);
    }
  }
  const p = {
    id: 'ad',
    key: 'ad-key',
    type: 'ldap',
    url: 'ldaps://dc.example.com',
    bindDN: 'reader',
    bindPassword: 'secret',
    searchBase: 'dc=example,dc=com',
    searchFilter: '(sAMAccountName={{username}})',
    subjectAttribute: 'objectGUID',
    emailAttribute: 'mail',
    nameAttribute: 'displayName',
    allowedDomains: ['example.com'],
    autoProvision: true,
  };
  const f = new Federation({
    providers: [p],
    repo: new MemoryRepository(),
    origin: 'https://pm.example.com',
    ldapClient: Client,
  });
  const id = await f.directory('ad', 'a*)(x=1', 'user-password');
  assert.equal(id.subject, 'base64:' + Buffer.from('stable-guid').toString('base64'));
  assert.equal(calls.filter((c) => c[0] === 'bind').length, 2);
  assert.equal(calls.filter((c) => c[0] === 'unbind').length, 2);
  assert.equal(calls[0][1].tlsOptions.rejectUnauthorized, true);
  assert.match(calls.find((c) => c[0] === 'search')[2].filter, /a\\2a\\29\\28x=1/);
  assert.equal(escapeLdapFilter('\0*()\\'), '\\00\\2a\\28\\29\\5c');
  const before = calls.length;
  await assert.rejects(f.directory('ad', 'person', ''));
  assert.equal(calls.length, before);
});
test('LDAPS HTTP: Origin·빈 비밀번호 검증 및 외부 전용 계정 로그인', async (t) => {
  class Client {
    async bind(dn, password) {
      if (dn === 'CN=Person' && password !== 'correct-password') throw Error('Invalid bind');
    }
    async search() {
      return {
        searchEntries: [
          {
            dn: 'CN=Person',
            entryUUID: 'directory-stable-subject',
            mail: 'person@example.com',
            displayName: '디렉터리 사용자',
          },
        ],
        searchReferences: [],
      };
    }
    async unbind() {}
  }
  const p = {
    id: 'ad',
    key: 'ad-key',
    type: 'ldap',
    url: 'ldaps://dc.example.com',
    bindDN: 'reader',
    bindPassword: 'secret',
    searchBase: 'dc=example,dc=com',
    searchFilter: '(uid={{username}})',
    subjectAttribute: 'entryUUID',
    emailAttribute: 'mail',
    nameAttribute: 'displayName',
    allowedDomains: ['example.com'],
    autoProvision: true,
  };
  const repo = new MemoryRepository(),
    origin = 'https://pm.example.com',
    federation = new Federation({ providers: [p], repo, origin, ldapClient: Client }),
    server = createApplication({ repo, origin, federation, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/';
  const post = (password, headers = {}) =>
    fetch(base + 'auth/directory', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ provider: 'ad', username: 'person', password }),
    });
  assert.equal(
    (await post('correct-password', { Origin: 'https://attacker.example.com' })).status,
    403,
  );
  assert.equal((await post('')).status, 400);
  assert.equal((await post('wrong-password')).status, 401);
  const response = await post('correct-password');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.user.localLogin, false);
  assert.equal((await repo.findUserByEmail('person@example.com')).password_hash, '');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.equal((await fetch(base + 'projects', { headers: { Cookie: cookie } })).status, 200);
});
