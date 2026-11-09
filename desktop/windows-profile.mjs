import fs from 'node:fs';
import path from 'node:path';

// AppData is virtualized by MSIX and its private writes disappear on uninstall.
// Keep the user's recovery/profile beside their own files, without exemptions.
export function windowsStoreProfile({ home, appData }) {
  const trace = (message) => {
    if (process.env.CI === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted')
      console.log('Store profile: ' + message);
  };
  trace('selecting persistent profile');
  const profile = path.join(home, 'PM Canvas', 'Profile');
  if (fs.existsSync(profile)) return profile;
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  const candidates = ['pmcanvas-desktop', 'PM Canvas Desktop'].map((name) =>
    path.join(appData, name),
  );
  const source =
    candidates.find((folder) =>
      ['workspace.json', 'recovery.json', 'preferences.json'].some((file) =>
        fs.existsSync(path.join(folder, file)),
      ),
    ) || candidates.find((folder) => fs.existsSync(folder));
  const stage = fs.mkdtempSync(path.join(path.dirname(profile), '.profile-migration-'));
  // Newer bundled Node versions reject copying into an existing directory when
  // errorOnExist is enabled. Publish a fresh child inside the staging container.
  const candidate = path.join(stage, 'Profile');
  try {
    if (source) {
      trace('copying existing profile');
      fs.cpSync(source, candidate, {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: (file) => {
          const relative = path.relative(source, file);
          if (!relative) return true;
          if (
            /^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Crashpad|Crash Reports|updates)([\\/]|$)/.test(
              relative,
            ) ||
            /^Singleton|^lockfile$/.test(relative)
          )
            return false;
          // Never follow a link outside the source profile.
          if (fs.lstatSync(file).isSymbolicLink())
            throw Error('Close the old app and remove profile links before migration: ' + file);
          return true;
        },
      });
      trace('existing profile copied');
    } else fs.mkdirSync(candidate);
    try {
      fs.renameSync(candidate, profile);
    } catch (error) {
      // Another first launch may have completed the same atomic migration.
      if (!fs.existsSync(profile)) throw error;
    }
    trace('persistent profile ready');
    return profile;
  } catch (error) {
    // Electron's early startup error dialog otherwise hides the cause from CI.
    if (process.windowsStore === true) console.error('Store profile migration failed:', error);
    throw error;
  } finally {
    // Only our unpublished staging directory; never remove either profile.
    if (
      path.dirname(stage) !== path.dirname(profile) ||
      !path.basename(stage).startsWith('.profile-migration-')
    )
      throw Error('Unsafe profile migration staging path.');
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
