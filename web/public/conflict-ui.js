import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';
import { mergeProject, resolvedProject } from './project-merge.js';

const labels = {
  name: ui('이름'),
  description: ui('설명'),
  start: ui('시작일'),
  end: ui('종료일'),
  owner: ui('담당자'),
  phase: ui('단계'),
  predecessor: ui('선행 업무'),
  parentId: ui('상위 업무'),
  memo: ui('메모'),
  title: ui('세부 작업'),
  hours: ui('공수'),
  doneDate: ui('완료일'),
  holidays: ui('휴무일'),
  allocation: ui('투입률'),
  dailyHours: ui('근무시간'),
  $order: ui('순서'),
  tasks: ui('업무'),
  members: ui('참여인력'),
  items: ui('세부 작업'),
};
function display(value) {
  if (value === undefined) return ui('삭제됨');
  if (value === null || value === '') return ui('비어 있음');
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
export function conflictBody(base, mine, latest) {
  const result = mergeProject(base, mine, latest);
  return (
    ui(
      '<p>다른 사용자가 먼저 저장했습니다. 서로 다른 항목의 변경은 합치고, 같은 항목은 유지할 값을 선택하세요. 적용 후 WBS에서 확인하고 저장합니다.</p><form id="conflictForm">',
    ) +
    (result.conflicts.length
      ? result.conflicts
          .map((c, i) => {
            const task =
              mine.tasks.find((t) => c.path.includes(t.id)) ||
              latest.tasks.find((t) => c.path.includes(t.id));
            return (
              '<fieldset class="merge-field"><legend>' +
              esc(task?.name || ui('프로젝트')) +
              ' · ' +
              esc(labels[c.path.at(-1)] || c.path.at(-1)) +
              '</legend>' +
              ['mine', 'server']
                .map(
                  (side) =>
                    '<label class="merge-choice"><input type="radio" name="choice-' +
                    i +
                    '" value="' +
                    side +
                    '" required><strong>' +
                    (side === 'mine' ? ui('내 변경') : ui('서버 변경')) +
                    '</strong><pre>' +
                    esc(display(c[side])) +
                    '</pre></label>',
                )
                .join('') +
              '</fieldset>'
            );
          })
          .join('')
      : ui(
          '<p class="notice">같은 항목의 충돌은 없습니다. 양쪽 변경을 함께 보존할 수 있습니다.</p>',
        )) +
    ui(
      '<p class="form-error" role="alert" id="mergeError"></p><div class="dialog-actions"><button type="button" class="button" id="cancelMerge">초안 유지하고 닫기</button><button class="button primary">선택 적용</button></div></form>',
    )
  );
}
export function openConflict(base, mine, latest) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'merge-dialog';
    dialog.setAttribute('aria-labelledby', 'mergeTitle');
    dialog.innerHTML =
      ui('<h2 id="mergeTitle">변경사항 비교</h2>') + conflictBody(base, mine, latest);
    document.body.append(dialog);
    let result = null;
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        resolve(result);
      },
      { once: true },
    );
    dialog.querySelector('#cancelMerge').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      try {
        const choices = {},
          data = new FormData(e.target);
        mergeProject(base, mine, latest).conflicts.forEach(
          (c, i) => (choices[c.key] = data.get('choice-' + i)),
        );
        result = { latest, project: resolvedProject(base, mine, latest, choices) };
        dialog.close();
      } catch (error) {
        dialog.querySelector('#mergeError').textContent = ui(error.message);
      }
    };
    dialog.showModal();
  });
}
