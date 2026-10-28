const allowed = new Set([
  'index.html',
  'renderer.js',
  'excel-ui.js',
  'planning-ui.js',
  'bulk-ui.js',
  'desktop.css',
  'shared/engine.js',
  'shared/business-clock.js',
  'shared/planning.js',
  'shared/html.js',
  'shared/i18n.js',
  'shared/locales/en.js',
  'shared/locales/desktop-en.js',
  'shared/view-ui.js',
  'shared/people-view.js',
  'shared/project-editor.js',
  'shared/reports.js',
  'shared/wbs-model.js',
  'shared/report-clock.js',
  'shared/excel-import-model.js',
  'shared/styles.css',
]);
export const APP_URL = 'pmcanvas://desktop/index.html';
export function assetPath(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== 'pmcanvas:' ||
    url.hostname !== 'desktop' ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname).slice(1);
  } catch {
    return null;
  }
  return allowed.has(pathname) ? pathname : null;
}
