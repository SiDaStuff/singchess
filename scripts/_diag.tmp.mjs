import { chromium } from 'playwright-core';
const base = 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });

// Screen 1: review layout at a short viewport (board controls overlap check).
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 740 } });
  page.setDefaultTimeout(15000);
  await page.goto(base + '/review');
  await page.waitForFunction(() => window.app?.authState?.initialized);
  await page.evaluate(() => { window.app._showPgnModal(); });
  await page.fill('#pgn-input', '[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O *');
  await page.click('#btn-pgn-load');
  await page.waitForFunction(() => window.app.gameMoves.length === 16);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 260));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/diag-review-controls.png' });
  await page.close();
}

// Screen 2: coach chat page.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15000);
  page.on('dialog', d => d.accept());
  await page.goto(base + '/coach');
  await page.waitForFunction(() => window.app?.authState?.initialized);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/diag-coach.png' });
  const info = await page.evaluate(() => {
    const shell = document.querySelector('.coach-chat-shell');
    const r = shell?.getBoundingClientRect();
    return { shell: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, bodyText: document.body.innerText.slice(0, 120) };
  });
  console.log('coach shell:', JSON.stringify(info));
  await page.close();
}

// Screen 3: draw an arrow in review and capture it.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  page.setDefaultTimeout(15000);
  await page.goto(base + '/review');
  await page.waitForFunction(() => window.app?.authState?.initialized);
  await page.evaluate(() => { window.app._showPgnModal(); });
  await page.fill('#pgn-input', '[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *');
  await page.click('#btn-pgn-load');
  await page.waitForFunction(() => window.app.gameMoves.length === 4);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const wrapper = await page.locator('#chess-board').boundingBox();
  const center = async sq => { const b = await page.locator(`#chess-board [data-square="${sq}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const e2 = await center('e2'), e4 = await center('e4');
  await page.mouse.move(e2.x, e2.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(e4.x, e4.y, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  const arrows = await page.evaluate(() => {
    const b = window.app.board;
    return { count: b.userArrows.length, lines: b.arrowLayer?.querySelectorAll('line').length, overlay: b.arrowLayer ? getComputedStyle(b.arrowLayer).display : null, z: b.arrowLayer ? getComputedStyle(b.arrowLayer).zIndex : null };
  });
  console.log('review arrows:', JSON.stringify(arrows));
  await page.screenshot({ path: 'artifacts/diag-arrows-review.png' });
  await page.close();
}

await browser.close();