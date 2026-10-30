import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey } from 'node:crypto';
import { releaseSource } from './release-policy.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
let privateDirectory;
try {
  if (process.platform !== 'darwin') throw Error('Upload MAS builds on macOS.');
  if (process.argv.length !== 2) throw Error('Usage: upload-mac-store.mjs');
  const { ASC_KEY_BASE64, ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
  if (
    !ASC_KEY_BASE64 ||
    !/^[A-Z0-9]{10}$/.test(ASC_KEY_ID || '') ||
    !/^[a-f0-9-]{36}$/i.test(ASC_ISSUER_ID || '')
  )
    throw Error('Configure ASC_KEY_BASE64, ASC_KEY_ID and ASC_ISSUER_ID.');
  const key = Buffer.from(ASC_KEY_BASE64, 'base64');
  if (createPrivateKey(key).asymmetricKeyType !== 'ec')
    throw Error('Use an App Store Connect P8 API key.');
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
  const output = path.join(desktop, 'dist', 'mas-submission-' + pkg.version);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'mas-manifest.json')));
  if (
    !manifest.signed ||
    !manifest.submissionPackage ||
    manifest.artifacts.length !== 1 ||
    manifest.commit !== releaseSource(path.dirname(desktop)) ||
    manifest.version !== pkg.version ||
    manifest.bundleId !== pkg.build.appId
  )
    throw Error('Upload requires a signed PKG from the current source commit.');
  const artifact = manifest.artifacts[0];
  if (path.basename(artifact.name) !== artifact.name || !artifact.name.endsWith('.pkg'))
    throw Error('Invalid PKG path.');
  const file = path.join(output, 'mas-universal', artifact.name);
  if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== artifact.sha256)
    throw Error('PKG checksum mismatch.');
  privateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-asc-'));
  fs.chmodSync(privateDirectory, 0o700);
  fs.writeFileSync(path.join(privateDirectory, 'AuthKey_' + ASC_KEY_ID + '.p8'), key, {
    mode: 0o600,
  });
  const env = { ...process.env, API_PRIVATE_KEYS_DIR: privateDirectory };
  for (const operation of ['--validate-app', '--upload-app'])
    execFileSync(
      'xcrun',
      [
        'altool',
        operation,
        '--type',
        'macos',
        '--file',
        file,
        '--apiKey',
        ASC_KEY_ID,
        '--apiIssuer',
        ASC_ISSUER_ID,
      ],
      { stdio: 'inherit', env },
    );
  fs.writeFileSync(
    path.join(output, 'upload-result.json'),
    JSON.stringify(
      {
        commit: manifest.commit,
        version: pkg.version,
        buildNumber: manifest.buildNumber,
        uploaded: true,
        submittedForReview: false,
        published: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Uploaded to App Store Connect. Processing, sandbox runtime testing and App Review remain.',
  );
} catch (error) {
  console.error(
    error.status ? 'App Store Connect upload failed. Review the upload output.' : error.message,
  );
  process.exitCode = 1;
} finally {
  if (
    privateDirectory &&
    path.dirname(privateDirectory) === path.resolve(os.tmpdir()) &&
    path.basename(privateDirectory).startsWith('pmcanvas-asc-')
  )
    fs.rmSync(privateDirectory, { recursive: true, force: true });
}
