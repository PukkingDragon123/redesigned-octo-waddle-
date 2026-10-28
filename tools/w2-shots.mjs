// world2: build a dev scene once, then capture several framings of it.
//   node tools/w2-shots.mjs "<query>" <out prefix> <w> <h> '<shots json>'
//   shots: [{ "name": "a", "cam": [x, y, z], "look": [x, y, z], "time": "golden", "frames": 4, "eval": "js" }]
//   (BASE env picks the server; EVAL env is printed after the last shot)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [query, prefix, W = '640', H = '360', json = '[]'] = process.argv.slice(2);
const shots = JSON.parse(json);
const base = process.env.BASE || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /\[vursok\]|\[islands\]|w2/.test(t)) console.log(`[${m.type()}] ${t.slice(0, 400)}`); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto(`${base}?${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skysongError || (window.__skysong?.devWorld && window.__skysong.frame >= 3), null, { timeout: 1500000, polling: 1000 });
console.log('built in', Math.round((Date.now() - t0) / 1000), 's');
for (const sh of shots) {
  const f0 = await page.evaluate((sh) => {
    const g = window.__skysong;
    const cam = g.engine.camera;
    if (sh.isl !== undefined) {
      // frame the k-th island of a chapter: { isl, ch, dist, h, az, lookh }
      const w = g.devWorld;
      const list = w.plan[sh.ch].islands;
      const rec = list[Math.min(list.length - 1, sh.isl)];
      const az = sh.az ?? 0.6, d = rec.R + (sh.dist ?? rec.R * 2.2);
      sh.cam = [rec.pos.x + Math.cos(az) * d, sh.h ?? rec.H * 0.6, rec.pos.z + Math.sin(az) * d];
      sh.look = [rec.pos.x, sh.lookh ?? rec.H * 0.45, rec.pos.z];
    }
    g.cameraRig.update = () => { cam.position.set(...sh.cam); cam.lookAt(...sh.look); };
    g.focus.set(sh.look[0], Math.max(10, sh.look[1]), sh.look[2]);
    if (sh.time) g.atmosphere.set(sh.time);
    if (sh.eval) eval(sh.eval);
    return g.frame;
  }, sh);
  // capture right after the frame renders (same task: the drawing buffer is still intact)
  await page.evaluate((n) => {
    const g = window.__skysong;
    window.__w2cap = null;
    if (!g.__w2upd) {
      g.__w2upd = g.update.bind(g);
      g.update = (dt) => {
        g.__w2upd(dt);
        if (window.__w2want && g.frame >= window.__w2want && !window.__w2cap) {
          const i = g.engine.renderer.info.render;
          window.__w2cap = { url: document.getElementById('c').toDataURL('image/png'), calls: i.calls, tris: i.triangles };
        }
      };
    }
    window.__w2want = n;
  }, f0 + (sh.frames ?? 4));
  await page.waitForFunction(() => !!window.__w2cap, null, { timeout: 900000, polling: 500 });
  const cap = await page.evaluate(() => window.__w2cap);
  const st = { calls: cap.calls, tris: cap.tris };
  (await import('fs')).writeFileSync(`${prefix}${sh.name}.png`, Buffer.from(cap.url.split(',')[1], 'base64'));
  console.log(sh.name, JSON.stringify(st));
}
if (process.env.EVAL) console.log(JSON.stringify(await page.evaluate((e) => { const g = window.__skysong; try { return eval(e); } catch (x) { return 'ERR ' + x.message; } }, process.env.EVAL)));
await browser.close();
