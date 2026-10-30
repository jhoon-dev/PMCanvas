// Update signing is independent of Apple/Windows installer certificates.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createPublicKey, createHash } from 'node:crypto';
import {
  quietRun,
  secureDirectory,
  privatePath,
  requirePrivateRuntime,
} from './mac-signing-core.mjs';

requirePrivateRuntime();
if (process.platform !== 'win32' || !process.env.LOCALAPPDATA || process.argv[2] !== '--register')
  throw Error('Run on Windows: node scripts/setup-update-signing.mjs --register');
const repository = 'github.com/jhoon-dev/PMCanvas';
const environment = 'desktop-update-signing';
const folder = path.join(process.env.LOCALAPPDATA, 'PMCanvas-UpdateSigning');
const created = !fs.existsSync(folder);
if (created) fs.mkdirSync(folder);
secureDirectory(folder, created);
const file = path.join(folder, 'update-key.dpapi');
const source = fileURLToPath(new URL('../update-trust.mjs', import.meta.url));
const dpapi = (bytes, protect) => {
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${protect ? 'Protect' : 'Unprotect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result = quietRun(
    'powershell.exe',
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
};
let secret;
try {
  if (fs.existsSync(file)) {
    privatePath(file);
    secret = dpapi(fs.readFileSync(file), false);
  } else {
    secret = Buffer.from(
      generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    fs.writeFileSync(file, dpapi(secret, true), { flag: 'wx', mode: 0o600 });
  }
  const publicKey = createPublicKey(secret).export({ type: 'spki', format: 'pem' });
  const id = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  const content =
    '// Public verification keys only. Private keys stay outside Git.\nexport const UPDATE_KEYS = Object.freeze(' +
    JSON.stringify({ [id]: publicKey }) +
    ');\n';
  const hasTrustSource = fs.existsSync(source);
  if (hasTrustSource) {
    const trusted = (await import(new URL('../update-trust.mjs', import.meta.url))).UPDATE_KEYS;
    if (!Object.hasOwn(trusted, id) || trusted[id] !== publicKey)
      throw Error('A different update trust key exists. Perform an explicit key rotation.');
  }
  const endpoint = 'repos/jhoon-dev/PMCanvas/environments/' + environment;
  quietRun('gh', ['api', '--method', 'PUT', endpoint, '--input', '-'], {
    input: JSON.stringify({
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    }),
  });
  const rules = JSON.parse(
    quietRun('gh', ['api', endpoint + '/deployment-branch-policies']).toString(),
  ).branch_policies;
  if (rules.some((rule) => rule.name !== 'main' || rule.type !== 'branch'))
    throw Error('Update signing environment must allow only the main branch.');
  if (!rules.length)
    quietRun(
      'gh',
      ['api', '--method', 'POST', endpoint + '/deployment-branch-policies', '--input', '-'],
      { input: JSON.stringify({ name: 'main', type: 'branch' }) },
    );
  quietRun(
    'gh',
    ['secret', 'set', 'PM_UPDATE_SIGNING_KEY', '--repo', repository, '--env', environment],
    { input: secret, label: 'Could not register the update signing key.' },
  );
  if (!hasTrustSource) fs.writeFileSync(source, content, { flag: 'wx' });
  console.log(
    'Configured Ed25519 update signing: ' +
      id +
      '. Recovery copy is encrypted for the current Windows user.',
  );
} finally {
  secret?.fill(0);
}
