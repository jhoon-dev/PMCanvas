import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIosProfile, assertIosBundle, iosStoreInputs } from '../scripts/ios-store-policy.mjs';

const expected = {
  bundleId: 'dev.jhoon.pmcanvas',
  team: 'V6445K474Q',
  version: '0.1.0',
  buildNumber: '1.1',
};
const profile = () => ({
  Platform: ['iOS'],
  TeamIdentifier: [expected.team],
  UUID: 'e17c8e04-7991-47f2-b781-ca897b9201e6',
  ExpirationDate: '2027-10-31T00:00:00Z',
  Entitlements: {
    'application-identifier': expected.team + '.' + expected.bundleId,
    'com.apple.developer.team-identifier': expected.team,
    'get-task-allow': false,
  },
});

test('iOS distribution rejects development, device, expired and foreign profiles', () => {
  const now = Date.parse('2026-10-31T00:00:00Z');
  assert.equal(assertIosProfile(profile(), expected, now), profile().UUID);
  for (const change of [
    (p) => (p.Platform = ['OSX']),
    (p) => (p.TeamIdentifier = ['OTHERTEAM1']),
    (p) => (p.Entitlements['application-identifier'] = expected.team + '.another.app'),
    (p) => (p.Entitlements['get-task-allow'] = true),
    (p) => (p.ProvisionedDevices = ['a-device']),
    (p) => (p.ProvisionsAllDevices = true),
    (p) => (p.ExpirationDate = '2026-10-30T00:00:00Z'),
  ]) {
    const value = profile();
    change(value);
    assert.throws(() => assertIosProfile(value, expected, now), /iOS App Store profile/);
  }
});

test('iOS upload inputs bind repository, main, app identity and unique build number', () => {
  const env = {
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'jhoon-dev/PMCanvas',
    PM_IOS_TEAM_ID: expected.team,
    PM_IOS_BUILD_NUMBER: '1.1',
  };
  assert.deepEqual(
    iosStoreInputs({ version: '0.1.0' }, { appId: expected.bundleId }, env),
    expected,
  );
  assert.throws(
    () =>
      iosStoreInputs(
        { version: '0.1.0' },
        { appId: expected.bundleId },
        { ...env, GITHUB_REF: 'refs/pull/1/merge' },
      ),
    /main branch/,
  );
  assert.throws(
    () =>
      iosStoreInputs(
        { version: '0.1.0' },
        { appId: expected.bundleId },
        { ...env, PM_IOS_BUILD_NUMBER: '1' },
      ),
    /unique/,
  );
  const info = {
    CFBundleIdentifier: expected.bundleId,
    CFBundleDisplayName: 'PM Canvas',
    CFBundleShortVersionString: '0.1.0',
    CFBundleVersion: '1.1',
    CFBundleSupportedPlatforms: ['iPhoneOS'],
    ITSAppUsesNonExemptEncryption: false,
    UIDeviceFamily: [1, 2],
  };
  assertIosBundle(info, expected);
  assert.throws(
    () => assertIosBundle({ ...info, CFBundleVersion: '0.9' }, expected),
    /intended Store release/,
  );
  assert.throws(
    () => assertIosBundle({ ...info, CFBundleSupportedPlatforms: ['iPhoneSimulator'] }, expected),
    /intended Store release/,
  );
});
