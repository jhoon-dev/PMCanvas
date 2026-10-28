import { fileURLToPath } from 'node:url';
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
  '.gitattributes',
  '.gitignore',
  '.git-blame-ignore-revs',
  '.prettierignore',
  '.prettierrc.json',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  'README.md',
  'shared',
  'web/.env.example',
  'web/.prettierignore',
  'web/Dockerfile',
  'web/Dockerfile.backup',
  'web/compose.yml',
  'web/compose.external.yml',
  'web/package.json',
  'web/package-lock.json',
  'web/README.md',
  'web/README.en.md',
  'web/CHANGELOG.md',
  'web/CONTRIBUTING.md',
  'web/SECURITY.md',
  'web/SOURCE-PROVENANCE.txt',
  'web/deploy',
  'web/docs',
  'web/migrations',
  'web/public',
  'web/scripts',
  'web/server',
  'web/test',
  'web/playwright.config.mjs',
  'web/config/auth.example.json',
  'web/config/mail.example.json',
  'web/certs/.gitkeep',
];

try {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  requirePublicSafety(checkPublicRepository(root));
  if (
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
    throw Error('Commit changes before building a release.');
  const version = JSON.parse(
    execFileSync('git', ['show', 'HEAD:web/package.json'], { cwd: root, encoding: 'utf8' }),
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
