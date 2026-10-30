import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
import { Readable } from 'node:stream';
import { DesktopPreferences } from '../preferences.mjs';
import { UPDATE_KEYS } from '../update-trust.mjs';
import { signUpdateManifest, verifyUpdateManifest } from '../update-signatures.mjs';
import { downloadInstaller } from '../update-download.mjs';
import { cleanupUpdateCache, CACHE_MAX_AGE } from '../update-cache.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function temp(t) {
  const base = fs.realpathSync(os.tmpdir()),
    directory = fs.mkdtempSync(path.join(base, 'pmcanvas-hardening-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), base);
    assert.ok(path.basename(directory).startsWith('pmcanvas-hardening-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function authorization() {
  const key = generateKeyPairSync('ed25519');
  const payload = Buffer.from('synthetic installer, never executed');
  const name = 'PMCanvas-Desktop-0.9.0-Windows-x64.exe';
  const manifest = {
    schema: 1,
    product: 'pmcanvas-desktop',
    version: '0.9.0',
    commit: 'a'.repeat(40),
    assets: [{ name, size: payload.length, sha256: hash(payload) }],
  };
  const bytes = signUpdateManifest(manifest, key.privateKey);
  const keys = { [JSON.parse(bytes).keyId]: key.publicKey.export({ type: 'spki', format: 'pem' }) };
  const verify = (bytes, context) => verifyUpdateManifest(bytes, { ...context, keys });
  return { key, payload, name, manifest, bytes, keys, verify };
}
test('signed updates bind publisher key, version, asset, size and hash; replacing both installer and checksum cannot authorize a download', async (t) => {
  const f = authorization(),
    context = { version: '0.9.0', fileName: f.name };
  assert.deepEqual(f.verify(f.bytes, context), {
    ...f.manifest.assets[0],
    version: '0.9.0',
    commit: 'a'.repeat(40),
  });
  assert.throws(() => verifyUpdateManifest(f.bytes, context), /Untrusted/);
  for (const mutation of [
    (envelope) => {
      envelope.keyId = 'unknown';
    },
    (envelope) => {
      envelope.signature = Buffer.alloc(64).toString('base64');
    },
    (envelope) => {
      const body = JSON.parse(Buffer.from(envelope.payload, 'base64'));
      body.assets[0].sha256 = '0'.repeat(64);
      envelope.payload = Buffer.from(JSON.stringify(body)).toString('base64');
    },
  ]) {
    const envelope = JSON.parse(f.bytes);
    mutation(envelope);
    assert.throws(() => f.verify(Buffer.from(JSON.stringify(envelope)), context));
  }
  assert.throws(() => f.verify(f.bytes, { ...context, version: '0.9.1' }), /version/);
  assert.throws(() => f.verify(f.bytes, { ...context, fileName: 'other.exe' }), /authorized/);
  assert.throws(() => f.verify(Buffer.alloc(65537), context));
  assert.throws(
    () =>
      signUpdateManifest(
        f.manifest,
        generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey,
      ),
    /Ed25519/,
  );
  for (const [id, key] of Object.entries(UPDATE_KEYS)) {
    assert.equal(createPublicKey(key).asymmetricKeyType, 'ed25519');
    assert.equal(hash(key).slice(0, 16), id);
  }
  const directory = temp(t),
    downloadUrl =
      'https://github.com/jhoon-dev/PMCanvas/releases/download/desktop-v0.9.0/' + f.name;
  const update = {
    available: true,
    downloadAvailable: true,
    version: '0.9.0',
    fileName: f.name,
    downloadUrl,
    checksumUrl: downloadUrl + '.sha256',
  };
  let binaries = 0;
  const open = async (url) => {
    let body;
    if (url.endsWith('/update-manifest.json')) body = f.bytes;
    else if (url.endsWith('.sha256')) body = Buffer.from(hash(f.payload) + '  ' + f.name);
    else {
      binaries++;
      body = f.payload;
    }
    const stream = Readable.from([body]);
    stream.headers = {};
    return stream;
  };
  const a = await downloadInstaller(update, directory, { open, verify: f.verify });
  const b = await downloadInstaller(update, directory, { open, verify: f.verify });
  assert.equal(a.file, b.file);
  assert.equal(binaries, 1);
  assert.deepEqual(fs.readFileSync(a.file), f.payload);
  const hostile = async (url) => {
    if (url.endsWith('.sha256')) {
      const stream = Readable.from([Buffer.from('0'.repeat(64) + '  ' + f.name)]);
      stream.headers = {};
      return stream;
    }
    return open(url);
  };
  await assert.rejects(
    downloadInstaller(update, directory, { open: hostile, verify: f.verify }),
    /publisher/,
  );
  const unauthenticated = async (url) => {
    if (url.endsWith('/update-manifest.json')) return Readable.from([Buffer.from('{}')]);
    return open(url);
  };
  await assert.rejects(
    downloadInstaller(update, directory, { open: unauthenticated, verify: f.verify }),
  );
  assert.equal(binaries, 1);
});

test('cache retention bounds completed downloads and preserves current, active, unrelated and symlink targets', async (t) => {
  const directory = temp(t),
    root = path.join(directory, 'cache');
  fs.mkdirSync(root);
  const name = 'PMCanvas-Desktop-0.9.0-Windows-x64.exe';
  const folder = (age = 0) => {
    const f = fs.mkdtempSync(path.join(root, 'download-'));
    fs.writeFileSync(path.join(f, name), 'payload');
    const at = new Date(Date.now() - age);
    fs.utimesSync(path.join(f, name), at, at);
    fs.utimesSync(f, at, at);
    return f;
  };
  const expired = folder(CACHE_MAX_AGE + 10000),
    keep = folder(),
    current = folder();
  const active = fs.mkdtempSync(path.join(root, 'download-'));
  fs.writeFileSync(path.join(active, '.active'), '');
  fs.writeFileSync(path.join(active, name + '.partial'), 'partial');
  const unrelated = fs.mkdtempSync(path.join(root, 'download-'));
  fs.writeFileSync(path.join(unrelated, 'my-notes.txt'), 'preserve');
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'private.txt'), 'preserve');
  fs.symlinkSync(
    outside,
    path.join(root, 'download-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await cleanupUpdateCache(root, {
    keep: [path.join(keep, name), path.join(current, name)],
    maxFolders: 1,
  });
  assert.equal(fs.existsSync(expired), false);
  assert.equal(fs.existsSync(keep), true);
  assert.equal(fs.existsSync(current), true);
  assert.equal(fs.existsSync(active), true);
  assert.equal(fs.readFileSync(path.join(unrelated, 'my-notes.txt'), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(path.join(outside, 'private.txt'), 'utf8'), 'preserve');
  await assert.rejects(
    cleanupUpdateCache(root, {
      keep: [path.join(keep, name), path.join(current, name)],
      maxBytes: 1,
    }),
    /busy|full/,
  );
  assert.equal(fs.existsSync(path.join(active, name + '.partial')), true);
});

test('preferences recover without destroying original bytes or unrelated settings and refuse unsafe persistence', (t) => {
  const directory = temp(t),
    file = path.join(directory, 'preferences.json');
  const original = Buffer.from('{broken JSON');
  fs.writeFileSync(file, original);
  for (let i = 0; i < 3; i++) {
    const preferences = new DesktopPreferences(file);
    assert.equal(preferences.value.timeZone, 'Asia/Seoul');
    assert.equal(preferences.value.checkUpdatesOnStart, false);
    assert.equal(preferences.recovery.backupCreated, true);
  }
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(fs.readdirSync(directory).filter((n) => n.includes('.invalid-')).length, 1);
  const preferences = new DesktopPreferences(file);
  preferences.update({ timeZone: 'UTC' });
  assert.equal(new DesktopPreferences(file).recovery, null);
  fs.writeFileSync(
    file,
    JSON.stringify({
      timeZone: 'Bad/Zone',
      checkUpdatesOnStart: false,
      futureSetting: { preserve: true },
    }),
  );
  const invalidZone = new DesktopPreferences(file);
  assert.equal(invalidZone.value.timeZone, 'Asia/Seoul');
  invalidZone.update({ timeZone: 'Asia/Tokyo' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).futureSetting, { preserve: true });
  assert.equal(new DesktopPreferences(file).value.checkUpdatesOnStart, false);
  const oversized = Buffer.alloc(65537, 120);
  fs.writeFileSync(file, oversized);
  const fallback = new DesktopPreferences(file);
  assert.equal(fallback.recovery.backupCreated, false);
  assert.throws(() => fallback.update({ timeZone: 'UTC' }), /보존/);
  assert.deepEqual(fs.readFileSync(file), oversized);
});
