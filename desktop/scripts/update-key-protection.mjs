import { quietRun } from './mac-signing-core.mjs';
import { windowsPowerShellPath } from './windows-system.mjs';

// Keep key material on stdin; protect the recovery copy for the current Windows user.
export function dpapi(bytes, protect) {
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${protect ? 'Protect' : 'Unprotect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result = quietRun(
    windowsPowerShellPath(),
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { input: bytes.toString('base64'), label: 'Windows update key protection failed.' },
  );
  try {
    return Buffer.from(result.toString(), 'base64');
  } finally {
    result.fill(0);
  }
}
