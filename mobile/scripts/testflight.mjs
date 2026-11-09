import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign } from 'node:crypto';
import { requirePrivateRuntime, REPOSITORY } from '../../desktop/scripts/mac-signing-core.mjs';
import { iosStoreInputs } from './ios-store-policy.mjs';

const origin = 'https://api.appstoreconnect.apple.com';
export const groupName = 'PM Canvas Release QA';

export function testFlightInputs(mobilePackage, desktopPackage, config, env) {
  const platform = env.PM_TESTFLIGHT_PLATFORM || 'ios';
  const buildNumber = env.PM_TESTFLIGHT_BUILD_NUMBER || env.PM_IOS_BUILD_NUMBER;
  const team = env.PM_MAS_TEAM_ID || env.PM_IOS_TEAM_ID;
  if (platform === 'ios')
    return {
      ...iosStoreInputs(mobilePackage, config, {
        ...env,
        PM_IOS_BUILD_NUMBER: buildNumber,
        PM_IOS_TEAM_ID: team,
      }),
      platform: 'IOS',
    };
  if (platform !== 'macos') throw Error('Choose ios or macos for TestFlight distribution.');
  const bundleId = desktopPackage.build?.mac?.appId || desktopPackage.build?.appId;
  if (
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    bundleId !== 'app.toolmoa.pmcanvas' ||
    config.appId !== bundleId ||
    !/^\d+\.\d+\.\d+$/.test(desktopPackage.version) ||
    !/^[A-Z0-9]{10}$/.test(team || '') ||
    !/^[1-9]\d{0,3}$/.test(buildNumber || '')
  )
    throw Error('Use the current main macOS release and its unique MAS build number.');
  return { bundleId, version: desktopPackage.version, team, buildNumber, platform: 'MAC_OS' };
}

function buildPlatform(expected) {
  const platform = expected.platform || 'IOS';
  if (!['IOS', 'MAC_OS'].includes(platform)) throw Error('Unsupported TestFlight platform.');
  return platform;
}

export function matchingBuild(response, expected) {
  const platform = buildPlatform(expected);
  const releases = new Map(
    (response.included || [])
      .filter((item) => item.type === 'preReleaseVersions')
      .map((item) => [item.id, item.attributes]),
  );
  const matches = response.data.filter((build) => {
    const release = releases.get(build.relationships?.preReleaseVersion?.data?.id);
    return (
      build.attributes.version === expected.buildNumber &&
      release?.version === expected.version &&
      release.platform === platform
    );
  });
  if (matches.length > 1) throw Error('Ambiguous ' + platform + ' TestFlight build.');
  return matches[0];
}

export function existingInternalGroup(groups) {
  const matches = groups.filter((group) => group.attributes.name === groupName);
  if (matches.length !== 1 || matches[0].attributes.isInternalGroup !== true)
    throw Error('The existing PM Canvas Release QA internal group is required.');
  return matches[0];
}

export async function distributeTestFlight(
  request,
  expected,
  { pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 40 } = {},
) {
  const platform = buildPlatform(expected);
  async function all(url) {
    const data = [];
    while (url) {
      const response = await request(url);
      data.push(...response.data);
      url = response.links?.next;
    }
    return data;
  }
  const apps = await all(
    '/v1/apps?' + new URLSearchParams({ 'filter[bundleId]': expected.bundleId }),
  );
  if (apps.length !== 1 || apps[0].attributes.bundleId !== expected.bundleId)
    throw Error('Expected exactly one existing PM Canvas app.');
  const app = apps[0];
  const group = existingInternalGroup(
    await all(`/v1/apps/${encodeURIComponent(app.id)}/betaGroups?limit=200`),
  );
  let added = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await request(
      '/v1/builds?' +
        new URLSearchParams({
          'filter[app]': app.id,
          'filter[version]': expected.buildNumber,
          include: 'preReleaseVersion',
          limit: '200',
        }),
    );
    const build = matchingBuild(response, expected);
    if (build && ['FAILED', 'INVALID'].includes(build.attributes.processingState))
      throw Error('Apple rejected this build during processing.');
    if (build?.attributes.processingState === 'VALID') {
      if (build.attributes.expired) throw Error('The requested build has expired.');
      const relationship = `/v1/betaGroups/${encodeURIComponent(group.id)}/relationships/builds`;
      let linked = (await all(relationship + '?limit=200')).some((item) => item.id === build.id);
      if (!linked && !added && !group.attributes.hasAccessToAllBuilds) {
        await request(relationship, {
          method: 'POST',
          body: { data: [{ type: 'builds', id: build.id }] },
        });
        added = true;
        linked = (await all(relationship + '?limit=200')).some((item) => item.id === build.id);
      }
      const detail = await request(`/v1/builds/${encodeURIComponent(build.id)}/buildBetaDetail`);
      const state = detail.data.attributes.internalBuildState;
      if (state === 'MISSING_EXPORT_COMPLIANCE')
        throw Error('Apple export compliance is required.');
      if (linked && ['READY_FOR_BETA_TESTING', 'IN_BETA_TESTING'].includes(state))
        return {
          bundleId: expected.bundleId,
          platform,
          version: expected.version,
          buildNumber: expected.buildNumber,
          appId: app.id,
          buildId: build.id,
          group: groupName,
          processingState: 'VALID',
          internalBuildState: state,
          available: true,
          testersChanged: false,
        };
    }
    if (attempt + 1 < attempts) await pause(30000);
  }
  throw Error(
    'Apple processing or internal TestFlight availability is still pending. Rerun this build check.',
  );
}

export function appleToken(key, id, issuer, now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body =
    encode({ alg: 'ES256', kid: id, typ: 'JWT' }) +
    '.' +
    encode({
      iss: issuer,
      iat: now,
      exp: now + 300,
      aud: 'appstoreconnect-v1',
    });
  return (
    body +
    '.' +
    sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  );
}

async function main() {
  requirePrivateRuntime();
  const mobile = fileURLToPath(new URL('../', import.meta.url));
  const expected = testFlightInputs(
    JSON.parse(fs.readFileSync(path.join(mobile, 'package.json'))),
    JSON.parse(fs.readFileSync(path.join(mobile, '../desktop/package.json'))),
    JSON.parse(fs.readFileSync(path.join(mobile, 'capacitor.config.json'))),
    process.env,
  );
  const id = process.env.ASC_KEY_ID,
    issuer = process.env.ASC_ISSUER_ID;
  const bytes = Buffer.from(process.env.ASC_KEY_BASE64 || '', 'base64');
  for (const name of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_BASE64']) delete process.env[name];
  let key;
  try {
    key = createPrivateKey(bytes);
  } finally {
    bytes.fill(0);
  }
  if (
    !/^[A-Z0-9]{10}$/.test(id || '') ||
    !/^[a-f0-9-]{36}$/i.test(issuer || '') ||
    key.asymmetricKeyType !== 'ec'
  )
    throw Error('Configure the existing App Store Connect upload key.');
  const request = async (route, { method = 'GET', body } = {}) => {
    const url = new URL(route, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/v1/'))
      throw Error('Unexpected Apple API destination.');
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + appleToken(key, id, issuer),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('App Store Connect API HTTP ' + response.status);
    return response.status === 204 ? {} : await response.json();
  };
  const result = await distributeTestFlight(request, expected);
  const output = path.join(mobile, 'build/app-store');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'testflight-result.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    `PASS: ${result.platform} ${result.version} (${result.buildNumber}) available in ${result.group}: ${result.internalBuildState}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
