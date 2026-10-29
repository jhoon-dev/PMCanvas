import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export async function stageReleaseArtifacts(files, stage, { pkg, commit, plan }) {
  const { version } = pkg;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const signed = plan.mode === 'signed';
  const manifests = files.filter(
    (file) => path.basename(file) === (signed ? 'release-manifest.json' : 'unsigned-manifest.json'),
  );
  assert.equal(manifests.length, plan.platforms.length, 'Missing platform manifests.');
  const uploads = [],
    sums = [],
    platforms = new Set(plan.platforms),
    hashes = new Map();
  const add = (file, name = path.basename(file)) => {
    assert.equal(path.basename(name), name);
    const target = path.join(stage, name);
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    uploads.push(target);
  };
  for (const file of manifests) {
    const manifest = JSON.parse(fs.readFileSync(file));
    assert.equal(manifest.version, version);
    assert.equal(manifest.product, pkg.name);
    assert.equal(manifest.commit, commit);
    assert.equal(manifest.signed, signed, 'Installer signing mode mismatch.');
    assert.equal(manifest.notarized, signed && manifest.platform === 'mac');
    assert.ok(platforms.delete(manifest.platform), 'Unexpected or duplicate platform.');
    if (signed) {
      assert.equal(manifest.verification?.signatures, true);
      assert.equal(manifest.verification?.nativeSmoke, true);
      assert.equal(manifest.macAdHoc, false);
    } else assert.equal(manifest.macAdHoc, manifest.platform === 'mac');
    assert.equal(manifest.artifacts.length, manifest.platform === 'win' ? 1 : 4);
    const expected = new Set(
      manifest.platform === 'win'
        ? ['PMCanvas-Desktop-' + version + '-Windows-x64.exe']
        : ['arm64', 'x64'].flatMap((arch) =>
            ['dmg', 'zip'].map((ext) => `PMCanvas-Desktop-${version}-macOS-${arch}.${ext}`),
          ),
    );
    for (const asset of manifest.artifacts) {
      assert.ok(expected.delete(asset.name), 'Unexpected or duplicate installer.');
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      const data = path.join(path.dirname(file), asset.name),
        digest = createHash('sha256');
      for await (const chunk of fs.createReadStream(data)) digest.update(chunk);
      assert.equal(digest.digest('hex'), asset.sha256, 'Installer checksum mismatch.');
      assert.equal(
        fs.readFileSync(data + '.sha256', 'utf8').trim(),
        asset.sha256 + '  ' + asset.name,
      );
      hashes.set(asset.name, asset.sha256);
      add(data);
      add(data + '.sha256');
      sums.push(asset.sha256 + '  ' + asset.name);
    }
    assert.equal(expected.size, 0);
    add(file, `desktop-${version}-${manifest.platform}-manifest.json`);
  }
  assert.equal(platforms.size, 0);
  const evidence = files
    .filter((file) =>
      /^install-lifecycle-(win32|darwin)-(x64|arm64)\.json$/.test(path.basename(file)),
    )
    .map((file) => JSON.parse(fs.readFileSync(file)));
  assert.equal(evidence.length, plan.systems.length, 'Missing installation evidence.');
  const systems = new Set(plan.systems);
  for (const item of evidence) {
    assert.ok(systems.delete(item.platform + '-' + item.arch), 'Unexpected or duplicate system.');
    assert.equal(item.version, version);
    assert.equal(item.commit, commit);
    assert.equal(item.baseline, '0.7.1');
    assert.equal(item.checks.length, 5);
    assert.match(item.projectSha256, /^[a-f0-9]{64}$/);
    // Old unsigned runs remain recoverable; signed evidence must be explicit and hash-bound.
    assert.equal(item.mode || 'unsigned', plan.mode, 'Installation test mode mismatch.');
    const installer =
      item.platform === 'win32'
        ? `PMCanvas-Desktop-${version}-Windows-x64.exe`
        : `PMCanvas-Desktop-${version}-macOS-${item.arch}.dmg`;
    if (signed || item.installerSha256) assert.equal(item.installerSha256, hashes.get(installer));
    if (signed) {
      assert.equal(item.signaturesVerified, true);
      assert.equal(item.notarizationVerified, item.platform === 'darwin');
      if (item.platform === 'darwin')
        assert.equal(
          item.zipSha256,
          hashes.get(`PMCanvas-Desktop-${version}-macOS-${item.arch}.zip`),
        );
    }
  }
  assert.equal(systems.size, 0);
  return { uploads, sums, evidence };
}
