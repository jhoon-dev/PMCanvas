import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { releasePlan } from '../scripts/release-policy.mjs';
import { stageReleaseArtifacts } from '../scripts/release-evidence.mjs';

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage');
  fs.mkdirSync(stage);
  const pkg = { name: 'pmcanvas-desktop', version: '0.8.0' },
    commit = 'a'.repeat(40);
  const plan = releasePlan(options),
    signed = plan.mode === 'signed';
  const files = [],
    manifests = [],
    evidence = [],
    assets = new Map();
  const write = (file, value) => {
    fs.writeFileSync(file, JSON.stringify(value));
    files.push(file);
  };
  for (const platform of plan.platforms) {
    const folder = path.join(root, platform);
    fs.mkdirSync(folder);
    const names =
      platform === 'win'
        ? ['PMCanvas-Desktop-0.8.0-Windows-x64.exe']
        : ['arm64', 'x64'].flatMap((arch) =>
            ['dmg', 'zip'].map((ext) => `PMCanvas-Desktop-0.8.0-macOS-${arch}.${ext}`),
          );
    const artifacts = names.map((name) => {
      const file = path.join(folder, name);
      fs.writeFileSync(file, 'synthetic installer: ' + name);
      const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      fs.writeFileSync(file + '.sha256', sha256 + '  ' + name + '\n');
      files.push(file, file + '.sha256');
      assets.set(name, sha256);
      return { name, sha256 };
    });
    const file = path.join(folder, signed ? 'release-manifest.json' : 'unsigned-manifest.json');
    const value = {
      product: pkg.name,
      version: pkg.version,
      commit,
      platform,
      signed,
      notarized: signed && platform === 'mac',
      macAdHoc: !signed && platform === 'mac',
      verification: { signatures: true, nativeSmoke: true },
      artifacts,
    };
    write(file, value);
    manifests.push({ file, value });
  }
  for (const system of plan.systems) {
    const [platform, arch] = system.split('-');
    const name =
      platform === 'win32'
        ? 'PMCanvas-Desktop-0.8.0-Windows-x64.exe'
        : `PMCanvas-Desktop-0.8.0-macOS-${arch}.dmg`;
    const value = {
      platform,
      arch,
      version: pkg.version,
      commit,
      baseline: '0.7.1',
      checks: ['install', 'upgrade', 'reopen', 'uninstall', 'reinstall'],
      projectSha256: 'b'.repeat(64),
      mode: plan.mode,
      installerSha256: assets.get(name),
      signaturesVerified: signed,
      notarizationVerified: signed && platform === 'darwin',
      ...(signed && platform === 'darwin'
        ? { zipSha256: assets.get(name.replace(/\.dmg$/, '.zip')) }
        : {}),
    };
    const file = path.join(root, `install-lifecycle-${platform}-${arch}.json`);
    write(file, value);
    evidence.push({ file, value });
  }
  return {
    files,
    stage,
    manifests,
    evidence,
    pkg,
    commit,
    plan,
    validate: () => stageReleaseArtifacts(files, stage, { pkg, commit, plan }),
  };
}

test('publication stages only selected signed/unsigned platforms and their matching installation evidence', async (t) => {
  for (const mode of ['signed', 'unsigned'])
    for (const platform of ['all', 'mac', 'win']) {
      await t.test(mode + ' ' + platform, async (t) => {
        const f = fixture(t, { mode, platform });
        const result = await f.validate();
        assert.equal(result.evidence.length, f.plan.systems.length);
        assert.equal(result.sums.length, platform === 'win' ? 1 : platform === 'mac' ? 4 : 5);
        if (platform === 'mac')
          assert.ok(result.uploads.every((file) => !file.includes('Windows')));
      });
    }
});

test('signed publication fails closed on unsigned, unnotarized, stale or incomplete evidence', async (t) => {
  const cases = [
    [
      'unsigned manifest',
      (f) => {
        f.manifests[0].value.signed = false;
      },
    ],
    [
      'missing notarization',
      (f) => {
        f.manifests[0].value.notarized = false;
      },
    ],
    [
      'failed build verification',
      (f) => {
        f.manifests[0].value.verification.signatures = false;
      },
    ],
    [
      'stale source',
      (f) => {
        f.manifests[0].value.commit = 'c'.repeat(40);
      },
    ],
    [
      'duplicate architecture',
      (f) => {
        f.evidence[1].value.arch = 'arm64';
      },
    ],
    [
      'unsigned install',
      (f) => {
        f.evidence[0].value.mode = 'unsigned';
      },
    ],
    [
      'missing installed signature',
      (f) => {
        f.evidence[0].value.signaturesVerified = false;
      },
    ],
    [
      'missing installed ticket',
      (f) => {
        f.evidence[0].value.notarizationVerified = false;
      },
    ],
    [
      'different installer',
      (f) => {
        f.evidence[0].value.installerSha256 = 'c'.repeat(64);
      },
    ],
    [
      'different zip',
      (f) => {
        f.evidence[0].value.zipSha256 = 'c'.repeat(64);
      },
    ],
    [
      'missing Intel check',
      (f) => {
        f.files.splice(f.files.indexOf(f.evidence[1].file), 1);
      },
    ],
    [
      'unexpected installer path',
      (f) => {
        f.manifests[0].value.artifacts[0].name = '../outside.dmg';
      },
    ],
    [
      'tampered file',
      (f) => {
        fs.appendFileSync(
          f.files.find((file) => file.endsWith('.dmg')),
          'tampered',
        );
      },
    ],
    [
      'tampered checksum',
      (f) => {
        fs.appendFileSync(
          f.files.find((file) => file.endsWith('.sha256')),
          'tampered',
        );
      },
    ],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async (t) => {
      const f = fixture(t, { mode: 'signed', platform: 'mac' });
      mutate(f);
      for (const item of [...f.manifests, ...f.evidence])
        fs.writeFileSync(item.file, JSON.stringify(item.value));
      await assert.rejects(f.validate);
    });
});

test('old unsigned two-platform artifacts remain recoverable without the new signed metadata', async (t) => {
  const f = fixture(t);
  for (const item of f.evidence) {
    for (const key of ['mode', 'installerSha256', 'signaturesVerified', 'notarizationVerified'])
      delete item.value[key];
    fs.writeFileSync(item.file, JSON.stringify(item.value));
  }
  assert.equal((await f.validate()).evidence.length, 3);
});
