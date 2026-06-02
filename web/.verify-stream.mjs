import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
await p.evaluate(() => { Object.keys(localStorage).filter(k=>k.startsWith('aimira-chat')).forEach(k=>localStorage.removeItem(k)); });
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.locator('textarea.chat-input').fill('用大约80个字介绍一下间隔重复记忆法');
await p.locator('.chat-send-btn').click();
// sample assistant text length over time
const lens = [];
for (let i = 0; i < 14; i++) {
  await p.waitForTimeout(700);
  const len = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.msg-content.ai-card .msg-text')];
    const last = cards[cards.length-1];
    return last ? last.innerText.length : -1;
  });
  lens.push(len);
  if (i>2 && len>0 && len===lens[i-1] && len===lens[i-2]) break; // stabilized
}
console.log('LEN OVER TIME:', JSON.stringify(lens));
const grew = lens.filter(l=>l>0);
console.log('STREAMED INCREMENTALLY:', new Set(grew).size > 2 ? 'YES' : 'NO', '(distinct lengths:', new Set(grew).size, ')');
await b.close();
