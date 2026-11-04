import { SETTINGS_SECTIONS, PROJECT_VIEWS } from './app/navigation.js';
import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  session,
  utilityProcess,
  shell,
  powerMonitor,
} from 'electron';
import path from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { DesktopWorkspace } from './workspace.mjs';
import { HolidaySync } from './holiday-sync.mjs';
import { setKoreanHolidayUpdates } from './app/shared/korean-holidays.js';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, atomicWrite, serializeDocument, normalizeProject } from './document.mjs';
import { APP_URL, assetPath } from './assets.mjs';
import { buildReport } from './reports.mjs';
import { createExcelJobs } from './excel-jobs.mjs';
import { ExcelImportSession } from './excel-session.mjs';
import { getLanguage, setLanguage, ui, supportedLanguages } from './app/shared/i18n.js';
import { getBusinessTimeZone, setBusinessTimeZone } from './app/shared/business-clock.js';
import { validateProject } from './app/shared/engine.js';
import { UpdateService, StoreUpdateService, MacStoreUpdateService } from './updates.mjs';
import { MacFileAccess } from './mac-file-access.mjs';
import { DesktopPreferences } from './preferences.mjs';
import { AppDialogs } from './dialogs.mjs';
import { UpdateManager } from './update-manager.mjs';
import { cleanupUpdateCache } from './update-cache.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const PRIVACY_POLICY = 'https://github.com/jhoon-dev/PMCanvas/blob/main/desktop/PRIVACY.md';
const testing = !app.isPackaged && process.env.PMCANVAS_DESKTOP_TEST === '1';
// Keep existing recovery, preferences and Chromium storage across the display-name change.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const userData =
    !app.isPackaged && process.env.PMCANVAS_DESKTOP_DATA
      ? path.resolve(process.env.PMCANVAS_DESKTOP_DATA)
      : path.join(app.getPath('appData'), metadata.name);
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pmcanvas',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  let window,
    document,
    editing = false,
    busy = false,
    closing = false;
  const excelJob = createExcelJobs((...args) => utilityProcess.fork(...args));
  let excelImport;
  const updates = process.mas
    ? new MacStoreUpdateService()
    : process.windowsStore
      ? new StoreUpdateService()
      : new UpdateService();
  let fileAccess;
  let updateManager;
  let navigation = { scope: 'projects', view: 'overview', section: 'general' };
  const updateNativeTitle = (snapshot = document?.snapshot()) => {
    if (!window || window.isDestroyed()) return;
    window.setTitle(
      navigation.scope === 'settings'
        ? ui('앱 설정') +
            ' · ' +
            ui(SETTINGS_SECTIONS[navigation.section].title) +
            ' — ' +
            metadata.productName
        : snapshot?.project
          ? (snapshot.dirty ? '● ' : '') +
            snapshot.project.name +
            ' · ' +
            ui(PROJECT_VIEWS[navigation.view]) +
            ' — ' +
            metadata.productName
          : metadata.productName,
    );
  };
  let holidaySync,
    appliedHolidays = [],
    holidayFlushTimer,
    inputCooldownUntil = 0;
  const calendarSnapshot = () =>
    holidaySync
      ? {
          ...holidaySync.snapshot(),
          holidays: appliedHolidays,
          pending: JSON.stringify(holidaySync.holidays) !== JSON.stringify(appliedHolidays),
        }
      : null;
  const updateHistoryMenu = (snapshot = document?.snapshot()) => {
    for (const id of [
      'file-save',
      'file-save-as',
      'file-close-project',
      'project-settings',
      'file-import-excel',
      'file-export',
    ]) {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (item) item.enabled = navigation.scope === 'projects' && !editing;
    }
    for (const id of ['tab-next', 'tab-previous']) {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (item)
        item.enabled = navigation.scope === 'projects' && !editing && document?.tabs.size > 1;
    }
    for (const [id, available] of [
      ['project-undo', snapshot?.canUndo],
      ['project-redo', snapshot?.canRedo],
    ]) {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (item) item.enabled = Boolean(available) && !editing && navigation.scope === 'projects';
    }
  };
  const send = (channel, value) => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  };
  const appDialogs = new AppDialogs((request) => send('desktop:dialog', request));
  const appMessage = (options) => appDialogs.show({ buttons: [ui('확인')], ...options });
  const publish = () => {
    const snapshot = { ...document.snapshot(), holidayCalendar: calendarSnapshot() };
    updateHistoryMenu(snapshot);
    updateNativeTitle(snapshot);
    window.setDocumentEdited(snapshot.dirty);
    send('desktop:document', snapshot);
    return snapshot;
  };
  function flushHolidayCalendar() {
    if (!holidaySync || !document || !window || window.isDestroyed() || closing) return;
    const pending = JSON.stringify(holidaySync.holidays) !== JSON.stringify(appliedHolidays);
    if (
      pending &&
      !busy &&
      !editing &&
      !excelImport?.current &&
      !appDialogs.pending &&
      Date.now() >= inputCooldownUntil
    ) {
      const changed = setKoreanHolidayUpdates(holidaySync.holidays);
      appliedHolidays = structuredClone(holidaySync.holidays);
      if (changed) {
        document.revision++;
        publish();
      }
    }
    send('desktop:holidayCalendar', calendarSnapshot());
  }
  const message = (error) =>
    appMessage({
      type: 'error',
      title: metadata.productName,
      message: ui(error.message || String(error)),
    });
  function assertSender(event) {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== APP_URL
    )
      throw Error(ui('허용되지 않은 요청입니다.'));
  }
  function handle(name, operation, exclusive = true) {
    ipcMain.handle('desktop:' + name, async (event, ...args) => {
      try {
        assertSender(event);
        if (exclusive && busy) throw Error(ui('이전 작업을 마친 뒤 다시 시도해 주세요.'));
        if (exclusive) busy = true;
        try {
          return { ok: true, value: await operation(...args) };
        } finally {
          if (exclusive) busy = false;
          flushHolidayCalendar();
        }
      } catch (error) {
        if (document && window && !window.isDestroyed()) publish();
        return { ok: false, error: error.message || ui('요청을 처리하지 못했습니다.') };
      }
    });
  }
  async function save(as = false) {
    if (editing) throw Error(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
    requireProject();
    let file = as ? null : document.file;
    if (!file) {
      const result = await dialog.showSaveDialog(window, {
        title: ui('프로젝트 저장'),
        defaultPath:
          (document.project.name.replace(/[\\/:*?"<>|]/g, '_') || 'Project') + '.pmcanvas',
        filters: [{ name: ui('PM Canvas 프로젝트'), extensions: ['pmcanvas'] }],
      });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath;
      if (!file.toLowerCase().endsWith('.pmcanvas')) file += '.pmcanvas';
    }
    return fileAccess.write(
      file,
      () => {
        document.save(file);
        return publish();
      },
      true,
    );
  }
  function requireProject() {
    if (!document.project) throw Error(ui('프로젝트를 먼저 생성해 주세요.'));
  }
  async function mayLeave() {
    if (editing) {
      await appMessage({
        type: 'info',
        message: ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'),
      });
      return { proceed: false };
    }
    if (!document.dirty) return { proceed: true };
    const result = await appMessage({
      type: 'question',
      title: ui('변경사항 저장'),
      message: ui('프로젝트 변경사항을 저장할까요?'),
      detail: document.project.name + '\n' + ui('저장하지 않으면 이번 변경사항이 사라집니다.'),
      buttons: [ui('저장'), ui('저장하지 않음'), ui('취소')],
      defaultId: 0,
      cancelId: 2,
    });
    if (result.response === 2) return { proceed: false };
    if (result.response === 1) return { proceed: true, discard: true };
    return { proceed: Boolean(await save()) };
  }
  function requireFinishedInput() {
    if (editing || excelImport.current)
      throw Error(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
  }
  async function mayQuit() {
    requireFinishedInput();
    const original = document.activeId,
      discarded = [];
    for (const tab of document.snapshot().tabs.filter((tab) => tab.dirty)) {
      document.activate(tab.id);
      publish();
      const result = await mayLeave();
      if (!result.proceed) {
        if (original) {
          document.activate(original);
          publish();
        }
        return false;
      }
      if (result.discard) discarded.push(tab.id);
    }
    // Do not discard any tab until all prompts have succeeded.
    if (discarded.length) document.closeMany(discarded);
    if (document.tabs.has(original)) document.activate(original);
    return true;
  }
  app.on('second-instance', () => {
    window?.restore();
    window?.focus();
  });
  // Electron waits for the entry module before emitting ready. Do not await ready at top level.
  void app
    .whenReady()
    .then(async () => {
      const preferencesFile = path.join(app.getPath('userData'), 'preferences.json');
      fileAccess = new MacFileAccess({
        enabled: Boolean(process.mas),
        app,
        dialog,
        window: () => window,
        file: path.join(app.getPath('userData'), 'file-access.json'),
        ui,
      });
      app.once('will-quit', () => fileAccess.dispose());
      const preferences = new DesktopPreferences(preferencesFile);
      setBusinessTimeZone(preferences.value.timeZone);
      const updateDirectory = path.join(app.getPath('userData'), 'updates');
      updateManager = new UpdateManager({
        service: updates,
        version: app.getVersion(),
        directory: updateDirectory,
        notify: (value) => send('desktop:update', value),
      });
      await cleanupUpdateCache(updateDirectory).catch(() =>
        console.warn('Update cache cleanup deferred.'),
      );
      if (!process.mas && !testing && process.env.PMCANVAS_DESKTOP_TEST !== '1')
        await cleanupUpdateCache(path.join(app.getPath('temp'), 'PMCanvas-updates')).catch(() =>
          console.warn('Legacy update cache cleanup deferred.'),
        );
      process.env.PM_TIME_ZONE = getBusinessTimeZone();
      document = new DesktopWorkspace(path.join(app.getPath('userData'), 'workspace.json'));
      holidaySync = new HolidaySync({
        file: path.join(app.getPath('userData'), 'public-holidays.json'),
        enabled: preferences.value.syncPublicHolidays,
        notify: () => flushHolidayCalendar(),
      });
      appliedHolidays = structuredClone(holidaySync.holidays);
      setKoreanHolidayUpdates(appliedHolidays);
      excelImport = new ExcelImportSession(document, excelJob);
      protocol.handle('pmcanvas', async (request) => {
        const asset = assetPath(request.url);
        if (!asset || request.method !== 'GET') return new Response('Not found', { status: 404 });
        // Node's Electron-patched fs resolves ASAR paths consistently on Windows and macOS.
        // The allowlist above is authoritative; no renderer path or file URL is accepted.
        let bytes;
        try {
          bytes = readFileSync(path.join(root, 'app', asset));
        } catch {
          return new Response('Not found', { status: 404 });
        }
        const headers = new Headers({
          'Content-Type': asset.endsWith('.png')
            ? 'image/png'
            : (asset.endsWith('.html')
                ? 'text/html'
                : asset.endsWith('.css')
                  ? 'text/css'
                  : 'text/javascript') + '; charset=utf-8',
        });
        headers.set(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
        );
        return new Response(bytes, { status: 200, headers });
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      window = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 1000,
        minHeight: 720,
        show: !testing,
        backgroundColor: '#f5f6fa',
        icon: path.join(root, 'app/icon.png'),
        webPreferences: {
          preload: path.join(root, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: false,
          spellcheck: false,
        },
      });
      window.on('page-title-updated', (event) => {
        event.preventDefault();
        updateNativeTitle();
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
        if (mainFrame) appDialogs.reset();
      });
      window.webContents.on('render-process-gone', () => appDialogs.reset());
      window.on('closed', () => appDialogs.reset());
      handle('dialogsReady', () => appDialogs.connect(), false);
      handle('dialogResponse', (id, response) => appDialogs.respond(id, response), false);
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== APP_URL) event.preventDefault();
      });
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.on('close', (event) => {
        if (closing) return;
        event.preventDefault();
        if (busy || appDialogs.pending) return;
        busy = true;
        mayQuit()
          .then((result) => {
            if (!result) return;
            closing = true;
            window.close();
          })
          .catch(message)
          .finally(() => {
            busy = false;
            flushHolidayCalendar();
          });
      });
      const command = (name) => send('desktop:command', name);
      const installMenu = () =>
        Menu.setApplicationMenu(
          Menu.buildFromTemplate([
            ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
            {
              label: ui('파일'),
              submenu: [
                {
                  label: ui('새 프로젝트'),
                  id: 'file-new',
                  accelerator: 'CmdOrCtrl+N',
                  click: () => command('new'),
                },
                {
                  label: ui('열기…'),
                  id: 'file-open',
                  accelerator: 'CmdOrCtrl+O',
                  click: () => command('open'),
                },
                { type: 'separator' },
                {
                  label: ui('저장'),
                  id: 'file-save',
                  accelerator: 'CmdOrCtrl+S',
                  click: () => command('save'),
                },
                {
                  label: ui('다른 이름으로 저장…'),
                  id: 'file-save-as',
                  accelerator: 'CmdOrCtrl+Shift+S',
                  click: () => command('saveAs'),
                },
                {
                  label: ui('프로젝트 닫기'),
                  id: 'file-close-project',
                  accelerator: process.platform === 'win32' ? 'Ctrl+W' : undefined,
                  click: () => command('closeProject'),
                },
                { type: 'separator' },
                {
                  label: ui('프로젝트 설정'),
                  id: 'project-settings',
                  click: () => command('projectSettings'),
                },
                { type: 'separator' },
                {
                  label: ui('Excel 가져오기…'),
                  id: 'file-import-excel',
                  click: () => command('importExcel'),
                },
                {
                  label: ui('내보내기'),
                  id: 'file-export',
                  submenu: [
                    {
                      label: ui('웹 버전용 JSON 내보내기…'),
                      id: 'file-export-json',
                      click: () => command('exportWeb'),
                    },
                    {
                      label: ui('업무 현황 Excel 저장…'),
                      id: 'file-export-excel',
                      click: () => command('exportExcel'),
                    },
                    {
                      label: ui('Excel 입력 양식 저장…'),
                      id: 'file-export-template',
                      click: () => command('exportTemplate'),
                    },
                  ],
                },
                { type: 'separator' },
                {
                  label: ui('앱 설정'),
                  id: 'settings-open',
                  accelerator: 'CmdOrCtrl+,',
                  click: () => command('appSettings'),
                },
                { type: 'separator' },
                { role: process.platform === 'darwin' ? 'close' : 'quit' },
              ],
            },
            {
              label: ui('편집'),
              submenu: [
                {
                  label: ui('프로젝트 변경 실행 취소'),
                  id: 'project-undo',
                  accelerator: 'CmdOrCtrl+Alt+Z',
                  click: () => command('undo'),
                },
                {
                  label: ui('프로젝트 변경 다시 실행'),
                  id: 'project-redo',
                  accelerator: 'CmdOrCtrl+Alt+Y',
                  click: () => command('redo'),
                },
                { type: 'separator' },
                { role: 'undo', label: ui('텍스트 실행 취소') },
                { role: 'redo', label: ui('텍스트 다시 실행') },
                { type: 'separator' },
                { role: 'cut', label: ui('잘라내기') },
                { role: 'copy', label: ui('복사') },
                { role: 'paste', label: ui('붙여넣기') },
                { role: 'selectAll', label: ui('모두 선택') },
              ],
            },
            {
              label: ui('보기'),
              submenu: [
                {
                  label: ui('다음 프로젝트 탭'),
                  id: 'tab-next',
                  accelerator: 'Ctrl+Tab',
                  click: () => command('nextTab'),
                },
                {
                  label: ui('이전 프로젝트 탭'),
                  id: 'tab-previous',
                  accelerator: 'Ctrl+Shift+Tab',
                  click: () => command('previousTab'),
                },
                { type: 'separator' },
                { role: 'resetZoom', label: ui('실제 크기') },
                { role: 'zoomIn', label: ui('확대') },
                { role: 'zoomOut', label: ui('축소') },
                { role: 'togglefullscreen', label: ui('전체 화면') },
              ],
            },
            {
              label: ui('도움말'),
              submenu: [
                { label: ui('업데이트 확인'), id: 'help-updates', click: () => command('updates') },
                { label: ui('앱 정보'), id: 'help-about', click: () => command('about') },
                {
                  label: ui('개인정보처리방침'),
                  id: 'help-privacy',
                  click: () => command('privacy'),
                },
              ],
            },
          ]),
        );
      installMenu();
      handle('language', (language) => {
        if (!supportedLanguages.includes(language) || editing)
          throw Error(ui('언어 설정을 확인해 주세요.'));
        setLanguage(language);
        installMenu();
        updateHistoryMenu();
        return language;
      });
      handle(
        'settings',
        () => ({
          ...preferences.value,
          timeZone: getBusinessTimeZone(),
          recovery: preferences.recovery,
        }),
        false,
      );
      handle(
        'updatePreference',
        (enabled) => {
          if (typeof enabled !== 'boolean') throw Error(ui('업데이트 설정을 확인해 주세요.'));
          preferences.update({ checkUpdatesOnStart: enabled });
          return { ...preferences.value };
        },
        false,
      );
      handle('updateState', () => updateManager.snapshot(), false);
      handle('updates', () => updateManager.check(true), false);
      handle('downloadUpdate', () => updateManager.download(), false);
      handle('applyUpdate', async () => {
        const requireSaved = () => {
          if (editing || document.anyDirty || excelImport.current)
            throw Error(ui('변경사항과 입력창을 먼저 저장하거나 취소한 뒤 업데이트해 주세요.'));
        };
        requireSaved();
        if (process.windowsStore || process.mas) {
          await shell.openExternal(updates.url);
          return true;
        }
        const file = await updateManager.installerPath();
        requireSaved();
        const error = await shell.openPath(file);
        if (error) throw Error(ui('설치 파일을 열지 못했습니다. 다시 시도해 주세요.'));
        return true;
      });
      handle('openRelease', () => shell.openExternal(updates.url), false);
      handle('privacyPolicy', () => shell.openExternal(PRIVACY_POLICY), false);
      handle('timeZone', (value) => {
        if (editing || document.anyDirty || excelImport.current)
          throw Error(ui('변경사항을 저장하거나 취소한 뒤 시간대를 바꿔 주세요.'));
        const previous = getBusinessTimeZone();
        try {
          setBusinessTimeZone(value);
          for (const tab of document.tabs.values()) validateProject(tab.project);
          preferences.update({ timeZone: getBusinessTimeZone() });
        } catch (error) {
          setBusinessTimeZone(previous);
          throw error;
        }
        process.env.PM_TIME_ZONE = getBusinessTimeZone();
        return { timeZone: getBusinessTimeZone() };
      });
      handle(
        'info',
        () => ({
          ...JSON.parse(readFileSync(path.join(root, 'app/build-info.json'), 'utf8')),
          version: app.getVersion(),
          platform: process.platform,
          displayName: metadata.productName,
          developer: typeof metadata.author === 'string' ? metadata.author : metadata.author.name,
          brand: metadata.brand,
        }),
        false,
      );
      handle('snapshot', () => document.snapshot(), false);
      handle(
        'navigationContext',
        (next) => {
          if (
            !next ||
            !['projects', 'settings'].includes(next.scope) ||
            !Object.hasOwn(PROJECT_VIEWS, next.view) ||
            !Object.hasOwn(SETTINGS_SECTIONS, next.section)
          )
            throw Error('Invalid navigation context');
          navigation = { scope: next.scope, view: next.view, section: next.section };
          updateHistoryMenu();
          updateNativeTitle();
          return navigation;
        },
        false,
      );

      handle('holidayState', () => calendarSnapshot(), false);
      handle(
        'refreshHolidays',
        (force = true) => {
          if (typeof force !== 'boolean') throw Error('Invalid holiday refresh');
          return holidaySync.refresh(force).then(() => calendarSnapshot());
        },
        false,
      );
      handle(
        'holidayPreference',
        (enabled) => {
          if (typeof enabled !== 'boolean') throw Error('Invalid holiday preference');
          preferences.update({ syncPublicHolidays: enabled });
          holidaySync.setEnabled(enabled);
          if (enabled) void holidaySync.refresh();
          return calendarSnapshot();
        },
        false,
      );
      for (const direction of ['undo', 'redo'])
        handle(direction, (revision) => {
          if (editing) throw Error(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
          document[direction](revision);
          return publish();
        });
      handle(
        'editing',
        (value) => {
          if (typeof value !== 'boolean') throw Error(ui('입력 상태가 올바르지 않습니다.'));
          editing = value;
          if (!value) {
            inputCooldownUntil = Date.now() + 250;
            clearTimeout(holidayFlushTimer);
            holidayFlushTimer = setTimeout(flushHolidayCalendar, 260);
            holidayFlushTimer.unref();
          }
          updateHistoryMenu();
        },
        false,
      );
      handle('replace', (project, revision) => {
        if (Buffer.byteLength(JSON.stringify(project)) > MAX_BYTES)
          throw Error(ui('프로젝트 크기를 줄여 주세요.'));
        document.replace(project, revision);
        return publish();
      });
      handle('new', async (proposal) => {
        requireFinishedInput();
        if (proposal !== undefined && Buffer.byteLength(JSON.stringify(proposal)) > MAX_BYTES)
          throw Error(ui('프로젝트 크기를 줄여 주세요.'));
        const project = normalizeProject(
          proposal === undefined
            ? { name: ui('새 프로젝트'), description: '', holidays: [], members: [], tasks: [] }
            : proposal,
        );
        document.create(project);
        return publish();
      });
      handle('open', async () => {
        requireFinishedInput();
        const result = await fileAccess.open(
          {
            title: ui('프로젝트 열기 / 웹 JSON 불러오기'),
            properties: ['openFile', 'multiSelections'],
            filters: [
              { name: ui('PM Canvas 프로젝트 / JSON 백업'), extensions: ['pmcanvas', 'json'] },
            ],
          },
          true,
        );
        if (result.canceled || !result.filePaths.length) return null;
        document.openMany(result.filePaths);
        return publish();
      });
      handle('save', (as) => save(as === true));
      handle('activateTab', (id) => {
        requireFinishedInput();
        document.activate(id);
        try {
          if (document.file) fileAccess.restore(document.file);
        } catch {
          /* Save can request access. */
        }
        return publish();
      });
      handle('close', async (id = document.activeId) => {
        requireFinishedInput();
        if (!document.project) return publish();
        const original = document.activeId;
        document.activate(id);
        publish();
        if (!(await mayLeave()).proceed) {
          document.activate(original);
          publish();
          return null;
        }
        document.close(id);
        if (id !== original && document.tabs.has(original)) document.activate(original);
        try {
          if (document.file) fileAccess.restore(document.file);
          else fileAccess.dispose();
        } catch {
          /* Save can request access. */
        }
        return publish();
      });
      handle('exportReport', async (options, revision) => {
        options = { ...options, language: getLanguage() };
        if (editing) throw Error(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
        requireProject();
        if (revision !== document.revision)
          throw Error(ui('문서가 변경되었습니다. 보고서를 다시 확인해 주세요.'));
        const report = buildReport(document.project, options);
        if (options.format !== undefined && !['csv', 'xlsx', 'html'].includes(options.format))
          throw Error(ui('내보내기 형식을 확인해 주세요.'));
        const format = options.format || 'csv';
        if ((format === 'html') !== (options.kind === 'weekly'))
          throw Error(ui('내보내기 형식을 확인해 주세요.'));
        const result = await dialog.showSaveDialog(window, {
          title:
            format === 'html'
              ? ui('주간보고 저장')
              : format === 'xlsx'
                ? ui('Excel 보고서 저장')
                : ui('CSV 보고서 저장'),
          defaultPath: report.filename.replace(/\.csv$/, '.' + format),
          filters: [
            {
              name:
                format === 'html'
                  ? 'HTML'
                  : format === 'xlsx'
                    ? ui('Excel 통합문서')
                    : ui('CSV 보고서 (Excel에서 열기)'),
              extensions: [format],
            },
          ],
        });
        if (result.canceled || !result.filePath) return false;
        const file = result.filePath.toLowerCase().endsWith('.' + format)
          ? result.filePath
          : result.filePath + '.' + format;
        const bytes =
          format === 'xlsx'
            ? await excelJob('export', {
                project: document.project,
                options,
                dirty: document.dirty,
                holidayCalendar: appliedHolidays,
              })
            : format === 'html'
              ? report.html
              : report.csv;
        return fileAccess.write(file, () => {
          atomicWrite(file, bytes);
          return true;
        });
      });
      handle('openExcel', async (revision) => {
        if (editing) throw Error(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
        requireProject();
        const result = await dialog.showOpenDialog(window, {
          title: ui('Excel 가져오기'),
          properties: ['openFile'],
          filters: [{ name: ui('Excel 통합문서'), extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePaths.length) return null;
        return excelImport.open(result.filePaths[0], revision);
      });
      handle('previewExcel', (id, options) => excelImport.preview(id, options));
      handle('applyExcel', (id, revision) => {
        excelImport.apply(id, revision);
        return publish();
      });
      handle('cancelExcel', (id) => excelImport.cancel(id));
      handle('exportTemplate', async (revision) => {
        requireProject();
        if (editing || !document.project || revision !== document.revision)
          throw Error(ui('프로젝트를 확인하고 입력을 먼저 적용해 주세요.'));
        const result = await dialog.showSaveDialog(window, {
          title: ui('Excel 입력 양식 저장'),
          defaultPath: 'PMCanvas-Template.xlsx',
          filters: [{ name: ui('Excel 통합문서'), extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) return false;
        const file = result.filePath.toLowerCase().endsWith('.xlsx')
          ? result.filePath
          : result.filePath + '.xlsx';
        return fileAccess.write(file, async () => {
          atomicWrite(
            file,
            await excelJob('template', {
              project: { name: document.project.name, members: document.project.members },
              language: getLanguage(),
            }),
          );
          return true;
        });
      });
      handle('exportWeb', async () => {
        if (editing) throw Error(ui('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.'));
        requireProject();
        const result = await dialog.showSaveDialog(window, {
          title: ui('웹 버전용 JSON 내보내기'),
          defaultPath: 'PM-Canvas-project.json',
          filters: [{ name: ui('PM Canvas JSON 백업'), extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return null;
        const file = result.filePath.toLowerCase().endsWith('.json')
          ? result.filePath
          : result.filePath + '.json';
        return fileAccess.write(file, () => {
          atomicWrite(file, serializeDocument(document.project));
          return true;
        });
      });
      await window.loadURL(APP_URL);
      try {
        const recovery = document.recovery();
        if (recovery?.workspace) {
          const restored = document.restore(recovery, (file) => fileAccess.restore(file));
          if (document.file) {
            try {
              fileAccess.restore(document.file);
            } catch {}
          }
          if (restored.missing || recovery.dirty)
            await appMessage({
              type: 'info',
              message: ui(
                restored.missing
                  ? '일부 원본 파일을 열 수 없어 복구 사본을 불러왔습니다. 해당 탭을 다른 이름으로 저장해 주세요.'
                  : '저장하지 않은 프로젝트 탭을 복구했습니다. 계속 작업하거나 파일에 저장해 주세요.',
              ),
            });
        } else if (recovery?.dirty) {
          document.restore(recovery);
          try {
            fileAccess.restore(recovery.file);
          } catch {
            /* Save will request a new folder grant. */
          }
          await appMessage({
            type: 'info',
            message: ui(
              '저장하지 않은 프로젝트를 복구했습니다. 계속 작업하거나 파일에 저장해 주세요.',
            ),
          });
        } else if (recovery?.file) {
          try {
            fileAccess.restore(recovery.file);
            document.open(recovery.file);
          } catch {
            document.restore({ ...recovery, file: null, savedHash: null, dirty: true });
            await appMessage({
              type: 'info',
              message: ui(
                '원본 파일을 열 수 없어 마지막 복구 사본을 불러왔습니다. 다른 이름으로 저장해 주세요.',
              ),
            });
          }
        }
        publish();
      } catch (error) {
        await message(error);
      }
      app.on('window-all-closed', () => app.quit());
      if (!testing && process.env.PMCANVAS_DESKTOP_TEST !== '1') {
        const stopHolidays = holidaySync.start();
        const resumeHolidays = () => {
          if (holidaySync.enabled) void holidaySync.refresh(Boolean(holidaySync.error));
        };
        powerMonitor.on('resume', resumeHolidays);
        window.on('focus', () => void holidaySync.refresh());
        app.once('will-quit', () => {
          stopHolidays();
          powerMonitor.removeListener('resume', resumeHolidays);
        });
      }
      // Startup discovery never blocks recovery, opens a modal, downloads, or restarts the app.
      if (app.isPackaged && !testing) {
        const timer = setTimeout(() => {
          if (window && !window.isDestroyed())
            void updateManager.start(preferences.value.checkUpdatesOnStart);
        }, 1500);
        timer.unref();
        app.once('before-quit', () => clearTimeout(timer));
      }
    })
    .catch(async (error) => {
      console.error('Desktop startup failed:', error.message || String(error));
      await dialog.showMessageBox({
        type: 'error',
        title: metadata.productName,
        message: error.message || String(error),
      });
      app.quit();
    });
}
