import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const assetBase = 'https://github.com/jhoon-dev/PMCanvas/releases/download/desktop-v';
const allowedHosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
export function assetUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !allowedHosts.has(url.hostname)
  )
    throw Error('Invalid update download URL.');
  return url;
}
export function openReleaseAsset(
  value,
  { request = https.get, redirects = 0, timeout = 30000 } = {},
) {
  const url = assetUrl(value);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { headers: { 'User-Agent': 'PMCanvas-Desktop' }, signal: AbortSignal.timeout(timeout) },
      (res) => {
        res.on?.('error', reject);
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirects >= 3 || !res.headers.location)
            return reject(Error('Invalid update redirect.'));
          try {
            resolve(
              openReleaseAsset(new URL(res.headers.location, url), {
                request,
                redirects: redirects + 1,
                timeout,
              }),
            );
          } catch (error) {
            reject(error);
          }
        } else if (res.statusCode !== 200) {
          res.resume();
          reject(Error('Update download unavailable.'));
        } else resolve(res);
      },
    );
    req.setTimeout(30000, () => req.destroy(Error('Update download timed out.')));
    req.once('error', reject);
  });
}
export function checksumValue(bytes, fileName) {
  if (bytes.length > 4096) throw Error('Invalid update checksum.');
  const line = bytes.toString('utf8').trim();
  const match = line.match(/^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/);
  if (!match || match[2] !== fileName) throw Error('Invalid update checksum.');
  return match[1].toLowerCase();
}
function sameHash(actual, expected) {
  return (
    /^[a-f0-9]{64}$/.test(expected || '') &&
    timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
  );
}
export async function verifyInstaller(file, expected, expectedSize) {
  if ((await fs.promises.lstat(file)).isSymbolicLink())
    throw Error('Installer changed. Download the update again.');
  const handle = await fs.promises.open(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size !== expectedSize ||
      stat.size > MAX_INSTALLER_BYTES
    )
      throw Error('Installer changed. Download the update again.');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    if (!sameHash(hash.digest('hex'), expected))
      throw Error('Installer changed. Download the update again.');
    return file;
  } finally {
    await handle.close();
  }
}
export async function downloadInstaller(
  update,
  directory,
  { open = openReleaseAsset, onProgress = () => {} } = {},
) {
  if (
    !update.available ||
    !update.downloadAvailable ||
    !/^[A-Za-z0-9.-]+\.(?:exe|dmg)$/.test(update.fileName || '') ||
    update.downloadUrl !== assetBase + update.version + '/' + update.fileName ||
    update.checksumUrl !== update.downloadUrl + '.sha256'
  )
    throw Error('No compatible update installer.');
  assetUrl(update.downloadUrl);
  const check = await open(update.checksumUrl);
  const checkChunks = [];
  let checkSize = 0;
  for await (const chunk of check) {
    checkSize += chunk.length;
    if (checkSize > 4096) {
      check.destroy();
      throw Error('Invalid update checksum.');
    }
    checkChunks.push(Buffer.from(chunk));
  }
  const expected = checksumValue(Buffer.concat(checkChunks), update.fileName);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await fs.promises.lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error('Invalid update cache.');
  const folder = await fs.promises.mkdtemp(path.join(directory, 'download-'));
  await fs.promises.chmod(folder, 0o700);
  const file = path.join(folder, update.fileName),
    partial = file + '.partial';
  let complete = false;
  try {
    const input = await open(update.downloadUrl, { timeout: 600000 });
    const declared = input.headers?.['content-length'];
    const total = declared === undefined ? 0 : Number(declared);
    if (
      declared !== undefined &&
      (!Number.isSafeInteger(total) || total <= 0 || total > MAX_INSTALLER_BYTES)
    ) {
      input.destroy();
      throw Error('Invalid installer size.');
    }
    const hash = createHash('sha256');
    let received = 0;
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_INSTALLER_BYTES || (total && received > total))
          return callback(Error('Installer is too large.'));
        hash.update(chunk);
        onProgress({ received, total });
        callback(null, chunk);
      },
    });
    await pipeline(input, guard, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }), {
      signal: AbortSignal.timeout(600000),
    });
    if (!received || (total && total !== received) || !sameHash(hash.digest('hex'), expected))
      throw Error('Installer checksum mismatch.');
    await fs.promises.rename(partial, file);
    complete = true;
    return { file, sha256: expected, size: received };
  } finally {
    if (!complete) {
      await fs.promises.unlink(partial).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await fs.promises.rmdir(folder).catch((error) => {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
      });
    }
  }
}
