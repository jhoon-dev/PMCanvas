import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const result = spawnSync(
  windows ? 'cmd.exe' : 'sh',
  windows
    ? ['/d', '/c', 'gradlew.bat', ':app:assembleDebug', '--no-daemon']
    : ['./gradlew', ':app:assembleDebug', '--no-daemon'],
  { cwd: fileURLToPath(new URL('../android/', import.meta.url)), stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
