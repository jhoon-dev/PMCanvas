import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { storeConfiguration, storeVersion, storeManifest } from '../scripts/store-policy.mjs';
import { StoreUpdateService, STORE_UPDATES } from '../updates.mjs';
const { DOMParser } = createRequire(import.meta.url)('@xmldom/xmldom');
const env = {
  PM_STORE_IDENTITY_NAME: '12345.Example.PMCanvas',
  PM_STORE_PUBLISHER: 'CN=00000000-0000-0000-0000-000000000000',
  PM_STORE_PUBLISHER_DISPLAY_NAME: 'Example & Company',
  PM_STORE_PRODUCT_ID: '9TEST0000000',
};

test('Store builds require exact configured Partner Center identities and reject placeholders and injection', () => {
  const config = storeConfiguration(env);
  assert.equal(config.identityName, env.PM_STORE_IDENTITY_NAME);
  assert.equal(config.displayName, 'PM Canvas Desktop');
  const custom = storeConfiguration({ ...env, PM_STORE_DISPLAY_NAME: 'PM Canvas & Work' });
  assert.match(storeManifest(custom, '0.7.4'), /DisplayName="PM Canvas &amp; Work"/);
  for (const key of Object.keys(env))
    assert.throws(() => storeConfiguration({ ...env, [key]: '' }), /Configure/);
  for (const [key, value] of [
    ['PM_STORE_IDENTITY_NAME', '../other'],
    ['PM_STORE_IDENTITY_NAME', 'YOUR_IDENTITY'],
    ['PM_STORE_PUBLISHER', 'other'],
    ['PM_STORE_PUBLISHER', 'CN=<injected>'],
    ['PM_STORE_PRODUCT_ID', 'https://attacker.example'],
    ['PM_STORE_PRODUCT_ID', '9TEST00000000\nextra'],
  ])
    assert.throws(() => storeConfiguration({ ...env, [key]: value }));
});
test('Store package versions remain increasing and reserve a zero fourth field with nonzero major', () => {
  assert.equal(storeVersion('0.7.4'), '1.7.4.0');
  assert.equal(storeVersion('1.0.0'), '2.0.0.0');
  assert.equal(storeVersion('65534.65535.65535'), '65535.65535.65535.0');
  for (const v of ['0.7.4-dev', '0.7.4.1', '65535.0.0', '0.65536.0', '0.1.65536', '01.0.0'])
    assert.throws(() => storeVersion(v));
});
test('MSIX manifest preserves external AppData, escapes identities and uses full-trust desktop activation', () => {
  const xml = storeManifest(storeConfiguration(env), '0.7.4');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const element = (name) => doc.getElementsByTagName(name)[0];
  assert.equal(element('Identity').getAttribute('Publisher'), env.PM_STORE_PUBLISHER);
  assert.equal(element('Identity').getAttribute('Version'), '1.7.4.0');
  assert.equal(element('PublisherDisplayName').textContent, 'Example & Company');
  assert.equal(element('Application').getAttribute('Executable'), 'app\\PM Canvas Desktop.exe');
  assert.equal(element('desktop6:FileSystemWriteVirtualization').textContent, 'disabled');
  assert.equal(doc.getElementsByTagName('virtualization:ExcludedDirectory').length, 2);
  assert.match(xml, /Name="unvirtualizedResources"/);
  assert.match(xml, /Name="runFullTrust"/);
  assert.doesNotMatch(xml, /RegistryWriteVirtualization|runFullTrust.*runFullTrust/s);
});

test('rebuilding the same application gets a distinct Store identity without using the reserved fourth field', () => {
  assert.equal(storeVersion('0.8.3', 70), '1.8.73.0');
  assert.equal(storeVersion('0.8.3', '71'), '1.8.74.0');
  const xml = storeManifest(storeConfiguration(env), '0.8.3', 71);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  assert.equal(doc.getElementsByTagName('Identity')[0].getAttribute('Version'), '1.8.74.0');
  for (const build of ['', -1, 0.5, '01', ' 1', '1\n', 'nope', NaN, Infinity, 2 ** 53, null, true])
    assert.throws(() => storeVersion('0.8.3', build));
  assert.equal(storeVersion('0.8.3', 65532), '1.8.65535.0');
  assert.throws(() => storeVersion('0.8.3', 65533), /65535/);
});
test('Store installations direct updates to the fixed Store library without requesting GitHub releases', async () => {
  const updates = new StoreUpdateService();
  const value = await updates.check('0.7.4');
  assert.equal(value.channel, 'microsoft-store');
  assert.equal(value.url, STORE_UPDATES);
  assert.equal(value.url, 'ms-windows-store://downloadsandupdates');
  assert.equal(value.downloadAvailable, false);
  assert.equal(value.available, false);
  await assert.rejects(() => updates.check('https://attacker.example'));
});
