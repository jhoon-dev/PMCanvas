import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { windowsStoreProfile } from '../windows-profile.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-profile-'));
  t.after(() => {
    assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('pmcanvas-profile-'));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const appData = path.join(home, 'AppData', 'Roaming');
  const legacy = path.join(appData, 'pmcanvas-desktop');
  fs.mkdirSync(legacy, { recursive: true });
  return { home, appData, legacy };
}

test('Store migration preserves recovery, settings and Chromium language without changing originals', (t) => {
  const context = fixture(t);
  const files = {
    'workspace.json': '{"tabs":[{"name":"한글 미저장 업무"}]}',
    'recovery.json': '{"dirty":true,"project":{"name":"이전 프로젝트"}}',
    'preferences.json': '{"timeZone":"America/New_York"}',
    'public-holidays.json': '{"holidays":[]}',
    'Local Storage/leveldb/000003.log': 'pmcanvas.language=en',
    'preferences.json.invalid-backup': 'preserved broken settings',
  };
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(context.legacy, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  fs.mkdirSync(path.join(context.legacy, 'Cache'));
  fs.writeFileSync(path.join(context.legacy, 'Cache', 'old'), 'discardable cache');
  const profile = windowsStoreProfile(context);
  assert.equal(profile, path.join(context.home, 'PM Canvas', 'Profile'));
  assert.ok(!profile.startsWith(context.appData + path.sep));
  for (const [name, bytes] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(profile, name), 'utf8'), bytes);
    assert.equal(fs.readFileSync(path.join(context.legacy, name), 'utf8'), bytes);
  }
  assert.equal(fs.existsSync(path.join(profile, 'Cache')), false);
  // New Store writes must win on later starts, updates and reinstallations.
  fs.writeFileSync(path.join(profile, 'workspace.json'), 'new unsaved Store work');
  fs.writeFileSync(path.join(context.legacy, 'workspace.json'), 'older EXE work');
  assert.equal(windowsStoreProfile(context), profile);
  assert.equal(
    fs.readFileSync(path.join(profile, 'workspace.json'), 'utf8'),
    'new unsaved Store work',
  );
});

test('Store migration finds the older display-name profile and also supports fresh installations', (t) => {
  const context = fixture(t);
  const old = path.join(context.appData, 'PM Canvas Desktop');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'recovery.json'), 'legacy recovery');
  const profile = windowsStoreProfile(context);
  assert.equal(fs.readFileSync(path.join(profile, 'recovery.json'), 'utf8'), 'legacy recovery');
  const freshHome = path.join(context.home, 'fresh');
  const fresh = windowsStoreProfile({ home: freshHome, appData: path.join(freshHome, 'AppData') });
  assert.ok(fs.statSync(fresh).isDirectory());
});

test('Failed migration never publishes a partial profile or touches the source', (t) => {
  const context = fixture(t);
  fs.writeFileSync(path.join(context.legacy, 'recovery.json'), 'valuable original');
  const linked = path.join(context.legacy, 'linked-profile');
  fs.symlinkSync(context.home, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => windowsStoreProfile(context), /profile links/);
  assert.equal(fs.existsSync(path.join(context.home, 'PM Canvas', 'Profile')), false);
  assert.equal(
    fs.readFileSync(path.join(context.legacy, 'recovery.json'), 'utf8'),
    'valuable original',
  );
  assert.deepEqual(fs.readdirSync(path.join(context.home, 'PM Canvas')), []);
  fs.unlinkSync(linked);
  assert.ok(fs.existsSync(windowsStoreProfile(context)));
});
