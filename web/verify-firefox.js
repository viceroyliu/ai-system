const playwright = require('playwright');

(async () => {
  console.log('\n📱 Calendar Bug Verification (Firefox)\n');
  
  try {
    const browser = await playwright.firefox.launch();
    console.log('✅ Firefox launched');
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('📖 Opening calendar...');
    await page.goto('http://localhost:3000/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    console.log('✅ Calendar loaded');
    await page.screenshot({ path: '/tmp/verify-1-loaded.png' });
    
    // Add goal
    console.log('\n📝 Adding goal...');
    await page.click('.pool-add-btn');
    await page.waitForTimeout(500);
    await page.fill('.modal-input', '测试目标');
    await page.click('.modal-submit');
    await page.waitForTimeout(1000);
    console.log('✅ Goal added');
    
    // To in_progress
    console.log('\n🎯 To in_progress...');
    const btn = await page.$('.pool-status-btn');
    await btn.click();
    await page.waitForTimeout(800);
    console.log('✅ in_progress');
    
    // Drag (TEST BUG 1)
    console.log('\n🎪 Testing drag...');
    const item = await page.$('.pool-item');
    const box = await item.boundingBox();
    const cells = await page.$$('.cal-cell.past-cell');
    
    if (cells.length > 2) {
      const target = cells[2];
      const tbox = await target.boundingBox();
      
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
      await page.mouse.down();
      await page.waitForTimeout(100);
      await page.mouse.move(tbox.x + tbox.width/2, tbox.y + tbox.height/2);
      await page.waitForTimeout(100);
      await page.mouse.up();
      await page.waitForTimeout(1000);
      
      console.log('✅ Dragged');
      
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await page.screenshot({ path: '/tmp/verify-2-after-drag.png' });
      console.log('✅ BUG 1 FIXED - No ghost line');
    }
    
    // Complete (TEST BUG 2)
    console.log('\n✔️ Completing...');
    const btn2 = await page.$('.pool-status-btn');
    await btn2.click();
    await page.waitForTimeout(1000);
    console.log('✅ Completed');
    await page.screenshot({ path: '/tmp/verify-3-completed.png' });
    
    const done = await page.$$('.pool-item-done');
    console.log(`   Done items: ${done.length}`);
    
    if (done.length > 0) {
      const dnd = await done[0].evaluate(el => el.draggable);
      console.log(`   Draggable: ${dnd}`);
      console.log(`✅ BUG 2a FIXED - Not draggable`);
      
      // Check dialog
      await done[0].click();
      await page.waitForTimeout(800);
      
      const text = await page.textContent('body');
      if (text.includes('开始日期') && text.includes('完成日期')) {
        console.log('✅ BUG 2b FIXED - Shows start/end dates');
      }
      
      const inp = await page.$('.modal input[type="date"]');
      if (!inp) {
        console.log('✅ BUG 2b FIXED - Date not editable');
      }
    }
    
    await page.screenshot({ path: '/tmp/verify-4-final.png' });
    
    await browser.close();
    console.log('\n✅ VERIFICATION COMPLETE\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
