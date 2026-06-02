import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
await p.evaluate(() => { Object.keys(localStorage).filter(k=>k.startsWith('aimira-chat')).forEach(k=>localStorage.removeItem(k)); localStorage.setItem('ai_autosend_enabled','1'); localStorage.setItem('ai_autosend_seconds','3'); });
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
// click first suggestion chip in empty state (button containing ？)
const chip = p.locator('.chat-messages button').filter({ hasText: '？' }).first();
const has = await chip.count();
if (!has) { console.log('NO SUGGESTION CHIP FOUND'); await b.close(); process.exit(0); }
const chipText = (await chip.innerText()).trim();
await chip.click();
// observe send button countdown number
await p.waitForTimeout(900);
const btnText1 = await p.locator('.chat-send-btn').innerText().catch(()=> '');
// wait for autosend (3s) and the user message to appear
await p.waitForSelector('.msg-content.user-bubble', { timeout: 8000 }).catch(()=>{});
const userMsgs = await p.evaluate(() => [...document.querySelectorAll('.user-bubble .msg-text')].map(e=>e.innerText.trim()));
console.log('CHIP TEXT:', chipText);
console.log('SEND BTN SHOWED COUNTDOWN:', /^[0-9]$/.test(btnText1) ? 'YES ('+btnText1+')' : 'maybe ('+btnText1+')');
console.log('AUTO-SENT USER MSG:', userMsgs.length ? 'YES → '+JSON.stringify(userMsgs[0].slice(0,20)) : 'NO');
await b.close();
