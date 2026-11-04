import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';
import { hierarchy, ordered } from './planning.js';

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
