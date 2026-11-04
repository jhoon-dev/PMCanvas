// Exercise the visible desktop-ordered menu, including routes outside the quick bar.
export async function openView(page, view) {
  if (!(await page.locator('#workspaceDrawer').isVisible()))
    await page.getByRole('button', { name: '프로젝트 메뉴 열기', exact: true }).click();
  await page.locator(`#workspaceNavigation [data-view="${view}"]`).click();
}
