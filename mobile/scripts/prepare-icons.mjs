import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Match the final Windows/Mac artwork; do not maintain a separate mobile logo.
const ico = await readFile(path.join(root, '../desktop/build/icon.ico'));
assert.equal(ico.readUInt16LE(2), 1);
let original;
for (let index = 0; index < ico.readUInt16LE(4); index++) {
  const entry = 6 + index * 16;
  if (ico[entry] || ico[entry + 1]) continue;
  const offset = ico.readUInt32LE(entry + 12);
  original = ico.subarray(offset, offset + ico.readUInt32LE(entry + 8));
}
assert.ok(original && original.subarray(1, 4).toString() === 'PNG');
await writeFile(path.join(root, 'assets/icon.png'), original);
await writeFile(path.join(root, '../web/public/icon.png'), original);
const background = '#2c2e3a';
const image = `data:image/png;base64,${original.toString('base64')}`;
const artwork = (inset = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><image href="${image}" x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}"/></svg>`;
const svg = artwork();
const iconNotes = await readFile(path.join(root, '../desktop/build/ICONS.md'), 'utf8');
const license = iconNotes.slice(iconNotes.indexOf('Copyright (c)'));
await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(path.join(root, 'public/LICENSE.electron.txt'), license);
await copyFile(
  path.join(root, 'public/LICENSE.electron.txt'),
  path.join(root, '../web/public/LICENSE.electron.txt'),
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(relative, size, content = svg, color = background) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:${color}}svg{width:100%;height:100%}</style>${content}`,
    );
    await page.screenshot({ path: target, omitBackground: false });
  }
  await render('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024);
  const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#f5f6fa"/><image href="${image}" x="410" y="410" width="204" height="204"/></svg>`;
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
    await render('ios/App/App/Assets.xcassets/Splash.imageset/' + name, 2732, splash, '#f5f6fa');
  const res = 'android/app/src/main/res/';
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
} finally {
  await browser.close();
}
console.log('Mobile icons, launch screens and web branding generated from desktop/build/icon.ico.');
