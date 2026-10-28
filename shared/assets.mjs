export const browserFiles = Object.freeze([
  'engine.js',
  'business-clock.js',
  'planning.js',
  'html.js',
  'i18n.js',
  'locales/en.js',
  'locales/desktop-en.js',
  'view-ui.js',
  'people-view.js',
  'project-editor.js',
  'reports.js',
  'wbs-model.js',
  'report-clock.js',
  'excel-import-model.js',
  'styles.css',
]);
export function browserAsset(file) {
  return browserFiles.includes(file) ? new URL('./browser/' + file, import.meta.url) : null;
}
