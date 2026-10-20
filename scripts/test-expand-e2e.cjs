const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/learner/watch.html#radar/matrix');
  await page.waitForTimeout(1000);

  // 1. Matrix default size
  const defaultMatrix = await page.evaluate(() => {
    const el = document.querySelector('.bwrap');
    const r = el.getBoundingClientRect();
    const btn = document.getElementById('mfExpandBtn');
    return { width: r.width, height: r.height, btnText: btn ? btn.textContent.trim() : null };
  });
  console.log('Matrix default (1280x800):', defaultMatrix);

  // 2. Click expand on matrix
  await page.click('#mfExpandBtn');
  await page.waitForTimeout(500);

  const fullMatrix = await page.evaluate(() => {
    const sec = document.getElementById('secMf');
    const bwrap = sec ? sec.querySelector('.bwrap') : null;
    const btn = document.getElementById('mfExpandBtn');
    const isFull = sec ? sec.classList.contains('chart-fullscreen') : false;
    const br = bwrap ? bwrap.getBoundingClientRect() : null;
    return {
      isFull,
      btnText: btn ? btn.textContent.trim() : null,
      bwrapSize: br ? { width: br.width, height: br.height } : null
    };
  });
  console.log('Matrix fullscreen:', fullMatrix);

  // 3. Press Escape to exit fullscreen
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const exitMatrix = await page.evaluate(() => {
    const sec = document.getElementById('secMf');
    const btn = document.getElementById('mfExpandBtn');
    return {
      isFull: sec ? sec.classList.contains('chart-fullscreen') : false,
      btnText: btn ? btn.textContent.trim() : null
    };
  });
  console.log('Matrix after Escape:', exitMatrix);

  // 4. Switch to Replay
  await page.click('[data-mv="replay"]');
  await page.waitForTimeout(600);

  const defaultReplay = await page.evaluate(() => {
    const el = document.querySelector('.bwrap.radar');
    const r = el.getBoundingClientRect();
    const btn = document.getElementById('mrpExpandBtn');
    return { width: r.width, height: r.height, btnText: btn ? btn.textContent.trim() : null };
  });
  console.log('Replay default (1280x800):', defaultReplay);

  // 5. Click expand on replay
  await page.click('#mrpExpandBtn');
  await page.waitForTimeout(500);

  const fullReplay = await page.evaluate(() => {
    const sec = document.getElementById('secMrp');
    const bwrap = sec ? sec.querySelector('.bwrap.radar') : null;
    const btn = document.getElementById('mrpExpandBtn');
    const isFull = sec ? sec.classList.contains('chart-fullscreen') : false;
    const br = bwrap ? bwrap.getBoundingClientRect() : null;
    return {
      isFull,
      btnText: btn ? btn.textContent.trim() : null,
      bwrapSize: br ? { width: br.width, height: br.height } : null
    };
  });
  console.log('Replay fullscreen:', fullReplay);

  // Take screenshot of fullscreen replay
  await page.screenshot({ path: 'scripts/replay-fullscreen.png' });

  // 6. Press Escape to exit replay fullscreen
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const exitReplay = await page.evaluate(() => {
    const sec = document.getElementById('secMrp');
    const btn = document.getElementById('mrpExpandBtn');
    return {
      isFull: sec ? sec.classList.contains('chart-fullscreen') : false,
      btnText: btn ? btn.textContent.trim() : null
    };
  });
  console.log('Replay after Escape:', exitReplay);

  await browser.close();
})();
