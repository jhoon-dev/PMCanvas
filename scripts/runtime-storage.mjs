import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function runtimeIdentity(
  env = {},
  ids = { uid: process.getuid?.(), gid: process.getgid?.() },
) {
  const identity = {
    PM_RUN_UID: String(env.PM_RUN_UID || ids.uid || 1000),
    PM_RUN_GID: String(env.PM_RUN_GID || ids.gid || 1000),
  };
  for (const value of Object.values(identity)) {
    if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) {
      throw Error('PM_RUN_UID and PM_RUN_GID must be non-root numeric IDs.');
    }
  }
  return identity;
}

// Only operate on known private directories inside this installation; never follow symlinks.
export function prepareRuntimeStorage(root, identity = runtimeIdentity()) {
  root = fs.realpathSync(root);
  const checked = (relative) => {
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) throw Error('Storage path escapes installation.');
    let cursor = root;
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part);
      if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw Error('Private storage must not use symlink paths.');
      }
    }
    return target;
  };
  const secure = (target, mode) => {
    fs.chmodSync(target, mode);
    if (process.getuid?.() === 0) {
      fs.chownSync(target, Number(identity.PM_RUN_UID), Number(identity.PM_RUN_GID));
    }
  };
  for (const dir of ['backups', 'config', 'config/secrets']) {
    const target = checked(dir);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    secure(target, 0o700);
  }
  for (const file of ['config/auth.json', 'config/mail.json', 'config/secrets/mfa.key']) {
    const target = checked(file);
    if (fs.existsSync(target)) secure(target, 0o600);
  }
  const old = checked('backups/keys');
  if (!fs.existsSync(old)) return 0;
  const entries = fs.readdirSync(old, { withFileTypes: true }).map((entry) => {
    const match = entry.name.match(/^key-([a-f0-9]{64})\.bin$/);
    if (!entry.isFile() || !match)
      throw Error('Unknown file in legacy backup keys; move it separately before upgrading.');
    const source = checked('backups/keys/' + entry.name),
      bytes = fs.readFileSync(source);
    if (bytes.length !== 32 || createHash('sha256').update(bytes).digest('hex') !== match[1])
      throw Error('Legacy backup key integrity check failed.');
    return { name: entry.name, source, bytes };
  });
  const destination = checked('recovery-keys');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  secure(destination, 0o700);
  for (const entry of entries) {
    const target = checked('recovery-keys/' + entry.name);
    if (fs.existsSync(target)) {
      if (!fs.readFileSync(target).equals(entry.bytes))
        throw Error('Recovery key already exists with different contents.');
    } else fs.writeFileSync(target, entry.bytes, { flag: 'wx', mode: 0o600 });
    secure(target, 0o600);
    if (!fs.readFileSync(target).equals(entry.bytes))
      throw Error('Recovery key copy could not be verified.');
    fs.unlinkSync(entry.source);
  }
  fs.rmdirSync(old);
  return entries.length;
}
