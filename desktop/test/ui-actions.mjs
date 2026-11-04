export async function navigate(page, view) {
  await page.locator('#projectSidebar [data-view="' + view + '"]').click();
}
export async function appSection(page, section, application) {
  if (await page.locator('#settingsPage').isHidden()) {
    if (application) await nativeCommand(application, 'appSettings');
    else await rendererCommand(page, 'appSettings');
    await page.locator('#settingsPage').waitFor();
  }
  await page.locator('[data-app-section="' + section + '"]').click();
}

export async function rendererCommand(page, name) {
  // The renderer rejects commands while a save is pending. Wait for the current
  // mutation before dispatching the next command through the test bridge.
  await page.waitForFunction(
    () => document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
  await page.evaluate((value) => (window.testCommand || window.uxCommand)(value), name);
  await page.waitForFunction(
    () => document.querySelector('#content').getAttribute('aria-busy') !== 'true',
  );
}

export async function answerMessage(page, response, operation) {
  const result = operation();
  await page.locator('#messageDialog[open]').waitFor();
  await page.locator('#messageDialog [data-response="' + response + '"]').click();
  return await result;
}

export const commandIds = {
  new: 'file-new',
  open: 'file-open',
  save: 'file-save',
  saveAs: 'file-save-as',
  closeProject: 'file-close-project',
  projectSettings: 'project-settings',
  exportWeb: 'file-export-json',
  exportExcel: 'file-export-excel',
  importExcel: 'file-import-excel',
  exportTemplate: 'file-export-template',
  undo: 'project-undo',
  redo: 'project-redo',
  appSettings: 'settings-open',
  timeZone: 'settings-open',
  updates: 'help-updates',
  about: 'help-about',
  privacy: 'help-privacy',
};

export async function nativeCommand(application, name) {
  const id = commandIds[name];
  if (!id) throw Error('Unknown native command: ' + name);
  await application.evaluate(
    ({ Menu }, value) => Menu.getApplicationMenu().getMenuItemById(value).click(),
    id,
  );
}
