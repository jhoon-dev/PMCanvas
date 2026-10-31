import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { releaseSource } from '../../desktop/scripts/release-policy.mjs';
import { requirePrivateRuntime } from '../../desktop/scripts/mac-signing-core.mjs';
import { iosStoreInputs } from './ios-store-policy.mjs';

const mobile = fileURLToPath(new URL('../', import.meta.url));
let directory;
try {
  requirePrivateRuntime();
  if (process.platform !== 'darwin' || process.argv.length !== 2)
    throw Error('Upload iOS Store builds on macOS.');
  const expected = iosStoreInputs(
    JSON.parse(fs.readFileSync(path.join(mobile, 'package.json'))),
    JSON.parse(fs.readFileSync(path.join(mobile, 'capacitor.config.json'))),
    process.env,
  );
  const commit = releaseSource(path.dirname(mobile));
  const output = path.join(mobile, 'build/app-store');
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'ios-store-manifest.json')));
  if (
    !manifest.signed ||
    manifest.commit !== commit ||
    Object.entries(expected).some(([k, v]) => manifest[k] !== v) ||
    path.basename(manifest.artifact.name) !== manifest.artifact.name ||
    !manifest.artifact.name.endsWith('.ipa')
  )
    throw Error('Upload only a verified signed IPA from the current main source.');
  const ipa = path.join(output, manifest.artifact.name);
  if (createHash('sha256').update(fs.readFileSync(ipa)).digest('hex') !== manifest.artifact.sha256)
    throw Error('IPA checksum mismatch.');
  const id = process.env.ASC_KEY_ID,
    issuer = process.env.ASC_ISSUER_ID,
    key = Buffer.from(process.env.ASC_KEY_BASE64 || '', 'base64');
  for (const name of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_BASE64']) delete process.env[name];
  if (
    !/^[A-Z0-9]{10}$/.test(id || '') ||
    !/^[a-f0-9-]{36}$/i.test(issuer || '') ||
    createPrivateKey(key).asymmetricKeyType !== 'ec'
  )
    throw Error('Configure the existing App Store upload API key.');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-ios-upload-'));
  fs.chmodSync(directory, 0o700);
  fs.writeFileSync(path.join(directory, 'AuthKey_' + id + '.p8'), key, { mode: 0o600 });
  key.fill(0);
  for (const operation of ['--validate-app', '--upload-app'])
    execFileSync(
      'xcrun',
      ['altool', operation, '--type', 'ios', '--file', ipa, '--apiKey', id, '--apiIssuer', issuer],
      { stdio: 'inherit', env: { ...process.env, API_PRIVATE_KEYS_DIR: directory } },
    );
  fs.writeFileSync(
    path.join(output, 'upload-result.json'),
    JSON.stringify(
      {
        commit,
        version: expected.version,
        buildNumber: expected.buildNumber,
        uploaded: true,
        submittedForReview: false,
        published: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Uploaded iOS build. Apple processing and App Review remain.');
} catch (error) {
  console.error(error.status ? 'iOS upload failed. Review Apple output.' : error.message);
  process.exitCode = 1;
} finally {
  if (
    directory &&
    path.dirname(directory) === path.resolve(os.tmpdir()) &&
    path.basename(directory).startsWith('pmcanvas-ios-upload-')
  )
    fs.rmSync(directory, { recursive: true, force: true });
}
