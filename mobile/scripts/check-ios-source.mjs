import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { releaseSource } from '../../desktop/scripts/release-policy.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  console.log('PASS: iOS source remains clean at ' + releaseSource(root));
} catch (error) {
  // Only file names/status are reported; never print credential file contents.
  console.error(
    execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: path.resolve(root),
      encoding: 'utf8',
    }),
  );
  console.error(error.message);
  process.exitCode = 1;
}
