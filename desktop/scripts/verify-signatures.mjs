import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export function verifyWindowsSignature(file, run = execFileSync) {
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$s=Get-AuthenticodeSignature -LiteralPath $env:PM_SIGNATURE_FILE; if ($s.Status -ne 'Valid' -or !$s.SignerCertificate -or !$s.TimeStamperCertificate) { throw 'Valid timestamped Authenticode signature required.' }",
    ],
    { stdio: 'inherit', env: { ...process.env, PM_SIGNATURE_FILE: file } },
  );
}

export function verifyMacApp(app, run = execFileSync) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], { stdio: 'inherit' });
  run('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
}

export function verifySignatures(target, output, run = execFileSync) {
  if (target === 'win') {
    const files = [
      path.join(output, 'win-unpacked', 'PM Canvas Desktop.exe'),
      ...fs
        .readdirSync(output)
        .filter((name) => name.endsWith('.exe'))
        .map((name) => path.join(output, name)),
    ];
    if (files.length < 2) throw Error('Signed Windows installer is missing.');
    for (const file of files) verifyWindowsSignature(file, run);
  } else if (target === 'mac') {
    for (const dir of ['mac', 'mac-arm64']) {
      const app = path.join(output, dir, 'PM Canvas Desktop.app');
      verifyMacApp(app, run);
    }
  } else throw Error('Unsupported signature target.');
}
