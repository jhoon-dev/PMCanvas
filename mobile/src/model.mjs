import { cleanProject } from '../../shared/model/project.mjs';
import { today, validDate } from '../../shared/browser/engine.js';
import { uid } from './id.mjs';

export const MAX_BYTES = 8 * 1024 * 1024;
const byteLength = (text) => new TextEncoder().encode(text).length;

export function normalizeProject(input) {
  if (
    input?._wbsPendingCells !== undefined &&
    (!Array.isArray(input._wbsPendingCells) || input._wbsPendingCells.length)
  )
    throw Error('웹에서 미확정 WBS 입력을 저장한 뒤 다시 내보내 주세요.');
  const project = cleanProject(input);
  const id =
    typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.id) ? input.id : uid();
  const result = { id, ...project };
  if (byteLength(JSON.stringify(result)) > MAX_BYTES)
    throw Error('프로젝트는 8MB까지 저장할 수 있습니다.');
  return result;
}

export function parseProject(text) {
  if (byteLength(text) > MAX_BYTES) throw Error('8MB 이하의 프로젝트 파일을 선택해 주세요.');
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw Error('JSON 파일을 읽을 수 없습니다. 원본 파일을 확인해 주세요.');
  }
  if (value?.format === 'pm-canvas-project' && value.version === 1)
    return normalizeProject(value.project);
  // Web JSON exports contain a bare project. Reject unknown versioned envelopes.
  if (value?.format !== undefined || value?.version !== undefined)
    throw Error('지원하지 않는 PM Canvas 프로젝트 파일 버전입니다.');
  return normalizeProject(value);
}

export function serializeProject(project) {
  const text = JSON.stringify(
    {
      format: 'pm-canvas-project',
      version: 1,
      exportedAt: new Date().toISOString(),
      project: normalizeProject(project),
    },
    null,
    2,
  );
  if (byteLength(text) > MAX_BYTES) throw Error('프로젝트 파일은 8MB까지 내보낼 수 있습니다.');
  return text;
}

export function toggleItem(project, taskId, itemId, date = today()) {
  const next = structuredClone(project);
  const item = next.tasks.find((task) => task.id === taskId)?.items.find((i) => i.id === itemId);
  if (!item) throw Error('세부 작업을 찾을 수 없습니다.');
  if (!validDate(date) || date > today()) throw Error('완료일은 오늘까지 선택할 수 있습니다.');
  item.doneDate = item.doneDate ? null : date;
  return normalizeProject(next);
}

export function deleteEntity(project, type, id) {
  const next = structuredClone(project);
  if (type === 'member') {
    next.members = next.members.filter((member) => member.id !== id);
    for (const task of next.tasks) if (task.owner === id) task.owner = '';
  } else if (type === 'task') {
    const removed = next.tasks.find((task) => task.id === id);
    if (!removed) throw Error('업무를 찾을 수 없습니다.');
    next.tasks = next.tasks.filter((task) => task.id !== id);
    for (const task of next.tasks) {
      if (task.predecessor === id) task.predecessor = '';
      if (task.parentId === id) {
        if (removed.parentId) task.parentId = removed.parentId;
        else delete task.parentId;
      }
    }
  } else throw Error('삭제할 항목을 확인해 주세요.');
  return normalizeProject(next);
}
