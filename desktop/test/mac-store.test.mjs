import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { macStoreConfiguration } from '../scripts/mac-store-policy.mjs';
import { MacStoreUpdateService, MAC_STORE_UPDATES } from '../updates.mjs';
import { UpdateManager } from '../update-manager.mjs';
import { MacFileAccess } from '../mac-file-access.mjs';

test('MAS requires dedicated distribution credentials; verification cannot produce a signed submission', () => {
  const pkg = {
    version: '0.8.3',
    build: { appId: 'app.pmcanvas.desktop', mac: { target: ['dmg', 'zip'] } },
  };
  assert.throws(() => macStoreConfiguration(pkg, {}), /Configure Mac App Store credentials/);
  const env = {
    PM_MAS_TEAM_ID: 'ABCDE12345',
    PM_MAS_BUILD_NUMBER: '1',
    PM_MAS_PROFILE: path.resolve('profile.provisionprofile'),
    CSC_LINK: 'synthetic',
    CSC_KEY_PASSWORD: 'synthetic',
    CSC_INSTALLER_LINK: 'synthetic',
    CSC_INSTALLER_KEY_PASSWORD: 'synthetic',
  };
  const config = macStoreConfiguration(pkg, env);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.mas.bundleVersion, '1');
  assert.equal(config.mas.extendInfo.ElectronTeamID, env.PM_MAS_TEAM_ID);
  assert.equal(config.mas.notarize, false);
  for (const name of Object.keys(env))
    assert.throws(() => macStoreConfiguration(pkg, { ...env, [name]: '' }));
  for (const value of ['0', '10000', '1.2', '1\n', '-1'])
    assert.throws(() => macStoreConfiguration(pkg, { ...env, PM_MAS_BUILD_NUMBER: value }));
  assert.throws(() => macStoreConfiguration(pkg, { ...env, PM_MAS_TEAM_ID: 'invalid' }));
  const verify = macStoreConfiguration(pkg, {}, true);
  assert.equal(verify.mas.identity, null);
  assert.equal(verify.forceCodeSigning, false);
  assert.equal(verify.mas.provisioningProfile, undefined);
});

test('MAS updates use only App Store and cannot download or launch a GitHub installer', async () => {
  const service = new MacStoreUpdateService();
  const manager = new UpdateManager({
    service,
    version: '0.8.3',
    directory: 'unused',
    download: () => {
      throw Error('Must not download');
    },
  });
  assert.equal(manager.snapshot().channel, 'mac-app-store');
  const result = await manager.check();
  assert.equal(result.url, MAC_STORE_UPDATES);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.channel, 'mac-app-store');
  assert.equal(result.available, false);
  assert.equal(result.downloadAvailable, false);
  await assert.rejects(() => manager.download(), /No compatible/);
  await assert.rejects(() => service.check('invalid'), /Invalid application version/);
});

function fixture(t, enabled = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-mas-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'bookmarks.json');
  const target = path.join(directory, 'project.pmcanvas');
  let stopped = 0,
    prompts = 0,
    selected = directory,
    canceled = false;
  const access = new MacFileAccess({
    enabled,
    file,
    app: {
      startAccessingSecurityScopedResource: (bookmark) => {
        assert.equal(bookmark, 'synthetic');
        return () => stopped++;
      },
    },
    dialog: {
      showOpenDialog: async (_window, options) => {
        prompts++;
        if (enabled) assert.equal(options.securityScopedBookmarks, true);
        return { canceled, filePaths: canceled ? [] : [selected], bookmarks: ['synthetic'] };
      },
    },
    window: () => null,
  });
  return {
    directory,
    target,
    access,
    file,
    stopped: () => stopped,
    prompts: () => prompts,
    select: (file) => (selected = file),
    cancel: () => (canceled = true),
  };
}

test('MAS folder grants protect atomic saves, survive restart and release access on exit', async (t) => {
  const f = fixture(t);
  assert.equal(await f.access.write(f.target, () => 42, true), 42);
  assert.equal(f.prompts(), 1);
  assert.equal(await f.access.write(f.target, () => 43, true), 43);
  assert.equal(f.prompts(), 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.file).mode & 0o077, 0);
  f.access.dispose();
  assert.equal(f.stopped(), 1);
  f.access.restore(f.target);
  assert.equal(await f.access.write(f.target, () => 44), 44);
  assert.equal(f.prompts(), 1);
  f.access.dispose();
  assert.equal(f.stopped(), 2);
});

test('MAS grants are limited to the selected folder; cancel and wrong folders never write', async (t) => {
  const f = fixture(t);
  let writes = 0;
  f.select(path.dirname(f.directory));
  await assert.rejects(() => f.access.write(f.target, () => writes++), /폴더를 선택/);
  assert.equal(writes, 0);
  f.cancel();
  assert.equal(await f.access.write(f.target, () => writes++), null);
  assert.equal(writes, 0);
  assert.equal(fs.existsSync(f.file), false);
});

test('MAS file bookmarks reopen only their project and transient export grants always close', async (t) => {
  const f = fixture(t);
  f.select(f.target);
  await f.access.open({ properties: ['openFile'] }, true);
  f.access.dispose();
  assert.throws(() => f.access.restore(path.join(f.directory, 'other.pmcanvas')), /접근 권한/);
  f.access.restore(f.target);
  f.access.dispose();
  f.select(f.directory);
  await assert.rejects(
    () =>
      f.access.write(f.target, () => {
        throw Error('write failed');
      }),
    /write failed/,
  );
  assert.equal(f.stopped(), 3);
});

test('non-MAS builds keep their existing file flow without bookmark files or folder prompts', async (t) => {
  const f = fixture(t, false);
  f.access.restore(f.target);
  assert.equal(await f.access.write(f.target, () => 42), 42);
  assert.equal(f.prompts(), 0);
  assert.equal(fs.existsSync(f.file), false);
});
