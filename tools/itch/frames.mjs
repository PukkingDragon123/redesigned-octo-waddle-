// Capture a run of consecutive frames (fixed dt in the query) and the whale's mouth on screen.
// usage: node frames.mjs "<query>" <outdir> <warmFrames> <count> <w> <h>
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/home/user/redesigned-octo-waddle-/tools/fx-shot.mjs');
const { chromium } = require('playwright');
const [query, outdir, warm, count, w, h] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?${query}`, { waitUntil: 'load', timeout: 600000 });
const waitF = (n) => page.waitForFunction((n) => window.__skysongError || (window.__skysong && window.__skysong.frame >= n), n, { timeout: 1500000, polling: 50 });
await waitF(+warm);
const mouths = [];
for (let i = 0; i < +count; i++) {
  const f0 = await page.evaluate(() => window.__skysong.frame);
  await waitF(f0 + 1);
  const r = await page.evaluate(() => {
    const g = window.__skysong, m = window.__whales?.[0], cam = g.engine.camera;
    let mouth = null;
    if (m) {
      const grp = m.group, V = grp.position.constructor;
      const L = m.L || m.length || 24;
      const p = grp.localToWorld(new V(0, -L * 0.03, L * 0.47)).project(cam);
      mouth = [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight];
    }
    return { url: document.getElementById('c').toDataURL('image/png'), mouth };
  });
  fs.writeFileSync(`${outdir}/f${String(i).padStart(3, '0')}.png`, Buffer.from(r.url.split(',')[1], 'base64'));
  mouths.push(r.mouth);
  if (i % 10 === 0) console.log('frame', i, JSON.stringify(r.mouth));
}
fs.writeFileSync(`${outdir}/mouth.json`, JSON.stringify(mouths));
await browser.close();
