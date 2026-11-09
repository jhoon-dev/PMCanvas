import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  appleToken,
  distributeTestFlight,
  existingInternalGroup,
  matchingBuild,
  testFlightInputs,
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

test('macOS build selection cannot select an iOS build with the same version and build number', () => {
  const mac = { ...expected, platform: 'MAC_OS' };
  assert.equal(matchingBuild(buildResponse(), mac), undefined);
  const response = buildResponse();
  response.included[0].attributes.platform = 'MAC_OS';
  assert.equal(matchingBuild(response, mac).id, 'build-1');
  assert.equal(matchingBuild(response, expected), undefined);
  assert.throws(() => matchingBuild(response, { ...mac, platform: 'TV_OS' }), /Unsupported/);
});

test('TestFlight inputs use the selected package version and reject wrong refs or build formats', () => {
  const mobile = { version: '0.3.2' };
  const desktop = { version: '1.9.1', build: { appId: expected.bundleId } };
  const config = { appId: expected.bundleId };
  const env = {
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'jhoon-dev/PMCanvas',
    PM_MAS_TEAM_ID: 'ABCDE12345',
    PM_TESTFLIGHT_BUILD_NUMBER: '42',
    PM_TESTFLIGHT_PLATFORM: 'macos',
  };
  assert.deepEqual(testFlightInputs(mobile, desktop, config, env), {
    bundleId: expected.bundleId,
    version: '1.9.1',
    team: env.PM_MAS_TEAM_ID,
    buildNumber: '42',
    platform: 'MAC_OS',
  });
  for (const change of [
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_REPOSITORY: 'other/repo' },
    { PM_TESTFLIGHT_BUILD_NUMBER: '42.1' },
    { PM_TESTFLIGHT_PLATFORM: 'tvos' },
  ])
    assert.throws(() => testFlightInputs(mobile, desktop, config, { ...env, ...change }));
  assert.throws(() =>
    testFlightInputs(mobile, { ...desktop, build: { appId: 'other.app' } }, config, env),
  );
  const ios = testFlightInputs(mobile, desktop, config, {
    ...env,
    PM_TESTFLIGHT_PLATFORM: 'ios',
    PM_TESTFLIGHT_BUILD_NUMBER: '42.1',
  });
  assert.equal(ios.version, '0.3.2');
  assert.equal(ios.platform, 'IOS');
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
