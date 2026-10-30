import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { signUpdateManifest, verifyUpdateManifest } from '../update-signatures.mjs';
import { DesktopPreferences } from '../preferences.mjs';
import { UpdateManager } from '../update-manager.mjs';
import { StoreUpdateService, UpdateService, selectUpdate, STORE_UPDATES } from '../updates.mjs';
import { checkStoreUpdates } from '../store-updates.mjs';
import {
  downloadInstaller as realDownloadInstaller,
  verifyInstaller,
  checksumValue,
  assetUrl,
  openReleaseAsset,
  MAX_INSTALLER_BYTES,
} from '../update-download.mjs';

const payload = Buffer.from('synthetic installer payload; never executed');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fileName = 'PMCanvas-Desktop-0.9.0-Windows-x64.exe';
const downloadUrl =
  'https://github.com/jhoon-dev/PMCanvas/releases/download/desktop-v0.9.0/' + fileName;
const update = {
  currentVersion: '0.8.0',
  version: '0.9.0',
  available: true,
  downloadAvailable: true,
  fileName,
  downloadUrl,
  checksumUrl: downloadUrl + '.sha256',
};
const testKey = generateKeyPairSync('ed25519');
const envelope = signUpdateManifest(
  {
    schema: 1,
    product: 'pmcanvas-desktop',
    version: update.version,
    commit: 'a'.repeat(40),
    assets: [{ name: fileName, size: payload.length, sha256: digest(payload) }],
  },
  testKey.privateKey,
);
const testKeys = {
  [JSON.parse(envelope).keyId]: testKey.publicKey.export({ type: 'spki', format: 'pem' }),
};
const downloadInstaller = (u, d, options) =>
  realDownloadInstaller(u, d, {
    ...options,
    verify: (bytes, context) => verifyUpdateManifest(bytes, { ...context, keys: testKeys }),
  });
function temp(t) {
  const base = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base, 'pmcanvas-updates-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), base);
    assert.ok(path.basename(directory).startsWith('pmcanvas-updates-test-'));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  return directory;
}
function source({
  checksum = digest(payload),
  bytes = payload,
  length = bytes.length,
  checkName = fileName,
} = {}) {
  return async (url) => {
    if (url.endsWith('/update-manifest.json')) {
      const stream = Readable.from([envelope]);
      stream.headers = {};
      return stream;
    }
    const check = url.endsWith('.sha256');
    const stream = Readable.from([check ? Buffer.from(checksum + '  ' + checkName + '\n') : bytes]);
    stream.headers = check ? {} : { 'content-length': String(length) };
    return stream;
  };
}

test('startup checks run once, can be disabled, and never download or install without an explicit action', async () => {
  let checks = 0,
    downloads = 0;
  const service = {
    url: 'https://github.com/jhoon-dev/PMCanvas/releases',
    async check() {
      checks++;
      return update;
    },
  };
  const manager = new UpdateManager({
    service,
    version: '0.8.0',
    download: async () => {
      downloads++;
    },
  });
  assert.equal((await manager.start(false)).status, 'idle');
  assert.equal(checks, 0);
  await Promise.all([manager.start(true), manager.start(true), manager.check()]);
  assert.equal(checks, 1);
  assert.equal(downloads, 0);
  assert.equal(manager.snapshot().status, 'available');
  assert.equal(manager.snapshot().version, '0.9.0');
  assert.ok(!('fileName' in manager.snapshot()) && !('downloadUrl' in manager.snapshot()));
  await manager.check();
  assert.equal(checks, 2);
  const offline = new UpdateManager({
    service: {
      url: service.url,
      check: async () => {
        throw Error('offline');
      },
    },
    version: '0.8.0',
  });
  assert.equal((await offline.start(true)).status, 'error');
  offline.service = service;
  assert.equal((await offline.check()).status, 'available');
});

test('preferences migrate old profiles and preserve time zone and startup choice in either save order', (t) => {
  const file = path.join(temp(t), 'preferences.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ timeZone: 'America/New_York', futureSetting: 'preserved' }),
  );
  const preferences = new DesktopPreferences(file);
  assert.equal(preferences.value.checkUpdatesOnStart, true);
  preferences.update({ checkUpdatesOnStart: false });
  preferences.update({ timeZone: 'Europe/London' });
  const reopened = new DesktopPreferences(file);
  assert.equal(reopened.value.checkUpdatesOnStart, false);
  assert.equal(reopened.value.timeZone, 'Europe/London');
  assert.equal(reopened.value.futureSetting, 'preserved');
  const before = fs.readFileSync(file);
  assert.throws(() => reopened.update({ checkUpdatesOnStart: 'false' }));
  assert.throws(() => reopened.update({ timeZone: 'not/a/timezone' }));
  assert.throws(() => reopened.update({ unexpected: true }));
  assert.deepEqual(fs.readFileSync(file), before);
});

test('Store discovery uses only the native channel, distinguishes unavailable checks, and shares requests', async () => {
  let calls = 0;
  const store = new StoreUpdateService({
    query: async () => {
      calls++;
      return { supported: true, available: true };
    },
  });
  const manager = new UpdateManager({ service: store, version: '0.8.0' });
  await Promise.all([manager.start(true), manager.check()]);
  assert.equal(calls, 1);
  assert.equal(manager.snapshot().channel, 'microsoft-store');
  assert.equal(manager.snapshot().status, 'available');
  assert.equal(manager.snapshot().version, null);
  assert.equal(store.url, STORE_UPDATES);
  await assert.rejects(manager.download(), /compatible/);
  const unknown = new UpdateManager({
    service: new StoreUpdateService({
      query: async () => ({ supported: false, available: false }),
    }),
    version: '0.8.0',
  });
  assert.equal((await unknown.check()).status, 'unsupported');
  assert.equal(unknown.snapshot().checkedAt, null);
});

test('native Store helper bounds execution and never exposes raw subprocess diagnostics', async () => {
  const result = await checkStoreUpdates({
    packaged: true,
    platform: 'win32',
    run: (binary, args, options, callback) => {
      assert.match(binary, /powershell.exe$/);
      assert.ok(args.includes('-NonInteractive') && args.includes('-EncodedCommand'));
      assert.equal(options.windowsHide, true);
      assert.ok(options.timeout <= 20000 && options.maxBuffer <= 16384);
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.match(script, /GetAppAndOptionalStorePackageUpdatesAsync/);
      assert.doesNotMatch(script, /RequestDownload|Start-Process/);
      callback(null, '{"supported":true,"available":true}');
    },
  });
  assert.equal(result.available, true);
  await assert.rejects(
    checkStoreUpdates({
      packaged: true,
      platform: 'win32',
      run: (_b, _a, _o, done) => done(Error('private details')),
    }),
    (error) => !error.message.includes('private details'),
  );
  await assert.rejects(
    checkStoreUpdates({
      packaged: true,
      platform: 'win32',
      run: (_b, _a, _o, done) => done(null, '{}'),
    }),
  );
});

test('manual download verifies bytes, shares concurrent requests and rechecks the installer before opening', async (t) => {
  const directory = temp(t);
  let downloads = 0;
  const manager = new UpdateManager({
    service: { url: 'https://github.com/jhoon-dev/PMCanvas/releases', check: async () => update },
    version: '0.8.0',
    directory,
    download: (...args) => {
      downloads++;
      return downloadInstaller(args[0], args[1], { ...args[2], open: source() });
    },
  });
  await manager.check();
  await assert.rejects(manager.installerPath());
  const [a, b] = await Promise.all([manager.download(), manager.download()]);
  assert.equal(downloads, 1);
  assert.equal(a.status, 'downloaded');
  assert.deepEqual(a, b);
  const file = await manager.installerPath();
  assert.deepEqual(fs.readFileSync(file), payload);
  assert.equal(fs.existsSync(file + '.partial'), false);
  fs.writeFileSync(file, Buffer.alloc(payload.length));
  await assert.rejects(manager.installerPath(), /변경/);
  assert.equal(manager.snapshot().status, 'error');
  assert.equal(manager.installer, null);
});

test('bad checksums, truncated/oversized streams, names and URL substitution cannot leave an executable installer', async (t) => {
  const directory = temp(t);
  for (const scenario of [
    { checksum: '0'.repeat(64) },
    { length: payload.length + 1 },
    { length: MAX_INSTALLER_BYTES + 1 },
    { checkName: '../other.exe' },
    { checksum: 'bad' },
    { bytes: Buffer.alloc(0), length: 0 },
  ]) {
    await assert.rejects(downloadInstaller(update, directory, { open: source(scenario) }));
    assert.equal(fs.readdirSync(directory).length, 0);
  }
  for (const patch of [
    { available: false },
    { downloadUrl: 'https://attacker.example/a.exe' },
    { fileName: '../other.exe' },
    { checksumUrl: downloadUrl },
  ])
    await assert.rejects(downloadInstaller({ ...update, ...patch }, directory, { open: source() }));
  assert.throws(() => checksumValue(Buffer.alloc(4097), fileName));
  const folder = path.join(directory, 'actual');
  fs.mkdirSync(folder);
  const link = path.join(directory, 'redirected');
  fs.symlinkSync(folder, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(downloadInstaller(update, link, { open: source() }), /cache/);
});

test('download redirects remain HTTPS on the release/CDN allowlist and are bounded', async () => {
  for (const value of [
    'http://github.com/a',
    'https://github.com.attacker.example/a',
    'https://user:pass@github.com/a',
    'https://github.com:444/a',
    'file:///tmp/a',
  ])
    assert.throws(() => assetUrl(value));
  const request = (_url, _options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = (error) => req.emit('error', error);
    queueMicrotask(() =>
      callback({
        statusCode: 302,
        headers: { location: 'https://attacker.example/a' },
        resume() {},
      }),
    );
    return req;
  };
  await assert.rejects(openReleaseAsset(downloadUrl, { request }));
  const loop = (_url, _options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = (error) => req.emit('error', error);
    queueMicrotask(() =>
      callback({ statusCode: 302, headers: { location: downloadUrl }, resume() {} }),
    );
    return req;
  };
  await assert.rejects(openReleaseAsset(downloadUrl, { request: loop }), /redirect/);
});
