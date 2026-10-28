import { ui } from './shared/i18n.js';
import { duplicateTasks, removeTasks, reorderTasks } from './shared/wbs-model.js';
import { hierarchy, ordered } from './shared/planning.js';
import { taskHours } from './shared/engine.js';
import { escapeHtml as esc } from './shared/html.js';

export function bulkProposal(project, ids, action, options = {}) {
  const selected = new Set(ids),
    before = new Map(project.tasks.map((task) => [task.id, task]));
  if (!selected.size || [...selected].some((id) => !before.has(id)))
    throw Error(ui('현재 프로젝트의 업무를 선택해 주세요.'));
  let next, title, description, rows;
  if (action === 'duplicate') {
    next = duplicateTasks(project, [...selected], options);
    title = ui('선택 업무 복제');
    description =
      ui('선택한 ') +
      selected.size +
      ui(
        '개 업무를 복제합니다. 복제본은 미완료 업무로 추가하며 선택한 상위·선행 관계는 복제본끼리 연결합니다. 함께 복제할 하위 업무도 선택해 주세요.',
      );
    const copiedTree = hierarchy(next);
    rows = ordered(next)
      .filter((task) => !before.has(task.id))
      .map((task) => [
        copiedTree.get(task.id).number + ' ' + task.name,
        ui('미완료 · ') + taskHours(task) + 'h',
      ]);
  } else if (action === 'remove') {
    next = removeTasks(project, [...selected]);
    title = ui('선택 업무 삭제');
    const promoted = next.tasks.filter((task) => selected.has(before.get(task.id).parentId)).length;
    const detached = next.tasks.filter((task) =>
      selected.has(before.get(task.id).predecessor),
    ).length;
    description =
      ui('선택한 ') +
      selected.size +
      ui('개 업무와 완료 기록을 삭제합니다. 미선택 하위 업무 ') +
      promoted +
      ui('개는 최상위로 이동하고 후속 업무 ') +
      detached +
      ui('개의 선행 연결을 해제합니다. 적용 후 실행 취소할 수 있습니다.');
    rows = ordered(project)
      .filter((task) => selected.has(task.id))
      .map((task) => [
        task.name,
        ui('삭제 · 완료 기록 ') + task.items.filter((item) => item.doneDate).length + ui('개'),
      ]);
  } else if (action === 'up' || action === 'down') {
    next = reorderTasks(project, [...selected], action === 'up' ? -1 : 1);
    title = action === 'up' ? ui('선택 업무 위로 이동') : ui('선택 업무 아래로 이동');
    description = ui(
      '전체 WBS에서 같은 상위 업무 아래의 순서를 조정합니다. 상위 업무와 하위 업무는 묶음으로 이동하며 담당자·일정·완료 기록을 보존합니다.',
    );
    const oldTree = hierarchy(project),
      newTree = hierarchy(next);
    rows = ordered(next)
      .filter((task) => oldTree.get(task.id).number !== newTree.get(task.id).number)
      .map((task) => [
        task.name,
        oldTree.get(task.id).number + ' → ' + newTree.get(task.id).number,
      ]);
  } else throw Error(ui('업무 작업을 확인해 주세요.'));
  if (JSON.stringify(next) === JSON.stringify(project))
    throw Error(ui('현재 위치에서 이동할 수 있는 업무가 없습니다.'));
  return { project: next, title, action, description, rows };
}

export function bulkPreviewHtml(proposal) {
  return (
    '<p class="form-hint">' +
    esc(proposal.description) +
    ui(
      '</p><p class="form-hint">아직 적용하지 않았습니다. 프로젝트 파일에 보관하려면 적용 후 저장하세요.</p>',
    ) +
    ui(
      '<div class="desktop-table-wrap"><table class="desktop-table"><thead><tr><th>업무</th><th>변경 내용</th></tr></thead><tbody>',
    ) +
    proposal.rows
      .map(([name, detail]) => '<tr><td>' + esc(name) + '</td><td>' + esc(detail) + '</td></tr>')
      .join('') +
    '</tbody></table></div>'
  );
}
