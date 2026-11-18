import { hkdfSync } from 'node:crypto';
import { seal, unseal } from './admin-mfa.mjs';
import { fail } from './errors.mjs';

export class AiSettings {
  constructor({ repo, key, apiKey = '', model = 'gpt-4.1-mini' }) {
    if (!Buffer.isBuffer(key) || key.length !== 32)
      throw Error('AI settings require a 32-byte encryption key.');
    this.repo = repo;
    this.key = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'pmcanvas-ai-settings-v1', 32));
    this.legacy = { apiKey: apiKey.trim(), model: model.trim() || 'gpt-4.1-mini' };
  }
  async public() {
    const row = await this.repo.getAiSettings();
    return {
      model: row ? row.model : this.legacy.model,
      hasApiKey: row ? !!row.api_key_encrypted : !!this.legacy.apiKey,
      revision: row?.revision || 0,
    };
  }
  async credentials() {
    const row = await this.repo.getAiSettings();
    if (!row) return { ...this.legacy };
    try {
      return {
        model: row.model,
        apiKey: row.api_key_encrypted ? unseal(row.api_key_encrypted, this.key) : '',
      };
    } catch {
      fail(503, 'AI_KEY', 'AI 인증 정보를 읽지 못했습니다. 설정에서 API 키를 다시 등록해 주세요.');
    }
  }
  async save(actorId, body) {
    if (
      !body ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      typeof body.model !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(body.model) ||
      typeof body.apiKey !== 'string' ||
      (body.apiKey !== '' && !/^[\x21-\x7e]{8,4096}$/.test(body.apiKey)) ||
      typeof body.clearApiKey !== 'boolean' ||
      (body.clearApiKey && body.apiKey !== '')
    )
      fail(400, 'AI_CONFIG', '모델과 API 키 입력을 확인해 주세요.');
    const row = await this.repo.getAiSettings();
    if ((row?.revision || 0) !== body.revision)
      fail(
        409,
        'AI_CONFLICT',
        '다른 관리자가 AI 설정을 변경했습니다. 최신 설정을 다시 확인해 주세요.',
      );
    const apiKeyEncrypted = body.clearApiKey
      ? null
      : body.apiKey
        ? seal(body.apiKey, this.key)
        : row
          ? row.api_key_encrypted
          : this.legacy.apiKey
            ? seal(this.legacy.apiKey, this.key)
            : null;
    await this.repo.saveAiSettings(actorId, {
      model: body.model,
      apiKeyEncrypted,
      revision: body.revision,
    });
    return this.public();
  }
}
