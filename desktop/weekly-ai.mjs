import { WeeklyReportAi, weeklyReportContext } from './app/node/weekly-report-ai.mjs';

export class DesktopWeeklyAi {
  constructor({ workspace, settings, fetchImpl, now = Date.now }) {
    this.workspace = workspace;
    this.settings = settings;
    this.client = new WeeklyReportAi({ settings, fetchImpl });
    this.now = now;
    this.requests = [];
    this.pending = false;
  }
  assertCurrent(body) {
    if (
      !this.workspace.project ||
      body.tabId !== this.workspace.activeId ||
      body.revision !== this.workspace.revision
    )
      throw Error('프로젝트가 변경되었습니다. 최신 내용을 불러온 뒤 AI 초안을 다시 생성해 주세요.');
  }
  async generate(body) {
    if (
      !body ||
      !Number.isSafeInteger(body.revision) ||
      typeof body.tabId !== 'string' ||
      Object.keys(body).some(
        (key) =>
          !['revision', 'tabId', 'from', 'to', 'notes', 'nextNotes', 'language'].includes(key),
      )
    )
      throw Error('주간보고 설명과 언어를 확인해 주세요.');
    this.assertCurrent(body);
    const context = weeklyReportContext(this.workspace.project, body);
    if (this.pending) throw Error('AI 초안을 생성 중입니다. 잠시 기다려 주세요.');
    this.requests = this.requests.filter((at) => at > this.now() - 60000);
    if (this.requests.length >= 5) throw Error('AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    this.pending = true;
    try {
      if (!(await this.client.isConfigured()))
        throw Error('AI 연결 설정에서 API 키를 먼저 등록해 주세요.');
      this.requests.push(this.now());
      const result = await this.client.generate(context);
      this.assertCurrent(body);
      return { ...result, revision: body.revision, tabId: body.tabId };
    } finally {
      this.pending = false;
    }
  }
}
