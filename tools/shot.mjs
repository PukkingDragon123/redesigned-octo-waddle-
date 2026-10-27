// Headless screenshot helper for visual iteration.
// Usage: node tools/shot.mjs "<query string>" <out.png> [waitFrames=30] [width=960] [height=540]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [query = '', out = 'tools/out/shot.png', waitFrames = '30', width = '960', height = '540'] = process.argv.slice(2);
const url = `http://127.0.0.1:${process.env.PORT || 5173}/?${query}&frames=${waitFrames}`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[skysong]')) logs.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction((n) => window.__skysongError || (window.__skysong && (window.__skysong.frame >= n || window.__skysong.halted)), +waitFrames, { timeout: 600000, polling: 500 });
} catch (e) {
  logs.push('[timeout] waiting for frames: ' + e.message);
}
const info = await page.evaluate(() => {
  const g = window.__skysong;
  if (!g) return null;
  const r = g.engine?.renderer?.info;
  return { frame: g.frame, time: g.time?.toFixed?.(2), calls: r?.render?.calls, tris: r?.render?.triangles, progs: r?.programs?.length, dbg: g.debugInfo?.() };
});
const durl = await page.evaluate(() => { try { return document.getElementById('c').toDataURL('image/png'); } catch (e) { return null; } });
if (durl && durl.length > 1000) {
  const fs = await import('fs');
  fs.writeFileSync(out, Buffer.from(durl.split(',')[1], 'base64'));
} else {
  await page.screenshot({ path: out, timeout: 600000 });
}
console.log(JSON.stringify({ url, ms: Date.now() - t0, info }));
for (const l of logs.slice(0, 40)) console.log(l);
await browser.close();
