/*global navigator*/
'use strict';

const {
  REGEX_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = require('./constants');

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

exports.isWindows = () => {
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    return platform === 'win32' || platform === 'windows';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }

  return false;
};

exports.removeBackslashes = str => {
  // Locate bracket spans once. Retrying a lazy bracket regex at every '['
  // makes an unterminated sequence quadratic in the input length.
  const ends = new Int32Array(str.length);
  ends.fill(-1);
  let closest = -1;
  let following = -1;
  let lineBreak = str.length;
  const isLineBreak = ch => ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === '[') {
      // The old expression requires at least one character inside the span.
      const end = closest === i + 1 ? following : closest;
      if (end >= i + 2 && lineBreak >= end - 1) ends[i] = end;
    }
    if (str[i] === ']' && str[i - 1] !== '\\') {
      following = closest;
      closest = i;
    }
    if (isLineBreak(str[i])) lineBreak = i;
  }
  const chunks = [];
  for (let i = 0; i < str.length; i++) {
    if (ends[i] !== -1) {
      chunks.push(str.slice(i, ends[i] + 1));
      i = ends[i];
    } else if (str[i] !== '\\' || i + 1 === str.length || isLineBreak(str[i + 1])) {
      chunks.push(str[i]);
    }
  }
  return chunks.join('');
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  const segs = path.split(windows ? /[\\/]/ : '/');
  const last = segs[segs.length - 1];

  if (last === '') {
    return segs[segs.length - 2];
  }

  return last;
};
