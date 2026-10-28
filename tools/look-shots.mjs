// Look checks: load one page, then capture several variants of it (time of day, camera, painterly
// settings) without rebuilding the world each time.
//   node tools/look-shots.mjs "<query>" <prefix> <w> <h> <warmFrames> <shots.json | inline JSON>
// shots: [{ name, js, frames }]  js runs with g = window.__skysong before waiting `frames` frames.
// Every shot's js must be self-contained (absolute settings): when the dev server hot-reloads the
// page mid-run (someone saved a file), the tool waits for the page again and retries the shot.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [query = '', prefix = 'tools/out/look-', width = '640', height = '360', warm = '4', shotsArg = '[]'] = process.argv.slice(2);
const shots = JSON.parse(fs.existsSync(shotsArg) ? fs.readFileSync(shotsArg, 'utf8') : shotsArg);
const url = `${process.env.BASE || 'http://127.0.0.1:5173/'}?${query}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.startsWith('LOOK')) console.log(`[${m.type()}] ${t.slice(0, 400)}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const t0 = Date.now();
const secs = () => Math.round((Date.now() - t0) / 1000) + 's';
await page.goto(url, { waitUntil: 'load' });
const waitFrames = async (n) => {
  const start = await page.evaluate(() => (window.__skysong ? window.__skysong.frame : 0));
  await page.waitForFunction((t) => window.__skysongError || (window.__skysong && window.__skysong.ready && window.__skysong.frame >= t), start + n, { timeout: 900000, polling: 250 });
};
const waitReady = async () => {
  await page.waitForFunction(() => window.__skysongError || (window.__skysong && window.__skysong.ready), null, { timeout: 900000, polling: 500 });
  await waitFrames(+warm);
};
await waitReady();
console.log('ready', secs());
for (const s of shots) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await page.evaluate((js) => {
        const g = window.__skysong;
        try { return String(eval(js ?? 'null')); } catch (e) { return 'ERR ' + e.message; }
      }, s.js || 'null');
      await waitFrames(s.frames ?? 3);
      const durl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
      fs.writeFileSync(`${prefix}${s.name}.png`, Buffer.from(durl.split(',')[1], 'base64'));
      const err = await page.evaluate(() => window.__skysongError || null);
      console.log(s.name, r === 'undefined' || r === 'null' ? '' : r, err ? 'ERROR ' + err.slice(0, 300) : '', secs());
      break;
    } catch (e) {
      console.log(`retry ${s.name} (${e.message.split('\n')[0].slice(0, 120)})`, secs());
      try { await page.waitForLoadState('load', { timeout: 120000 }); await waitReady(); } catch (e2) { console.log('reload wait failed', e2.message.slice(0, 120)); }
    }
  }
}
await browser.close();
