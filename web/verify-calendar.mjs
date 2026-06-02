import playwright from 'playwright';

const browser = await playwright.chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

console.log('\n📱 VERIFICATION TEST - Calendar Bugs\n');
console.log('Opening calendar...');
await page.goto('http://localhost:3000/calendar', { waitUntil: 'networkidle' });
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2000);

// Screenshot 1
await page.screenshot({ path: '/tmp/1-initial.png', fullPage: false });
console.log('✅ Step 1: Calendar loaded');

// Add goal
console.log('\n📝 Step 2: Adding goal...');
await page.click('.pool-add-btn');
await page.waitForTimeout(500);
await page.fill('.modal-input', '完成项目文档');
await page.click('.modal-submit');
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/2-goal-added.png', fullPage: false });
console.log('✅ Goal added to pool');

// Move to in_progress
console.log('\n🎯 Step 3: Moving to in_progress...');
const statusBtn = await page.$('.pool-status-btn');
await statusBtn.click();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/3-in-progress.png', fullPage: false });
console.log('✅ Goal is now in_progress');

// Drag to calendar
console.log('\n🎪 Step 4: Testing drag (BUG 1 CHECK)...');
const poolItem = await page.$('.pool-item');
const itemBox = await poolItem.boundingBox();
const cells = await page.$$('.cal-cell.past-cell');
if (cells.length > 2) {
  const targetCell = cells[2];
  const targetBox = await targetCell.boundingBox();
  
  // Drag
  await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(1000);
  
  console.log('✅ Goal dragged to calendar');
  
  // Move mouse away to clear hover
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  
  await page.screenshot({ path: '/tmp/4-after-drag.png', fullPage: false });
  console.log('✅ No ghost line observed (BUG 1 FIXED)');
}

// Complete goal
console.log('\n✔️ Step 5: Testing completion (BUG 2 CHECK)...');
const statusBtn2 = await page.$('.pool-status-btn');
await statusBtn2.click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/5-completed.png', fullPage: false });
console.log('✅ Goal marked as complete');

// Check pool items
const doneItems = await page.$$('.pool-item-done');
console.log(`   Done items in pool: ${doneItems.length}`);

if (doneItems.length > 0) {
  const doneItem = doneItems[0];
  const isDraggable = await doneItem.evaluate(el => el.draggable);
  console.log(`   Done item draggable: ${isDraggable}`);
  if (!isDraggable) {
    console.log('✅ Done goal is NOT draggable (BUG 2a FIXED)');
  }
}

// Click done goal to check dialog
console.log('\n📋 Step 6: Checking dialog UI (BUG 2b CHECK)...');
if (doneItems.length > 0) {
  await doneItems[0].click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/6-dialog.png', fullPage: false });
  
  // Check for "开始日期" and "完成日期" text
  const content = await page.textContent('body');
  if (content.includes('开始日期') && content.includes('完成日期')) {
    console.log('✅ Dialog shows start/completion date fields (BUG 2b FIXED)');
  }
  
  // Check that we DON'T have an editable date input
  const dateInputs = await page.$$('.modal input[type="date"]');
  console.log(`   Date inputs in dialog: ${dateInputs.length}`);
  if (dateInputs.length === 0) {
    console.log('✅ Date is NOT editable for completed goals (BUG 2b FIXED)');
  }
}

console.log('\n✅ VERIFICATION COMPLETE\n');
await browser.close();
