import readline from 'node:readline';
import { SetupError } from './mac-signing-core.mjs';

// No echo, stars or clipboard access. Typed secrets never reach the output stream.
export function hiddenInput(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || !input.setRawMode)
    throw new SetupError(
      '암호 입력은 대화형 터미널에서만 가능합니다. 입력·출력을 파일로 리다이렉트하지 마세요.',
    );
  output.write(prompt);
  readline.emitKeypressEvents(input);
  const raw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      input.off('keypress', onKey);
      input.setRawMode(raw);
      input.pause();
      output.write('\n');
      const answer = value;
      value = '';
      if (error) reject(error);
      else resolve(answer);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new SetupError('작업을 취소했습니다.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
        return;
      }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) {
        if (value.length + text.length > 512) return finish(new SetupError('입력이 너무 깁니다.'));
        value += text;
      }
    };
    input.on('keypress', onKey);
  });
}

export function question(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdin.pause();
      resolve(answer.trim());
    }),
  );
}
