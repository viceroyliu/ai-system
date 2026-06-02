import playwright from 'playwright';

const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

console.log('\n📱 REGRESSION TEST - User-reported calendar bugs\n');

await page.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(() => localStorage.setItem('ai_calendar_goals', '[]'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

async function chips(page) {
  return await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.cal-cell'));
    const out = [];
    for (const c of cells) {
      const day = c.querySelector('.cal-day-num')?.textContent;
      if (!day) continue;
      const items = Array.from(c.querySelectorAll('.cal-item')).map(i => ({
        cls: i.className.replace('cal-item ', ''),
        txt: i.textContent?.trim(),
        opacity: i.style?.opacity,
      }));
      if (items.length) out.push({ day, items });
    }
    return out;
  });
}
async function cgs(page) {
  return await page.evaluate(() => JSON.parse(localStorage.getItem('ai_calendar_goals') || '[]'));
}
async function getBox(h) { const el = h.asElement ? h.asElement() : h; return el ? await el.boundingBox() : null; }
async function dragTo(page, src, dst) {
  const sb = await getBox(src), db = await getBox(dst);
  if (!sb || !db) throw new Error('bbox missing');
  await page.mouse.move(sb.x + sb.width/2, sb.y + sb.height/2);
  await page.mouse.down(); await page.waitForTimeout(80);
  await page.mouse.move(db.x + db.width/2, db.y + db.height/2, { steps: 10 });
  await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(900);
}
function clickPoolBtnByTitle(page, title) {
  return page.evaluate((t) => {
    for (const item of document.querySelectorAll('.pool-item'))
      if (item.querySelector('.pool-item-title')?.textContent === t) {
        item.querySelector('.pool-status-btn').click(); return true;
      }
    return false;
  }, title);
}

// Programmatically dispatch HTML5 drop event (bypassing mouse simulation,
// since headless chromium does not fire HTML5 drag events from raw mouse moves).
async function dispatchDrop(page, { fromGoalScheduleId, goalId, goalTitle, targetDayNum }) {
  return await page.evaluate((args) => {
    const cells = Array.from(document.querySelectorAll('.cal-cell'));
    const cell = cells.find(c => c.querySelector('.cal-day-num')?.textContent === args.targetDayNum);
    if (!cell) return { ok: false, reason: 'cell not found' };
    const dt = new DataTransfer();
    if (args.fromGoalScheduleId) dt.setData('fromGoalScheduleId', args.fromGoalScheduleId);
    dt.setData('goalId', args.goalId);
    dt.setData('goalTitle', args.goalTitle);
    const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    cell.dispatchEvent(dragOver);
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    cell.dispatchEvent(drop);
    return { ok: true };
  }, { fromGoalScheduleId, goalId, goalTitle, targetDayNum });
}

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
const TODAY_DAY = String(parseInt(today.slice(8), 10));
const TITLE = `回测_${Date.now().toString(36).slice(-6)}`;
console.log(`Using unique title: ${TITLE}`);

// ────── BUG 1 ──────
console.log('═══ BUG 1: not-started goal drag → click Start → no stale ═══');
await page.click('.pool-add-btn');
await page.waitForTimeout(400);
await page.fill('.modal-input', TITLE);
await page.click('.modal-submit');
await page.waitForTimeout(1500);

// Get goalId for this new goal
let goalEntry = await page.evaluate((t) => {
  const items = Array.from(document.querySelectorAll('.pool-item'));
  for (const it of items) {
    if (it.querySelector('.pool-item-title')?.textContent === t) {
      // We don't have direct access to goal id from DOM; use indirection via localStorage after drop
      return { found: true };
    }
  }
  return { found: false };
}, TITLE);

const pool1 = await page.$('.pool-item');
const cells1 = await page.$$('.cal-cell.past-cell');
const targetDrag1 = cells1[Math.max(0, cells1.length - 5)];
const day1 = await targetDrag1.evaluate(el => el.querySelector('.cal-day-num')?.textContent);
console.log(`   drag to past day=${day1}`);
await dragTo(page, pool1, targetDrag1);

let cg = await cgs(page);
let mine = cg.find(g => g.goalTitle === TITLE);
console.log(`   cg after drag: ${JSON.stringify(mine)}`);

await clickPoolBtnByTitle(page, TITLE);
await page.waitForTimeout(1500);

cg = await cgs(page);
mine = cg.find(g => g.goalTitle === TITLE);
const all = cg.filter(g => g.goalTitle === TITLE);
console.log(`   cg after Start: ${JSON.stringify(all)}`);
const stale = all.filter(g => g.date !== today);
console.log(stale.length === 0 ? '   ✅ BUG 1 PASS\n' : `   ❌ BUG 1 FAIL (stale=${stale.length})\n`);

// ────── BUG 2 ──────
console.log('═══ BUG 2: done chip drag → in_progress ghost preserved ═══');

// At this point, goal is in_progress at today. Move it to a past day via dispatch drop.
const X_DAY = String(parseInt(TODAY_DAY, 10) - 4); // 4 days ago
console.log(`   move in_progress chip to day=${X_DAY} via dispatchDrop`);
let r = await dispatchDrop(page, { fromGoalScheduleId: mine.id, goalId: mine.goalId, goalTitle: TITLE, targetDayNum: X_DAY });
await page.waitForTimeout(900);
console.log(`   dispatch result: ${JSON.stringify(r)}`);
cg = await cgs(page);
mine = cg.find(g => g.goalTitle === TITLE);
console.log(`   cg after move: ${JSON.stringify(mine)}`);

// Click Complete in pool
await clickPoolBtnByTitle(page, TITLE);
await page.waitForTimeout(1500);
cg = await cgs(page);
mine = cg.find(g => g.goalTitle === TITLE);
console.log(`   cg after Complete: ${JSON.stringify(mine)}`);

const expDate = today;
const expStart = `2026-05-${X_DAY.padStart(2,'0')}`;
console.log(`   expected: date=${expDate}, startDate=${expStart}`);

let dom = await chips(page);
const ghostAtX = dom.find(d => d.day === X_DAY && d.items.some(i => i.txt?.includes(TITLE) && i.opacity === '0.5'));
const doneAtToday = dom.find(d => d.day === TODAY_DAY && d.items.some(i => i.cls.includes('goal-done') && i.txt?.includes(TITLE)));
console.log(`   ghost at day ${ghostAtX?.day || 'NONE'} (cls=${ghostAtX?.items.find(i => i.txt?.includes(TITLE))?.cls})`);
console.log(`   done at day ${doneAtToday?.day || 'NONE'}`);

if (!ghostAtX) { console.log('   ❌ BUG 2 setup failed — no ghost rendered'); await browser.close(); process.exit(1); }

// Now drag the done chip via popover (dispatch drop) to a different past day Y
const Y_DAY = String(parseInt(TODAY_DAY, 10) - 7);
console.log(`   drag done chip → day=${Y_DAY} via dispatchDrop (simulating popover drag with fromGoalScheduleId)`);
r = await dispatchDrop(page, { fromGoalScheduleId: mine.id, goalId: mine.goalId, goalTitle: TITLE, targetDayNum: Y_DAY });
await page.waitForTimeout(900);
cg = await cgs(page);
mine = cg.find(g => g.goalTitle === TITLE);
console.log(`   cg after drag done: ${JSON.stringify(mine)}`);

const startPreserved = mine?.startDate === expStart;
const movedToY = mine?.date === `2026-05-${Y_DAY.padStart(2,'0')}`;

dom = await chips(page);
const ghostFinal = dom.find(d => d.day === X_DAY && d.items.some(i => i.txt?.includes(TITLE) && i.opacity === '0.5'));
const doneFinal = dom.find(d => d.day === Y_DAY && d.items.some(i => i.cls.includes('goal-done') && i.txt?.includes(TITLE)));
console.log(`   after drag: ghost at day ${ghostFinal?.day || 'NONE'}, done at day ${doneFinal?.day || 'NONE'}`);
console.log(`   startDate preserved? ${startPreserved}, moved to Y? ${movedToY}`);
console.log((startPreserved && movedToY && ghostFinal) ? '   ✅ BUG 2 PASS\n' : '   ❌ BUG 2 FAIL\n');

await browser.close();
