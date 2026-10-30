import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { releaseSource } from './release-policy.mjs';
import { storeConfiguration, storeManifest, storeVersion } from './store-policy.mjs';
import { preparePackage, sourceBytes } from './package-source.mjs';
import { verifyPackage } from '../test/package-safety.mjs';
import { checkPublicRepository, requirePublicSafety } from '../../web/scripts/public-safety.mjs';

const require = createRequire(import.meta.url);
const { getWindowsKitsBundle } = require('app-builder-lib/out/toolsets/windows.js');
const { Arch } = require('builder-util');
const desktop = fileURLToPath(new URL('../', import.meta.url)),
  root = path.dirname(desktop);
const args = process.argv.slice(2),
  ciTest = args.includes('--ci-test');
if (args.some((arg) => !['--ci-test', '--check'].includes(arg)))
  throw Error('Unknown Store option.');
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw Error('Build MSIX on Windows x64.');
if (
  ciTest &&
  (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.CI !== 'true' ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ID || '') ||
    !process.env.RUNNER_TEMP)
)
  throw Error('Test identities are permitted only on isolated GitHub runners.');
const config = ciTest
  ? {
      identityName: 'PMCanvas.CITest.' + process.env.GITHUB_RUN_ID,
      publisher: 'CN=PMCanvas CI ' + process.env.GITHUB_RUN_ID,
      publisherDisplayName: 'PM Canvas CI test only',
      productId: '9TEST0000000',
    }
  : storeConfiguration();
const commit = releaseSource(root);
requirePublicSafety(checkPublicRepository(root));
const pkg = JSON.parse(sourceBytes(root, 'package.json', commit));
const buildNumber = ciTest ? 0 : (process.env.PM_STORE_BUILD_NUMBER ?? 0);
const packageVersion = storeVersion(pkg.version, buildNumber);
if (args.includes('--check')) {
  console.log('Store configuration verified.');
  process.exit(0);
}
const output = path.join(desktop, 'dist', 'store-' + pkg.version + '-win');
if (fs.existsSync(output) && fs.readdirSync(output).length)
  throw Error('Preserve previous Store output outside the build folder before rebuilding.');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-store-'));
const build = path.join(stage, 'source'),
  payload = path.join(stage, 'payload');
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(CSC_|WIN_CSC_|MAC_CSC_|APPLE_)/.test(key)),
);
env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const run = (command, argv, extra = {}) =>
  execFileSync(command, argv, { cwd: desktop, stdio: 'inherit', env, windowsHide: true, ...extra });
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try {
  preparePackage(
    root,
    build,
    pkg,
    { version: pkg.version, commit, development: false, dirty: false },
    commit,
  );
  fs.writeFileSync(
    path.join(build, 'package-lock.json'),
    sourceBytes(root, 'package-lock.json', commit),
  );
  fs.symlinkSync(path.join(desktop, 'node_modules'), path.join(build, 'node_modules'), 'junction');
  fs.mkdirSync(output, { recursive: true });
  run(process.execPath, [
    path.join(desktop, 'node_modules/electron-builder/cli.js'),
    '--win',
    '--dir',
    '--x64',
    '--projectDir',
    build,
    '--config.toolsets.winCodeSign=1.1.0',
    '--config.win.signAndEditExecutable=true',
    '--config.forceCodeSigning=false',
    '--config.directories.output=' + path.join(stage, 'pack'),
    '--publish',
    'never',
  ]);
  const unpacked = path.join(stage, 'pack/win-unpacked');
  verifyPackage(path.join(unpacked, 'resources/app.asar'), { root, commit });
  // Native test fixtures import the prepared shared model; release bytes still come from Git.
  run(process.execPath, ['scripts/prepare.mjs']);
  run(process.execPath, ['scripts/check-package.mjs', '--smoke'], {
    env: { ...env, PM_PACKAGE_DIR: path.join(stage, 'pack'), PM_SOURCE_COMMIT: commit },
  });
  fs.cpSync(unpacked, path.join(payload, 'app'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'assets'));
  for (const name of ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png'])
    fs.writeFileSync(
      path.join(payload, 'assets', name),
      sourceBytes(root, 'build/store/' + name, commit),
    );
  const manifest = storeManifest(config, pkg.version, buildNumber);
  fs.writeFileSync(path.join(payload, 'AppxManifest.xml'), manifest);
  // The pinned builder ships checksums for this Windows SDK bundle; no beta MSIX builder target needed.
  const { kit } = await getWindowsKitsBundle({ winCodeSign: '1.1.0', arch: Arch.x64 });
  const makeappx = path.join(kit, 'makeappx.exe');
  const name = `PMCanvas-Desktop-${pkg.version}-Windows-x64${ciTest ? '-CI-TEST-ONLY' : '-Store'}.msix`;
  const file = path.join(output, name),
    extracted = path.join(stage, 'verified');
  run(makeappx, ['pack', '/d', payload, '/p', file, '/h', 'SHA256']);
  run(makeappx, ['unpack', '/p', file, '/d', extracted]);
  if (fs.readFileSync(path.join(extracted, 'AppxManifest.xml'), 'utf8') !== manifest)
    throw Error('MSIX manifest differs from configuration.');
  function compare(folder, relative = '') {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('Symlinks are forbidden in the Store payload.');
      const rel = path.join(relative, entry.name),
        source = path.join(folder, entry.name);
      if (entry.isDirectory()) compare(source, rel);
      else if (hash(source) !== hash(path.join(extracted, rel)))
        throw Error('MSIX payload mismatch: ' + rel);
    }
  }
  compare(payload);
  verifyPackage(path.join(extracted, 'app/resources/app.asar'), { root, commit });
  if (releaseSource(root) !== commit) throw Error('Source changed during MSIX build.');
  const sha256 = hash(file);
  fs.writeFileSync(file + '.sha256', sha256 + '  ' + name + '\n');
  fs.writeFileSync(
    path.join(output, 'store-manifest.json'),
    JSON.stringify(
      {
        product: pkg.name,
        version: pkg.version,
        packageVersion,
        buildNumber: Number(buildNumber),
        commit,
        channel: 'microsoft-store',
        intendedFor: ciTest ? 'ci-test-only' : 'partner-center',
        signed: false,
        storeSigned: false,
        identity: config,
        verification: { packageContents: true, nativeSmoke: true, manifestValidation: true },
        artifacts: [{ name, sha256 }],
      },
      null,
      2,
    ) + '\n',
  );
  if (ciTest) fs.writeFileSync(path.join(output, 'ci-tools.json'), JSON.stringify({ kit }));
  console.log(
    'PASS: unsigned MSIX verified. Submit production packages to Partner Center for Store signing and certification.',
  );
} finally {
  if (
    path.dirname(stage) !== path.resolve(os.tmpdir()) ||
    !path.basename(stage).startsWith('pmcanvas-store-')
  )
    throw Error('Unsafe Store staging path.');
  fs.rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
