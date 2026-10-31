import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate, randomBytes } from 'node:crypto';
import plist from 'plist';
import xcode from 'xcode';
import { quietRun, requirePrivateRuntime } from '../../desktop/scripts/mac-signing-core.mjs';
import { releaseSource } from '../../desktop/scripts/release-policy.mjs';
import { assertIosProfile, assertIosBundle, iosStoreInputs } from './ios-store-policy.mjs';
import { inspectAppleSignature } from './ios-signature.mjs';

const mobile = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(mobile, 'build/app-store');
let staging, keychain, previousKeychains, originalProject, installedProfile;
const projectFile = path.join(mobile, 'ios/App/App.xcodeproj/project.pbxproj');
const run = (command, args, capture = false) =>
  execFileSync(command, args, {
    cwd: mobile,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
try {
  requirePrivateRuntime();
  if (process.platform !== 'darwin' || process.argv.length !== 2)
    throw Error('Build signed iOS releases on macOS.');
  const pkg = JSON.parse(fs.readFileSync(path.join(mobile, 'package.json')));
  const config = JSON.parse(fs.readFileSync(path.join(mobile, 'capacitor.config.json')));
  const expected = iosStoreInputs(pkg, config, process.env);
  const commit = releaseSource(path.dirname(mobile));
  const certificateBytes = Buffer.from(process.env.PM_IOS_CSC_LINK || '', 'base64');
  const password = process.env.PM_IOS_CSC_PASSWORD;
  const profileBytes = Buffer.from(process.env.PM_IOS_PROFILE_BASE64 || '', 'base64');
  for (const key of ['PM_IOS_CSC_LINK', 'PM_IOS_CSC_PASSWORD', 'PM_IOS_PROFILE_BASE64'])
    delete process.env[key];
  if (!password || certificateBytes.length < 100 || profileBytes.length < 100)
    throw Error('Configure the existing Apple Distribution identity and iOS Store profile.');
  if (fs.existsSync(output)) throw Error('Preserve the previous iOS Store output.');
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-ios-store-'));
  fs.chmodSync(staging, 0o700);
  const certFile = path.join(staging, 'distribution.p12'),
    profileFile = path.join(staging, 'store.mobileprovision');
  fs.writeFileSync(certFile, certificateBytes, { mode: 0o600 });
  certificateBytes.fill(0);
  fs.writeFileSync(profileFile, profileBytes, { mode: 0o600 });
  profileBytes.fill(0);
  const profile = plist.parse(
    quietRun('security', ['cms', '-D', '-i', profileFile], {
      label: 'Could not decode the iOS profile.',
    }).toString(),
  );
  const uuid = assertIosProfile(profile, expected);
  if (profile.DeveloperCertificates?.length !== 1)
    throw Error('Use one Apple Distribution certificate.');
  const certificate = new X509Certificate(Buffer.from(profile.DeveloperCertificates[0]));
  if (
    !certificate.subject.includes('OU=' + expected.team) ||
    !certificate.subject.includes('CN=Apple Distribution:') ||
    Date.parse(certificate.validTo) <= Date.now()
  )
    throw Error('Unexpected or expired Apple Distribution certificate.');
  const identity = certificate.fingerprint.replaceAll(':', '');
  const keychainPassword = randomBytes(32).toString('hex');
  keychain = path.join(staging, 'signing.keychain-db');
  previousKeychains = [
    ...quietRun('security', ['list-keychains', '-d', 'user'])
      .toString()
      .matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
  quietRun('security', ['create-keychain', '-p', keychainPassword, keychain], {
    label: 'Could not create temporary signing keychain.',
  });
  quietRun('security', ['set-keychain-settings', '-lut', '7200', keychain]);
  quietRun('security', ['unlock-keychain', '-p', keychainPassword, keychain]);
  quietRun(
    'security',
    [
      'import',
      certFile,
      '-k',
      keychain,
      '-P',
      password,
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/security',
    ],
    { label: 'Could not import the encrypted distribution identity.' },
  );
  quietRun(
    'security',
    [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      keychainPassword,
      keychain,
    ],
    { label: 'Could not permit code signing with the temporary keychain.' },
  );
  quietRun('security', ['list-keychains', '-d', 'user', '-s', keychain, ...previousKeychains]);
  if (
    !quietRun('security', ['find-identity', '-v', '-p', 'codesigning', keychain])
      .toString()
      .includes(identity)
  )
    throw Error('Signing identity does not match the iOS profile.');
  const profiles = path.join(
    os.homedir(),
    'Library/Developer/Xcode/UserData/Provisioning Profiles',
  );
  fs.mkdirSync(profiles, { recursive: true });
  const profileTarget = path.join(profiles, uuid + '.mobileprovision');
  if (!fs.existsSync(profileTarget)) {
    fs.copyFileSync(profileFile, profileTarget, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(profileTarget, 0o644);
    installedProfile = profileTarget;
  } else if (!fs.readFileSync(profileTarget).equals(fs.readFileSync(profileFile))) {
    throw Error('Preserve the existing profile with this UUID.');
  }
  originalProject = fs.readFileSync(projectFile);
  run('npm', ['run', 'build']);
  run('npx', ['cap', 'sync', 'ios']);
  const project = xcode.project(projectFile);
  project.parseSync();
  let matched = 0;
  for (const value of Object.values(project.pbxXCBuildConfigurationSection())) {
    const settings = value?.buildSettings;
    if (
      !settings ||
      value.name !== 'Release' ||
      settings.PRODUCT_BUNDLE_IDENTIFIER?.replaceAll('"', '') !== expected.bundleId
    )
      continue;
    Object.assign(settings, {
      CODE_SIGN_STYLE: 'Manual',
      DEVELOPMENT_TEAM: expected.team,
      CODE_SIGN_IDENTITY: identity,
      PROVISIONING_PROFILE_SPECIFIER: uuid,
      CURRENT_PROJECT_VERSION: expected.buildNumber,
      MARKETING_VERSION: expected.version,
      OTHER_CODE_SIGN_FLAGS: JSON.stringify('$(inherited) --keychain ' + keychain),
    });
    matched++;
  }
  if (matched !== 1) throw Error('Expected exactly one iOS application Release target.');
  fs.writeFileSync(projectFile, project.writeSync());
  fs.mkdirSync(output, { recursive: true });
  const archive = path.join(output, 'PMCanvas.xcarchive');
  run('xcodebuild', [
    '-project',
    'ios/App/App.xcodeproj',
    '-scheme',
    'App',
    '-configuration',
    'Release',
    '-onlyUsePackageVersionsFromResolvedFile',
    '-destination',
    'generic/platform=iOS',
    '-derivedDataPath',
    'build/StoreDerivedData',
    '-archivePath',
    archive,
    'archive',
  ]);
  const options = path.join(staging, 'ExportOptions.plist');
  fs.writeFileSync(
    options,
    plist.build({
      method: 'app-store-connect',
      destination: 'export',
      signingStyle: 'manual',
      signingCertificate: identity,
      teamID: expected.team,
      provisioningProfiles: { [expected.bundleId]: uuid },
      manageAppVersionAndBuildNumber: false,
      stripSwiftSymbols: true,
      uploadSymbols: false,
    }),
    { mode: 0o600 },
  );
  run('xcodebuild', [
    '-exportArchive',
    '-archivePath',
    archive,
    '-exportPath',
    path.join(output, 'export'),
    '-exportOptionsPlist',
    options,
  ]);
  const exported = fs.readdirSync(path.join(output, 'export')).filter((f) => f.endsWith('.ipa'));
  if (exported.length !== 1) throw Error('Expected one signed IPA.');
  const name = 'PMCanvas-' + expected.version + '-' + expected.buildNumber + '-iOS.ipa';
  const ipa = path.join(output, name);
  fs.renameSync(path.join(output, 'export', exported[0]), ipa);
  const verification = path.join(staging, 'verify');
  fs.mkdirSync(verification);
  run('unzip', ['-q', ipa, '-d', verification]);
  const payload = path.join(verification, 'Payload');
  const apps = fs.readdirSync(payload).filter((f) => f.endsWith('.app'));
  if (apps.length !== 1) throw Error('Unexpected IPA payload.');
  const app = path.join(payload, apps[0]);
  assertIosBundle(
    plist.parse(run('plutil', ['-convert', 'xml1', '-o', '-', path.join(app, 'Info.plist')], true)),
    expected,
  );
  const embedded = plist.parse(
    run('security', ['cms', '-D', '-i', path.join(app, 'embedded.mobileprovision')], true),
  );
  if (assertIosProfile(embedded, expected) !== uuid)
    throw Error('Embedded iOS profile changed during export.');
  if (!fs.existsSync(path.join(app, 'PrivacyInfo.xcprivacy')))
    throw Error('iOS privacy manifest missing.');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const signature = inspectAppleSignature(app, staging);
  const { entitlements } = signature;
  if (
    entitlements['application-identifier'] !== expected.team + '.' + expected.bundleId ||
    entitlements['get-task-allow']
  )
    throw Error('Unexpected iOS signing entitlements.');
  if (signature.certificate.fingerprint256 !== certificate.fingerprint256)
    throw Error('Exported IPA uses a different signing certificate.');
  const manifest = {
    ...expected,
    commit,
    signed: true,
    uploaded: false,
    published: false,
    artifact: { name, sha256: createHash('sha256').update(fs.readFileSync(ipa)).digest('hex') },
  };
  fs.writeFileSync(
    path.join(output, 'ios-store-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(
    'PASS: signed iOS IPA, profile, identity, bundle metadata, privacy and signature verified.',
  );
} catch (error) {
  console.error(error.status ? 'iOS Store build failed. Review Xcode output.' : error.message);
  process.exitCode = 1;
} finally {
  if (originalProject) fs.writeFileSync(projectFile, originalProject);
  if (installedProfile) fs.unlinkSync(installedProfile);
  if (previousKeychains)
    try {
      quietRun('security', ['list-keychains', '-d', 'user', '-s', ...previousKeychains]);
    } catch {}
  if (keychain)
    try {
      quietRun('security', ['delete-keychain', keychain]);
    } catch {}
  if (
    staging &&
    path.dirname(staging) === path.resolve(os.tmpdir()) &&
    path.basename(staging).startsWith('pmcanvas-ios-store-')
  )
    fs.rmSync(staging, { recursive: true, force: true });
}
