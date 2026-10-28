import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { manualBackup } from '../scripts/manual-backup.mjs';

for (const failure of ['', 'dump', 'list', 'copy', 'checksum']) {
  test(
    'manual backup publishes only complete verified transfers: ' + (failure || 'success'),
    (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-manual-backup-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const bytes = Buffer.from('synthetic archive content');
      const hash = createHash('sha256').update(bytes).digest('hex');
      let cleaned = false;
      const compose = (args) => {
        const command = args[3];
        if (command === 'rm') {
          cleaned = true;
          return '';
        }
        if (command === 'pg_dump' && failure === 'dump') throw Error('dump failed');
        if (command === 'pg_restore' && failure === 'list') throw Error('invalid archive');
        if (command === 'sha256sum') return hash + '  /tmp/archive.dump\n';
        if (args[0] === 'cp') {
          assert.ok(args[2].endsWith('.dump.partial'));
          assert.equal(
            fs.readdirSync(path.dirname(args[2])).some((name) => name.endsWith('.dump')),
            false,
          );
          fs.writeFileSync(args[2], failure === 'checksum' ? 'truncated' : bytes);
          if (failure === 'copy') throw Error('transfer interrupted');
        }
        return '';
      };
      if (failure) assert.throws(() => manualBackup({ root, database: 'fixture_test', compose }));
      else {
        const file = manualBackup({ root, database: 'fixture_test', compose });
        assert.deepEqual(fs.readFileSync(file), bytes);
        assert.ok(file.endsWith('.dump'));
      }
      assert.equal(cleaned, true);
      const files = fs.readdirSync(path.join(root, 'backups'));
      assert.equal(
        files.some((name) => name.endsWith('.partial')),
        false,
      );
      assert.equal(files.filter((name) => name.endsWith('.dump')).length, failure ? 0 : 1);
    },
  );
}
