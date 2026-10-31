import './mobile.css';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { escapeHtml as esc } from '../../shared/browser/html.js';
import { setLanguage } from '../../shared/browser/i18n.js';
import { today, summary, progress } from '../../shared/browser/engine.js';
import {
  setBusinessTimeZone,
  getBusinessTimeZone,
  validateTimeZone,
} from '../../shared/browser/business-clock.js';
import { editorForm, applyEditor, itemEditor } from '../../shared/browser/project-editor.js';
import { csvText, wbsRows } from '../../shared/browser/reports.js';
import { icon, pct, num } from '../../shared/browser/view-ui.js';
import { ProjectStore } from './storage.mjs';
import {
  normalizeProject,
  parseProject,
  serializeProject,
  toggleItem,
  deleteEntity,
  MAX_BYTES,
} from './model.mjs';
import { shareFile } from './platform.js';
import { uid } from './id.mjs';
import { privacyContent } from './privacy.js';

setLanguage('ko');
try {
  setBusinessTimeZone(localStorage.getItem('pmcanvas.mobile.timezone') || 'Asia/Seoul');
} catch {}
const $ = (selector) => document.querySelector(selector);
const store = new ProjectStore();
let records = [],
  record = null,
  view = 'projects',
  editing = null,
  busy = false;
let query = '',
  owner = '',
  onlyOpen = true,
  completionDate = today(),
  lastDay = today();
let undo = [],
  redo = [],
  toastTimer,
  returnFocus = null;
const titles = {
  overview: '프로젝트 현황',
  tasks: '업무 · 일정',
  daily: '완료 체크',
  more: '프로젝트 관리',
};
const tabs = [
  ['overview', '현황', 'dashboard'],
  ['tasks', '업무', 'layers'],
  ['daily', '완료 체크', 'check'],
  ['more', '더보기', 'more'],
];

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 5000);
}
function errorText(error) {
  return error?.message || '작업하지 못했습니다. 다시 시도해 주세요.';
}
async function run(action) {
  if (busy) return;
  busy = true;
  $('#content').setAttribute('aria-busy', 'true');
  const controls = [
    ...document.querySelectorAll('button:not(:disabled), input[type="checkbox"]:not(:disabled)'),
  ];
  controls.forEach((element) => {
    element.disabled = true;
  });
  try {
    await action();
  } catch (error) {
    toast(errorText(error));
  } finally {
    busy = false;
    $('#content').setAttribute('aria-busy', 'false');
    controls.forEach((element) => {
      if (element.isConnected) element.disabled = false;
    });
  }
}
function button(label, action, style = '', extra = '') {
  return `<button class="button ${style}" data-action="${action}" ${extra}>${label}</button>`;
}
function empty(title, text, action = '') {
  return `<section class="empty-state">${icon('layers')}<h2>${title}</h2><p>${text}</p>${action}</section>`;
}
function meter(value) {
  return `<div class="meter" role="meter" aria-label="진척률" aria-valuenow="${Math.round(value * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${value * 100}%"></span></div>`;
}
function status(task) {
  return progress(task, today()) === 1
    ? ['done', '완료']
    : task.end < today()
      ? ['late', '지연']
      : progress(task, today()) > 0
        ? ['active', '진행 중']
        : ['active', '예정'];
}
function filtered(project) {
  return project.tasks.filter(
    (task) =>
      (!query || task.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (!owner || task.owner === owner),
  );
}
function taskCard(project, task, daily = false) {
  const [style, label] = status(task);
  const member = project.members.find((member) => member.id === task.owner);
  const items = daily ? task.items.filter((item) => !onlyOpen || !item.doneDate) : [];
  return `<article class="task-card"><div class="card-top"><span class="phase">${esc(task.phase || '일반')}</span><span class="badge ${style}">${label}</span></div>
    <button class="task-title" data-action="edit-task" data-id="${esc(task.id)}">${esc(task.name)}</button>
    <p class="task-meta">${icon('users')}${esc(member?.name || '미지정')}<span>·</span>${task.start.slice(5)} – ${task.end.slice(5)}</p>
    ${daily ? `<div class="checklist">${items.map((item) => `<label class="check-row"><input type="checkbox" data-task="${esc(task.id)}" data-item="${esc(item.id)}" ${item.doneDate ? 'checked' : ''}><span>${esc(item.title)}${item.doneDate ? `<small>완료 ${item.doneDate}</small>` : ''}</span><small>${num(item.hours)}h</small></label>`).join('') || '<p class="muted">모든 세부 작업을 완료했습니다.</p>'}</div>` : `<div class="progress-line">${meter(progress(task, today()))}<strong>${pct(progress(task, today()))}</strong></div>`}
  </article>`;
}
function projectList() {
  return `<section class="page-heading"><div><span class="eyebrow">YOUR WORKSPACE</span><h1>나의 프로젝트</h1><p>한 번의 체크로, 오늘의 진척을 기록하세요.</p></div></section>
    <div class="project-actions">${button('＋ 새 프로젝트', 'new', 'primary')}${button(icon('upload') + ' 가져오기', 'import')}</div>
    ${
      records.length
        ? `<div class="project-list">${records
            .map((entry, index) => {
              try {
                const p = normalizeProject(entry.project),
                  s = summary(p, today());
                return `<button class="project-card" data-action="open" data-index="${index}"><span class="project-monogram">${esc(p.name.slice(0, 1))}</span><span class="project-card-body"><strong>${esc(p.name)}</strong><small>업무 ${p.tasks.length}개 · 참여인력 ${p.members.length}명</small>${meter(s.progress)}<span class="project-card-foot"><span>진척률 ${pct(s.progress)}</span><span>${s.overdue ? `지연 ${s.overdue}건` : '기기에 저장됨'}</span></span></span>${icon('arrow')}</button>`;
              } catch {
                return '<article class="task-card"><h2>읽을 수 없는 프로젝트</h2><p>저장된 원본은 보존했습니다. 백업 파일을 가져와 복구해 주세요.</p></article>';
              }
            })
            .join('')}</div>`
        : empty(
            '첫 프로젝트를 시작하세요',
            '업무와 일정을 등록하고, 완료한 작업을 바로 체크하세요. 인터넷 연결 없이 사용할 수 있습니다.',
          )
    }
    <aside class="storage-note">${icon('check')}<div><strong>내 기기 안의 작은 작업실</strong><p>변경 내용은 이 기기에 자동 저장됩니다. 더보기에서 파일을 내보내 다른 기기로 옮길 수 있습니다.</p></div></aside>
    <p class="privacy-note">${button('개인정보처리방침', 'privacy', 'ghost')}</p>`;
}
function overview(p) {
  const s = summary(p, today());
  return `<section class="hero"><span class="eyebrow">PROJECT PULSE</span><div class="hero-progress"><strong>${pct(s.progress)}</strong><span>전체 진척률</span></div>${meter(s.progress)}<div class="hero-foot"><span>계획 ${pct(s.planned)}</span><span>${num(s.done)} / ${num(s.total)}h 완료</span></div></section>
    <div class="metric-grid"><article><span>완료 업무</span><strong>${s.completed}<small> / ${p.tasks.length}</small></strong></article><article><span>지연 업무</span><strong class="${s.overdue ? 'late-text' : ''}">${s.overdue}<small>건</small></strong></article></div>
    <section class="forecast-card">${icon('calendar')}<div><span>예상 완료일</span><strong>${s.forecast.end || '업무를 등록해 주세요'}</strong><small>${s.forecast.observed ? '최근 완료 속도를 반영했습니다.' : '현재 계획과 공수를 기준으로 계산합니다.'}</small></div></section>
    <div class="section-heading"><h2>다가오는 업무</h2><a href="#tasks/${esc(p.id)}">모두 보기 →</a></div>
    ${
      p.tasks.length
        ? `<div class="task-list">${
            p.tasks
              .filter((task) => progress(task, today()) < 1)
              .sort((a, b) => a.end.localeCompare(b.end))
              .slice(0, 4)
              .map((task) => taskCard(p, task))
              .join('') || '<p class="notice">모든 업무를 완료했습니다.</p>'
          }</div>`
        : empty(
            '첫 업무를 등록해 보세요',
            '담당자와 일정, 체크할 세부 작업을 추가합니다.',
            button('＋ 업무 추가', 'add-task', 'primary'),
          )
    }`;
}
function filters(p) {
  return `<div class="filters"><label class="search-box">${icon('layers')}<input id="search" type="search" placeholder="업무 검색" aria-label="업무 검색" value="${esc(query)}"></label><select id="owner" aria-label="담당자 필터"><option value="">전체 담당자</option>${p.members.map((m) => `<option value="${esc(m.id)}" ${owner === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>`;
}
function tasks(p, daily) {
  return `${daily ? `<div class="notice">완료한 세부 작업을 체크하면 진척률이 바뀝니다.</div><div class="daily-options"><label>완료일<input type="date" id="completionDate" aria-label="완료일" value="${esc(completionDate)}" max="${today()}" required></label><label class="switch-label"><input id="onlyOpen" type="checkbox" ${onlyOpen ? 'checked' : ''}>할 일만</label></div>` : `<div class="section-heading"><p>전체 업무 ${p.tasks.length}개</p>${button('＋ 업무 추가', 'add-task', 'primary')}</div>`}${filters(p)}<div id="taskList" class="task-list">${taskList(p, daily)}</div>`;
}
function taskList(p, daily) {
  const tasks = filtered(p).filter(
    (task) => !daily || !onlyOpen || task.items.some((item) => !item.doneDate),
  );
  if (!p.tasks.length)
    return empty(
      '등록된 업무가 없습니다',
      '작은 업무부터 하나씩 계획해 보세요.',
      button('＋ 업무 추가', 'add-task', 'primary'),
    );
  return (
    tasks.map((task) => taskCard(p, task, daily)).join('') ||
    empty(
      daily ? '표시할 할 일이 없습니다' : '검색 결과가 없습니다',
      daily
        ? '필터를 바꾸거나 할 일만 옵션을 꺼 완료 기록을 확인하세요.'
        : '다른 검색어나 담당자를 선택해 보세요.',
    )
  );
}
function more(p) {
  return `<section class="settings-card"><h2>프로젝트</h2><p>${esc(p.description || '이 프로젝트의 일정과 참여인력을 관리하세요.')}</p>${button('프로젝트 설정', 'settings')}
    <div class="history-actions">${button('↶ 실행 취소', 'undo', '', undo.length ? '' : 'disabled')}${button('↷ 다시 실행', 'redo', '', redo.length ? '' : 'disabled')}</div></section>
    <section class="settings-card"><div class="section-heading"><h2>참여인력 <span>${p.members.length}</span></h2>${button('＋ 추가', 'add-member')}</div><div class="member-list">${p.members.map((m) => `<button class="member-row" data-action="edit-member" data-id="${esc(m.id)}"><span class="member-avatar">${esc(m.name.slice(-2))}</span><span><strong>${esc(m.name)}</strong><small>${esc(m.role || '참여인력')} · ${num(m.hours)}h / 일 · ${m.allocation}%</small></span><span aria-hidden="true">›</span></button>`).join('') || '<p class="muted">함께할 사람을 추가해 보세요.</p>'}</div></section>
    <section class="settings-card"><h2>파일 · 보고서</h2><p>프로젝트 파일은 웹과 데스크톱에서도 가져올 수 있습니다.</p><div class="stack-actions">${button(icon('download') + ' 프로젝트 내보내기', 'export')}${button(icon('download') + ' 업무 보고서 CSV', 'csv')}${button(icon('upload') + ' 프로젝트 가져오기', 'import')}</div></section>
    <section class="settings-card"><h2>업무 기준 시간대</h2><p>${esc(getBusinessTimeZone())} 기준으로 오늘과 완료일을 계산합니다.</p>${button('시간대 변경', 'timezone')}</section>
    <p class="privacy-note">PM Canvas Mobile 0.1.0 · 기기에 자동 저장<br>계정이나 서버 연결 없이 동작합니다. 앱을 삭제하면 기기의 프로젝트도 삭제될 수 있으므로 파일을 내보내 보관하세요.</p>
    <p class="privacy-note">${button('개인정보처리방침', 'privacy', 'ghost')}</p>
    <div class="delete-project">${button('이 프로젝트 삭제', 'delete-project', 'danger ghost')}</div>`;
}
function render() {
  const p = record?.project;
  $('#navigation').hidden = !p || view === 'projects';
  $('#navigation').innerHTML = p
    ? tabs
        .map(
          ([key, label, glyph]) =>
            `<a href="#${key}/${esc(p.id)}" ${key === view ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`,
        )
        .join('')
    : '';
  $('#content').classList.toggle('with-navigation', Boolean(p && view !== 'projects'));
  if (!p || view === 'projects') {
    $('#content').innerHTML = projectList();
    return;
  }
  $('#content').innerHTML =
    `<section class="project-heading"><a class="back-link" href="#projects">← 프로젝트</a><div class="project-heading-line"><div><span class="eyebrow">${titles[view]}</span><h1>${esc(p.name)}</h1></div><span class="saved-label" role="status">저장됨</span></div><p class="date-caption">${today()} · ${esc(getBusinessTimeZone())}</p></section>${view === 'overview' ? overview(p) : view === 'tasks' ? tasks(p, false) : view === 'daily' ? tasks(p, true) : more(p)}`;
}
async function route() {
  if (editing || $('#confirmation').open) {
    history.replaceState(
      null,
      '',
      `#${view}${record && view !== 'projects' ? '/' + record.id : ''}`,
    );
    return;
  }
  const [requested, id] = location.hash.slice(1).split('/');
  records = await store.list();
  const next = records.find((entry) => entry.id === id);
  if (next && Object.hasOwn(titles, requested)) {
    const changed = record?.id !== next.id || record?.revision !== next.revision;
    record = { ...next, project: normalizeProject(next.project) };
    if (changed) {
      undo = [];
      redo = [];
      query = '';
      owner = '';
    }
    view = requested;
  } else {
    view = 'projects';
    record = null;
    undo = [];
    redo = [];
  }
  render();
  $('#content').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function navigate(next, id = record?.id) {
  location.hash = next + (id ? '/' + id : '');
}
function trimHistory(stack) {
  while (stack.length > 20 || JSON.stringify(stack).length > 8 * 1024 * 1024) stack.shift();
}
async function save(project, history = true) {
  const previous = record?.project;
  const saved = await store.save(project, record?.id === project.id ? record.revision : 0);
  if (history && previous?.id === project.id) {
    undo.push(previous);
    trimHistory(undo);
    redo = [];
  }
  record = saved;
  records = records.filter((entry) => entry.id !== saved.id);
  records.unshift(saved);
  render();
}
function openEditor(type, id = '') {
  editing = { type, id };
  returnFocus = document.activeElement;
  const form = editorForm(type, record?.project || { members: [], tasks: [] }, id, { uid });
  $('#editorTitle').textContent = form.title;
  $('#editorBody').innerHTML = form.body;
  $('#formError').textContent = '';
  $('#deleteItem').hidden = !id || !['task', 'member'].includes(type);
  $('#editor').showModal();
  // Native WebViews respect the user's keyboard gesture on the triggering click.
  $('#editorBody').querySelector('input,textarea,select')?.focus();
}
function closeEditor() {
  editing = null;
  $('#editor').close();
}
$('#editor').addEventListener('close', () => {
  editing = null;
  if (returnFocus?.isConnected) returnFocus.focus();
});
$('#editor').addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});
$('#closeEditor').onclick = $('#cancelEditor').onclick = () => {
  if (!busy) closeEditor();
};
$('#editorBody').addEventListener('click', (event) => {
  if (event.target.closest('#addItem')) {
    if ($('#itemEditors').children.length >= 200)
      return toast('세부 작업은 200개까지 추가할 수 있습니다.');
    $('#itemEditors').insertAdjacentHTML(
      'beforeend',
      itemEditor({ id: uid(), title: '', hours: 4, doneDate: null }),
    );
    $('#itemEditors').lastElementChild.querySelector('input').focus();
  }
  event.target.closest('.remove-item')?.closest('.item-editor').remove();
});
$('#editorForm').addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    try {
      if (editing.type === 'timezone') {
        const zone = new FormData(event.target).get('timeZone').trim();
        const validated = validateTimeZone(zone);
        const previous = getBusinessTimeZone();
        try {
          setBusinessTimeZone(validated);
          for (const entry of await store.list()) normalizeProject(entry.project);
          localStorage.setItem('pmcanvas.mobile.timezone', validated);
        } catch (error) {
          setBusinessTimeZone(previous);
          throw Error(
            '시간대를 변경하지 못했습니다. 완료 기록이 새 시간대의 오늘보다 늦지 않은지, 기기에 설정을 저장할 수 있는지 확인해 주세요.',
            { cause: error },
          );
        }
        lastDay = today();
        completionDate = today();
        closeEditor();
        render();
        return;
      }
      const items = [...document.querySelectorAll('.item-editor')].map((row) => ({
        id: row.dataset.itemId,
        title: row.querySelector('[name="itemTitle"]').value.trim(),
        hours: Number(row.querySelector('[name="itemHours"]').value),
        doneDate: row.dataset.doneDate || null,
      }));
      const result = applyEditor(
        record?.project || {},
        editing,
        new FormData(event.target),
        items,
        { uid },
      );
      await save(result.project);
      closeEditor();
      if (result.created) navigate('overview', result.project.id);
      toast(result.message);
    } catch (error) {
      $('#formError').textContent = errorText(error);
    }
  });
});
async function confirmDelete(message) {
  $('#confirmText').textContent = message;
  $('#confirmation').returnValue = 'cancel';
  $('#confirmation').showModal();
  return new Promise((resolve) =>
    $('#confirmation').addEventListener(
      'close',
      () => resolve($('#confirmation').returnValue === 'delete'),
      { once: true },
    ),
  );
}
$('#deleteItem').onclick = async () => {
  if (!editing || busy) return;
  if (
    !(await confirmDelete(
      editing.type === 'member'
        ? '참여인력을 삭제하면 담당 업무가 미지정으로 바뀝니다.'
        : '업무와 세부 작업을 삭제합니다. 하위 업무는 유지하고 선행 연결은 해제합니다.',
    ))
  )
    return;
  run(async () => {
    await save(deleteEntity(record.project, editing.type, editing.id));
    closeEditor();
    toast('삭제했습니다. 더보기에서 실행 취소할 수 있습니다.');
  });
};
document.addEventListener('click', (event) => {
  if (busy && event.target.closest('a[href^="#"]')) {
    event.preventDefault();
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || busy || editing) return;
  const action = target.dataset.action;
  if (action === 'privacy') {
    $('#privacyBody').innerHTML = privacyContent;
    $('#privacyDialog').showModal();
    return;
  }
  if (action === 'new') return openEditor('project');
  if (action === 'open') return navigate('overview', records[Number(target.dataset.index)].id);
  if (action === 'import') return $('#importFile').click();
  if (action === 'add-task' || action === 'edit-task') return openEditor('task', target.dataset.id);
  if (action === 'add-member' || action === 'edit-member')
    return openEditor('member', target.dataset.id);
  if (action === 'settings') return openEditor('settings');
  if (action === 'timezone') {
    returnFocus = target;
    editing = { type: 'timezone' };
    $('#editorTitle').textContent = '업무 기준 시간대';
    $('#editorBody').innerHTML =
      `<label class="field">IANA Time Zone<input name="timeZone" value="${esc(getBusinessTimeZone())}" required maxlength="100" placeholder="Asia/Seoul"></label><p class="form-hint">예: Asia/Seoul, America/New_York, UTC. 저장된 일정은 바뀌지 않습니다.</p>`;
    $('#formError').textContent = '';
    $('#deleteItem').hidden = true;
    $('#editor').showModal();
    return;
  }
  if (action === 'delete-project') {
    confirmDelete('이 기기에 저장된 프로젝트를 삭제합니다. 필요한 파일을 먼저 내보내 주세요.').then(
      (confirmed) => {
        if (confirmed)
          run(async () => {
            await store.remove(record.id);
            navigate('projects', '');
          });
      },
    );
    return;
  }
  run(async () => {
    if (action === 'undo' || action === 'redo') {
      const source = action === 'undo' ? undo : redo,
        destination = action === 'undo' ? redo : undo;
      if (!source.length) return;
      const previous = record.project;
      await save(source.at(-1), false);
      source.pop();
      destination.push(previous);
      trimHistory(destination);
      render();
    } else if (action === 'export') {
      await shareFile(record.project.name + '.pmcanvas', serializeProject(record.project));
    } else if (action === 'csv') {
      const p = record.project;
      await shareFile(
        p.name + '-' + today() + '.csv',
        csvText(wbsRows(p, today(), summary(p, today()).forecast)),
        'text/csv;charset=utf-8',
      );
    } else if (action === 'retry') await route();
  });
});
document.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  $('#taskList').innerHTML = taskList(record.project, view === 'daily');
});
document.addEventListener('change', (event) => {
  const element = event.target;
  if (element.id === 'owner') {
    owner = element.value;
    $('#taskList').innerHTML = taskList(record.project, view === 'daily');
  }
  if (element.id === 'onlyOpen') {
    onlyOpen = element.checked;
    $('#taskList').innerHTML = taskList(record.project, true);
  }
  if (element.id === 'completionDate') completionDate = element.value;
  if (element.dataset.item) {
    if (busy) {
      element.checked = !element.checked;
      return;
    }
    run(async () => {
      try {
        await save(
          toggleItem(record.project, element.dataset.task, element.dataset.item, completionDate),
        );
      } catch (error) {
        element.checked = !element.checked;
        throw error;
      }
    });
  }
});
$('#importFile').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  run(async () => {
    if (file.size > MAX_BYTES) throw Error('8MB 이하의 프로젝트 파일을 선택해 주세요.');
    const project = parseProject(await file.text());
    // Every import creates a copy; it can never overwrite the current project's changes.
    project.id = uid();
    await save(project, false);
    undo = [];
    redo = [];
    navigate('overview', project.id);
    toast('프로젝트를 새 사본으로 가져왔습니다.');
  });
});
function refreshDate() {
  if (
    today() !== lastDay &&
    !editing &&
    !$('#confirmation').open &&
    !busy &&
    !document.activeElement?.matches('input,textarea,select')
  ) {
    lastDay = today();
    completionDate = today();
    render();
  }
}
window.addEventListener('hashchange', () => {
  run(route);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDate();
});
window.addEventListener('focus', refreshDate);
$('#closePrivacy').onclick = () => $('#privacyDialog').close();
setInterval(refreshDate, 60000);
if (Capacitor.isNativePlatform()) {
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) refreshDate();
  }).catch((error) => toast(errorText(error)));
  App.addListener('backButton', () => {
    if (busy) return;
    if ($('#privacyDialog').open) return $('#privacyDialog').close();
    if ($('#confirmation').open) return $('#confirmation').close('cancel');
    if ($('#editor').open) return closeEditor();
    if (view !== 'projects') navigate('projects', '');
    else App.minimizeApp();
  }).catch((error) => toast(errorText(error)));
}
try {
  await route();
  navigator.storage?.persist?.().catch(() => {});
} catch (error) {
  $('#content').innerHTML = empty(
    '저장소를 열지 못했습니다',
    '기기의 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요.',
    button('다시 시도', 'retry', 'primary'),
  );
  toast(errorText(error));
}
