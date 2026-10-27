import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';

const maxFileBytes = 2 * 1024 * 1024;
const maxArchiveBytes = 32 * 1024 * 1024;
const publicConfig = new Set(['config/auth.example.json', 'config/mail.example.json']);
const documentationHosts = new Set([
  'github.com',
  'docs.github.com',
  'raw.githubusercontent.com',
  'learn.microsoft.com',
  'login.microsoftonline.com',
  'schemas.xmlsoap.org',
  'www.w3.org',
  'cheatsheetseries.owasp.org',
  'nodemailer.com',
  'playwright.dev',
  'prettier.io',
  'nodejs.org',
  'registry.npmjs.org',
]);
const fileExtensions = new Set([
  'js',
  'mjs',
  'ts',
  'json',
  'md',
  'sql',
  'yml',
  'yaml',
  'conf',
  'crt',
  'key',
  'sh',
  'html',
  'css',
  'txt',
  'dump',
  'zip',
  'xlsx',
  'log',
  'png',
  'jpg',
  'backup',
  'env',
  'd',
  'x',
]);

export function exampleHost(host) {
  host = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (['localhost', 'app', 'db', '0.0.0.0', '::1'].includes(host)) return true;
  if (isIP(host) === 4) {
    const parts = host.split('.').map(Number);
    return (
      parts[0] === 127 ||
      ['192.0.2', '198.51.100', '203.0.113'].includes(parts.slice(0, 3).join('.'))
    );
  }
  return /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/.test(host);
}

export function publicPathProblem(file) {
  if (
    !file ||
    file.includes('\0') ||
    file.includes('\\') ||
    file.startsWith('/') ||
    file.includes(':') ||
    file
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    return 'UNSAFE_PATH';
  const parts = file.split('/');
  if (
    parts.some((part) =>
      [
        '.git',
        'node_modules',
        'backups',
        'recovery-keys',
        'releases',
        'originals',
        '.playwright-mcp',
        'test-results',
        'playwright-report',
        '.ssh',
        'secrets',
        '.aws',
        '.azure',
        '.kube',
      ].includes(part.toLowerCase()),
    )
  )
    return 'PRIVATE_PATH';
  if (parts.some((part) => /^\.env(?:\.|$)/i.test(part) && part !== '.env.example'))
    return 'PRIVATE_ENV';
  const configIndex = parts.findIndex((part) => part.toLowerCase() === 'config');
  if (
    configIndex >= 0 &&
    configIndex < parts.length - 1 &&
    !publicConfig.has(parts.slice(configIndex).join('/'))
  )
    return 'PRIVATE_CONFIG';
  const certIndex = parts.findIndex((part) => part.toLowerCase() === 'certs');
  if (
    certIndex >= 0 &&
    certIndex < parts.length - 1 &&
    parts.slice(certIndex).join('/') !== 'certs/.gitkeep'
  )
    return 'PRIVATE_CERTIFICATE';
  if (/\.(?:key|pem|p12|pfx|crt|dump|bak|zip)$/i.test(file)) return 'PRIVATE_OR_ARCHIVE_FILE';
  return null;
}

function placeholder(value, depth = 0) {
  if (!value || /^(?:YOUR[-_]|REPLACE[-_]|<|\.{3}$)/i.test(value)) return true;
  if (depth > 8) return false;
  const reference = value.match(/^\$\{[A-Z_][A-Z0-9_]*(.*?)\}$/);
  if (!reference) return false;
  const suffix = reference[1];
  if (!suffix || /^:?\?[^{}]*$/.test(suffix)) return true;
  if (suffix.startsWith(':-')) return placeholder(suffix.slice(2), depth + 1);
  if (suffix.startsWith('-')) return placeholder(suffix.slice(1), depth + 1);
  return false;
}
const publicExample = (file) =>
  /\.(?:md|txt|rst|adoc)$/i.test(file) ||
  file === '.env.example' ||
  file.startsWith('config/') ||
  file.startsWith('deploy/') ||
  /^compose(?:\.[a-z]+)?\.yml$/.test(file);

export function inspectPublicFile(file, bytes) {
  const problem = publicPathProblem(file);
  if (problem) return [{ file, line: 1, rule: problem }];
  if (bytes.length > maxFileBytes) return [{ file, line: 1, rule: 'FILE_TOO_LARGE' }];
  const content = bytes.toString('utf8');
  const findings = new Map();
  const add = (rule, index = 0) => {
    const line = content.slice(0, index).split('\n').length;
    findings.set(`${line}:${rule}`, { file, line, rule });
  };
  for (const match of content.matchAll(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/g))
    add('PRIVATE_KEY', match.index);
  for (const match of content.matchAll(
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255}|AKIA[A-Z0-9]{16})\b/g,
  ))
    add('ACCESS_TOKEN', match.index);
  const configIndex = file.split('/').indexOf('config');
  const examplePath = configIndex >= 0 ? file.split('/').slice(configIndex).join('/') : file;
  if (!publicExample(examplePath)) return [...findings.values()];

  for (const match of content.matchAll(
    /\b(?:https?|ldaps?|postgres(?:ql)?):\/\/(?:\$\{[^}\r\n]*\}|[^\s<>"'`])+/gi,
  )) {
    try {
      const raw = match[0].replace(/[),.;]+$/, '');
      const url = new URL(raw.replace(/\$\{[^}]*\}/g, 'example').replace(/[}]+$/, ''));
      if (url.username || url.password) {
        const authority = raw.slice(raw.indexOf('://') + 3).split('@')[0];
        const colon = authority.indexOf(':');
        if (colon < 0 || !placeholder(authority.slice(colon + 1)))
          add('URL_CREDENTIALS', match.index);
      }
      if (!exampleHost(url.hostname) && !documentationHosts.has(url.hostname.toLowerCase()))
        add('NON_EXAMPLE_HOST', match.index);
    } catch {
      add('INVALID_EXAMPLE_URL', match.index);
    }
  }
  for (const match of content.matchAll(
    /\b(?:[a-z0-9][a-z0-9-]{0,62}\.)+[a-z][a-z0-9-]{1,62}\b/gi,
  )) {
    const host = match[0].toLowerCase();
    if (
      fileExtensions.has(host.split('.').at(-1)) ||
      ['blame.ignorerevsfile', 'yyyy.mm.dd'].includes(host)
    )
      continue;
    if (!exampleHost(host) && !documentationHosts.has(host)) add('NON_EXAMPLE_DOMAIN', match.index);
  }
  for (const match of content.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (isIP(match[0]) && !exampleHost(match[0])) add('NON_EXAMPLE_IP', match.index);
  }
  for (const match of content.matchAll(
    /\b(?:PGHOST|SMTP_HOST|MAIL_HOST)[ \t]*[:=][ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|((?:\$\{[^}\r\n]*\}|[^\s`"'])+))/gi,
  )) {
    const value = match[1] ?? match[2] ?? match[3];
    if (!placeholder(value) && !exampleHost(value)) add('NON_EXAMPLE_ENDPOINT', match.index);
  }
  for (const match of content.matchAll(
    /(?<!\$\{)\b(?:[A-Z_]*(?:PASSWORD|SECRET|TOKEN))[ \t]*[:=][ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|((?:\$\{[^}\r\n]*\}|[^\s`"'])+))/g,
  )) {
    if (!placeholder(match[1] ?? match[2] ?? match[3])) add('INLINE_PRIVATE_SETTING', match.index);
  }
  for (const match of content.matchAll(
    /["'](?:password|clientSecret|bindPassword|accessToken|refreshToken)["']\s*:\s*["']([^"']+)["']/gi,
  )) {
    if (!placeholder(match[1])) add('INLINE_SECRET', match.index);
  }
  for (const match of content.matchAll(
    /(?:[A-Z]:[\\/]+Users[\\/]+|\/(?:home|Users)\/)([^\s\\/`"']+)/gi,
  )) {
    if (!placeholder(match[1])) add('PERSONAL_HOME_PATH', match.index);
  }
  if (publicConfig.has(examplePath)) {
    try {
      const visit = (value, key = '') => {
        if (Array.isArray(value)) return value.forEach((item) => visit(item, key));
        if (value && typeof value === 'object')
          return Object.entries(value).forEach(([name, item]) => visit(item, name));
        if (typeof value !== 'string' || placeholder(value)) return;
        if (['host', 'allowedDomains', 'reviewRecipients', 'from'].includes(key)) {
          const host = value.includes('@') ? value.slice(value.lastIndexOf('@') + 1) : value;
          if (!exampleHost(host)) add('NON_EXAMPLE_CONFIG_ENDPOINT');
        }
        const dn = [...value.matchAll(/\bDC=([^,]+)/gi)].map((match) => match[1].trim()).join('.');
        if (dn && !exampleHost(dn)) add('NON_EXAMPLE_CONFIG_ENDPOINT');
        if (
          key === 'issuer' &&
          value.startsWith('https://login.microsoftonline.com/') &&
          !/^\/(?:YOUR-TENANT-ID|common|organizations|consumers)(?:\/|$)/.test(
            new URL(value).pathname,
          )
        )
          add('NON_EXAMPLE_TENANT');
      };
      visit(JSON.parse(content));
    } catch {
      add('INVALID_EXAMPLE_JSON');
    }
  }
  return [...findings.values()];
}

export function checkPublicRepository(root = process.cwd()) {
  root = fs.realpathSync(root);
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: maxArchiveBytes,
      })
        .split('\0')
        .filter(Boolean),
    ),
  ];
  const findings = [];
  for (const file of files) {
    const problem = publicPathProblem(file);
    if (problem) {
      findings.push({ file, line: 1, rule: problem });
      continue;
    }
    let cursor = root;
    let safe = true;
    for (const part of file.split('/')) {
      cursor = path.join(cursor, part);
      if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) safe = false;
    }
    if (!safe) {
      findings.push({ file, line: 1, rule: 'SYMLINK' });
      continue;
    }
    if (!fs.existsSync(cursor)) {
      findings.push({ file, line: 1, rule: 'MISSING_TRACKED_FILE' });
      continue;
    }
    if (fs.statSync(cursor).size > maxFileBytes) {
      findings.push({ file, line: 1, rule: 'FILE_TOO_LARGE' });
      continue;
    }
    findings.push(...inspectPublicFile(file, fs.readFileSync(cursor)));
  }
  return { files: files.length, findings };
}

export async function checkPublicArchive(bytes) {
  if (bytes.length > maxArchiveBytes)
    throw Error('Archive exceeds the public artifact size limit.');
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      {
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, archive) => (error ? reject(error) : resolve(archive)),
    ),
  );
  return new Promise((resolve, reject) => {
    const findings = [],
      names = new Set();
    let files = 0,
      total = 0;
    const failed = (error) => {
      zip.close();
      reject(error);
    };
    zip.on('error', failed);
    zip.on('end', () => {
      zip.close();
      resolve({ files, findings });
    });
    zip.on('entry', async (entry) => {
      try {
        if (++files > 2000 || (total += entry.uncompressedSize) > maxArchiveBytes)
          throw Error('Archive exceeds public artifact limits.');
        const directory = entry.fileName.endsWith('/');
        const file = directory ? entry.fileName.slice(0, -1) : entry.fileName;
        const name = file.toLowerCase();
        if (names.has(name)) throw Error('Duplicate public archive path.');
        names.add(name);
        const problem = publicPathProblem(file);
        if (problem && !(directory && ['config', 'certs'].includes(file)))
          findings.push({ file, line: 1, rule: problem });
        else if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
          findings.push({ file, line: 1, rule: 'SYMLINK' });
        else if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod))
          throw Error('Unsupported public archive entry.');
        else if (!directory) {
          if (entry.uncompressedSize > maxFileBytes)
            throw Error('Archive entry exceeds public file size limit.');
          const stream = await new Promise((res, rej) =>
            zip.openReadStream(entry, (error, value) => (error ? rej(error) : res(value))),
          );
          const chunks = [];
          let size = 0;
          for await (const chunk of stream) {
            if ((size += chunk.length) > maxFileBytes)
              throw Error('Archive entry exceeds public file size limit.');
            chunks.push(chunk);
          }
          const content = Buffer.concat(chunks);
          if (crc32(content) !== entry.crc32) throw Error('Invalid public archive checksum.');
          findings.push(...inspectPublicFile(file, content));
        }
        zip.readEntry();
      } catch (error) {
        failed(error);
      }
    });
    zip.readEntry();
  });
}

export function requirePublicSafety(result) {
  if (!result.findings.length) return;
  // Print rule and location only; never copy a suspected credential into CI logs.
  const locations = result.findings
    .slice(0, 50)
    .map(({ file, line, rule }) => `${file}:${line} ${rule}`);
  throw Error(
    `Public file safety check failed (${result.findings.length} findings):\n${locations.join('\n')}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    let result;
    if (!args.length) result = checkPublicRepository();
    else if (args.length === 2 && args[0] === '--zip') {
      if (fs.statSync(args[1]).size > maxArchiveBytes)
        throw Error('Archive exceeds public artifact size limit.');
      result = await checkPublicArchive(fs.readFileSync(args[1]));
    } else throw Error('Usage: node scripts/public-safety.mjs [--zip archive.zip]');
    requirePublicSafety(result);
    console.log(`Public file safety check passed (${result.files} entries).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
