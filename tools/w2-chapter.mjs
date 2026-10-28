// world2 check: run a real chapter (autopilot), wait until the world is built and the chapter has
// played for a few seconds, then print draw calls / triangles / world and flora costs and save a
// screenshot.   node tools/w2-chapter.mjs <chapter> <out.png> [playSeconds=6] [w=640] [h=360]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [ch = '3', out = 'tools/out/w2-chapter.png', play = '6', W = '640', H = '360'] = process.argv.slice(2);
const base = process.env.BASE || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
const errs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /vursok|w2|error/i.test(t)) errs.push(t.slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto(`${base}?debug&chapter=${ch}&auto&dt=0.05${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skysongError || (window.__skysong?.story?.worldReady && window.__skysong.story.state === 'play'), null, { timeout: 1500000, polling: 1000 }).catch((e) => errs.push('timeout ' + e.message));
const tReady = Date.now();
const f0 = await page.evaluate(() => window.__skysong?.frame ?? 0);
await page.waitForFunction((n) => (window.__skysong?.frame ?? 0) >= n, f0 + Math.round(+play / 0.05), { timeout: 1500000, polling: 1000 }).catch((e) => errs.push('timeout2 ' + e.message));
const st = await page.evaluate(() => {
  const g = window.__skysong;
  if (!g) return { err: window.__skysongError };
  const i = g.engine.renderer.info;
  const w = g.story.world;
  const fl = w.flora?.stats?.();
  // world draw calls: count visible meshes under the world's chapter groups (approximate)
  let worldMeshes = 0;
  for (const k in w.groups) w.groups[k].traverseVisible((o) => { if (o.isMesh) worldMeshes++; });
  return {
    chapter: g.story.chapterIndex, s: Math.round(g.story.herd.s), calls: i.render.calls, tris: i.render.triangles,
    worldMeshesVisible: worldMeshes,
    flora: fl && { calls: fl.calls, ktris: Math.round(fl.tris / 1000), kshadow: Math.round(fl.shadowTris / 1000), instances: fl.instances, far: fl.far, cpu: fl.cpuMs },
    timing: Object.fromEntries(Object.entries(w.timing || {}).map(([k, v]) => [k, Math.round(v)])),
    err: window.__skysongError,
  };
});
console.log(`chapter ${ch}: ready after ${Math.round((tReady - t0) / 1000)}s`, JSON.stringify(st));
if (errs.length) console.log('  console:', errs.slice(0, 12).join('\n  '));
const durl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
(await import('fs')).writeFileSync(out, Buffer.from(durl.split(',')[1], 'base64'));
await browser.close();
