import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  compareVersions,
  selectUpdate,
  UpdateService,
  fetchReleases,
  RELEASES_PAGE,
} from '../updates.mjs';
const release = (v = '0.8.0') => ({
  tag_name: 'desktop-v' + v,
  html_url: RELEASES_PAGE + '/tag/desktop-v' + v,
  draft: false,
  prerelease: false,
  assets: [
    'PMCanvas-Desktop-' + v + '-Windows-x64.exe',
    'PMCanvas-Desktop-' + v + '-Windows-x64.exe.sha256',
  ].map((name) => ({
    name,
    browser_download_url:
      'https://github.com/jhoon-dev/PMCanvas/releases/download/desktop-v' + v + '/' + name,
  })),
});
test('update selection uses stable desktop tags, numeric versions and compatible checksummed assets', () => {
  assert.equal(compareVersions('0.10.0', '0.9.99'), 1);
  const data = [
    { ...release('99.0.0'), draft: true },
    { ...release('98.0.0'), prerelease: true },
    release('0.7.1'),
    release('0.10.0'),
    { tag_name: 'web-v99.0.0' },
  ];
  const next = selectUpdate(data, '0.7.2', 'win32', 'x64');
  assert.equal(next.version, '0.10.0');
  assert.equal(next.available, true);
  assert.equal(next.downloadAvailable, true);
  assert.equal(selectUpdate(data, '0.10.0', 'win32', 'x64').available, false);
  assert.equal(selectUpdate(data, '0.11.0', 'win32', 'x64').available, false);
  assert.equal(selectUpdate(data, '0.7.2', 'darwin', 'arm64').downloadAvailable, false);
  assert.equal(selectUpdate([], '0.7.2', 'win32', 'x64').version, null);
  assert.throws(() => compareVersions('1.2.3-alpha', '1.2.3'));
  assert.throws(() =>
    selectUpdate([{ ...release(), html_url: 'https://attacker.example' }], '0.7.2', 'win32', 'x64'),
  );
  const bad = release();
  bad.assets[0].browser_download_url = 'https://attacker.example/download.exe';
  assert.equal(selectUpdate([bad], '0.7.2', 'win32', 'x64').downloadAvailable, false);
});
test('manual update checks share a request, cache successes and allow retry after offline errors', async () => {
  let calls = 0,
    clock = 1000,
    resolve;
  const service = new UpdateService({
    now: () => clock,
    fetch: () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const a = service.check('0.7.2', 'win32', 'x64'),
    b = service.check('0.7.2', 'win32', 'x64');
  resolve([release()]);
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);
  await service.check('0.7.2', 'win32', 'x64');
  assert.equal(calls, 1);
  clock += 600001;
  const c = service.check('0.7.2', 'win32', 'x64');
  resolve([release()]);
  await c;
  assert.equal(calls, 2);
  let offline = true;
  const retry = new UpdateService({
    fetch: async () => {
      if (offline) throw Error('offline');
      return [release()];
    },
  });
  await assert.rejects(retry.check('0.7.2'));
  offline = false;
  assert.equal((await retry.check('0.7.2')).available, true);
});
test('release transport rejects HTTP errors, malformed JSON and oversized bodies', async () => {
  for (const scenario of ['http', 'json', 'oversize', 'valid']) {
    const request = (_url, _options, callback) => {
      const req = new EventEmitter();
      req.destroy = (error) => {
        req.emit('error', error);
        req.emit('close');
      };
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = scenario === 'http' ? 302 : 200;
        res.resume = () => {};
        callback(res);
        if (res.statusCode === 200) {
          res.emit(
            'data',
            Buffer.from(
              scenario === 'oversize'
                ? 'x'.repeat(512 * 1024 + 1)
                : scenario === 'json'
                  ? 'bad'
                  : JSON.stringify([release()]),
            ),
          );
          res.emit('end');
        }
        req.emit('close');
      });
      return req;
    };
    if (scenario === 'valid')
      assert.equal((await fetchReleases(request))[0].tag_name, 'desktop-v0.8.0');
    else await assert.rejects(fetchReleases(request));
  }
});
