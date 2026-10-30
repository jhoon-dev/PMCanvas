const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Keep the original Windows executable's icon as the only artwork source.
const root = path.resolve(__dirname, '..');
app
  .whenReady()
  .then(() => {
    const ico = fs.readFileSync(path.join(root, 'build/icon.ico'));
    assert.equal(ico.readUInt16LE(2), 1);
    let original;
    for (let index = 0; index < ico.readUInt16LE(4); index++) {
      const entry = 6 + index * 16;
      if (ico[entry] || ico[entry + 1]) continue;
      const offset = ico.readUInt32LE(entry + 12);
      original = ico.subarray(offset, offset + ico.readUInt32LE(entry + 8));
    }
    assert.ok(original && original.subarray(1, 4).toString() === 'PNG');
    const image = nativeImage.createFromBuffer(original);
    assert.deepEqual(image.getSize(), { width: 256, height: 256 });
    fs.writeFileSync(path.join(root, 'ui/icon.png'), original);
    for (const [file, size] of [
      ['build/icon-mac.png', 1024],
      ['build/store/StoreLogo.png', 50],
      ['build/store/Square150x150Logo.png', 150],
      ['build/store/Square44x44Logo.png', 44],
    ]) {
      fs.writeFileSync(
        path.join(root, file),
        image.resize({ width: size, height: size, quality: 'best' }).toPNG(),
      );
    }
    console.log('Prepared desktop and Store icons from the original Windows artwork.');
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
