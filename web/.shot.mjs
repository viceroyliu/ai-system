import { chromium } from 'playwright';
const map = {
  dashboard: { url: 'http://localhost:3000/', out: '/tmp/sb-shots/dashboard.png', h: 1300 },
  chat: { url: 'http://localhost:3000/chat', out: '/tmp/sb-shots/chat.png', h: 1000 },
};
const keys = process.argv[2] ? [process.argv[2]] : ['dashboard','chat'];
const browser = await chromium.launch();
for (const k of keys) {
  const t = map[k];
  const page = await browser.newPage({ viewport: { width: 1440, height: t.h }, deviceScaleFactor: 2 });
  await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e=>console.log('nav warn', e.message));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: t.out });
  await page.close();
  console.log('shot', t.out);
}
await browser.close();
