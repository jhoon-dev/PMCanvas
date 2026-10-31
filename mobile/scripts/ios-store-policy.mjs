export const IOS_BUNDLE_ID = 'dev.jhoon.pmcanvas';

export function iosStoreInputs(pkg, config, env) {
  if (config.appId !== IOS_BUNDLE_ID || !/^\d+\.\d+\.\d+$/.test(pkg.version))
    throw Error('Unexpected iOS application or release version.');
  if (env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY !== 'jhoon-dev/PMCanvas')
    throw Error('Submit iOS releases only from this repository main branch.');
  if (!/^[A-Z0-9]{10}$/.test(env.PM_IOS_TEAM_ID || '')) throw Error('Invalid Apple Team ID.');
  if (!/^[1-9]\d{0,3}\.[1-9]\d{0,2}$/.test(env.PM_IOS_BUILD_NUMBER || ''))
    throw Error('Use a unique run.attempt iOS build number.');
  return {
    bundleId: config.appId,
    version: pkg.version,
    team: env.PM_IOS_TEAM_ID,
    buildNumber: env.PM_IOS_BUILD_NUMBER,
  };
}

export function assertIosProfile(profile, { team, bundleId }, now = Date.now()) {
  const entitlements = profile.Entitlements || {};
  if (
    !profile.Platform?.includes('iOS') ||
    profile.TeamIdentifier?.[0] !== team ||
    entitlements['application-identifier'] !== team + '.' + bundleId ||
    entitlements['com.apple.developer.team-identifier'] !== team ||
    entitlements['get-task-allow'] ||
    profile.ProvisionedDevices ||
    profile.ProvisionsAllDevices ||
    !Number.isFinite(new Date(profile.ExpirationDate).getTime()) ||
    new Date(profile.ExpirationDate).getTime() <= now ||
    !/^[A-F0-9-]{36}$/i.test(profile.UUID || '')
  )
    throw Error('Use an unexpired iOS App Store profile for this exact application and team.');
  return profile.UUID;
}

export function assertIosBundle(info, expected) {
  if (
    info.CFBundleIdentifier !== expected.bundleId ||
    info.CFBundleDisplayName !== 'PM Canvas' ||
    info.CFBundleShortVersionString !== expected.version ||
    info.CFBundleVersion !== expected.buildNumber ||
    info.CFBundleSupportedPlatforms?.[0] !== 'iPhoneOS' ||
    info.ITSAppUsesNonExemptEncryption !== false ||
    !info.UIDeviceFamily?.includes(1)
  )
    throw Error('Exported iOS bundle does not match the intended Store release.');
}
