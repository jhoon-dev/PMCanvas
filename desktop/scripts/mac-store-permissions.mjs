import fs from 'node:fs';
import path from 'node:path';

// The private input stays private. osx-sign preserves this copy's mode when
// embedding it in the app, which will be installed as root and run by users.
export function copyEmbeddedProfile(source, staging) {
  const destination = path.join(staging, 'mas-embedded.provisionprofile');
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o644);
  return destination;
}

export function assertPublicMacApp(app) {
  function visit(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return;
    const required = stat.isDirectory() ? 0o5 : 0o4;
    if ((stat.mode & required) !== required)
      throw Error(
        'MAS app is not readable by non-root users: ' + (path.relative(app, file) || '.'),
      );
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name));
  }
  visit(app);
}
