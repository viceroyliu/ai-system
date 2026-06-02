import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
// clear chat storage for a clean test
await p.evaluate(() => { Object.keys(localStorage).filter(k=>k.startsWith('aimira-chat')).forEach(k=>localStorage.removeItem(k)); });
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const ta = p.locator('textarea.chat-input');
await ta.fill('一句话介绍你自己');
await p.locator('.chat-send-btn').click();
await p.waitForSelector('.msg-actions', { timeout: 180000 }).catch(()=>{});
await p.waitForTimeout(1500);
const after = await p.evaluate(() => {
  const sessions = JSON.parse(localStorage.getItem('aimira-chat-sessions')||'[]');
  const msgKeys = Object.keys(localStorage).filter(k=>k.startsWith('aimira-chat-msgs-'));
  return { sessionCount: sessions.length, msgKeys: msgKeys.length, firstTitle: sessions[0]?.title, msgCount: msgKeys[0]? JSON.parse(localStorage.getItem(msgKeys[0])).length : 0 };
});
console.log('AFTER SEND:', JSON.stringify(after));
// reload plain /chat -> should auto-load latest conversation
await p.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const reloaded = await p.evaluate(() => document.querySelectorAll('.chat-msg').length);
console.log('MSGS VISIBLE AFTER RELOAD (no params):', reloaded);
await b.close();
