// Smoke-test style-switcher.html: loads, switches, measures swap time, screenshots.
const { chromium } = require('playwright');
const path = require('path'), { pathToFileURL } = require('url');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(pathToFileURL(path.join(__dirname, 'style-switcher.html')).href + '#round2/15-gazette');
  await p.waitForTimeout(2500);
  const out = path.join(__dirname, 'screenshots');
  await p.screenshot({ path: path.join(out, 'switcher-a.png') });
  const opts = await p.$$eval('#pick option', o => o.length);
  // Time a cold and a warm switch (from click to the frame being visible).
  const t = async id => p.evaluate(id => new Promise(r => { const s = performance.now(); const sel = document.getElementById('pick'); sel.value = id; sel.dispatchEvent(new Event('change')); requestAnimationFrame(() => requestAnimationFrame(() => r(Math.round(performance.now() - s)))); }), id);
  const cold = await t('07-zaibatsu-v2-overview'); await p.waitForTimeout(2000);
  await p.screenshot({ path: path.join(out, 'switcher-b.png') });
  // Click the Operations link inside the Zaibatsu page: should switch design, not navigate.
  const fr = p.frames().find(f => f !== p.mainFrame() && f.url() === 'about:srcdoc' && (f.name() || true));
  let linkOk = 'n/a';
  for (const f of p.frames()) { const a = await f.$('a[href="07-zaibatsu-v2-operations.html"]').catch(() => null); if (a && await a.isVisible()) { await a.click(); await p.waitForTimeout(800); linkOk = await p.$eval('#pick', s => s.value); break; } }
  await p.keyboard.press('Alt+ArrowRight'); await p.waitForTimeout(300);
  const afterKey = await p.$eval('#pick', s => s.value);
  await p.waitForTimeout(20000); // let background warming run
  const warmCount = await p.$$eval('#stage iframe', f => f.length);
  const warm = await t('round2/15-gazette');
  const warm2 = await t('01-constructivist-v2');
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, 'switcher-c.png') });
  const reloads = await p.evaluate(() => performance.getEntriesByType('navigation').length);
  console.log({ opts, cold, linkOk, afterKey, warmCount, warm, warm2, reloads, errs: errs.slice(0, 5) });
  await b.close();
})();
