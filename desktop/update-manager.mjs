import { downloadInstaller, verifyInstaller } from './update-download.mjs';

export class UpdateManager {
  constructor({
    service,
    version,
    directory,
    platform = process.platform,
    arch = process.arch,
    download = downloadInstaller,
    notify = () => {},
    now = Date.now,
  }) {
    Object.assign(this, {
      service,
      version,
      directory,
      platform,
      arch,
      downloadFile: download,
      notify,
      now,
    });
    this.value = {
      status: 'idle',
      channel: service.url.startsWith('ms-windows-store:') ? 'microsoft-store' : 'github',
      currentVersion: version,
      url: service.url,
      available: false,
      downloadAvailable: false,
      checkedAt: null,
      progress: null,
    };
    this.pending = null;
    this.startup = null;
    this.installer = null;
    this.release = null;
  }
  snapshot() {
    return { ...this.value, progress: this.value.progress && { ...this.value.progress } };
  }
  set(patch) {
    Object.assign(this.value, patch);
    this.notify(this.snapshot());
    return this.snapshot();
  }
  start(enabled) {
    if (!enabled) return Promise.resolve(this.snapshot());
    if (!this.startup) this.startup = this.check(false);
    return this.startup;
  }
  check(force = true) {
    if (this.pending) return this.pending;
    if (this.value.status === 'downloaded' && !force) return Promise.resolve(this.snapshot());
    this.set({ status: 'checking', error: null });
    this.pending = (async () => {
      try {
        const update = await this.service.check(this.version, this.platform, this.arch, { force });
        const ready =
          this.installer && update.available && update.version === this.release?.version;
        if (!ready) this.installer = null;
        this.release = update;
        return this.set({
          status:
            update.checked === false
              ? 'unsupported'
              : update.available
                ? ready
                  ? 'downloaded'
                  : 'available'
                : 'current',
          channel: update.channel || 'github',
          url: update.url || this.service.url,
          storeCheck: update.storeCheck || null,
          available: update.available,
          downloadAvailable: update.downloadAvailable,
          version: update.version,
          checkedAt: update.checked === false ? null : this.now(),
          progress: null,
        });
      } catch {
        return this.set({ status: 'error', error: 'check', progress: null });
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
  download() {
    if (this.pending) return this.pending;
    if (this.value.status === 'downloaded') return Promise.resolve(this.snapshot());
    if (
      !this.release?.available ||
      !this.release.downloadAvailable ||
      this.value.channel === 'microsoft-store'
    )
      return Promise.reject(Error('No compatible update installer.'));
    this.set({ status: 'downloading', error: null, progress: { received: 0, total: 0 } });
    let progressAt = 0;
    this.pending = (async () => {
      try {
        this.installer = await this.downloadFile(this.release, this.directory, {
          onProgress: (progress) => {
            if (this.now() - progressAt > 150 || progress.received === progress.total) {
              progressAt = this.now();
              this.set({ progress });
            }
          },
        });
        return this.set({ status: 'downloaded', progress: null });
      } catch {
        this.installer = null;
        return this.set({ status: 'error', error: 'download', progress: null });
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
  async installerPath() {
    if (!this.installer || this.value.status !== 'downloaded')
      throw Error('Download and verify the update first.');
    try {
      return await verifyInstaller(this.installer.file, this.installer.sha256, this.installer.size);
    } catch {
      this.installer = null;
      this.set({ status: 'error', error: 'download' });
      throw Error('설치 파일이 변경되었습니다. 업데이트를 다시 다운로드해 주세요.');
    }
  }
}
