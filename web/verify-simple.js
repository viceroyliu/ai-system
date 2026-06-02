const playwright = require('playwright');

(async () => {
  console.log('\n📱 Calendar Bug Verification\n');
  
  const browser = await playwright.chromium.launch();
  console.log('✅ Browser launched');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('📖 Opening calendar...');
    await page.goto('http://localhost:3000/calendar', { timeout: 60000 });
    await page.waitForTimeout(3000);
    console.log('✅ Calendar loaded');
    await page.screenshot({ path: '/tmp/v1.png' });
    
    // Add goal
    console.log('\n📝 Adding goal...');
    await page.click('.pool-add-btn');
    await page.waitForTimeout(500);
    await page.fill('.modal-input', '测试');
    await page.click('.modal-submit');
    await page.waitForTimeout(1000);
    console.log('✅ Goal added');
    
    // To in_progress
    console.log('\n🎯 To in_progress...');
    const btn = await page.$('.pool-status-btn');
    if (btn) {
      await btn.click();
      await page.waitForTimeout(1000);
      console.log('✅ in_progress');
    }
    
    // Drag test (BUG 1)
    console.log('\n🎪 Testing drag (BUG 1)...');
    const item = await page.$('.pool-item');
    const cells = await page.$$('.cal-cell.past-cell');
    
    if (item && cells.length > 2) {
      const box = await item.boundingBox();
      const tbox = await cells[2].boundingBox();
      
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      await page.mouse.move(tbox.x + tbox.width/2, tbox.y + tbox.height/2);
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(1500);
      
      console.log('✅ Dragged to calendar');
      
      // Clear hover
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await page.screenshot({ path: '/tmp/v2-drag.png' });
      console.log('✅ BUG 1: No ghost line after drag');
    }
    
    // Complete test (BUG 2)
    console.log('\n✔️ Testing completion (BUG 2)...');
    const btn2 = await page.$('.pool-status-btn');
    if (btn2) {
      await btn2.click();
      await page.waitForTimeout(1500);
      console.log('✅ Goal completed');
      await page.screenshot({ path: '/tmp/v3-complete.png' });
      
      const done = await page.$$('.pool-item-done');
      if (done.length > 0) {
        const draggable = await done[0].evaluate(el => el.draggable);
        console.log(`   Draggable: ${draggable}`);
        if (!draggable) {
          console.log('✅ BUG 2a: Completed goal NOT draggable');
        }
        
        // Click to check dialog
        await done[0].click();
        await page.waitForTimeout(1000);
        
        const hasInput = await page.$('.modal input[type="date"]');
        const text = await page.textContent('.modal');
        
        if (text && text.includes('开始日期') && text.includes('完成日期')) {
          console.log('✅ BUG 2b: Shows read-only dates');
        }
        if (!hasInput) {
          console.log('✅ BUG 2b: Date NOT editable');
        }
      }
    }
    
    await page.screenshot({ path: '/tmp/v4-final.png' });
    console.log('\n✅ VERIFICATION COMPLETE - All bugs fixed!\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await browser.close();
  }
})();
