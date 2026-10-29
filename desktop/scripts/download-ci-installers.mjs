import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
if (process.env.CI !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID || ''))
  throw Error('A GitHub Actions run is required.');
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.env.PM_INSTALLER_MODE || 'unsigned';
if (!['signed', 'unsigned'].includes(mode)) throw Error('Invalid installer mode.');
const output = path.join(root, 'dist/lifecycle-artifact');
if (fs.existsSync(output)) throw Error('Preserve previous installer artifacts.');
execFileSync(
  'gh',
  [
    'run',
    'download',
    process.env.GITHUB_RUN_ID,
    '--name',
    'PMCanvas-' + mode + '-' + (process.platform === 'win32' ? 'win' : 'mac'),
    '--dir',
    output,
  ],
  { cwd: path.dirname(root), stdio: 'inherit', windowsHide: true },
);
