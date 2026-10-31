import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const svg = await readFile(path.join(root, 'assets/icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(relative, size, content = svg, background = '#5368dd') {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:${background}}svg{width:100%;height:100%}</style>${content}`,
    );
    await page.screenshot({ path: target, omitBackground: false });
  }
  await render('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024);
  const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#f5f6fa"/><svg x="410" y="410" width="204" height="204" viewBox="0 0 1024 1024">${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></svg>`;
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
    await render(`${res}mipmap-${density}/ic_launcher_foreground.png`, Math.round(size * 2.25));
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
console.log('Mobile icons and launch screens generated from assets/icon.svg.');
