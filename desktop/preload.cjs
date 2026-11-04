const { contextBridge, ipcRenderer } = require('electron');
const call = (name, ...args) =>
  ipcRenderer.invoke('desktop:' + name, ...args).then((result) => {
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    snapshot: () => call('snapshot'),
    dialogsReady: () => call('dialogsReady'),
    respondDialog: (id, response) => call('dialogResponse', id, response),
    onDialog: (callback) => {
      ipcRenderer.on('desktop:dialog', (_event, request) => callback(request));
    },
    setLanguage: (language) => call('language', language),
    settings: () => call('settings'),
    navigationContext: (value) => call('navigationContext', value),
    holidayState: () => call('holidayState'),
    refreshHolidays: (force = true) => call('refreshHolidays', force),
    setHolidayPreference: (enabled) => call('holidayPreference', enabled),
    onHolidayCalendar: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('desktop:holidayCalendar', listener);
      return () => ipcRenderer.removeListener('desktop:holidayCalendar', listener);
    },
    setTimeZone: (value) => call('timeZone', value),
    info: () => call('info'),
    checkUpdates: () => call('updates'),
    updateState: () => call('updateState'),
    setUpdatePreference: (enabled) => call('updatePreference', enabled),
    downloadUpdate: () => call('downloadUpdate'),
    applyUpdate: () => call('applyUpdate'),
    openRelease: () => call('openRelease'),
    openPrivacyPolicy: () => call('privacyPolicy'),
    replace: (project, revision) => call('replace', project, revision),
    undo: (revision) => call('undo', revision),
    redo: (revision) => call('redo', revision),
    newProject: (project) => call('new', project),
    open: () => call('open'),
    closeProject: (id) => call('close', id),
    activateTab: (id) => call('activateTab', id),
    save: () => call('save', false),
    saveAs: () => call('save', true),
    exportWeb: () => call('exportWeb'),
    exportReport: (options, revision) => call('exportReport', options, revision),
    openExcel: (revision) => call('openExcel', revision),
    previewExcel: (id, options) => call('previewExcel', id, options),
    applyExcel: (id, revision) => call('applyExcel', id, revision),
    cancelExcel: (id) => call('cancelExcel', id),
    exportTemplate: (revision) => call('exportTemplate', revision),
    editing: (value) => call('editing', value),
    onCommand: (callback) => {
      ipcRenderer.on('desktop:command', (_event, command) => callback(command));
    },
    onDocument: (callback) => {
      ipcRenderer.on('desktop:document', (_event, snapshot) => callback(snapshot));
    },
    onUpdate: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('desktop:update', listener);
      return () => ipcRenderer.removeListener('desktop:update', listener);
    },
  }),
);
