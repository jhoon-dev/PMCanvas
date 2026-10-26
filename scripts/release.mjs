import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  checkPublicRepository,
  checkPublicArchive,
  requirePublicSafety,
} from './public-safety.mjs';

const paths = [
  '.dockerignore',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.git-blame-ignore-revs',
  '.prettierignore',
  '.prettierrc.json',
  '.github',
  'Dockerfile',
  'Dockerfile.backup',
  'compose.yml',
  'compose.external.yml',
  'package.json',
  'package-lock.json',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'SOURCE-PROVENANCE.txt',
  'deploy',
  'docs',
  'migrations',
  'public',
  'scripts',
  'server',
  'test',
  'playwright.config.mjs',
  'config/auth.example.json',
  'config/mail.example.json',
  'certs/.gitkeep',
];

try {
  const root = process.cwd();
  requirePublicSafety(checkPublicRepository(root));
  if (
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
    throw Error('Commit changes before building a release.');
  const version = JSON.parse(
    execFileSync('git', ['show', 'HEAD:package.json'], { cwd: root, encoding: 'utf8' }),
  ).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw Error('Invalid release version.');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out'))
    throw Error('Usage: npm run release -- [--out file.zip]');
  const output = path.resolve(args[1] || `releases/PMCanvas-Server-v${version}.zip`);
  if (!output.endsWith('.zip') || fs.lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink())
    throw Error('Release output must be a regular ZIP file.');
  const bytes = execFileSync('git', ['archive', '--format=zip', 'HEAD', '--', ...paths], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
  const result = await checkPublicArchive(bytes);
  requirePublicSafety(result);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  console.log(`Verified public release: ${path.basename(output)} (${result.files} entries)`);
  console.log(`SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);
} catch (error) {
  if (error.status === 1) console.error('Commit tracked changes before building a release.');
  else console.error(error.message);
  process.exitCode = 1;
}
