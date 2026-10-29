// fx builder probe: load ?query, wait N frames, run PRE (js, g = window.__skysong), then capture a
// screenshot after each of the AFTER frame offsets (comma list) to out-<k>.png.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [query = '', out = 'tools/out/fx.png', waitFrames = '60', width = '640', height = '360'] = process.argv.slice(2);
const url = `${process.env.BASE || 'http://127.0.0.1:5173/'}?${query}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
const waitF = (n) => page.waitForFunction((n) => window.__skysongError || (window.__skysong && window.__skysong.frame >= n), n, { timeout: 600000, polling: 100 });
await waitF(+waitFrames);
const pre = process.env.PRE || '';
const r = await page.evaluate((pre) => { const g = window.__skysong; try { return String(eval(pre)); } catch (e) { return 'ERR ' + e.message; } }, pre);
if (pre) console.log('PRE ->', r);
const f0 = await page.evaluate(() => window.__skysong.frame);
const after = (process.env.AFTER || '0').split(',').map(Number);
let k = 0;
for (const a of after) {
  await waitF(f0 + a);
  const o = after.length > 1 ? out.replace(/\.png$/, `-${k}.png`) : out;
  await page.screenshot({ path: o });
  console.log('shot', o, 'frame', await page.evaluate(() => window.__skysong.frame));
  k++;
}
const err = await page.evaluate(() => window.__skysongError || null);
if (err) console.log('ERROR', err);
await browser.close();
