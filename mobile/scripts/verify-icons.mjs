import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file) => readFile(path.join(root, file));
const master = await read('desktop/build/icon-source.png');
const { background } = JSON.parse(await read('desktop/build/icon-settings.json'));
const expected = background
  .slice(1)
  .match(/../g)
  .map((value) => parseInt(value, 16));
const ios = 'mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
for (const file of [
  'desktop/build/icon-mac.png',
  ios,
  'mobile/assets/icon.png',
  'web/public/icon.png',
])
  assert.deepEqual(await read(file), master, file + ' must use the exact master image');
const frames = [];
const ico = await read('desktop/build/icon.ico');
assert.equal(ico.readUInt16LE(0), 0);
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 9);
let end = 6 + 16 * ico.readUInt16LE(4);
for (let index = 0; index < ico.readUInt16LE(4); index++) {
  const entry = 6 + index * 16;
  const size = ico[entry] || 256;
  const length = ico.readUInt32LE(entry + 8);
  const offset = ico.readUInt32LE(entry + 12);
  assert.equal(offset, end);
  assert.equal(ico[entry + 1] || 256, size);
  assert.equal(ico.readUInt16LE(entry + 6), 32);
  end += length;
  assert.ok(end <= ico.length);
  frames.push({ name: 'Windows ICO ' + size, size, bytes: ico.subarray(offset, end) });
}
assert.equal(end, ico.length);
assert.deepEqual(frames.at(-1).bytes, await read('desktop/ui/icon.png'));
const images = [{ name: 'master', size: 1024, bytes: master }, ...frames];
for (const [file, size] of [
  ['desktop/build/store/StoreLogo.png', 50],
  ['desktop/build/store/Square150x150Logo.png', 150],
  ['desktop/build/store/Square44x44Logo.png', 44],
])
  images.push({ name: file, size, bytes: await read(file) });
for (const [density, size] of [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]) {
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    const file = `mobile/android/app/src/main/res/mipmap-${density}/${name}`;
    images.push({
      name: file,
      size: name.includes('foreground') ? size * 2.25 : size,
      bytes: await read(file),
    });
  }
}
const colors = (
  await read('mobile/android/app/src/main/res/values/ic_launcher_background.xml')
).toString();
assert.ok(colors.toLowerCase().includes(background));
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const xml = (await read('mobile/android/app/src/main/res/mipmap-anydpi-v26/' + name)).toString();
  assert.ok(xml.includes('@color/ic_launcher_background'));
  assert.ok(xml.includes('@mipmap/ic_launcher_foreground'));
}
const { storeManifest } = await import('../../desktop/scripts/store-policy.mjs');
const desktopVersion = JSON.parse(await read('desktop/package.json')).version;
assert.ok(
  storeManifest(
    { identityName: 'Test.Identity', publisher: 'CN=Test', publisherDisplayName: 'Test' },
    desktopVersion,
  ).includes(`BackgroundColor="${background}"`),
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const item of images) {
    const result = await page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let transparent = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 255) transparent++;
      const corners = [
        0,
        image.width - 1,
        image.width * (image.height - 1),
        image.width * image.height - 1,
      ].map((pixel) => Array.from(data.slice(pixel * 4, pixel * 4 + 3)));
      return { width: image.width, height: image.height, transparent, corners };
    }, item.bytes.toString('base64'));
    assert.equal(result.width, item.size, item.name + ' width');
    assert.equal(result.height, item.size, item.name + ' height');
    assert.equal(result.transparent, 0, item.name + ' must be fully opaque');
    for (const corner of result.corners)
      assert.deepEqual(corner, expected, item.name + ' background');
  }
  if (process.argv.includes('--preview')) {
    const cards = [
      ['Windows', frames.at(-1).bytes],
      ['Mac', master],
      ['iPhone', await read(ios)],
      ['Android', await read('mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png')],
    ];
    await page.setViewportSize({ width: 1040, height: 350 });
    await page.setContent(
      `<style>body{margin:0;padding:32px;background:#f5f6fa;font:16px system-ui;color:#232635}main{display:flex;justify-content:space-between}figure{margin:0;text-align:center}img{width:192px;height:192px;border-radius:32px}figcaption{margin-top:14px;font-weight:600}p{margin:24px 0 0;text-align:center}</style><main>${cards.map(([name, bytes]) => `<figure><img src="data:image/png;base64,${bytes.toString('base64')}"/><figcaption>${name}</figcaption></figure>`).join('')}</main><p>PM Canvas · ${background} · opaque background</p>`,
    );
    const output = path.join(root, 'test-results/icon-backgrounds/preview.png');
    await mkdir(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    console.log('Preview: ' + output);
  }
} finally {
  await browser.close();
}
console.log(
  `Verified ${images.length} icon images: fully opaque ${background} backgrounds, shared Mac/iOS master and Store/adaptive settings.`,
);
