import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { dpapi } from '../scripts/update-key-protection.mjs';

function checkDpapi() {
  const key = Buffer.from(
    generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );
  let encrypted, restored, corrupt;
  try {
    encrypted = dpapi(key, true);
    assert.ok(encrypted.length > 0);
    assert.ok(!encrypted.includes(key), 'Recovery copy must not contain the plaintext key');
    restored = dpapi(encrypted, false);
    assert.ok(restored.equals(key), 'DPAPI must restore the same synthetic signing key');
    corrupt = Buffer.from(encrypted);
    corrupt[corrupt.length - 1] ^= 1;
    assert.throws(
      () => dpapi(corrupt, false),
      (error) => error.message === 'Windows update key protection failed.',
    );
  } finally {
    key.fill(0);
    encrypted?.fill(0);
    restored?.fill(0);
    corrupt?.fill(0);
  }
}

test(
  'Windows DPAPI restores a synthetic update signing key and rejects corrupted recovery data',
  { skip: process.platform !== 'win32' },
  checkDpapi,
);

test(
  'DPAPI and Authenticode ignore a successful fake PowerShell on PATH and in the working directory',
  { skip: process.platform !== 'win32' },
  (t) => {
    const base = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(base, 'pmcanvas-signing-path test-'));
    t.after(() => {
      assert.equal(path.dirname(root), base);
      assert.ok(path.basename(root).startsWith('pmcanvas-signing-path test-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const marker = path.join(root, 'shadow-invoked.txt');
    const shadow = path.join(root, 'powershell.exe');
    const unsigned = path.join(root, 'unsigned fixture.exe');
    fs.writeFileSync(unsigned, 'Synthetic unsigned application');
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    // A harmless native fixture accepts any arguments and exits successfully. If a
    // verifier resolves it through PATH, an unsigned application would be accepted.
    const script = `Add-Type -TypeDefinition 'public static class PowerShellShadow {
      public static int Main(string[] args) {
        System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("PM_TEST_PS_MARKER"), "called");
        return 0;
      }
    }' -OutputAssembly $env:PM_TEST_PS_BINARY -OutputType ConsoleApplication`;
    execFileSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        stdio: 'pipe',
        timeout: 30000,
        env: { ...process.env, PM_TEST_PS_BINARY: shadow },
      },
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'),
    );
    Object.assign(env, { PATH: root, PM_TEST_PS_MARKER: marker });
    const options = { env, cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 };
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {execFileSync} from 'node:child_process'; execFileSync('powershell.exe', ['-NoProfile']);`,
      ],
      options,
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'called', 'The PATH collision must be real');
    fs.unlinkSync(marker);

    const protection = new URL('../scripts/update-key-protection.mjs', import.meta.url).href;
    const signatures = new URL('../scripts/verify-signatures.mjs', import.meta.url).href;
    const source = `import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {generateKeyPairSync} from 'node:crypto';
      import {dpapi} from ${JSON.stringify(protection)};
      import {verifyWindowsSignature} from ${JSON.stringify(signatures)};
      (${checkDpapi.toString()})();
      assert.throws(() => verifyWindowsSignature(process.argv[1]));
      assert.equal(fs.existsSync(process.env.PM_TEST_PS_MARKER), false);
      process.stdout.write('private-key-roundtrip-and-unsigned-rejection');`;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', source, unsigned],
      options,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'private-key-roundtrip-and-unsigned-rejection');
    assert.equal(fs.existsSync(marker), false, 'System tools must bypass the PATH fixture');
  },
);
