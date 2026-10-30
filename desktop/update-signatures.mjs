import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { UPDATE_KEYS } from './update-trust.mjs';

export const UPDATE_MANIFEST = 'update-manifest.json';
const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
function validate(manifest) {
  if (
    !manifest ||
    manifest.schema !== 1 ||
    manifest.product !== 'pmcanvas-desktop' ||
    !versionPattern.test(manifest.version || '') ||
    !/^[a-f0-9]{40}$/.test(manifest.commit || '') ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.length ||
    manifest.assets.length > 5
  )
    throw Error('Invalid signed update manifest.');
  const names = new Set();
  for (const asset of manifest.assets) {
    const prefix = 'PMCanvas-Desktop-' + manifest.version;
    if (
      !asset ||
      ![
        prefix + '-Windows-x64.exe',
        ...['arm64', 'x64'].flatMap((arch) =>
          ['dmg', 'zip'].map((ext) => prefix + '-macOS-' + arch + '.' + ext),
        ),
      ].includes(asset.name) ||
      names.has(asset.name) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256 || '') ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > 1024 * 1024 * 1024
    )
      throw Error('Invalid signed update asset.');
    names.add(asset.name);
  }
  return manifest;
}
export function signUpdateManifest(manifest, privateKey) {
  validate(manifest);
  const publicKey = createPublicKey(privateKey);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw Error('An Ed25519 update key is required.');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const keyId = createHash('sha256').update(pem).digest('hex').slice(0, 16);
  const payload = Buffer.from(JSON.stringify(manifest));
  return Buffer.from(
    JSON.stringify({
      schema: 1,
      keyId,
      payload: payload.toString('base64'),
      signature: sign(null, payload, privateKey).toString('base64'),
    }) + '\n',
  );
}
function verifyManifest(bytes, { version, fileName, keys = UPDATE_KEYS } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw Error('Invalid update signature.');
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (
    !envelope ||
    envelope.schema !== 1 ||
    !Object.hasOwn(keys, envelope.keyId) ||
    typeof envelope.payload !== 'string' ||
    typeof envelope.signature !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature)
  )
    throw Error('Untrusted update signature.');
  const payload = Buffer.from(envelope.payload, 'base64'),
    signature = Buffer.from(envelope.signature, 'base64');
  if (
    signature.length !== 64 ||
    payload.toString('base64') !== envelope.payload ||
    !verify(null, payload, keys[envelope.keyId], signature)
  )
    throw Error('Update signature verification failed.');
  const manifest = validate(JSON.parse(payload.toString('utf8')));
  if (manifest.version !== version) throw Error('Signed update version mismatch.');
  const asset = manifest.assets.find((item) => item.name === fileName);
  if (!asset) throw Error('Installer is not authorized by the update publisher.');
  return { ...asset, version: manifest.version, commit: manifest.commit };
}
export function verifyUpdateManifest(bytes, options) {
  try {
    return verifyManifest(bytes, options);
  } catch (error) {
    error.code = 'UPDATE_UNTRUSTED';
    throw error;
  }
}
