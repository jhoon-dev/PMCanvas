import fs from 'node:fs';
import path from 'node:path';
if (process.platform === 'darwin' && process.env.APPLE_API_KEY_BASE64) {
  const bytes = Buffer.from(process.env.APPLE_API_KEY_BASE64, 'base64');
  if (!bytes.length || bytes.length > 32768) throw Error('Invalid Apple API key size.');
  const file = path.join(process.env.RUNNER_TEMP, 'pmcanvas-notary.p8');
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  fs.appendFileSync(process.env.GITHUB_ENV, 'APPLE_API_KEY=' + file + '\n');
}
