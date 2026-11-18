import { test, expect } from '@playwright/test';
import { openView } from './navigation.mjs';
import { layoutProject } from './fixtures/layout-project.mjs';

test('task editor controls fit iPhone portrait and landscape, safe areas and keyboard sizes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const p = layoutProject();
  p.members[0].name = '플랫폼서비스담당자'.repeat(8);
  await page.goto('/');
  await page.locator('#importFile').setInputFiles({
    name: 'sizing.pmcanvas',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.locator('#activeProjectName')).toHaveText(p.name);
  await openView(page, 'tasks');
  for (const [width, height] of [
    [375, 667],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('.page-head [data-action="task"]').click();
    await page.locator('#editor [name=name]').fill('iPhone 업무 입력');
    await page.locator('#editor [name=itemTitle]').fill('세부 작업');
    const boxes = await page.locator('#editor').evaluate((root) =>
      [...root.querySelectorAll('input,select,textarea,button')]
        .filter((el) => el.getBoundingClientRect().width)
        .map((el) => {
          const b = el.getBoundingClientRect(),
            parent = el.parentElement.getBoundingClientRect();
          return {
            name: el.name || el.id,
            type: el.type,
            width: b.width,
            height: b.height,
            outside:
              b.left < parent.left - 1 ||
              b.right > parent.right + 1 ||
              b.left < -1 ||
              b.right > innerWidth + 1,
            clipped: el.scrollWidth > el.clientWidth + 2,
          };
        }),
    );
    expect(boxes.filter((b) => b.outside)).toEqual([]);
    const controls = boxes.filter((b) =>
      ['name', 'owner', 'start', 'end', 'itemTitle', 'itemHours', 'parentId', 'phase'].includes(
        b.name,
      ),
    );
    expect(controls.length).toBe(8);
    for (const control of controls)
      expect(control.height, control.name + ' at ' + width).toBeGreaterThanOrEqual(44);
    expect(await page.locator('#editor [name=owner]').inputValue()).toBe(p.members[0].id);
    await page.locator('#editor [name=owner]').selectOption(p.members[1].id);
    expect(await page.locator('#editor [name=owner]').inputValue()).toBe(p.members[1].id);
    await page.locator('#editor .task-details').evaluate((el) => {
      el.open = true;
    });
    const multiple = await page.locator('#editor [name=predecessor]').boundingBox();
    expect(multiple.height).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath('task-editor-' + width + '.png') });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-area-inset-top', '47px');
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px');
    });
    await page.setViewportSize({ width, height: 360 });
    await page.locator('#editor [name=itemTitle]').focus();
    const footer = await page.locator('#editor .dialog-actions').boundingBox();
    expect(footer.y).toBeGreaterThanOrEqual(0);
    expect(footer.y + footer.height).toBeLessThanOrEqual(361);
    await expect(page.locator('#submitEditor')).toBeVisible();
    await page.getByRole('button', { name: '입력 취소', exact: true }).click();
    await page.getByRole('button', { name: '버리기', exact: true }).click();
  }
});
