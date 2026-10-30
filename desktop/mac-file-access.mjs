import path from 'node:path';
import { atomicWrite } from './document.mjs';
import { readBounded } from './file-io.mjs';

// Keep only the current project's grant. Bookmarks never cross the renderer bridge.
export class MacFileAccess {
  constructor({ enabled, app, dialog, window, file, ui = (value) => value }) {
    Object.assign(this, { enabled, app, dialog, window, file, ui });
    this.current = null;
    this.stop = null;
  }
  remember(file, bookmark, directory = false) {
    if (typeof bookmark !== 'string' || !bookmark || bookmark.length > 128 * 1024)
      throw Error(this.ui('파일 접근 권한을 복원하지 못했습니다. 파일을 다시 열어 주세요.'));
    const stop = this.app.startAccessingSecurityScopedResource(bookmark);
    try {
      const current = { file: path.resolve(file), bookmark, directory };
      atomicWrite(this.file, JSON.stringify(current));
      this.stop?.();
      this.stop = stop;
      this.current = current;
    } catch (error) {
      stop();
      throw error;
    }
  }
  restore(file) {
    if (!this.enabled || !file) return;
    const grant = JSON.parse(readBounded(this.file, 256 * 1024));
    if (
      typeof grant.file !== 'string' ||
      typeof grant.directory !== 'boolean' ||
      path.resolve(grant.file) !==
        (grant.directory ? path.dirname(path.resolve(file)) : path.resolve(file))
    )
      throw Error(this.ui('파일 접근 권한을 복원하지 못했습니다. 파일을 다시 열어 주세요.'));
    this.remember(grant.file, grant.bookmark, grant.directory);
  }
  async open(options, remember = false) {
    const result = await this.dialog.showOpenDialog(this.window(), {
      ...options,
      ...(this.enabled && remember ? { securityScopedBookmarks: true } : {}),
    });
    if (this.enabled && remember && !result.canceled && result.filePaths.length)
      this.remember(result.filePaths[0], result.bookmarks?.[0]);
    return result;
  }
  async write(file, operation, remember = false) {
    if (!this.enabled) return operation();
    const directory = path.dirname(path.resolve(file));
    if (this.current?.directory && this.current.file === directory) return operation();
    // Atomic saves create a sibling temporary file. A file-only grant is insufficient;
    // ask the user to authorize its parent folder instead of weakening atomic writes.
    const result = await this.dialog.showOpenDialog(this.window(), {
      title: this.ui('파일을 안전하게 저장하려면 대상 폴더를 선택해 주세요.'),
      defaultPath: directory,
      properties: ['openDirectory'],
      securityScopedBookmarks: true,
    });
    if (result.canceled || !result.filePaths.length) return null;
    if (path.resolve(result.filePaths[0]) !== directory)
      throw Error(this.ui('저장할 파일이 있는 폴더를 선택해 주세요.'));
    const bookmark = result.bookmarks?.[0];
    if (remember) {
      this.remember(directory, bookmark, true);
      return operation();
    }
    if (typeof bookmark !== 'string' || !bookmark)
      throw Error(this.ui('파일 접근 권한을 복원하지 못했습니다. 파일을 다시 열어 주세요.'));
    const stop = this.app.startAccessingSecurityScopedResource(bookmark);
    try {
      return await operation();
    } finally {
      stop();
    }
  }
  dispose() {
    this.stop?.();
    this.stop = null;
    this.current = null;
  }
}
