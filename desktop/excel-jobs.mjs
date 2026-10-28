import { fileURLToPath } from 'node:url';
import { getBusinessTimeZone } from './app/shared/business-clock.js';

export function createExcelJobs(fork, { timeout = 15000 } = {}) {
  let active = false;
  return async (kind, input) => {
    if (active) throw Error('Excel 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
    if (
      !['import', 'export', 'template'].includes(kind) ||
      Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024
    )
      throw Error('Excel 요청을 확인해 주세요.');
    active = true;
    try {
      return await new Promise((resolve, reject) => {
        const env = { NODE_ENV: 'production', PM_TIME_ZONE: getBusinessTimeZone() };
        for (const key of ['SystemRoot', 'TEMP', 'TMP'])
          if (process.env[key]) env[key] = process.env[key];
        const child = fork(fileURLToPath(new URL('./excel-worker.mjs', import.meta.url)), [], {
          env,
          execArgv: ['--max-old-space-size=192'],
          stdio: 'pipe',
          serviceName: 'PM Canvas Excel',
        });
        let size = 0,
          error = '',
          settled = false;
        const chunks = [];
        const finish = (problem) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (problem) {
            child.kill();
            reject(problem);
          } else resolve(Buffer.concat(chunks));
        };
        const timer = setTimeout(
          () => finish(Error('Excel 처리 시간이 초과되었습니다. 파일 크기를 줄여 주세요.')),
          timeout,
        );
        child.stdout.on('data', (chunk) => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) finish(Error('Excel 출력 크기 제한을 초과했습니다.'));
          else chunks.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
          if (error.length < 1000) error += chunk.toString();
        });
        child.once('spawn', () => child.postMessage({ kind, input }));
        child.once('error', () => finish(Error('Excel 작업을 시작하지 못했습니다.')));
        let exitCode,
          stdoutEnded = false,
          stderrEnded = false;
        const complete = () => {
          if (exitCode !== undefined && stdoutEnded && stderrEnded)
            finish(
              exitCode === 0
                ? null
                : Error(error.trim().slice(0, 300) || 'Excel 파일을 처리하지 못했습니다.'),
            );
        };
        child.stdout.once('end', () => {
          stdoutEnded = true;
          complete();
        });
        child.stderr.once('end', () => {
          stderrEnded = true;
          complete();
        });
        child.once('exit', (code) => {
          exitCode = code;
          complete();
        });
      });
    } finally {
      active = false;
    }
  };
}
