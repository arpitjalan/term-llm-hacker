import assert from 'node:assert/strict';

// The home panel on a new chat: its fetch sections stand in for the app's
// heading, fit the viewport, and the Appearance switch removes and restores it.
export async function checkHome(page) {
  const empty = page.locator('.messages > .empty-chat');
  await empty.waitFor({ state: 'attached' });
  await empty.locator(':scope > .vn-home').waitFor({ state: 'attached' });
  const state = await page.evaluate(() => {
    const e = document.querySelector('.messages > .empty-chat');
    const home = e.querySelector(':scope > .vn-home');
    const appHeading = e.querySelector(':scope > h2');
    const r = home.getBoundingClientRect();
    return {
      sections: [...home.querySelectorAll('.vn-fetch-section > .vn-fetch-rule:first-child')].map((n) => n.textContent),
      rows: [...home.querySelectorAll('.vn-fetch-row dt')].map((dt) => dt.textContent.replace(/[│├└\s]/g, '')),
      headline: home.querySelector('h2.vn-home-line')?.textContent.replace(/^❯\s*/, '').trim() ?? '',
      appHeadingHidden: !appHeading || getComputedStyle(appHeading).display === 'none',
      keysLast: e.lastElementChild?.classList.contains('vn-home-keys') ?? false,
      // Hints show wherever the layout has room for them (wider than 640px).
      keysShown: innerWidth <= 640 || (() => {
        const k = e.querySelector(':scope > .vn-home-keys');
        const kr = k?.getBoundingClientRect();
        return Boolean(k && getComputedStyle(k).display !== 'none' && kr.width > 0 && kr.height > 0);
      })(),
      fits: r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth,
    };
  });
  assert(state.sections.some((s) => s.includes(' agent ')) && state.sections.some((s) => s.includes(' workspace ')), 'Fetch sections render');
  for (const key of ['name', 'model', 'effort', 'chats', 'status', 'theme']) assert(state.rows.includes(key), `Fetch row: ${key}`);
  assert(state.headline.length > 0, 'Prompt headline');
  assert(state.appHeadingHidden, 'The panel stands in for the app heading');
  assert(state.keysLast, 'Key hints close the screen');
  assert(state.keysShown, 'Key hints are visible where there is room');
  assert(state.fits, 'Home fits the viewport without horizontal scrolling');

  await page.locator('.vn-theme-btn').click();
  const toggle = page.locator('.vn-popover:not([data-leaving]) [data-home]');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await page.waitForFunction(() => !document.querySelector('.empty-chat > .vn-home'));
  assert(await page.evaluate(() => {
    const h = document.querySelector('.empty-chat > h2');
    return !h || getComputedStyle(h).display !== 'none';
  }), 'The app heading returns without the panel');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await page.waitForFunction(() => !!document.querySelector('.empty-chat > .vn-home'));
  await page.keyboard.press('Escape');
  await page.locator('.vn-popover').waitFor({ state: 'detached' });
  return state;
}
