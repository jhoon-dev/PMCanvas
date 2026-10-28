// Run only inside a disposable Linux container. Never changes the host's user identity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtimeIdentity, prepareRuntimeStorage } from '../../scripts/runtime-storage.mjs';
if (process.platform !== 'linux' || process.getuid() !== 0)
  throw Error('Use the disposable Linux check container.');
const root = fs.mkdtempSync('/tmp/pmcanvas-uid-check-');
fs.chownSync(root, 1001, 1001);
process.setgroups([]);
process.setgid(1001);
process.setuid(1001);
try {
  const identity = runtimeIdentity();
  assert.equal(identity.PM_RUN_UID, '1001');
  assert.equal(identity.PM_RUN_GID, '1001');
  prepareRuntimeStorage(root, identity);
  fs.writeFileSync(root + '/backups/probe.dump', 'probe', { mode: 0o600 });
  assert.equal(fs.statSync(root + '/backups').uid, 1001);
  assert.equal(fs.statSync(root + '/backups').mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(root + '/backups/probe.dump', 'utf8'), 'probe');
  console.log('Linux UID 1001: private directory ownership, creation and backup writes passed.');
} finally {
  fs.rmSync(root, { recursive: true });
}
