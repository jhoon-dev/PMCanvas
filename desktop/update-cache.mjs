import fs from 'node:fs/promises';
import path from 'node:path';
export const CACHE_MAX_BYTES = 1024 * 1024 * 1024;
export const CACHE_MAX_FOLDERS = 2;
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const activeAge = 20 * 60 * 1000;
const ownedFile = /^(?:PMCanvas-Desktop-[A-Za-z0-9.-]+\.(?:exe|dmg)(?:\.partial)?|\.active)$/;

async function entries(directory) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid update cache.');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const root = await fs.realpath(directory),
    folders = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (
      !/^download-[A-Za-z0-9]+$/.test(entry.name) ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    )
      continue;
    const folder = path.join(root, entry.name);
    if (path.dirname(await fs.realpath(folder)) !== root) continue;
    const files = [];
    let safe = true;
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name),
        stat = await fs.lstat(file);
      if (!ownedFile.test(name) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        safe = false;
        break;
      }
      files.push({ file, name, size: stat.size, mtime: stat.mtimeMs });
    }
    if (safe)
      folders.push({
        folder,
        root,
        files,
        size: files.reduce((sum, f) => sum + f.size, 0),
        mtime: Math.max((await fs.stat(folder)).mtimeMs, ...files.map((f) => f.mtime)),
      });
  }
  return folders;
}
export async function cleanupUpdateCache(
  directory,
  {
    keep = [],
    now = Date.now(),
    reserve = 0,
    maxBytes = CACHE_MAX_BYTES,
    maxFolders = CACHE_MAX_FOLDERS,
    maxAge = CACHE_MAX_AGE,
  } = {},
) {
  const folders = (await entries(directory)).sort((a, b) => b.mtime - a.mtime);
  let total = folders.reduce((sum, f) => sum + f.size, 0),
    count = folders.length;
  // Resolve with the same native API as entries(): Windows may report 8.3 names
  // while the downloader holds a long path to that same file.
  const protectedFiles = new Set(
    await Promise.all(
      keep.map(async (file) => {
        try {
          return await fs.realpath(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return path.resolve(file);
        }
      }),
    ),
  );
  for (const item of [...folders].reverse()) {
    const active =
      item.files.some(
        (file) =>
          (file.name === '.active' || file.name.endsWith('.partial')) &&
          now - file.mtime < activeAge,
      ) ||
      (!item.files.length && now - item.mtime < activeAge);
    if (active || item.files.some((file) => protectedFiles.has(path.resolve(file.file)))) continue;
    if (now - item.mtime <= maxAge && total + reserve <= maxBytes && count <= maxFolders) continue;
    // Flat, owned files only; never recursively follow a directory, junction or link.
    if (path.dirname(await fs.realpath(item.folder)) !== item.root) continue;
    for (const file of item.files) {
      const stat = await fs.lstat(file.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw Error('Update cache changed during cleanup.');
      await fs.unlink(file.file);
    }
    await fs.rmdir(item.folder);
    total -= item.size;
    count--;
  }
  if (total + reserve > maxBytes) throw Error('Update cache is busy or full. Try again later.');
}
export async function cachedInstaller(directory, name, verify) {
  for (const entry of (await entries(directory)).sort((a, b) => b.mtime - a.mtime)) {
    if (entry.files.some((file) => file.name === '.active')) continue;
    const file = entry.files.find((item) => item.name === name);
    if (!file) continue;
    try {
      await verify(file.file);
      await fs.utimes(file.file, new Date(), new Date());
      return file.file;
    } catch {
      /* A mismatched file must never be reused. Cleanup applies normal retention. */
    }
  }
  return null;
}
