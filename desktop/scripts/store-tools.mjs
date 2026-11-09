import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { wincodesignChecksums } = require('app-builder-lib/out/toolsets/windows.js');
const { extractArchive } = require('app-builder-lib/out/util/electronGet.js');

// GitHub's release-page download route can return 504 for this release tag.
// Use the official asset API, retaining the pinned builder's SHA-256 checks.
export async function prepareStoreTools(stage) {
  const tools = [
    ['rcedit-windows-2_0_0.zip', 345709138, 'rcedit'],
    ['windows-kits-bundle-10_0_26100_0.zip', 345709150, 'windows-kits'],
  ];
  for (const [name, id, folder] of tools) {
    const response = await fetch(
      'https://api.github.com/repos/electron-userland/electron-builder-binaries/releases/assets/' +
        id,
      { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok)
      throw Error('Windows tool download failed: ' + name + ' / ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== wincodesignChecksums['1.1.0'][name])
      throw Error('Windows tool checksum mismatch: ' + name);
    const archive = path.join(stage, name);
    fs.writeFileSync(archive, bytes);
    await extractArchive(archive, path.join(stage, folder));
  }
  return { rcedit: path.join(stage, 'rcedit'), kit: path.join(stage, 'windows-kits', 'x64') };
}
