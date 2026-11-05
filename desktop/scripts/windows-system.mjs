import path from 'node:path';

export function windowsSystemPath(...parts) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  if (!/^[a-z]:[\\/]/i.test(root)) throw Error('Windows SystemRoot must be a local absolute path.');
  return path.win32.join(root, 'System32', ...parts);
}

export const windowsPowerShellPath = () =>
  windowsSystemPath('WindowsPowerShell', 'v1.0', 'powershell.exe');
