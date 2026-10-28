import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  utilityProcess,
} from 'electron';
import path from 'node:path';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DesktopDocument, MAX_BYTES, atomicWrite, serializeDocument } from './document.mjs';
import { APP_URL, assetPath } from './assets.mjs';
import { buildReport } from './reports.mjs';
import { createExcelJobs } from './excel-jobs.mjs';
import { ExcelImportSession } from './excel-session.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const testing = !app.isPackaged && process.env.PMCANVAS_DESKTOP_TEST === '1';
if (!app.isPackaged && process.env.PMCANVAS_DESKTOP_DATA)
  app.setPath('userData', path.resolve(process.env.PMCANVAS_DESKTOP_DATA));
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
  const send = (channel, value) => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  };
  const publish = () => {
    const snapshot = document.snapshot();
    window.setTitle(
      (snapshot.dirty ? '● ' : '') +
        (snapshot.project?.name || 'PM Canvas') +
        ' — PM Canvas Desktop',
    );
    window.setDocumentEdited(snapshot.dirty);
    send('desktop:document', snapshot);
    return snapshot;
  };
  const message = (error) =>
    dialog.showMessageBox(window, {
      type: 'error',
      title: 'PM Canvas Desktop',
      message: error.message || String(error),
    });
  function assertSender(event) {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== APP_URL
    )
      throw Error('허용되지 않은 요청입니다.');
  }
  function handle(name, operation, exclusive = true) {
    ipcMain.handle('desktop:' + name, async (event, ...args) => {
      try {
        assertSender(event);
        if (exclusive && busy) throw Error('이전 작업을 마친 뒤 다시 시도해 주세요.');
        if (exclusive) busy = true;
        try {
          return { ok: true, value: await operation(...args) };
        } finally {
          if (exclusive) busy = false;
        }
      } catch (error) {
        if (document && window && !window.isDestroyed()) publish();
        return { ok: false, error: error.message || '요청을 처리하지 못했습니다.' };
      }
    });
  }
  async function save(as = false) {
    if (editing) throw Error('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.');
    if (!document.project) return null;
    let file = as ? null : document.file;
    if (!file) {
      const result = await dialog.showSaveDialog(window, {
        title: '프로젝트 저장',
        defaultPath:
          (document.project.name.replace(/[\\/:*?"<>|]/g, '_') || 'Project') + '.pmcanvas',
        filters: [{ name: 'PM Canvas 프로젝트', extensions: ['pmcanvas'] }],
      });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath;
      if (!file.toLowerCase().endsWith('.pmcanvas')) file += '.pmcanvas';
    }
    document.save(file);
    return publish();
  }
  async function mayLeave() {
    if (editing) {
      await dialog.showMessageBox(window, {
        type: 'info',
        message: '입력창의 변경사항을 먼저 적용하거나 취소해 주세요.',
      });
      return { proceed: false };
    }
    if (!document.dirty) return { proceed: true };
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      message: '프로젝트 변경사항을 저장할까요?',
      detail: '저장하지 않으면 이번 변경사항이 사라집니다.',
      buttons: ['저장', '저장하지 않음', '취소'],
      defaultId: 0,
      cancelId: 2,
    });
    if (result.response === 2) return { proceed: false };
    if (result.response === 1) return { proceed: true, discard: true };
    return { proceed: Boolean(await save()) };
  }
  app.on('second-instance', () => {
    window?.restore();
    window?.focus();
  });
  // Electron waits for the entry module before emitting ready. Do not await ready at top level.
  void app
    .whenReady()
    .then(async () => {
      document = new DesktopDocument(path.join(app.getPath('userData'), 'recovery.json'));
      excelImport = new ExcelImportSession(document, excelJob);
      protocol.handle('pmcanvas', async (request) => {
        const asset = assetPath(request.url);
        if (!asset || request.method !== 'GET') return new Response('Not found', { status: 404 });
        const response = await net.fetch(pathToFileURL(path.join(root, 'app', asset)).href);
        const headers = new Headers(response.headers);
        headers.set(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
        );
        return new Response(response.body, { status: response.status, headers });
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
        webPreferences: {
          preload: path.join(root, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: false,
          spellcheck: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== APP_URL) event.preventDefault();
      });
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.on('close', (event) => {
        if (closing) return;
        event.preventDefault();
        if (busy) return;
        busy = true;
        mayLeave()
          .then((result) => {
            if (!result.proceed) return;
            if (result.discard) {
              try {
                unlinkSync(document.recoveryFile);
              } catch (error) {
                if (error.code !== 'ENOENT') throw error;
              }
            }
            closing = true;
            window.close();
          })
          .catch(message)
          .finally(() => {
            busy = false;
          });
      });
      const command = (name) => send('desktop:command', name);
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
          {
            label: '파일',
            submenu: [
              { label: '새 프로젝트', accelerator: 'CmdOrCtrl+N', click: () => command('new') },
              { label: '열기…', accelerator: 'CmdOrCtrl+O', click: () => command('open') },
              { type: 'separator' },
              { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
              {
                label: '다른 이름으로 저장…',
                accelerator: 'CmdOrCtrl+Shift+S',
                click: () => command('saveAs'),
              },
              { label: '웹 버전용 JSON 내보내기…', click: () => command('exportWeb') },
              { label: 'Excel 내보내기…', click: () => command('exportExcel') },
              { label: 'Excel 가져오기…', click: () => command('importExcel') },
              { label: 'Excel 입력 양식 저장…', click: () => command('exportTemplate') },
              { type: 'separator' },
              { role: process.platform === 'darwin' ? 'close' : 'quit' },
            ],
          },
          { role: 'editMenu' },
          {
            label: '보기',
            submenu: [
              { role: 'resetZoom' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              { role: 'togglefullscreen' },
            ],
          },
        ]),
      );
      handle('snapshot', () => document.snapshot(), false);
      handle(
        'editing',
        (value) => {
          if (typeof value !== 'boolean') throw Error('입력 상태가 올바르지 않습니다.');
          editing = value;
        },
        false,
      );
      handle('replace', (project, revision) => {
        if (Buffer.byteLength(JSON.stringify(project)) > MAX_BYTES)
          throw Error('프로젝트 크기를 줄여 주세요.');
        document.replace(project, revision);
        return publish();
      });
      handle('new', async () => {
        if (!(await mayLeave()).proceed) return null;
        document.create({
          name: '새 프로젝트',
          description: '',
          holidays: [],
          members: [],
          tasks: [],
        });
        return publish();
      });
      handle('open', async () => {
        if (!(await mayLeave()).proceed) return null;
        const result = await dialog.showOpenDialog(window, {
          title: '프로젝트 열기 / 웹 JSON 불러오기',
          properties: ['openFile'],
          filters: [{ name: 'PM Canvas 프로젝트 / JSON 백업', extensions: ['pmcanvas', 'json'] }],
        });
        if (result.canceled || !result.filePaths.length) return null;
        document.open(result.filePaths[0]);
        return publish();
      });
      handle('save', (as) => save(as === true));
      handle('exportReport', async (options, revision) => {
        if (editing) throw Error('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.');
        if (revision !== document.revision)
          throw Error('문서가 변경되었습니다. 보고서를 다시 확인해 주세요.');
        const report = buildReport(document.project, options);
        if (options.format !== undefined && !['csv', 'xlsx'].includes(options.format))
          throw Error('내보내기 형식을 확인해 주세요.');
        const format = options.format || 'csv';
        const result = await dialog.showSaveDialog(window, {
          title: format === 'xlsx' ? 'Excel 보고서 저장' : 'CSV 보고서 저장',
          defaultPath: report.filename.replace(/\.csv$/, '.' + format),
          filters: [
            {
              name: format === 'xlsx' ? 'Excel 통합문서' : 'CSV 보고서 (Excel에서 열기)',
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
              })
            : report.csv;
        atomicWrite(file, bytes);
        return true;
      });
      handle('openExcel', async (revision) => {
        if (editing) throw Error('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.');
        const result = await dialog.showOpenDialog(window, {
          title: 'Excel 가져오기',
          properties: ['openFile'],
          filters: [{ name: 'Excel 통합문서', extensions: ['xlsx'] }],
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
        if (editing || !document.project || revision !== document.revision)
          throw Error('프로젝트를 확인하고 입력을 먼저 적용해 주세요.');
        const result = await dialog.showSaveDialog(window, {
          title: 'Excel 입력 양식 저장',
          defaultPath: 'PMCanvas-Template.xlsx',
          filters: [{ name: 'Excel 통합문서', extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) return false;
        const file = result.filePath.toLowerCase().endsWith('.xlsx')
          ? result.filePath
          : result.filePath + '.xlsx';
        atomicWrite(
          file,
          await excelJob('template', {
            project: { name: document.project.name, members: document.project.members },
          }),
        );
        return true;
      });
      handle('exportWeb', async () => {
        if (editing) throw Error('입력창의 변경사항을 먼저 적용하거나 취소해 주세요.');
        if (!document.project) return null;
        const result = await dialog.showSaveDialog(window, {
          title: '웹 버전용 JSON 내보내기',
          defaultPath: 'PM-Canvas-project.json',
          filters: [{ name: 'PM Canvas JSON 백업', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return null;
        const file = result.filePath.toLowerCase().endsWith('.json')
          ? result.filePath
          : result.filePath + '.json';
        atomicWrite(file, serializeDocument(document.project));
        return true;
      });
      await window.loadURL(APP_URL);
      try {
        const recovery = document.recovery();
        if (recovery?.dirty) {
          document.restore(recovery);
          await dialog.showMessageBox(window, {
            type: 'info',
            message: '저장하지 않은 프로젝트를 복구했습니다. 계속 작업하거나 파일에 저장해 주세요.',
          });
        } else if (recovery?.file) {
          try {
            document.open(recovery.file);
          } catch {
            document.restore({ ...recovery, file: null, savedHash: null, dirty: true });
            await dialog.showMessageBox(window, {
              type: 'info',
              message:
                '원본 파일을 열 수 없어 마지막 복구 사본을 불러왔습니다. 다른 이름으로 저장해 주세요.',
            });
          }
        }
        publish();
      } catch (error) {
        await message(error);
      }
      app.on('window-all-closed', () => app.quit());
    })
    .catch((error) => {
      dialog.showErrorBox('PM Canvas Desktop', error.message || String(error));
      app.quit();
    });
}
