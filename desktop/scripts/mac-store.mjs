import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { macStoreConfiguration } from './mac-store-policy.mjs';
import { preparePackage, sourceBytes } from './package-source.mjs';
import { releaseSource } from './release-policy.mjs';
import { checkPublicRepository, requirePublicSafety } from '../../web/scripts/public-safety.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(desktop);
let staging;
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !['--verify', '--check'].includes(arg)))
    throw Error('Usage: mac-store.mjs [--verify|--check]');
  const verify = args.includes('--verify');
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
  const config = macStoreConfiguration(pkg, process.env, verify);
  if (args.includes('--check')) {
    if (!fs.statSync(process.env.PM_MAS_PROFILE).isFile()) throw Error('Missing MAS profile.');
    console.log(
      'MAS credential inputs present. Certificate and profile validation requires macOS.',
    );
    process.exit(0);
  }
  if (process.platform !== 'darwin') throw Error('Build MAS on a macOS runner.');
  const commit = releaseSource(root);
  requirePublicSafety(checkPublicRepository(root));
  const output = path.join(
    desktop,
    'dist',
    (verify ? 'mas-verify-' : 'mas-submission-') + pkg.version,
  );
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw Error('Preserve the existing MAS output.');
  const run = (command, args, options = {}) =>
    execFileSync(command, args, {
      cwd: desktop,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
  if (!verify) {
    // Parse with macOS tools; reject another app/team, expired or development profiles.
    const { parse } = createRequire(import.meta.url)('plist');
    const profile = parse(run('security', ['cms', '-D', '-i', process.env.PM_MAS_PROFILE]));
    const entitlements = profile.Entitlements || {};
    if (
      profile.TeamIdentifier?.[0] !== process.env.PM_MAS_TEAM_ID ||
      entitlements['com.apple.application-identifier'] !==
        process.env.PM_MAS_TEAM_ID + '.' + config.appId ||
      new Date(profile.ExpirationDate).getTime() <= Date.now() ||
      !Number.isFinite(new Date(profile.ExpirationDate).getTime()) ||
      profile.ProvisionedDevices ||
      profile.ProvisionsAllDevices ||
      entitlements['get-task-allow']
    )
      throw Error(
        'MAS profile must be an unexpired App Store distribution profile for this app and team.',
      );
  }
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-mas-'));
  fs.chmodSync(staging, 0o700);
  preparePackage(
    root,
    staging,
    pkg,
    { version: pkg.version, commit, development: verify, dirty: false },
    commit,
  );
  for (const file of [
    'package-lock.json',
    'build/entitlements.mas.plist',
    'build/entitlements.mas.inherit.plist',
    'build/icon-mac.png',
  ]) {
    fs.mkdirSync(path.dirname(path.join(staging, file)), { recursive: true });
    fs.writeFileSync(path.join(staging, file), sourceBytes(root, file, commit));
  }
  fs.symlinkSync(path.join(desktop, 'node_modules'), path.join(staging, 'node_modules'), 'dir');
  fs.mkdirSync(output, { recursive: true });
  const configFile = path.join(staging, 'builder.json');
  fs.writeFileSync(configFile, JSON.stringify({ ...config, directories: { output } }));
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: verify ? 'false' : 'true' };
  if (verify)
    for (const name of Object.keys(env))
      if (/^(?:CSC_|MAC_CSC_|APPLE_)/i.test(name)) delete env[name];
  env.CSC_IDENTITY_AUTO_DISCOVERY = verify ? 'false' : 'true';
  run(
    process.execPath,
    [
      path.join(desktop, 'node_modules/electron-builder/cli.js'),
      '--mac',
      'mas',
      '--universal',
      '--projectDir',
      staging,
      '--config',
      configFile,
      '--publish',
      'never',
    ],
    { stdio: 'inherit', env },
  );
  const appPath = path.join(output, 'mas-universal', pkg.build.productName + '.app');
  run(
    process.execPath,
    [
      path.join(desktop, 'test/package-safety.mjs'),
      path.join(appPath, 'Contents/Resources/app.asar'),
      commit,
      ...(verify ? ['--development'] : []),
    ],
    { stdio: 'inherit' },
  );
  const { parse } = createRequire(import.meta.url)('plist');
  const info = parse(fs.readFileSync(path.join(appPath, 'Contents/Info.plist'), 'utf8'));
  if (info.CFBundleIdentifier !== config.appId) throw Error('Unexpected MAS bundle identifier.');
  const architectures = run('lipo', [
    '-archs',
    path.join(appPath, 'Contents/MacOS', info.CFBundleExecutable),
  ]);
  if (!architectures.includes('x86_64') || !architectures.includes('arm64'))
    throw Error('MAS must support Intel and Apple Silicon.');
  if (!fs.existsSync(path.join(appPath, 'Contents/Resources', info.CFBundleIconFile)))
    throw Error('Missing Mac app icon.');
  if (!verify) {
    run('codesign', ['--verify', '--deep', '--strict', appPath]);
    const entitlements = parse(run('codesign', ['-d', '--entitlements', ':-', appPath]));
    if (
      !entitlements['com.apple.security.app-sandbox'] ||
      !entitlements['com.apple.security.files.user-selected.read-write']
    )
      throw Error('Missing MAS sandbox entitlements.');
  }
  const artifacts = [];
  for (const name of fs
    .readdirSync(path.join(output, 'mas-universal'))
    .filter((name) => name.endsWith('.pkg'))) {
    const file = path.join(output, 'mas-universal', name);
    if (!verify) {
      const signature = run('pkgutil', ['--check-signature', file]);
      if (
        !signature.includes('3rd Party Mac Developer Installer:') ||
        !signature.includes('(' + process.env.PM_MAS_TEAM_ID + ')')
      )
        throw Error('Unexpected MAS installer signing identity.');
    }
    const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.writeFileSync(file + '.sha256', sha256 + '  ' + name + '\n');
    artifacts.push({ name, sha256 });
  }
  if (!verify && artifacts.length !== 1) throw Error('Expected one signed MAS submission package.');
  if (releaseSource(root) !== commit) throw Error('Source changed during the MAS build.');
  fs.writeFileSync(
    path.join(output, 'mas-manifest.json'),
    JSON.stringify(
      {
        version: pkg.version,
        commit,
        bundleId: config.appId,
        buildNumber: verify ? null : process.env.PM_MAS_BUILD_NUMBER,
        architectures: ['arm64', 'x64'],
        signed: !verify,
        submissionPackage: !verify,
        sandboxRuntimeTested: false,
        uploaded: false,
        published: false,
        artifacts,
      },
      null,
      2,
    ) + '\n',
  );
  if (verify)
    run('ditto', [
      '-c',
      '-k',
      '--keepParent',
      appPath,
      path.join(output, 'PMCanvas-MAS-verification-only.zip'),
    ]);
  console.log(
    verify
      ? 'PASS: unsigned universal MAS package; not for submission. Sandbox runtime still needs a signed test.'
      : 'PASS: signed MAS PKG. Upload and App Review are separate steps.',
  );
} catch (error) {
  console.error(
    error.status ? 'MAS build command failed. Review the build output.' : error.message,
  );
  process.exitCode = 1;
} finally {
  if (
    staging &&
    path.dirname(staging) === path.resolve(os.tmpdir()) &&
    path.basename(staging).startsWith('pmcanvas-mas-')
  )
    fs.rmSync(staging, { recursive: true, force: true });
}
