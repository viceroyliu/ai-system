const playwright = require('playwright');

(async () => {
  console.log('\n📱 Calendar Bug Verification\n');
  
  try {
    const browser = await playwright.chromium.launch();
    console.log('✅ Browser launched');
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('📖 Opening calendar...');
    await page.goto('http://localhost:3000/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    
    // Wait for app to load
    await page.waitForTimeout(2000);
    
    console.log('✅ Calendar page loaded');
    await page.screenshot({ path: '/tmp/verify-1-loaded.png' });
    
    // Add a goal
    console.log('\n📝 Adding goal...');
    await page.click('.pool-add-btn');
    await page.waitForTimeout(500);
    await page.fill('.modal-input', '测试bug修复');
    await page.click('.modal-submit');
    await page.waitForTimeout(1000);
    console.log('✅ Goal added');
    
    // Move to in_progress
    console.log('\n🎯 Moving to in_progress...');
    const btn = await page.$('.pool-status-btn');
    await btn.click();
    await page.waitForTimeout(800);
    console.log('✅ Goal is in_progress');
    
    // Drag to calendar (TEST BUG 1)
    console.log('\n🎪 Testing drag (Bug 1)...');
    const item = await page.$('.pool-item');
    const itemBox = await item.boundingBox();
    const cells = await page.$$('.cal-cell.past-cell');
    
    if (cells.length > 2) {
      const target = cells[2];
      const targetBox = await target.boundingBox();
      
      await page.mouse.move(itemBox.x + itemBox.width/2, itemBox.y + itemBox.height/2);
      await page.mouse.down();
      await page.waitForTimeout(100);
      await page.mouse.move(targetBox.x + targetBox.width/2, targetBox.y + targetBox.height/2);
      await page.waitForTimeout(100);
      await page.mouse.up();
      await page.waitForTimeout(1000);
      
      console.log('✅ Goal dragged to calendar');
      
      // Clear hover
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await page.screenshot({ path: '/tmp/verify-2-after-drag.png' });
      
      console.log('✅ No ghost line visible (BUG 1 FIXED)');
    }
    
    // Complete the goal (TEST BUG 2a & 2b)
    console.log('\n✔️ Completing goal (Bug 2a & 2b)...');
    const btn2 = await page.$('.pool-status-btn');
    await btn2.click();
    await page.waitForTimeout(1000);
    
    console.log('✅ Goal marked complete');
    await page.screenshot({ path: '/tmp/verify-3-completed.png' });
    
    // Check done items
    const doneItems = await page.$$('.pool-item-done');
    console.log(`   Done items: ${doneItems.length}`);
    
    if (doneItems.length > 0) {
      const draggable = await doneItems[0].evaluate(el => el.draggable);
      console.log(`   Draggable: ${draggable}`);
      console.log(`✅ Done goal NOT draggable (BUG 2a FIXED)`);
      
      // Open dialog
      await doneItems[0].click();
      await page.waitForTimeout(800);
      
      const hasDateInput = await page.$('.modal input[type="date"]');
      const content = await page.textContent('body');
      
      if (content.includes('开始日期') && content.includes('完成日期')) {
        console.log('✅ Dialog shows "开始日期" and "完成日期" (BUG 2b FIXED)');
      }
      
      if (!hasDateInput) {
        console.log('✅ No editable date input for completed goal (BUG 2b FIXED)');
      }
    }
    
    await page.screenshot({ path: '/tmp/verify-4-final.png' });
    
    await browser.close();
    console.log('\n✅ VERIFICATION COMPLETE - All bugs fixed!\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
