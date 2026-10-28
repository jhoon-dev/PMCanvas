import https from 'node:https';

export const RELEASES_PAGE = 'https://github.com/jhoon-dev/PMCanvas/releases';
export const RELEASES_API = 'https://api.github.com/repos/jhoon-dev/PMCanvas/releases?per_page=100';
const versionPattern = '(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})\\.(0|[1-9]\\d{0,5})';
const version = new RegExp('^' + versionPattern + '$');
const tag = new RegExp('^desktop-v(' + versionPattern + ')$');
export function compareVersions(a, b) {
  if (!version.test(a) || !version.test(b)) throw Error('Invalid application version.');
  const left = a.split('.').map(Number),
    right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function selectUpdate(releases, currentVersion, platform, arch) {
  compareVersions(currentVersion, currentVersion);
  if (!Array.isArray(releases) || releases.length > 100) throw Error('Invalid release list.');
  const candidates = releases.filter(
    (release) =>
      release &&
      !release.draft &&
      !release.prerelease &&
      typeof release.tag_name === 'string' &&
      tag.test(release.tag_name),
  );
  candidates.sort((a, b) => compareVersions(b.tag_name.slice(9), a.tag_name.slice(9)));
  const latest = candidates[0];
  if (!latest)
    return {
      currentVersion,
      version: null,
      available: false,
      downloadAvailable: false,
      url: RELEASES_PAGE,
    };
  const latestVersion = latest.tag_name.slice(9);
  const url = RELEASES_PAGE + '/tag/' + latest.tag_name;
  if (latest.html_url !== url || !Array.isArray(latest.assets) || latest.assets.length > 100)
    throw Error('Invalid desktop release metadata.');
  const name =
    platform === 'win32' && arch === 'x64'
      ? 'PMCanvas-Desktop-' + latestVersion + '-Windows-x64.exe'
      : platform === 'darwin' && ['arm64', 'x64'].includes(arch)
        ? 'PMCanvas-Desktop-' + latestVersion + '-macOS-' + arch + '.dmg'
        : null;
  const asset = (file) =>
    latest.assets.some(
      (a) =>
        a.name === file &&
        a.browser_download_url ===
          'https://github.com/jhoon-dev/PMCanvas/releases/download/' + latest.tag_name + '/' + file,
    );
  return {
    currentVersion,
    version: latestVersion,
    available: compareVersions(latestVersion, currentVersion) > 0,
    downloadAvailable: Boolean(name && asset(name) && asset(name + '.sha256')),
    url,
  };
}
export function fetchReleases(request = https.get) {
  return new Promise((resolve, reject) => {
    const req = request(
      RELEASES_API,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'PMCanvas-Desktop',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error('Release service unavailable.'));
          return;
        }
        let bytes = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 512 * 1024) req.destroy(Error('Release response too large.'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks)));
          } catch {
            reject(Error('Invalid release response.'));
          }
        });
      },
    );
    const timer = setTimeout(() => req.destroy(Error('Release check timed out.')), 8000);
    req.once('close', () => clearTimeout(timer));
    req.once('error', reject);
  });
}
export class UpdateService {
  constructor({ fetch = fetchReleases, now = Date.now } = {}) {
    this.fetch = fetch;
    this.now = now;
    this.last = null;
    this.pending = null;
    this.url = RELEASES_PAGE;
  }
  async check(currentVersion, platform = process.platform, arch = process.arch) {
    if (this.last && this.now() - this.last.at < 600000) return this.last.value;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const value = selectUpdate(await this.fetch(), currentVersion, platform, arch);
        this.url = value.url;
        this.last = { at: this.now(), value };
        return value;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
}
