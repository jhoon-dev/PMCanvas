import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { releaseSource } from './release-policy.mjs';
import { checkPublicRepository, requirePublicSafety } from '../../web/scripts/public-safety.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(desktop);
const target = process.argv[2];
try {
  if (process.argv.length !== 3 || !['win', 'mac'].includes(target))
    throw Error('Usage: unsigned.mjs win|mac');
  if (process.platform !== (target === 'win' ? 'win32' : 'darwin'))
    throw Error('Build on the target operating system.');
  const commit = releaseSource(root);
  requirePublicSafety(checkPublicRepository(root));
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
  const output = path.join(desktop, 'dist', 'unsigned-' + pkg.version + '-' + target);
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw Error('Unsigned output already exists; preserve the existing artifacts.');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(?:CSC_|WIN_CSC_|MAC_CSC_|APPLE_)/i.test(name),
    ),
  );
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  const run = (script, args = [], extra = {}) =>
    execFileSync(process.execPath, [path.join(desktop, script), ...args], {
      cwd: desktop,
      stdio: 'inherit',
      env: { ...env, ...extra },
    });
  run('scripts/prepare.mjs');
  run('node_modules/electron-builder/cli.js', [
    '--' + target,
    ...(target === 'win'
      ? ['nsis', '--x64', '--config.win.signAndEditExecutable=false']
      : [
          'dmg',
          'zip',
          '--arm64',
          '--x64',
          '--config.mac.identity=-',
          '--config.mac.hardenedRuntime=false',
        ]),
    '--config.forceCodeSigning=false',
    '--config.directories.output=' + output,
    '--publish',
    'never',
  ]);
  const archives =
    target === 'win'
      ? [path.join(output, 'win-unpacked/resources/app.asar')]
      : ['mac', 'mac-arm64'].map((dir) =>
          path.join(output, dir, 'PM Canvas Desktop.app/Contents/Resources/app.asar'),
        );
  for (const archive of archives)
    run('test/package-safety.mjs', [archive, commit, '--development']);
  run('scripts/check-package.mjs', ['--smoke'], {
    PM_PACKAGE_DIR: output,
    PM_SOURCE_COMMIT: commit,
    PM_DEVELOPMENT_BUILD: 'true',
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
  if (!artifacts.length) throw Error('No unsigned installer was produced.');
  const manifest = {
    product: pkg.name,
    version: pkg.version,
    commit,
    platform: target,
    signed: false,
    notarized: false,
    macAdHoc: target === 'mac',
    nativeSmokeArchitecture: process.arch,
    artifacts,
  };
  fs.writeFileSync(
    path.join(output, 'unsigned-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  for (const file of artifacts)
    fs.writeFileSync(
      path.join(output, file.name + '.sha256'),
      file.sha256 + '  ' + file.name + '\n',
    );
  console.log(
    'PASS: unsigned installers, canonical source checks, native smoke and SHA-256 manifest.',
  );
} catch (error) {
  console.error(error.status ? 'Unsigned build failed. Review the build output.' : error.message);
  process.exitCode = 1;
}
