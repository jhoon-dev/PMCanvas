import { ui } from './shared/i18n.js';
import { escapeHtml as esc } from './shared/html.js';
import {
  hierarchy,
  ordered,
  rollups,
  baselineDiff,
  criticalPath,
  scheduleWarnings,
} from './shared/planning.js';
import { moveSchedule, alignSuccessors, checkDraft } from './shared/wbs-model.js';
import { pct, num, person, meter, pageHead, btn } from './shared/view-ui.js';

export function parentField(project, id = '') {
  const tree = hierarchy(project);
  const current = project.tasks.find((task) => task.id === id)?.parentId || '';
  return (
    ui(
      '<label class="field">상위 업무<select name="parentId"><option value="">최상위 업무</option>',
    ) +
    ordered(project)
      .filter((task) => task.id !== id && !tree.get(task.id).ancestors.includes(id))
      .map(
        (task) =>
          '<option value="' +
          esc(task.id) +
          '" ' +
          (task.id === current ? 'selected' : '') +
          '>' +
          esc(tree.get(task.id).number + ' ' + task.name) +
          '</option>',
      )
      .join('') +
    ui('</select><small>상위 업무는 묶음 관계이며 선행 업무와 별개입니다.</small></label>')
  );
}

const delta = (value, unit) => (value > 0 ? '+' : '') + num(value) + unit;

export function scheduleForm(project, id = '') {
  return {
    title: ui('일정 조정'),
    body:
      ui('<label class="field">업무<select name="scheduleTask" required>') +
      ordered(project)
        .map(
          (task) =>
            '<option value="' +
            esc(task.id) +
            '" ' +
            (task.id === id ? 'selected' : '') +
            '>' +
            esc(task.name) +
            '</option>',
        )
        .join('') +
      ui(
        '</select></label><label class="field">조정 방법<select name="scheduleMode"><option value="move">시작·종료 함께 이동</option><option value="start">시작일만 조정</option><option value="end">종료일만 조정</option><option value="align">전체 선행 관계에 맞춰 후속 일정 정리</option></select></label>',
      ) +
      ui(
        '<label class="field">이동 일수<input name="scheduleDays" type="number" step="1" min="-3652" max="3652" value="1" required><small>달력 일수입니다. +는 뒤로, −는 앞으로 이동합니다.</small></label>',
      ) +
      ui(
        '<label class="desktop-schedule-cascade"><input name="scheduleCascade" type="checkbox"> 연결된 후속 업무도 필요한 만큼 뒤로 조정</label>',
      ) +
      ui(
        '<p class="form-hint">완료 기록·공수·기준 계획은 보존합니다. 이동 후 근무일이 없는 일정은 적용할 수 없습니다. 후속 일정은 달력상 기간을 유지하며 뒤로 조정합니다.</p>',
      ) +
      ui(
        '<button class="button" type="button" id="previewSchedule">일정 변경 미리보기</button><div id="schedulePreview" aria-live="polite"></div>',
      ),
  };
}

export function scheduleProposal(project, form) {
  const options = {
    id: String(form.get('scheduleTask') || ''),
    mode: String(form.get('scheduleMode') || ''),
    days: String(form.get('scheduleDays') || ''),
    cascade: form.get('scheduleCascade') === 'on',
  };
  let next;
  if (options.mode === 'align') next = checkDraft(alignSuccessors(structuredClone(project)));
  else {
    if (!project.tasks.some((task) => task.id === options.id))
      throw Error(ui('조정할 업무를 선택해 주세요.'));
    if (!options.days.trim()) throw Error(ui('이동 일수를 입력해 주세요.'));
    next = moveSchedule(project, [options.id], Number(options.days), {
      mode: options.mode,
      cascade: options.cascade,
    });
  }
  const changes = next.tasks.flatMap((task, index) => {
    const before = project.tasks[index];
    return before.start === task.start && before.end === task.end
      ? []
      : [
          {
            id: task.id,
            name: task.name,
            from: before.start + ' ~ ' + before.end,
            to: task.start + ' ~ ' + task.end,
          },
        ];
  });
  return { project: next, changes, signature: JSON.stringify(options) };
}

export function schedulePreviewHtml(changes) {
  return (
    ui('<p class="form-hint">변경할 일정 ') +
    changes.length +
    ui('개 · 아직 적용하지 않았습니다.</p>') +
    (changes.length
      ? ui(
          '<div class="desktop-table-wrap"><table class="desktop-table"><thead><tr><th>업무</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>',
        ) +
        changes
          .map(
            (row) =>
              '<tr><td>' +
              esc(row.name) +
              '</td><td>' +
              esc(row.from) +
              '</td><td>' +
              esc(row.to) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div>'
      : '')
  );
}

function scheduleReview(project, cp) {
  const warnings = scheduleWarnings(project);
  return (
    ui(
      '<section class="panel desktop-baseline"><div class="desktop-section-head"><h2>일정 점검</h2>',
    ) +
    btn(ui('일정 조정'), 'schedule') +
    ui('</div><p class="desktop-report-summary">선행 일정 충돌 ') +
    warnings.dependencies.length +
    ui('개 · 과부하 구간 ') +
    warnings.overloads.length +
    ui('개 · 임계 업무 ') +
    cp.ids.size +
    ui('개 · CPM 기간 ') +
    cp.duration +
    ui('근무일</p>') +
    '<div class="desktop-schedule-issues">' +
    warnings.dependencies
      .map(
        (task) =>
          '<p data-dependency="' +
          esc(task.id) +
          ui('">선행 일정 확인: <button class="task-name" data-edit-task="') +
          esc(task.id) +
          '">' +
          esc(task.name) +
          '</button></p>',
      )
      .join('') +
    warnings.overloads
      .slice(0, 100)
      .map(
        (warning) =>
          '<p data-overload>' +
          esc(warning.name) +
          ' · ' +
          warning.from +
          ' ~ ' +
          warning.to +
          ' · ' +
          num(warning.load) +
          ' / ' +
          num(warning.capacity) +
          ui('h/근무일</p>'),
      )
      .join('') +
    (warnings.overloads.length > 100 ? ui('<p>과부하 구간은 앞의 100개를 표시합니다.</p>') : '') +
    (!warnings.dependencies.length && !warnings.overloads.length
      ? ui('<p>계획 일정 충돌과 담당자 과부하가 없습니다.</p>')
      : '') +
    ui(
      '</div><p class="desktop-report-summary">전체 업무의 계획을 점검합니다. 업무 공수는 기간 내 근무일에 균등 배분하고 주말·휴무일은 제외합니다. 임계 업무는 계획·선행 관계 기준 여유일이 0인 업무이며 담당자 간 자원 경쟁은 반영하지 않습니다.</p></section>',
    )
  );
}
function baselineView(project) {
  const baseline = project.baseline;
  if (!baseline)
    return (
      ui(
        '<section class="panel desktop-baseline"><div class="desktop-section-head"><h2>기준 계획</h2>',
      ) +
      btn(ui('기준 계획 저장'), 'baseline', 'primary') +
      ui(
        '</div><p class="desktop-report-summary">현재 업무 이름·계층·일정·공수를 기준으로 보관하고 이후 변경을 비교하세요.</p></section>',
      )
    );
  const diff = baselineDiff(project);
  const rows = diff.rows
    .map((row) => {
      const labels = row.added
        ? [ui('추가')]
        : [
            row.renamed && ui('이름 변경'),
            row.reparented && ui('계층 변경'),
            (row.start || row.end || row.hours) && ui('계획 변경'),
          ].filter(Boolean);
      return (
        '<tr data-baseline-row="' +
        esc(row.id) +
        '"><td>' +
        esc(row.name) +
        '</td><td>' +
        esc(labels.join(' · ') || ui('변경 없음')) +
        '</td><td>' +
        (row.added ? '—' : delta(row.start, ui('일'))) +
        '</td><td>' +
        (row.added ? '—' : delta(row.end, ui('일'))) +
        '</td><td>' +
        (row.added ? '—' : delta(row.hours, 'h')) +
        '</td></tr>'
      );
    })
    .concat(
      diff.removed.map(
        (row) =>
          '<tr><td>' +
          esc(row.name) +
          ui('</td><td>삭제</td><td colspan="3">기준 계획에만 남아 있습니다.</td></tr>'),
      ),
    );
  return (
    ui(
      '<section class="panel desktop-baseline"><div class="desktop-section-head"><h2>기준 계획 비교</h2>',
    ) +
    btn(ui('기준 계획 교체'), 'baseline') +
    '</div><p class="desktop-report-summary"><strong>' +
    esc(baseline.name) +
    ui('</strong> · 저장일 ') +
    esc(baseline.createdAt.slice(0, 10)) +
    ui(' · 당시 업무 ') +
    baseline.tasks.length +
    ui(
      '개</p><div class="desktop-table-wrap"><table class="desktop-table"><thead><tr><th>업무</th><th>변경 내용</th><th>시작일 차이</th><th>종료일 차이</th><th>공수 차이</th></tr></thead><tbody>',
    ) +
    (rows.join('') || ui('<tr><td colspan="5">비교할 업무가 없습니다.</td></tr>')) +
    ui(
      '</tbody></table></div><p class="desktop-report-summary">전체 업무를 비교합니다. 날짜는 달력 일수이며 +는 늦어짐, −는 앞당김입니다. 공수는 각 업무 자체의 세부 작업 합계입니다.</p></section>',
    )
  );
}

export function planningView(
  project,
  { at, query = '', owner = '', collapsed = new Set(), selected = new Set(), controls = '' },
) {
  const tree = hierarchy(project),
    totals = rollups(project, at, tree),
    cp = criticalPath(project);
  const filtering = Boolean(query || owner),
    visible = new Set();
  for (const task of project.tasks) {
    if (
      (!query || task.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (!owner || task.owner === owner)
    ) {
      visible.add(task.id);
      for (const ancestor of tree.get(task.id).ancestors) visible.add(ancestor);
    }
  }
  const visibleTasks = ordered(project).filter(
    (task) =>
      visible.has(task.id) &&
      (filtering || !tree.get(task.id).ancestors.some((id) => collapsed.has(id))),
  );
  const rows = visibleTasks.map((task) => {
    const node = tree.get(task.id),
      total = totals.get(task.id);
    return (
      '<tr data-wbs-row="' +
      esc(task.id) +
      '" class="' +
      (selected.has(task.id) ? 'desktop-selected' : '') +
      '"><td><input type="checkbox" data-select-task="' +
      esc(task.id) +
      '" aria-label="' +
      esc(task.name) +
      ui(' 선택" ') +
      (selected.has(task.id) ? 'checked' : '') +
      '></td><td><div class="desktop-tree-name" style="--depth:' +
      node.depth +
      '">' +
      (node.children.length
        ? '<button class="desktop-tree-toggle" data-fold="' +
          esc(task.id) +
          '" aria-label="' +
          esc(task.name) +
          ui(' 하위 업무" aria-expanded="') +
          (filtering || !collapsed.has(task.id)) +
          '" ' +
          (filtering ? 'disabled' : '') +
          '>' +
          (filtering || !collapsed.has(task.id) ? '▾' : '▸') +
          '</button>'
        : '<span class="desktop-tree-spacer"></span>') +
      '<span class="desktop-wbs-number">' +
      node.number +
      '</span><button class="task-name" data-edit-task="' +
      esc(task.id) +
      '">' +
      esc(task.name) +
      '</button>' +
      (cp.ids.has(task.id) ? ui('<span class="desktop-critical">임계</span>') : '') +
      '</div>' +
      (node.children.length
        ? ui('<span class="task-phase">하위 포함 ') + total.count + ui('개 업무</span>')
        : '') +
      '</td><td>' +
      person(project, task.owner) +
      '</td><td>' +
      total.start +
      '<br>' +
      total.end +
      '</td><td>' +
      num(total.hours) +
      'h</td><td>' +
      pct(total.progress) +
      meter(total.progress) +
      '</td><td><div class="desktop-tree-actions"><button class="button small" data-indent="' +
      esc(task.id) +
      '" aria-label="' +
      esc(task.name) +
      ui(' 들여쓰기" ') +
      (Number(node.number.split('.').at(-1)) > 1 ? '' : 'disabled') +
      '>→</button><button class="button small" data-outdent="' +
      esc(task.id) +
      '" aria-label="' +
      esc(task.name) +
      ui(' 내어쓰기" ') +
      (node.ancestors.length ? '' : 'disabled') +
      '>←</button><button class="button small" data-shift-task="' +
      esc(task.id) +
      '" aria-label="' +
      esc(task.name) +
      ui(' 일정 조정">일정</button></div></td></tr>')
    );
  });
  return (
    pageHead(
      'WORK BREAKDOWN & BASELINE',
      ui('WBS · 기준 계획'),
      ui('업무를 계층으로 묶고 기준 계획과의 변화를 확인하세요.'),
      btn(ui('＋ 업무 추가'), 'task', 'primary'),
    ) +
    controls +
    ui(
      '<div class="desktop-planning-tools"><button class="button small" data-expand-all>모두 펼치기</button><span>업무 이름을 눌러 상위 업무를 지정할 수 있습니다.</span></div>',
    ) +
    '<div class="desktop-bulk-tools" ' +
    (selected.size ? '' : 'hidden') +
    ui('><span role="status">선택 ') +
    selected.size +
    ui('개</span>') +
    [
      ['duplicate', ui('선택 복제')],
      ['up', ui('선택 위로')],
      ['down', ui('선택 아래로')],
      ['remove', ui('선택 삭제')],
    ]
      .map(
        ([action, label]) =>
          '<button class="button small" data-bulk="' +
          action +
          '" ' +
          (selected.size ? '' : 'disabled') +
          '>' +
          label +
          '</button>',
      )
      .join('') +
    '<button class="button small" data-clear-selection ' +
    (selected.size ? '' : 'disabled') +
    ui('>선택 해제</button></div>') +
    ui(
      '<section class="panel"><div class="desktop-table-wrap"><table class="desktop-table desktop-wbs-table"><thead><tr><th><input type="checkbox" data-select-visible aria-label="표시된 업무 모두 선택" ',
    ) +
    (visibleTasks.length && visibleTasks.every((task) => selected.has(task.id)) ? 'checked' : '') +
    (visibleTasks.length ? '' : ' disabled') +
    ui(
      '></th><th>WBS · 업무</th><th>담당자</th><th>하위 포함 일정</th><th>하위 포함 공수</th><th>하위 포함 진척률</th><th>계층 조정</th></tr></thead><tbody>',
    ) +
    (rows.join('') || ui('<tr><td colspan="7">표시할 업무가 없습니다.</td></tr>')) +
    '</tbody></table></div></section>' +
    ui(
      '<p class="desktop-note">묶음의 공수·진척률·기간은 해당 업무 자체와 모든 하위 업무를 합산합니다. 전체 프로젝트 총계에 중복 가산하지 않습니다.<br>들여쓰기는 앞의 같은 수준 업무 아래로 이동합니다. 검색 중에는 일치하는 업무와 상위 경로를 펼쳐 표시하며 집계는 전체 하위 업무를 포함합니다.</p>',
    ) +
    scheduleReview(project, cp) +
    baselineView(project)
  );
}
