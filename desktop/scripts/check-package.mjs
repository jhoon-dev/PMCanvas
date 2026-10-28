import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--smoke')) throw Error('Usage: check-package.mjs [--smoke]');
const folder = process.env.PM_PACKAGE_DIR || path.join(root, 'dist');
const options =
  process.platform === 'win32'
    ? [['win-unpacked', 'resources/app.asar', 'PM Canvas Desktop.exe']]
    : [
        [
          process.arch === 'arm64' ? 'mac-arm64' : 'mac',
          'PM Canvas Desktop.app/Contents/Resources/app.asar',
          'PM Canvas Desktop.app/Contents/MacOS/PM Canvas Desktop',
        ],
      ];
for (const [directory, archive, executable] of options) {
  const base = path.join(folder, directory);
  if (!fs.existsSync(path.join(base, archive)))
    throw Error('Build the package for this operating system first.');
  execFileSync(
    process.execPath,
    [
      path.join(root, 'test/package-safety.mjs'),
      path.join(base, archive),
      ...(process.env.PM_SOURCE_COMMIT ? [process.env.PM_SOURCE_COMMIT] : []),
      ...(process.env.PM_DEVELOPMENT_BUILD === 'true' ? ['--development'] : []),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (args.includes('--smoke'))
    execFileSync(
      process.execPath,
      [path.join(root, 'test/app-smoke.mjs'), '--installed', path.join(base, executable)],
      { cwd: root, stdio: 'inherit' },
    );
}
