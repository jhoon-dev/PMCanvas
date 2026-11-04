import { getBusinessTimeZone } from '../../shared/browser/business-clock.js';
import { PROJECT_SCREENS, projectNavigation } from '../../shared/browser/project-navigation.js';
import { WbsWorkspace } from '../../shared/browser/wbs-workspace.js';
import { DraftStore } from '../../shared/browser/draft-store.js';
import {
  managementView,
  installManagementUi,
  weeklyHtml,
} from '../../shared/browser/management-ui.js';
import { dashboardVisuals } from '../../shared/browser/dashboard-view.js';
import { today, addDays, summary } from '../../shared/browser/engine.js';
import {
  completionRecords,
  completionRows,
  wbsRows,
  csvText,
} from '../../shared/browser/reports.js';
import { escapeHtml as esc } from '../../shared/browser/html.js';
import { uid } from './id.mjs';
import { shareFile } from './platform.js';

export class ProjectTools {
  constructor(options) {
    this.options = options;
    this.at = today();
    this.range = { from: addDays(this.at, -13), to: this.at, owner: '' };
    this.page = { pane: 'list', id: '' };
    this.wbs = new WbsWorkspace({
      uid,
      getDraftStore: () => new DraftStore('mobile-local', localStorage),
      toast: options.toast,
      onStatus: () => {},
      onRender: options.render,
      onDetails: (id) => options.edit('task', id),
      confirm: options.confirm,
      savedMessage: 'WBS와 일정을 기기에 저장했습니다.',
      reloadLabel: '변경 취소 · 기기에서 다시 읽기',
      discardMessage:
        'WBS 변경사항을 버리고 기기에 저장된 업무를 읽을까요? 필요한 내용은 먼저 백업하세요.',
      downloadTemplate: () => this.excel('template'),
      readExcel: async (file) => (await import('./excel.js')).readExcel(file),
      onSave: async (draft) => {
        if (draft._revision !== options.revision())
          throw Error('프로젝트가 변경되었습니다. 초안을 백업하고 다시 열어 주세요.');
        await options.save(draft);
        return this.current();
      },
      onReload: async () => {
        await options.reload();
        return this.current();
      },
    });
    this.management = installManagementUi({
      project: options.project,
      getDate: () => this.at,
      toast: options.toast,
      confirmDiscard: options.confirm,
      canChange: () => options.canChange() && !this.wbs.dirty && !this.wbs.saving,
      save: async (next) => {
        await options.save(next);
        this.page = { pane: 'list', id: '' };
        options.render();
      },
      exportReport: (report) =>
        shareFile('주간보고-' + report.to + '.html', weeklyHtml(report), 'text/html;charset=utf-8'),
      savedMessage: '변경사항을 기기에 저장했습니다.',
      publishedMessage: '주간보고를 발행하고 기기에 저장했습니다.',
    });
    document.addEventListener('click', (event) => {
      void this.click(event).catch((error) => options.toast(error.message));
    });
    document.addEventListener('change', (event) => this.change(event));
    window.addEventListener('beforeunload', (event) => {
      if (this.dirty()) {
        this.wbs.persistDraft();
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }
  current() {
    return { ...this.options.project(), _revision: this.options.revision() };
  }
  dirty() {
    return this.wbs.dirty || this.management.dirty();
  }
  pending() {
    return this.wbs.saving || this.management.pending() || this.exporting;
  }
  async leave() {
    if (this.pending()) {
      this.options.toast('저장이 끝난 뒤 이동해 주세요.');
      return false;
    }
    if (this.wbs.dirty) {
      this.options.toast('WBS 변경사항을 먼저 저장하거나 취소해 주세요.');
      return false;
    }
    return await this.management.leave();
  }
  enter(view, id) {
    if (this.projectId !== id) {
      this.at = today();
      this.range = { from: addDays(this.at, -13), to: this.at, owner: '' };
      this.wbs.draft = null;
    }
    if (this.view !== view || this.projectId !== id) this.page = { pane: 'list', id: '' };
    this.projectId = id;
    this.view = view;
    const project = this.options.project();
    if (this.range.owner && !project.members.some((member) => member.id === this.range.owner))
      this.range.owner = '';
  }
  dateControl() {
    return `<label class="report-date"><span>보고 기준일</span><input id="projectReportDate" aria-label="보고 기준일" type="date" max="${esc(today())}" value="${esc(this.at)}"></label>`;
  }
  controls(view) {
    return `<div class="desktop-controls date-only">${this.dateControl()}<span class="date-caption">${esc(view && this.at === today() ? '오늘' : '과거 조회')} · ${esc(getBusinessTimeZone())} · 저장됨</span></div>`;
  }
  visuals(project) {
    return dashboardVisuals(project, summary(project, this.at), this.at);
  }
  render(view) {
    if (view === 'planning')
      return (
        '<section class="mobile-project-section">' +
        this.wbs.markup(this.current(), this.at) +
        '</section>'
      );
    if (PROJECT_SCREENS[view]?.section)
      return (
        '<section class="mobile-project-section">' +
        managementView(this.options.project(), this.at, {
          section: PROJECT_SCREENS[view].section,
          page: this.page,
        }) +
        '</section>'
      );
    return this.reports();
  }
  attach(view) {
    if (view === 'planning') {
      this.wbs.attach();
      if (this.openImportOnAttach) {
        this.openImportOnAttach = false;
        queueMicrotask(() => this.wbs.action('import-excel'));
      }
    }
    const host = document.querySelector('#pmManagement');
    // Keep every desktop field and action in the DOM. On phones the same row
    // becomes a labeled record, so actions never disappear beyond the viewport.
    for (const table of host?.querySelectorAll('table') || []) {
      const headings = [...table.querySelectorAll('thead th')].map((cell) =>
        cell.textContent.trim(),
      );
      if (!headings.length) continue;
      table.classList.add('mobile-record-table');
      for (const row of table.querySelectorAll('tbody tr')) {
        [...row.cells].forEach((cell, index) => {
          cell.dataset.label = headings[index] || '';
          if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(cell.textContent.trim())) {
            const date = new Date(cell.textContent.trim());
            if (Number.isFinite(date.getTime()))
              cell.textContent = new Intl.DateTimeFormat('ko-KR', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: getBusinessTimeZone(),
              }).format(date);
          }
        });
      }
    }
    for (const form of host?.querySelectorAll('form') || []) {
      const submit = form.querySelector('button[type="submit"]');
      if (!submit) continue;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'button';
      cancel.dataset.pmReset = '';
      cancel.textContent = '입력 취소';
      submit.after(cancel);
    }
    const staffing = host?.querySelector('[data-pm-form="staffing"]');
    if (staffing && !this.options.project().members.length)
      staffing.innerHTML =
        '<p>투입 기간을 등록하려면 참여인력을 먼저 추가해 주세요.</p><button type="button" class="button primary" data-action="add-member">참여인력 추가</button>';
  }
  records() {
    return completionRecords(this.options.project(), this.range);
  }
  reports() {
    const p = this.options.project(),
      completed = this.records();
    return `<section class="settings-card panel"><h2>업무 현황</h2><p>보고 기준일의 업무 일정과 진척률을 저장합니다.</p><p class="report-count">기준일 ${this.at} · 업무 ${p.tasks.length}개</p><div class="stack-actions"><button class="button" data-action="csv">업무 보고서 CSV</button><button class="button" data-project-tool="excel">업무 보고서 Excel</button><button class="button" data-project-tool="template">Excel 입력 양식</button><button class="button" data-project-tool="import-excel">Excel 가져오기</button></div></section>
    <section class="settings-card panel"><h2>완료 기록</h2><div class="report-range"><label class="field">시작일<input id="toolReportFrom" aria-label="조회 시작일" type="date" value="${this.range.from}" max="${this.at}"></label><label class="field">종료일<input id="toolReportTo" aria-label="조회 종료일" type="date" value="${this.range.to}" max="${this.at}"></label><label class="field">담당자<select id="toolReportOwner" aria-label="조회 담당자"><option value="">전체 담당자</option>${p.members.map((member) => `<option value="${esc(member.id)}" ${this.range.owner === member.id ? 'selected' : ''}>${esc(member.name)}</option>`).join('')}</select></label><button type="button" class="button" data-project-tool="all-records">전체 기록</button></div><p class="report-count">조회 기간의 완료 작업 ${completed.length}건</p>
    ${
      completed.length
        ? `<ul class="completion-records">${completed
            .slice(0, 20)
            .map(
              (entry) =>
                `<li><strong>${esc(entry.title)}</strong><span>${esc(entry.task)} · ${esc(entry.owner)}</span><small>${entry.date} · ${entry.hours}h</small></li>`,
            )
            .join(
              '',
            )}</ul>${completed.length > 20 ? '<p>최근 20건을 표시합니다. 파일에는 전체 조회 결과가 포함됩니다.</p>' : ''}<div class="stack-actions"><button class="button" data-action="completion-csv">완료 기록 CSV</button><button class="button" data-project-tool="completion-excel">완료 기록 Excel</button></div>`
        : '<p class="muted">선택한 기간과 담당자의 완료 기록이 없습니다.</p>'
    }</section>`;
  }
  async excel(kind = 'wbs') {
    if (this.exporting) return;
    this.exporting = true;
    try {
      if (this.view === 'planning') this.wbs.commitAll();
      const project = this.view === 'planning' ? this.wbs.snapshot() : this.options.project();
      const ids =
        this.view === 'planning'
          ? this.wbs.visible({ includeCollapsed: true }).map((task) => task.id)
          : undefined;
      if (kind === 'wbs' && ids && !ids.length)
        throw Error('출력할 업무가 없습니다. 검색 조건을 확인해 주세요.');
      const settings = {
        kind,
        at: this.at,
        ids,
        draft: this.view === 'planning' && this.wbs.dirty,
        ...this.range,
      };
      const { exportExcel } = await import('./excel.js');
      return await exportExcel(project, settings);
    } finally {
      this.exporting = false;
    }
  }
  async exportCsv(completion = false) {
    const project = this.view === 'planning' ? this.wbs.snapshot() : this.options.project();
    const rows = completion
      ? completionRows(project, this.records())
      : wbsRows(
          project,
          this.at,
          summary(project, this.at).forecast,
          this.view === 'planning' ? this.wbs.visible({ includeCollapsed: true }) : project.tasks,
        );
    await shareFile(
      project.name + '-' + (completion ? '완료기록' : this.at) + '.csv',
      csvText(rows),
      'text/csv;charset=utf-8',
    );
  }
  async click(event) {
    const pane = event.target.closest('[data-management-pane]');
    if (pane) {
      if (!(await this.management.leave())) return;
      this.page = { pane: pane.dataset.managementPane, id: pane.dataset.managementId || '' };
      this.options.render();
      document.querySelector('#content').focus({ preventScroll: true });
      return;
    }
    const reset = event.target.closest('[data-pm-reset]');
    if (reset) {
      this.management.reset(reset.closest('form'));
      return;
    }
    const target = event.target.closest('[data-project-tool]');
    if (!target || !this.options.canChange()) return;
    const action = target.dataset.projectTool;
    if (action === 'all-records') {
      const dates = this.options
        .project()
        .tasks.flatMap((task) => task.items.map((item) => item.doneDate).filter(Boolean))
        .sort();
      this.range = { ...this.range, from: dates[0] || this.at, to: this.at };
      this.options.render();
    } else if (action === 'import-excel') {
      if (this.view !== 'planning') {
        if (!(await this.leave())) return;
        this.openImportOnAttach = true;
        this.options.navigate('planning');
      } else await this.wbs.action('import-excel');
    } else
      await this.excel(
        action === 'template' ? 'template' : action === 'completion-excel' ? 'completion' : 'wbs',
      );
  }
  change(event) {
    const el = event.target;
    if (el.id === 'projectView') {
      this.options.navigate(el.value);
      return;
    }
    if (el.id === 'projectReportDate') {
      if (this.dirty() || this.pending()) {
        el.value = this.at;
        this.options.toast('변경사항을 먼저 저장하거나 취소해 주세요.');
        return;
      }
      try {
        summary(this.options.project(), el.value);
        if (!el.value || el.value > today()) throw Error('오늘까지의 날짜를 선택해 주세요.');
        this.at = el.value;
        if (this.range.to > this.at)
          this.range = { from: addDays(this.at, -13), to: this.at, owner: this.range.owner };
        this.options.onDate?.(this.at);
        this.options.render();
      } catch (error) {
        el.value = this.at;
        this.options.toast(error.message);
      }
      return;
    }
    if (['toolReportFrom', 'toolReportTo', 'toolReportOwner'].includes(el.id)) {
      const next = {
        from: document.querySelector('#toolReportFrom').value,
        to: document.querySelector('#toolReportTo').value,
        owner: document.querySelector('#toolReportOwner').value,
      };
      try {
        if (next.to > this.at) throw Error('보고 기준일까지 조회할 수 있습니다.');
        completionRecords(this.options.project(), next);
        this.range = next;
      } catch (error) {
        this.options.toast(error.message);
      }
      this.options.render();
    }
  }
}
