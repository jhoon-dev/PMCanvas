import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function migrationFiles(
  directory = fileURLToPath(new URL('../migrations/', import.meta.url)),
) {
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = entry.name.match(/^(\d{3})_[a-z0-9_]+\.sql$/);
      if (!entry.isFile() || !match) throw Error('Invalid migration file: ' + entry.name);
      return { version: Number(match[1]), file: path.join(directory, entry.name) };
    })
    .sort((a, b) => a.version - b.version);
  if (!files.length || files.some((item, index) => item.version !== index + 1)) {
    throw Error('Migration versions must be unique and consecutive, starting at 001.');
  }
  return files;
}
