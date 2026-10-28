import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { releaseSource, signingPolicy } from './release-policy.mjs';
import { checkPublicRepository, requirePublicSafety } from '../../web/scripts/public-safety.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(desktop);
const [target, ...args] = process.argv.slice(2);
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
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
  const output = path.join(desktop, 'dist', 'release-' + pkg.version + '-' + target);
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw Error('Release output already exists; preserve it and choose a new version.');
  execFileSync(process.execPath, [path.join(desktop, 'scripts/prepare.mjs')], {
    cwd: desktop,
    stdio: 'inherit',
  });
  fs.writeFileSync(
    path.join(desktop, 'app/build-info.json'),
    JSON.stringify({ version: pkg.version, commit, development: false, dirty: false }, null, 2) +
      '\n',
  );
  fs.mkdirSync(output, { recursive: true });
  const configFile = path.join(output, 'builder.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        ...pkg.build,
        ...configuration,
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
    execFileSync(process.execPath, [path.join(desktop, 'test/package-safety.mjs'), archive], {
      cwd: desktop,
      stdio: 'inherit',
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
      { product: pkg.name, version: pkg.version, commit, platform: target, artifacts },
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
}
