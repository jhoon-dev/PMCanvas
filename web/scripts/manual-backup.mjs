import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// A failed transfer never becomes a discoverable, final .dump backup.
export function manualBackup({ root, database, compose }) {
  const folder = path.join(root, 'backups');
  if (fs.lstatSync(folder, { throwIfNoEntry: false })?.isSymbolicLink())
    throw Error('Backup storage must not use a symlink.');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.chmodSync(folder, 0o700);
  const name =
    'pmcanvas-' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    randomBytes(4).toString('hex') +
    '.dump';
  const remote = '/tmp/' + name;
  const local = path.join(folder, name);
  const partial = local + '.partial';
  try {
    compose(['exec', '-T', 'db', 'pg_dump', '-U', 'postgres', '-d', database, '-Fc', '-f', remote]);
    compose(['exec', '-T', 'db', 'pg_restore', '--list', remote], { capture: true });
    const expected = compose(['exec', '-T', 'db', 'sha256sum', remote], { capture: true })
      .trim()
      .split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('Could not verify the backup checksum.');
    fs.closeSync(fs.openSync(partial, 'wx', 0o600));
    compose(['cp', 'db:' + remote, partial]);
    fs.chmodSync(partial, 0o600);
    const actual = createHash('sha256');
    const descriptor = fs.openSync(partial, 'r+');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let size;
      while ((size = fs.readSync(descriptor, buffer))) actual.update(buffer.subarray(0, size));
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (actual.digest('hex') !== expected) throw Error('Backup transfer checksum mismatch.');
    fs.renameSync(partial, local);
    return local;
  } finally {
    fs.rmSync(partial, { force: true });
    compose(['exec', '-T', 'db', 'rm', '-f', remote], { capture: true });
  }
}
