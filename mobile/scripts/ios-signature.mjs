import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import plist from 'plist';

export function inspectAppleSignature(app, directory) {
  const inspect = (args, label) => {
    try {
      return execFileSync('codesign', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // These display commands contain only public signature information.
      throw Error(label + ': ' + String(error.stderr || error.message).slice(0, 4000));
    }
  };
  const entitlements = plist.parse(
    inspect(['-d', '--entitlements', '-', '--xml', app], 'Could not read signed entitlements'),
  );
  const prefix = path.join(directory, 'signed-cert');
  // This option has an optional argument: attach it with '=' so codesign does
  // not interpret the certificate filename as another application to inspect.
  inspect(['-d', '--extract-certificates=' + prefix, app], 'Could not extract signing certificate');
  return { entitlements, certificate: new X509Certificate(fs.readFileSync(prefix + '0')) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let directory;
  try {
    if (
      process.platform !== 'darwin' ||
      process.argv.length !== 3 ||
      process.argv[2] !== '--self-test'
    )
      throw Error('Run ios-signature.mjs --self-test on macOS.');
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-signature-test-'));
    fs.chmodSync(directory, 0o700);
    const result = inspectAppleSignature('/System/Applications/Calculator.app', directory);
    if (!result.entitlements || !/Apple/.test(result.certificate.subject))
      throw Error('Expected a real Apple-signed system application.');
    console.log('PASS: native codesign XML entitlements and signing certificate extraction.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (
      directory &&
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('pmcanvas-signature-test-')
    )
      fs.rmSync(directory, { recursive: true, force: true });
  }
}
