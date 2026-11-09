// Recreate a retired app only inside disposable CI; never upload its installers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { preparePackage, sourceBytes } from '../scripts/package-source.mjs';
import { verifyPackage } from './package-safety.mjs';

export const LEGACY_SOURCE = '7c57c3d10129a761b61dfc5ae06f55e8103570b0';
const { parseChecksumFile } = createRequire(import.meta.url)(
  'app-builder-lib/out/util/electronGet.js',
);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(desktop);

export async function buildLegacyFixture() {
  if (
    process.env.CI !== 'true' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !process.env.RUNNER_TEMP
  )
    throw Error('Legacy fixtures require a disposable GitHub-hosted runner.');
  if (!['win32', 'darwin'].includes(process.platform)) throw Error('Windows or macOS required.');
  const run = (command, args, options = {}) =>
    execFileSync(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      timeout: 600000,
      ...options,
    });
  try {
    run('git', ['cat-file', '-e', LEGACY_SOURCE + '^{commit}'], { stdio: 'ignore' });
  } catch {
    run('git', ['fetch', '--depth=1', 'origin', LEGACY_SOURCE]);
  }
  const pkg = JSON.parse(sourceBytes(root, 'package.json', LEGACY_SOURCE));
  assert.equal(pkg.version, '0.7.1');
  assert.equal(pkg.name, 'pmcanvas-desktop');
  const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'pmcanvas-legacy-ci-'));
  const source = path.join(work, 'source');
  const output = path.join(work, 'output');
  preparePackage(
    root,
    source,
    pkg,
    {
      version: pkg.version,
      commit: LEGACY_SOURCE,
      development: false,
      dirty: false,
    },
    LEGACY_SOURCE,
  );
  fs.writeFileSync(
    path.join(source, 'package-lock.json'),
    sourceBytes(root, 'package-lock.json', LEGACY_SOURCE),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(CSC_|WIN_CSC_|MAC_CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$|PM_UPDATE_SIGNING_KEY$)/.test(
          key,
        ),
    ),
  );
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  const npmCli = [
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find((file) => fs.existsSync(file));
  if (!npmCli) throw Error('Use Node with its bundled npm to build the CI fixture.');
  run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts'], { cwd: source, env });
  const win = process.platform === 'win32';
  // Keep the retired runtime exact, but avoid the failing release-page checksum URL.
  assert.equal(pkg.devDependencies.electron, '45.0.0');
  const sums = await fetch(
    'https://api.github.com/repos/electron/electron/releases/assets/661448854',
    {
      headers: { Accept: 'application/octet-stream' },
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!sums.ok) throw Error('Legacy Electron checksum download failed: ' + sums.status);
  const checksums = parseChecksumFile(await sums.text());
  assert.match(
    checksums['electron-v45.0.0-' + (win ? 'win32-x64' : 'darwin-' + process.arch) + '.zip'] || '',
    /^[a-f0-9]{64}$/,
  );
  const builderConfig = path.join(work, 'legacy-builder.json');
  fs.writeFileSync(
    builderConfig,
    JSON.stringify({
      ...pkg.build,
      electronDownload: { checksums },
      forceCodeSigning: false,
      directories: { ...pkg.build.directories, output },
      win: {
        ...pkg.build.win,
        signAndEditExecutable: false,
        artifactName: 'CI-ONLY-Legacy-0.7.1-${arch}.${ext}',
      },
      mac: {
        ...pkg.build.mac,
        identity: '-',
        hardenedRuntime: false,
        artifactName: 'CI-ONLY-Legacy-0.7.1-${arch}.${ext}',
      },
    }),
  );
  run(
    process.execPath,
    [
      path.join(desktop, 'node_modules/electron-builder/cli.js'),
      ...(win ? ['--win', 'nsis', '--x64'] : ['--mac', 'dmg', '--' + process.arch]),
      '--projectDir',
      source,
      '--config=' + builderConfig,
      '--publish',
      'never',
    ],
    { env },
  );
  const archive = win
    ? path.join(output, 'win-unpacked/resources/app.asar')
    : path.join(
        output,
        process.arch === 'arm64' ? 'mac-arm64' : 'mac',
        pkg.build.productName + '.app/Contents/Resources/app.asar',
      );
  verifyPackage(archive, { root, commit: LEGACY_SOURCE });
  const installers = fs
    .readdirSync(output)
    .filter((name) => name.startsWith('CI-ONLY-Legacy-') && name.endsWith(win ? '.exe' : '.dmg'));
  assert.equal(installers.length, 1);
  const installer = path.join(output, installers[0]);
  const sha256 = createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
  return {
    installer,
    sha256,
    sourceCommit: LEGACY_SOURCE,
    version: pkg.version,
    recreatedFromSource: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.resolve(process.argv[2] || '');
  if (
    !process.env.RUNNER_TEMP ||
    !target.startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep) ||
    !target.endsWith('.json')
  )
    throw Error('Write fixture evidence only beneath RUNNER_TEMP.');
  fs.writeFileSync(target, JSON.stringify(await buildLegacyFixture(), null, 2) + '\n');
}
