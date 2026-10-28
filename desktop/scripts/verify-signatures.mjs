import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

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
    for (const file of files)
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
  } else if (target === 'mac') {
    for (const dir of ['mac', 'mac-arm64']) {
      const app = path.join(output, dir, 'PM Canvas Desktop.app');
      run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], { stdio: 'inherit' });
      run('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
    }
  } else throw Error('Unsupported signature target.');
}
