import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('두 Docker 구성은 마운트한 기본 SMTP 파일을 읽고 파일 없는 신규 설치와 명시적 경로도 지원', (t) => {
  for (const name of ['compose.yml', 'compose.external.yml']) {
    const compose = readFileSync(new URL('../' + name, import.meta.url), 'utf8'),
      mounted = compose.match(/\.\/config:([^:]+):ro/)[1],
      directory = compose.match(/MAIL_CONFIG_DIR:\s*(\S+)/)?.[1];
    assert.equal(directory, mounted);
  }
  const folder = mkdtempSync(path.join(os.tmpdir(), 'pmcanvas-mail-path-')),
    working = path.join(folder, 'web'),
    directory = path.join(folder, 'config'),
    mail = path.join(directory, 'mail.json'),
    password = path.join(directory, 'password.txt'),
    override = path.join(directory, 'override.json');
  mkdirSync(working);
  mkdirSync(directory);
  t.after(() => {
    for (const file of [mail, password, override]) {
      try {
        unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    rmdirSync(working);
    rmdirSync(directory);
    rmdirSync(folder);
  });
  const source = `
    import { legacyMailSettings } from ${JSON.stringify(new URL('../server/mail-settings.mjs', import.meta.url).href)};
    import { loadMailer } from ${JSON.stringify(new URL('../server/mailer.mjs', import.meta.url).href)};
    const legacy = legacyMailSettings();
    const mailer = loadMailer();
    mailer?.close();
    console.log(JSON.stringify({ ...legacy, loaded: !!mailer }));
  `;
  const read = (env = {}, cwd = working) =>
    JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', source], {
        cwd,
        env: { ...process.env, MAIL_CONFIG_DIR: directory, MAIL_CONFIG_FILE: '', ...env },
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  assert.equal(read().config.enabled, false);
  assert.equal(read().loaded, false);
  const config = {
    enabled: true,
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    from: 'sender@example.com',
    username: 'fixture',
    passwordFile: 'password.txt',
  };
  writeFileSync(mail, JSON.stringify(config));
  writeFileSync(password, 'fixture-only-password\n');
  const loaded = read();
  assert.equal(loaded.config.enabled, true);
  assert.equal(loaded.config.host, config.host);
  assert.equal(loaded.password, 'fixture-only-password');
  assert.equal(loaded.loaded, true);
  writeFileSync(override, JSON.stringify({ ...config, host: 'override.example.com' }));
  assert.equal(read({ MAIL_CONFIG_FILE: override }).config.host, 'override.example.com');
  assert.throws(
    () => read({ MAIL_CONFIG_FILE: path.join(directory, 'missing.json') }),
    /MAIL_CONFIG_FILE/,
  );
  // Direct Node installations still resolve their existing config/mail.json default.
  assert.equal(read({ MAIL_CONFIG_DIR: '' }, folder).config.host, config.host);
});
