import { readBounded } from './file-io.mjs';
import { atomicWrite } from './document.mjs';

export class DesktopAiSettings {
  constructor({ file, storage, platform = process.platform }) {
    this.file = file;
    this.storage = storage;
    this.platform = platform;
  }
  read() {
    try {
      const row = JSON.parse(readBounded(this.file, 16384));
      if (
        row.version !== 1 ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 0 ||
        typeof row.model !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(row.model) ||
        typeof row.encryptedKey !== 'string' ||
        row.encryptedKey.length > 12000
      )
        throw Error();
      return row;
    } catch (error) {
      if (error.code === 'ENOENT')
        return { version: 1, model: 'gpt-4.1-mini', encryptedKey: '', revision: 0 };
      throw Error('AI 설정 파일을 읽지 못했습니다. 프로필 백업에서 복원해 주세요.');
    }
  }
  public() {
    const row = this.read();
    return { model: row.model, hasApiKey: !!row.encryptedKey, revision: row.revision };
  }
  async available() {
    let available = false;
    try {
      available =
        ['win32', 'darwin'].includes(this.platform) &&
        (await this.storage.isAsyncEncryptionAvailable());
    } catch {}
    if (!available)
      throw Error('운영체제의 보안 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  async save(body) {
    if (
      !body ||
      !Number.isSafeInteger(body.revision) ||
      typeof body.model !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(body.model) ||
      typeof body.apiKey !== 'string' ||
      (body.apiKey !== '' && !/^[\x21-\x7e]{8,4096}$/.test(body.apiKey)) ||
      typeof body.clearApiKey !== 'boolean' ||
      (body.clearApiKey && body.apiKey)
    )
      throw Error('모델과 API 키 입력을 확인해 주세요.');
    const row = this.read();
    const conflict = () => {
      if (this.read().revision !== body.revision)
        throw Error('AI 설정이 변경되었습니다. 설정을 다시 열어 확인해 주세요.');
    };
    conflict();
    let encryptedKey = body.clearApiKey ? '' : row.encryptedKey;
    if (body.apiKey) {
      await this.available();
      try {
        encryptedKey = (await this.storage.encryptStringAsync(body.apiKey)).toString('base64');
      } catch {
        throw Error('API 키를 안전하게 저장하지 못했습니다. 다시 시도해 주세요.');
      }
    }
    conflict();
    atomicWrite(
      this.file,
      JSON.stringify({ version: 1, model: body.model, encryptedKey, revision: row.revision + 1 }) +
        '\n',
    );
    return this.public();
  }
  async credentials() {
    const row = this.read();
    if (!row.encryptedKey) return { model: row.model, apiKey: '' };
    await this.available();
    try {
      const decrypted = await this.storage.decryptStringAsync(
        Buffer.from(row.encryptedKey, 'base64'),
      );
      if (typeof decrypted.result !== 'string' || !decrypted.result) throw Error();
      if (decrypted.shouldReEncrypt) {
        const encryptedKey = (await this.storage.encryptStringAsync(decrypted.result)).toString(
          'base64',
        );
        if (this.read().revision === row.revision)
          atomicWrite(
            this.file,
            JSON.stringify({ ...row, encryptedKey, revision: row.revision + 1 }) + '\n',
          );
      }
      return { model: row.model, apiKey: decrypted.result };
    } catch {
      throw Error('API 키를 읽지 못했습니다. AI 설정에서 키를 다시 등록해 주세요.');
    }
  }
}
