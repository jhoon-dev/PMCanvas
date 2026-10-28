import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { preparePackage, sourceBytes } from './package-source.mjs';
import { verifySignatures } from './verify-signatures.mjs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { releaseSource, signingPolicy } from './release-policy.mjs';
import { checkPublicRepository, requirePublicSafety } from '../../web/scripts/public-safety.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(desktop);
const [target, ...args] = process.argv.slice(2);
let staging;
try {
  if (args.some((arg) => arg !== '--check') || args.length > 1)
    throw Error('Usage: release.mjs win|mac [--check]');
  const commit = releaseSource(root);
  requirePublicSafety(checkPublicRepository(root));
  const configuration = signingPolicy(target);
  if (args.includes('--check')) {
    console.log('Desktop release prerequisites verified.');
    process.exit(0);
  }
  const pkg = JSON.parse(sourceBytes(root, 'package.json', commit));
  const output = path.join(desktop, 'dist', 'release-' + pkg.version + '-' + target);
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw Error('Release output already exists; preserve it and choose a new version.');
  // Build exclusively from committed inputs in a private, isolated directory.
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-release-'));
  fs.chmodSync(staging, 0o700);
  preparePackage(
    root,
    staging,
    pkg,
    { version: pkg.version, commit, development: false, dirty: false },
    commit,
  );
  fs.writeFileSync(
    path.join(staging, 'package-lock.json'),
    sourceBytes(root, 'package-lock.json', commit),
  );
  fs.symlinkSync(
    path.join(desktop, 'node_modules'),
    path.join(staging, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.mkdirSync(output, { recursive: true });
  const configFile = path.join(output, 'builder.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        ...pkg.build,
        ...configuration,
        win: { ...pkg.build.win, ...configuration.win },
        mac: { ...pkg.build.mac, ...configuration.mac },
        directories: { ...pkg.build.directories, output },
      },
      null,
      2,
    ) + '\n',
  );
  // Private credentials stay in the environment, never in configuration files or command arguments.
  execFileSync(
    process.execPath,
    [
      path.join(desktop, 'node_modules/electron-builder/cli.js'),
      '--' + target,
      ...(target === 'win' ? ['nsis', '--x64'] : ['dmg', 'zip', '--arm64', '--x64']),
      '--projectDir',
      staging,
      '--config',
      configFile,
      '--publish',
      'never',
    ],
    {
      cwd: desktop,
      stdio: 'inherit',
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'true' },
    },
  );
  const archives =
    target === 'win'
      ? [path.join(output, 'win-unpacked/resources/app.asar')]
      : ['mac', 'mac-arm64'].map((dir) =>
          path.join(output, dir, 'PM Canvas Desktop.app/Contents/Resources/app.asar'),
        );
  for (const archive of archives)
    execFileSync(
      process.execPath,
      [path.join(desktop, 'test/package-safety.mjs'), archive, commit],
      {
        cwd: desktop,
        stdio: 'inherit',
      },
    );
  verifySignatures(target, output);
  execFileSync(process.execPath, [path.join(desktop, 'scripts/check-package.mjs'), '--smoke'], {
    cwd: desktop,
    stdio: 'inherit',
    env: { ...process.env, PM_PACKAGE_DIR: output, PM_SOURCE_COMMIT: commit },
  });
  if (releaseSource(root) !== commit) throw Error('Source commit changed during the build.');
  const artifacts = fs
    .readdirSync(output)
    .filter((name) => /\.(?:exe|dmg|zip)$/.test(name))
    .map((name) => ({
      name,
      sha256: createHash('sha256')
        .update(fs.readFileSync(path.join(output, name)))
        .digest('hex'),
    }));
  if (!artifacts.length) throw Error('No release artifacts were produced.');
  fs.writeFileSync(
    path.join(output, 'release-manifest.json'),
    JSON.stringify(
      {
        product: pkg.name,
        version: pkg.version,
        commit,
        platform: target,
        verification: { signatures: true, nativeSmoke: true },
        artifacts,
      },
      null,
      2,
    ) + '\n',
  );
  for (const file of artifacts)
    fs.writeFileSync(
      path.join(output, file.name + '.sha256'),
      file.sha256 + '  ' + file.name + '\n',
    );
  console.log('Signed desktop release verified; source commit and SHA-256 manifest written.');
} catch (error) {
  // Child output is handled by electron-builder; do not serialize errors containing the environment.
  console.error(
    error.status ? 'Desktop release command failed. Review the build output.' : error.message,
  );
  process.exitCode = 1;
} finally {
  if (
    staging &&
    path.dirname(staging) === path.resolve(os.tmpdir()) &&
    path.basename(staging).startsWith('pmcanvas-release-')
  )
    fs.rmSync(staging, { recursive: true, force: true });
}
