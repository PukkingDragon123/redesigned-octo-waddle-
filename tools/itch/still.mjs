// Render stills from the game with a custom camera. usage:
//   node still.mjs "<query>" <warpSecs> <w> <h> <out-prefix> <camJS...>
// camJS is evaluated with (g, S, herd, mom, calf, f, V) and must return { pos:[x,y,z], look:[x,y,z], fov }.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/home/user/redesigned-octo-waddle-/tools/fx-shot.mjs');
const { chromium } = require('playwright');
const [query, warp, w, h, out, ...cams] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?${query}`, { waitUntil: 'load', timeout: 600000 });
const waitF = (n) => page.waitForFunction((n) => window.__skysongError || (window.__skysong && window.__skysong.frame >= n), n, { timeout: 1500000, polling: 200 });
await waitF(3);
await page.evaluate((s) => { const g = window.__skysong; if (+s > 0) g.warp(+s); }, warp);
if (process.env.PRE) console.log('PRE', await page.evaluate((src) => { const g = window.__skysong; return String(eval(src)); }, process.env.PRE));
let k = 0;
for (const cam of cams) {
  await page.evaluate((src) => {
    const g = window.__skysong, S = g.story, herd = S?.herd, mom = herd?.mother, calf = herd?.calf;
    const V = (x, y, z) => ({ x, y, z });
    const f = S?.path?.frameAt?.(herd.s);
    const fn = new Function('g', 'S', 'herd', 'mom', 'calf', 'f', 'V', src);
    const camO = g.engine.camera;
    g.cameraRig.update = () => {
      const r = fn(g, S, herd, mom, calf, S.path.frameAt(herd.s), V);
      camO.position.set(...r.pos); camO.lookAt(...r.look);
      if (r.fov) { camO.fov = r.fov; camO.updateProjectionMatrix(); }
    };
  }, cam);
  const f0 = await page.evaluate(() => window.__skysong.frame);
  await waitF(f0 + 4);
  const durl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  const file = `${out}-${k++}.png`;
  fs.writeFileSync(file, Buffer.from(durl.split(',')[1], 'base64'));
  console.log('shot', file, await page.evaluate(() => { const g = window.__skysong; return JSON.stringify({ t: +g.time.toFixed(1), ch: g.story?.chapterIndex, err: window.__skysongError || null }); }));
}
await browser.close();
