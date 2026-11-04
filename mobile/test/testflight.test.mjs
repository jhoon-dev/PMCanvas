import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  appleToken,
  distributeTestFlight,
  existingInternalGroup,
  matchingBuild,
  groupName,
} from '../scripts/testflight.mjs';

const expected = { bundleId: 'app.toolmoa.pmcanvas', version: '0.3.0', buildNumber: '41.1' };
const buildResponse = (state = 'VALID', version = expected.version) => ({
  data: [
    {
      type: 'builds',
      id: 'build-1',
      attributes: { version: expected.buildNumber, processingState: state, expired: false },
      relationships: { preReleaseVersion: { data: { id: 'release-1' } } },
    },
  ],
  included: [
    { type: 'preReleaseVersions', id: 'release-1', attributes: { version, platform: 'IOS' } },
  ],
});
const group = () => ({
  id: 'group-1',
  attributes: { name: groupName, isInternalGroup: true, hasAccessToAllBuilds: false },
});

test('TestFlight selects both the marketing version and build and requires the existing internal group', () => {
  assert.equal(matchingBuild(buildResponse(), expected).id, 'build-1');
  assert.equal(matchingBuild(buildResponse('VALID', '0.1.0'), expected), undefined);
  assert.throws(() => existingInternalGroup([]), /existing/);
  assert.throws(
    () =>
      existingInternalGroup([
        { ...group(), attributes: { name: groupName, isInternalGroup: false } },
      ]),
    /internal group/,
  );
  assert.throws(() => existingInternalGroup([group(), group()]), /existing/);
});

function fixture(states = ['VALID'], linked = false) {
  const writes = [],
    delays = [];
  const request = async (route, options) => {
    const url = new URL(route, 'https://api.appstoreconnect.apple.com');
    if (url.pathname === '/v1/apps')
      return { data: [{ id: 'app-1', attributes: { bundleId: expected.bundleId } }] };
    if (url.pathname === '/v1/apps/app-1/betaGroups') return { data: [group()] };
    if (url.pathname === '/v1/builds')
      return buildResponse(states.length > 1 ? states.shift() : states[0]);
    if (url.pathname === '/v1/betaGroups/group-1/relationships/builds') {
      if (options?.method === 'POST') {
        writes.push({ route, ...options });
        linked = true;
        return {};
      }
      return { data: linked ? [{ id: 'build-1', type: 'builds' }] : [] };
    }
    if (url.pathname === '/v1/builds/build-1/buildBetaDetail')
      return { data: { attributes: { internalBuildState: 'IN_BETA_TESTING' } } };
    throw Error('Unexpected API call: ' + route);
  };
  return { request, writes, delays, pause: async (ms) => delays.push(ms) };
}

test('Apple processing is awaited before adding only the requested build, and reruns preserve existing access', async () => {
  const run = fixture(['PROCESSING', 'VALID']);
  const result = await distributeTestFlight(run.request, expected, { pause: run.pause });
  assert.equal(result.available, true);
  assert.equal(result.testersChanged, false);
  assert.equal(result.internalBuildState, 'IN_BETA_TESTING');
  assert.deepEqual(run.delays, [30000]);
  assert.deepEqual(run.writes, [
    {
      route: '/v1/betaGroups/group-1/relationships/builds',
      method: 'POST',
      body: { data: [{ type: 'builds', id: 'build-1' }] },
    },
  ]);
  const repeat = fixture(['VALID'], true);
  await distributeTestFlight(repeat.request, expected);
  assert.deepEqual(repeat.writes, []);
});

test('failed or unprocessed Apple builds never change tester access', async () => {
  const failed = fixture(['INVALID']);
  await assert.rejects(distributeTestFlight(failed.request, expected), /Apple rejected/);
  assert.deepEqual(failed.writes, []);
  const pending = fixture(['PROCESSING']);
  await assert.rejects(
    distributeTestFlight(pending.request, expected, { attempts: 1 }),
    /still pending/,
  );
  assert.deepEqual(pending.writes, []);
});

test('Apple API tokens use an expiring ES256 signature without persisting the private key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const token = appleToken(privateKey, 'KEY1234567', '11111111-2222-3333-4444-555555555555', 1000);
  const [header, payload, signature] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    iss: '11111111-2222-3333-4444-555555555555',
    iat: 1000,
    exp: 1300,
    aud: 'appstoreconnect-v1',
  });
  assert.equal(
    verify(
      'sha256',
      Buffer.from(header + '.' + payload),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    ),
    true,
  );
});
