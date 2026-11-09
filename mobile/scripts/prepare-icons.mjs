import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Render the PM Canvas vector master; never resample a previously generated icon.
const vector = await readFile(path.join(root, '../desktop/build/icon-source.svg'), 'utf8');
const renderer = await chromium.launch();
let original;
try {
  const page = await renderer.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;width:100%;height:100%}svg{display:block}</style>${vector}`,
  );
  original = await page.screenshot({ omitBackground: false });
  await writeFile(path.join(root, '../desktop/build/icon-source.png'), original);
} finally {
  await renderer.close();
}
assert.ok(original.subarray(1, 4).toString() === 'PNG');
const { background } = JSON.parse(
  await readFile(path.join(root, '../desktop/build/icon-settings.json'), 'utf8'),
);
assert.match(background, /^#[a-f0-9]{6}$/i);
const desktopOnly = process.argv.includes('--desktop');
const image = `data:image/png;base64,${original.toString('base64')}`;
const artwork = (inset = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><image href="${image}" x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}"/></svg>`;
const svg = artwork();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function png(size, content = svg, color = background) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:${color}}svg{width:100%;height:100%}</style>${content}`,
    );
    return page.screenshot({ omitBackground: false });
  }
  async function render(relative, size, content = svg, color = background) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await png(size, content, color));
  }
  // macOS and iOS use byte-identical opaque 1024px artwork.
  await writeFile(path.join(root, '../desktop/build/icon-mac.png'), original);
  for (const [file, size] of [
    ['../desktop/ui/icon.png', 256],
    ['../desktop/build/store/StoreLogo.png', 50],
    ['../desktop/build/store/Square150x150Logo.png', 150],
    ['../desktop/build/store/Square44x44Logo.png', 44],
  ])
    await render(file, size);
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const frames = [];
  for (const size of sizes) frames.push(await png(size));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  }
  await writeFile(path.join(root, '../desktop/build/icon.ico'), Buffer.concat([header, ...frames]));
  if (!desktopOnly) {
    await writeFile(path.join(root, 'assets/icon.png'), original);
    await writeFile(path.join(root, '../web/public/icon.png'), original);
    await writeFile(
      path.join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
      original,
    );
    const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#f5f6fa"/><image href="${image}" x="410" y="410" width="204" height="204"/></svg>`;
    for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
      await render('ios/App/App/Assets.xcassets/Splash.imageset/' + name, 2732, splash, '#f5f6fa');
    const res = 'android/app/src/main/res/';
    await writeFile(
      path.join(root, res, 'values/ic_launcher_background.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background.toUpperCase()}</color>\n</resources>\n`,
    );
    for (const [density, size] of [
      ['mdpi', 48],
      ['hdpi', 72],
      ['xhdpi', 96],
      ['xxhdpi', 144],
      ['xxxhdpi', 192],
    ]) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png'])
        await render(`${res}mipmap-${density}/${name}`, size);
      // Keep the complete symbol inside Android's adaptive icon safe area.
      await render(
        `${res}mipmap-${density}/ic_launcher_foreground.png`,
        Math.round(size * 2.25),
        artwork(208),
      );
    }
    // Replace every template splash, including orientation variants, with the brand.
    const { readdir } = await import('node:fs/promises');
    for (const directory of await readdir(path.join(root, res))) {
      if (!directory.startsWith('drawable')) continue;
      if (!(await readdir(path.join(root, res, directory))).includes('splash.png')) continue;
      await render(`${res}${directory}/splash.png`, 1024, splash, '#f5f6fa');
    }
  }
} finally {
  await browser.close();
}
console.log(
  'Icons generated from desktop/build/icon-source.png with background ' + background + '.',
);
