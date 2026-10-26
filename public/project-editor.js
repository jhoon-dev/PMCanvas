import { escapeHtml as esc } from './html.js';
import { field } from './view-ui.js';
import { today, nextWorkday, shiftWorkday, validDate, validateProject } from './engine.js';
import { memberEditor, updateMember } from './people-view.js';
export function itemEditor(i = { id: crypto.randomUUID(), title: '', hours: 4, doneDate: null }) {
  return (
    '<div class="item-editor" data-item-id="' +
    esc(i.id) +
    '" data-done-date="' +
    esc(i.doneDate || '') +
    '"><input name="itemTitle" value="' +
    esc(i.title) +
    '" placeholder="예: 로그인 API 구현" aria-label="세부 작업 이름" maxlength="300" required><input name="itemHours" value="' +
    i.hours +
    '" type="number" min=".1" max="10000" step=".1" aria-label="세부 작업 예상 시간" required><span>h</span><button type="button" class="icon-button remove-item" aria-label="세부 작업 삭제">×</button></div>'
  );
}

export function editorForm(
  type,
  p,
  id = '',
  { currentDate = today(), uid = () => crypto.randomUUID() } = {},
) {
  let body = '',
    title = '';
  if (type === 'project' || type === 'settings') {
    title = type === 'project' ? '새 프로젝트' : '프로젝트 설정';
    body =
      field(
        '프로젝트명',
        'name',
        type === 'project' ? '' : p.name,
        'text',
        'required maxlength="120" placeholder="예: 고객 포털 리뉴얼"',
      ) +
      '<label class="field">프로젝트 설명<textarea name="description" rows="2" maxlength="300">' +
      esc(type === 'project' ? '' : p.description) +
      '</textarea></label><label class="field">추가 휴무일 <span class="optional">선택</span><textarea name="holidays" rows="3" placeholder="2026-12-25&#10;2027-01-01">' +
      (type === 'project' ? '' : esc((p.holidays || []).join('\n'))) +
      '</textarea><small>월–금 근무 기준입니다. 공휴일·팀 휴무일을 한 줄에 하나씩 입력하세요.</small></label>';
  } else if (type === 'member') {
    const member = memberEditor(p, id);
    title = member.title;
    body = member.body;
  } else {
    const t = p.tasks.find((x) => x.id === id) || {
      name: '',
      owner: p.members[0]?.id || '',
      start: nextWorkday(currentDate, p.holidays),
      end: shiftWorkday(nextWorkday(currentDate, p.holidays), 4, p.holidays),
      phase: '개발',
      predecessor: '',
      items: [{ id: uid(), title: '', hours: 4, doneDate: null }],
      memo: '',
    };
    title = id ? '업무 수정' : '새 업무 추가';
    body =
      field(
        '업무명',
        'name',
        t.name,
        'text',
        'required maxlength="200" placeholder="예: 회원 관리 기능 개발"',
      ) +
      '<div class="form-grid"><label class="field">담당자<select name="owner"><option value="">미지정</option>' +
      p.members
        .map(
          (m) =>
            '<option value="' +
            esc(m.id) +
            '" ' +
            (m.id === t.owner ? 'selected' : '') +
            '>' +
            esc(m.name) +
            ' · ' +
            esc(m.grade) +
            '</option>',
        )
        .join('') +
      '</select></label>' +
      field('단계 / 분류', 'phase', t.phase, 'text', 'maxlength="50" list="phases"') +
      '</div><datalist id="phases"><option>기획</option><option>설계</option><option>디자인</option><option>개발</option><option>QA</option><option>오픈</option></datalist><div class="form-grid">' +
      field('예상 시작일', 'start', t.start, 'date', 'required') +
      field('예상 종료일', 'end', t.end, 'date', 'required') +
      '</div><label class="field">선행 업무 <span class="optional">선택</span><select name="predecessor"><option value="">없음</option>' +
      p.tasks
        .filter((x) => x.id !== id)
        .map(
          (x) =>
            '<option value="' +
            esc(x.id) +
            '" ' +
            (x.id === t.predecessor ? 'selected' : '') +
            '>' +
            esc(x.name) +
            '</option>',
        )
        .join('') +
      '</select><small>선행 업무가 끝난 다음 근무일에 시작합니다.</small></label><div class="items-title"><strong>세부 작업 체크리스트</strong><span>예상 공수 (h)</span></div><div id="itemEditors">' +
      t.items.map(itemEditor).join('') +
      '</div><button type="button" id="addItem" class="button ghost add-item">＋ 세부 작업 추가</button><label class="field">메모 <span class="optional">선택</span><textarea name="memo" rows="2" maxlength="2000">' +
      esc(t.memo || '') +
      '</textarea></label><p class="form-hint">작업을 실제로 완료했을 때 체크합니다. 세부 작업의 예상 시간이 진척률의 가중치가 됩니다.</p>';
  }

  return { title, body };
}
export function applyEditor(
  p,
  editor,
  f,
  items = [],
  { currentDate = today(), uid = () => crypto.randomUUID() } = {},
) {
  const value = (n) => String(f.get(n) || '').trim();
  let target = structuredClone(p),
    message = '저장했습니다.',
    created = false;
  if (editor.type === 'project' || editor.type === 'settings') {
    const holidays = [
      ...new Set(
        value('holidays')
          .split(/[\s,]+/)
          .filter(Boolean),
      ),
    ];
    if (holidays.some((d) => !validDate(d)))
      throw Error('휴무일을 YYYY-MM-DD 형식으로 입력해 주세요.');
    if (editor.type === 'project') {
      target = {
        id: uid(),
        name: value('name'),
        description: value('description'),
        demo: false,
        createdAt: currentDate,
        holidays,
        members: [],
        tasks: [],
      };
      validateProject(target);
      created = true;
      message = '새 프로젝트를 만들었습니다. 참여인력부터 추가해 보세요.';
    } else {
      target.name = value('name');
      target.description = value('description');
      target.holidays = holidays;
      validateProject(target);
    }
  } else if (editor.type === 'member') {
    updateMember(target, editor.id, f, uid);
  } else {
    if (!items.length) throw Error('체크할 세부 작업을 한 개 이상 추가해 주세요.');
    const t = {
      ...(editor.id ? target.tasks.find((t) => t.id === editor.id) : {}),
      id: editor.id || uid(),
      name: value('name'),
      owner: value('owner'),
      phase: value('phase'),
      start: value('start'),
      end: value('end'),
      predecessor: value('predecessor'),
      items,
      memo: value('memo'),
    };
    if (editor.id) target.tasks[target.tasks.findIndex((x) => x.id === editor.id)] = t;
    else target.tasks.push(t);
    validateProject(target);
  }

  return { project: target, message, created };
}
export function createProjectEditor({
  project,
  wbs,
  hasStorageError,
  canChange,
  api,
  persist,
  render,
  toast,
  onCreate,
  onReplace,
  reload,
  currentDate = today(),
  document = globalThis.document,
  confirm = globalThis.confirm,
  uid = () => crypto.randomUUID(),
}) {
  const $ = (s) => document.querySelector(s),
    TODAY = currentDate;
  let editor = null;
  function openEditor(type, id = '') {
    if (wbs.dirty) {
      toast('WBS 변경사항을 먼저 저장하거나 취소해 주세요.');
      return;
    }
    if (type === 'project' && hasStorageError()) {
      toast('현재 변경사항을 먼저 백업하거나 저장해 주세요.');
      return;
    }
    if (type !== 'project' && project()?._role === 'viewer') {
      toast('조회자는 프로젝트를 수정할 수 없습니다.');
      return;
    }
    editor = { type, id };
    $('#formError').textContent = '';
    $('#deleteButton').hidden = type === 'settings' ? project()?._role !== 'owner' : !id;
    $('#deleteButton').textContent = type === 'settings' ? '프로젝트 삭제' : '삭제';
    $('#submitButton').textContent = type === 'project' ? '프로젝트 만들기' : '저장하기';
    const p = project();
    const form = editorForm(type, p, id, { currentDate: TODAY, uid });
    const body = form.body;
    $('#dialogTitle').textContent = form.title;
    $('#dialogBody').innerHTML = body;
    $('#editorDialog').showModal();
    setTimeout(() => $('#dialogBody input')?.focus(), 50);
  }
  $('#editorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      p = project();
    try {
      const items = [...document.querySelectorAll('.item-editor')].map((row) => ({
        id: row.dataset.itemId,
        title: row.querySelector('[name=itemTitle]').value.trim(),
        hours: Number(row.querySelector('[name=itemHours]').value),
        doneDate: row.dataset.doneDate || null,
      }));
      const {
        project: target,
        created,
        message,
      } = applyEditor(p, editor, f, items, { uid, currentDate: TODAY });
      if (created) onCreate(target);
      else onReplace(target);
      const saved = await persist();
      $('#editorDialog').close();
      render();
      toast(saved ? message : '변경했지만 서버 저장에 실패했습니다. 백업을 내려받으세요.');
    } catch (error) {
      $('#formError').textContent = error.message;
    }
  });
  $('#deleteButton').addEventListener('click', async () => {
    if (editor.type === 'settings') {
      const p = project();
      if (!canChange()) return;
      if (!confirm('프로젝트를 휴지통으로 이동할까요? 30일 동안 소유자가 복구할 수 있습니다.'))
        return;
      try {
        await api('projects/' + p.id, { method: 'DELETE', body: { revision: p._revision } });
        $('#editorDialog').close();
        await reload();
        toast('휴지통으로 이동했습니다. 파일 메뉴에서 복구할 수 있습니다.');
      } catch (error) {
        $('#formError').textContent = error.message;
      }
      return;
    }
    const p = project();
    if (editor.type === 'member' && p.tasks.some((t) => t.owner === editor.id)) {
      $('#formError').textContent =
        '담당 업무가 있는 인력입니다. 먼저 업무 담당자를 변경해 주세요.';
      return;
    }
    if (editor.type === 'task' && p.tasks.some((t) => t.predecessor === editor.id)) {
      $('#formError').textContent =
        '후속 업무가 연결되어 있습니다. 먼저 선행 업무 연결을 해제해 주세요.';
      return;
    }
    if (editor.type === 'task' && p.tasks.some((t) => t.parentId === editor.id)) {
      $('#formError').textContent =
        '하위 업무가 있습니다. 먼저 WBS에서 내어쓰기하거나 하위 업무를 정리해 주세요.';
      return;
    }
    if (
      !confirm(
        editor.type === 'task'
          ? '업무를 휴지통으로 이동할까요? 완료 기록을 포함해 30일 동안 복구할 수 있습니다.'
          : '이 참여인력을 삭제할까요?',
      )
    )
      return;
    if (editor.type === 'member') p.members = p.members.filter((m) => m.id !== editor.id);
    else p.tasks = p.tasks.filter((t) => t.id !== editor.id);
    const saved = await persist();
    $('#editorDialog').close();
    render();
    toast(saved ? '삭제했습니다.' : '서버에 저장하지 못했습니다. 현재 내용을 백업해 주세요.');
  });
  $('#dialogBody').addEventListener('click', (e) => {
    if (e.target.closest('#addItem')) {
      $('#itemEditors').insertAdjacentHTML('beforeend', itemEditor());
      $('#itemEditors').lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('.remove-item')) {
      const row = e.target.closest('.item-editor');
      if (row.dataset.doneDate && !confirm('완료 기록이 있는 세부 작업을 삭제할까요?')) return;
      row.remove();
    }
  });

  $('#closeDialog').onclick = $('#cancelDialog').onclick = () => $('#editorDialog').close();

  return { open: openEditor };
}
