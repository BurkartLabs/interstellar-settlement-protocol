// Screenshot every mockup at desktop and phone width; report console errors and horizontal overflow.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = __dirname, out = path.join(dir, 'screenshots');
const only = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const files = fs.readdirSync(dir).filter(f => /^\d\d-.*\.html$/.test(f) && (!only.length || only.some(o => f.startsWith(o))));
  for (const f of files) {
    for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errs = [];
      page.on('console', m => m.type() === 'error' && errs.push(m.text()));
      page.on('pageerror', e => errs.push(String(e)));
      await page.goto(require('url').pathToFileURL(path.join(dir, f)).href, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const base = f.replace('.html', '') + '-' + tag;
      await page.screenshot({ path: path.join(out, base + '.png') });
      if (tag === 'desk') await page.screenshot({ path: path.join(out, base + '-full.png'), fullPage: true });
      console.log(base, 'overflowX=' + over, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok');
      await page.close();
    }
  }
  await browser.close();
})();
