import path from 'node:path';

export function macStoreConfiguration(pkg, env = process.env, verify = false) {
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw Error('MAS requires a numeric release version.');
  const required = [
    'PM_MAS_TEAM_ID',
    'PM_MAS_BUILD_NUMBER',
    'PM_MAS_PROFILE',
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'CSC_INSTALLER_LINK',
    'CSC_INSTALLER_KEY_PASSWORD',
  ];
  if (!verify) {
    const missing = required.filter(
      (name) => !env[name] || /^(?:YOUR_|REPLACE_|<)/i.test(env[name]),
    );
    if (missing.length) throw Error('Configure Mac App Store credentials: ' + missing.join(', '));
    if (
      !/^[A-Z0-9]{10}$/.test(env.PM_MAS_TEAM_ID) ||
      env.PM_MAS_TEAM_ID.trim() !== env.PM_MAS_TEAM_ID
    )
      throw Error('Invalid MAS Team ID.');
    if (
      !/^[1-9]\d{0,3}$/.test(env.PM_MAS_BUILD_NUMBER) ||
      env.PM_MAS_BUILD_NUMBER.trim() !== env.PM_MAS_BUILD_NUMBER
    )
      throw Error('MAS build number must be 1–9999.');
    if (!path.isAbsolute(env.PM_MAS_PROFILE))
      throw Error('Use an absolute provisioning profile path.');
  }
  const common = {
    hardenedRuntime: false,
    notarize: false,
    entitlements: 'build/entitlements.mas.plist',
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
    icon: 'build/icon-mac.png',
    extendInfo: {
      ITSAppUsesNonExemptEncryption: false,
      ...(verify ? {} : { ElectronTeamID: env.PM_MAS_TEAM_ID }),
    },
  };
  return {
    ...pkg.build,
    forceCodeSigning: !verify,
    mac: { ...pkg.build.mac, ...common },
    mas: {
      ...common,
      type: 'distribution',
      artifactName: 'PMCanvas-Desktop-${version}-MacAppStore-${arch}.${ext}',
      ...(verify
        ? { identity: null }
        : {
            provisioningProfile: env.PM_MAS_PROFILE,
            bundleVersion: env.PM_MAS_BUILD_NUMBER,
          }),
    },
  };
}
