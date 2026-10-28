import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Map generated assets back to their canonical, tracked inputs.
export function sourcePath(file) {
  if (file.startsWith('app/shared/')) return 'shared/browser/' + file.slice(11);
  if (file.startsWith('app/model/')) return 'shared/model/' + file.slice(10);
  if (file.startsWith('app/node/')) return 'shared/node/' + file.slice(9);
  if (file.startsWith('app/')) return 'desktop/ui/' + file.slice(4);
  return 'desktop/' + file;
}
export function sourceBytes(root, file, commit = null) {
  if (file === 'app/build-info.json')
    throw Error('Build information requires explicit provenance.');
  const source = sourcePath(file);
  let bytes = commit
    ? execFileSync('git', ['show', commit + ':' + source], {
        cwd: root,
        maxBuffer: 16 * 1024 * 1024,
      })
    : fs.readFileSync(path.join(root, source));
  if (file.startsWith('app/model/') || file.startsWith('app/node/'))
    bytes = Buffer.from(bytes.toString('utf8').replaceAll('../browser/', '../shared/'));
  return bytes;
}
export function preparePackage(root, output, pkg, provenance, commit = null) {
  const files = [...pkg.build.files, ...(pkg.build.nsis?.include ? [pkg.build.nsis.include] : [])];
  for (const file of files) {
    if (path.isAbsolute(file) || file.includes('..') || file.includes('\\'))
      throw Error('Package sources must use explicit relative paths.');
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      file === 'app/build-info.json'
        ? JSON.stringify(provenance, null, 2) + '\n'
        : sourceBytes(root, file, commit),
    );
  }
}
