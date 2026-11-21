import assert from 'node:assert/strict';

// The sidebar's section links: under New chat, the current one marked, and
// Activity narrowing the list. The CI store is empty, so nothing needs you
// and the Activity list says so; Conversations brings every chat back.
export async function checkNav(page) {
  const nav = page.locator('.sidebar-actions > nav.vn-nav');
  await nav.waitFor({ state: 'attached' });
  if (!(await nav.isVisible())) return { skipped: 'sidebar is a closed drawer at this size' };
  const state = () => page.evaluate(() => {
    const newChat = document.querySelector('#newChatBtn').getBoundingClientRect();
    const links = document.querySelector('.vn-nav').getBoundingClientRect();
    return {
      shown: [...document.querySelectorAll('.vn-nav-item')].filter((b) => !b.hidden).map((b) => b.dataset.nav),
      current: [...document.querySelectorAll('.vn-nav-item[aria-current="page"]')].map((b) => b.dataset.nav),
      underNewChat: links.top >= newChat.bottom - 1,
      list: document.documentElement.dataset.vnList ?? null,
      note: Boolean(document.querySelector('.vn-activity-empty')),
    };
  });
  const start = await state();
  assert(start.underNewChat, 'Links sit under New chat');
  assert.deepEqual(start.shown.slice(0, 2), ['activity', 'chats'], 'Activity and Conversations always show');
  assert.deepEqual(start.current, ['chats'], 'Conversations is current by default');

  await nav.locator('[data-nav="activity"]').click();
  const activity = await state();
  assert.deepEqual(activity.current, ['activity']);
  assert.equal(activity.list, 'activity');
  assert(activity.note, 'An empty Activity list says so');

  await nav.locator('[data-nav="chats"]').click();
  const back = await state();
  assert.deepEqual(back.current, ['chats']);
  assert.equal(back.list, null);
  assert(!back.note, 'The note leaves with the filter');
  return { shown: start.shown };
}
