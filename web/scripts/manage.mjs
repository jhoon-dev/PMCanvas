import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { emailAddress } from '../server/security.mjs';
import { runtimeIdentity, prepareRuntimeStorage } from './runtime-storage.mjs';
import { restoreCleanupSql } from '../server/restore-safety.mjs';
import { manualBackup } from './manual-backup.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(root, '.env');
let runtimeEnvironment = runtimeIdentity();
export function setupValues({ email, origin = 'http://localhost:3000', port = '3000' }) {
  email = emailAddress(email);
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535)
    throw Error('Port must be 1–65535.');
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !['http:', 'https:'].includes(url.protocol)
  )
    throw Error('Origin must contain scheme and host only.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw Error('Public origin requires HTTPS.');
  const secret = () => randomBytes(32).toString('hex');
  return {
    PUBLIC_ORIGIN: origin,
    BASE_PATH: '/pmcanvas',
    APP_PORT: String(port),
    APP_DATABASE: 'pmcanvas',
    PM_TIME_ZONE: 'Asia/Seoul',
    AUTH_CONFIG_FILE: '/app/config/auth.json',
    DB_ADMIN_PASSWORD: secret(),
    DB_PASSWORD: secret(),
    ADMIN_EMAIL: email,
    ADMIN_NAME: '관리자',
    ADMIN_PASSWORD: secret(),
    ...runtimeIdentity(),
  };
}
function compose(args, { capture = false } = {}) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-directory', root, '--env-file', envPath, ...args],
    {
      cwd: root,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      encoding: 'utf8',
      shell: false,
      env: { ...process.env, ...runtimeEnvironment },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      capture
        ? 'Docker command failed. Check Docker and the database service.'
        : 'Docker command failed.',
    );
  return result.stdout;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const ensureMfaKey = () => {
    for (const name of ['config', 'config/secrets', 'config/secrets/mfa.key']) {
      if (fs.lstatSync(path.join(root, name), { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw Error('Private storage must not use symlink paths.');
      }
    }
    const dir = path.join(root, 'config', 'secrets');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = path.join(dir, 'mfa.key');
    if (!fs.existsSync(key)) fs.writeFileSync(key, randomBytes(32), { flag: 'wx', mode: 0o600 });
  };
  if (command === 'setup') {
    if (fs.existsSync(envPath)) throw Error('.env already exists; setup will not overwrite it.');
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--email', '--origin', '--port'].includes(args[i]) || !args[i + 1])
        throw Error('Use setup --email address [--origin URL] [--port port].');
      options[args[i].slice(2)] = args[i + 1];
    }
    if (!options.email) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        options.email = await rl.question('Administrator email: ');
      } finally {
        rl.close();
      }
    }
    if (options.port && !options.origin) options.origin = 'http://localhost:' + options.port;
    const values = setupValues(options);
    ensureMfaKey();
    const config = path.join(root, 'config', 'auth.json');
    if (!fs.existsSync(config))
      fs.copyFileSync(
        path.join(root, 'config', 'auth.example.json'),
        config,
        fs.constants.COPYFILE_EXCL,
      );
    fs.writeFileSync(
      envPath,
      Object.entries(values)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      'Created .env with generated passwords. Read ADMIN_PASSWORD in this private file to log in.\nStart: npm run service:up',
    );
    return;
  }
  if (!fs.existsSync(envPath)) throw Error('Run npm run setup first.');
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  runtimeEnvironment = runtimeIdentity(env);
  const database = env.APP_DATABASE || 'pmcanvas';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw Error('Invalid APP_DATABASE.');
  if (command === 'up') {
    const moved = prepareRuntimeStorage(root, runtimeEnvironment);
    ensureMfaKey();
    prepareRuntimeStorage(root, runtimeEnvironment);
    if (moved)
      console.log(
        'Moved ' +
          moved +
          ' legacy recovery key(s) to ' +
          path.join(root, 'recovery-keys') +
          '. Move this folder to secure storage outside this project and separate from DB dumps. A full-project backup would otherwise include both.',
      );
    compose(['up', '-d', '--build', '--wait', '--wait-timeout', '180']);
    return;
  }
  if (command === 'status') {
    compose(['ps']);
    return;
  }
  if (command === 'stop') {
    compose(['stop']);
    return;
  }
  if (command === 'logs') {
    compose(['logs', '--tail', '100', 'app']);
    return;
  }
  if (command === 'backup') {
    console.log('Backup: ' + manualBackup({ root, database, compose }));
    return;
  }
  if (command === 'restore') {
    const [file, target] = args;
    if (!file || !target || !/^pmcanvas_restore_[a-z0-9_]{1,40}$/.test(target))
      throw Error(
        'Use restore <dump-file> <new-database-name: pmcanvas_restore_...>. Existing databases are never overwritten.',
      );
    const source = path.resolve(file);
    if (!fs.statSync(source).isFile()) throw Error('Backup file required.');
    const remote = '/tmp/restore-' + randomBytes(12).toString('hex') + '.dump';
    try {
      compose(['cp', source, 'db:' + remote]);
      compose(['exec', '-T', 'db', 'createdb', '-U', 'postgres', '-O', 'pmcanvas', target]);
      compose([
        'exec',
        '-T',
        'db',
        'pg_restore',
        '-U',
        'postgres',
        '--role=pmcanvas',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--single-transaction',
        '-d',
        target,
        remote,
      ]);
      compose([
        'exec',
        '-T',
        'db',
        'psql',
        '-U',
        'postgres',
        '-d',
        target,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        restoreCleanupSql,
      ]);
      console.log(
        'Restored to ' +
          target +
          '. To activate, set APP_DATABASE=' +
          target +
          ' in .env and run npm run service:up.',
      );
    } finally {
      compose(['exec', '-T', 'db', 'rm', '-f', remote], { capture: true });
    }
    return;
  }
  throw Error('Commands: setup, up, status, stop, logs, backup, restore.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
