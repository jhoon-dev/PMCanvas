import { performance } from 'node:perf_hooks';
import { WbsView } from '../public/wbs-view.js';
import { editCell, moveSchedule } from '../public/wbs-model.js';
import { largeProject, hierarchyProject } from '../test/support/large-project.mjs';
import { forecast } from '../public/engine.js';
import { rollups } from '../public/planning.js';
const p = largeProject(),
  at = '2026-10-26',
  view = new WbsView({});
const measure = (name, fn) => {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return [name, Number(times[2].toFixed(2))];
};
view.render(p, at);
const nested = hierarchyProject();
forecast(nested, '2026-11-01');
rollups(nested, '2026-11-01');
console.log(
  JSON.stringify(
    {
      tasks: p.tasks.length,
      node: process.version,
      medianMs: Object.fromEntries([
        measure('forecast50Summaries200Tasks', () => forecast(nested, '2026-11-01')),
        measure('rollups50Summaries200Tasks', () => rollups(nested, '2026-11-01')),
        measure('render500', () => view.render(p, at)),
        measure('filter500', () => {
          view.query = 'Task 499';
          view.inner();
          view.query = '';
        }),
        measure('edit500', () => editCell(p, 't499', 'name', 'Edited task')),
        measure('ganttMove500', () => moveSchedule(p, ['t499'], 1, { mode: 'move' })),
      ]),
    },
    null,
    2,
  ),
);
