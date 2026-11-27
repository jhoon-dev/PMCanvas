import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail, HttpError } from './errors.mjs';
import { getBusinessTimeZone } from '../../shared/browser/business-clock.js';
// Includes cold worker startup and leaves headroom before the 60-second proxy timeout.
const FILE_JOB_TIMEOUT_MS = 45000;
let active = 0;
export async function fileJob(kind, input) {
  if (active >= 2) fail(429, 'FILE_BUSY', '파일 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const env = { NODE_ENV: 'production', PM_TIME_ZONE: getBusinessTimeZone() };
      for (const k of ['SystemRoot', 'TEMP', 'TMP']) if (process.env[k]) env[k] = process.env[k];
      const child = spawn(
        process.execPath,
        [
          '--max-old-space-size=192',
          fileURLToPath(new URL('./file-job-child.mjs', import.meta.url)),
          '--file-job',
          kind,
        ],
        { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
      const chunks = [];
      let size = 0,
        error = '',
        limitError;
      const stop = (failure) => {
        if (limitError) return;
        limitError = failure;
        child.kill();
      };
      const timer = setTimeout(
        () =>
          stop(
            new HttpError(
              504,
              'FILE_TIMEOUT',
              '파일 작업 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
            ),
          ),
        FILE_JOB_TIMEOUT_MS,
      );
      child.stdout.on('data', (chunk) => {
        if (limitError) return;
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          stop(
            new HttpError(
              422,
              'FILE_OUTPUT_LIMIT',
              '파일 출력 한도를 초과했습니다. 출력 범위 또는 파일 크기를 줄여 주세요.',
            ),
          );
        } else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk) => {
        if (error.length < 2000) error += chunk.toString();
      });
      child.stdin.on('error', () => {});
      child.once('error', () => {
        clearTimeout(timer);
        reject(Error('파일 작업 프로세스를 시작하지 못했습니다.'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (limitError) return reject(limitError);
        if (code !== 0)
          return reject(Error(error.trim().slice(0, 300) || '파일을 처리하지 못했습니다.'));
        resolve(Buffer.concat(chunks));
      });
      child.stdin.end(JSON.stringify(input));
    });
  } finally {
    active--;
  }
}
