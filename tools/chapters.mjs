// Runs each chapter headless with the autopilot and reports errors + state.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const list = (process.argv[2] || '0,1,2,3,4,5,6,7,8,9').split(',').map(Number);
const warp = process.argv[3] || '40';
const shots = process.argv[4] === 'shots';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const ch of list) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('script error')) errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?debug&chapter=${ch}&auto&dt=0.05&warp=${warp}&frames=1${process.env.EXTRA || ""}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__skysongError || (window.__skysong && window.__skysong.halted), null, { timeout: 900000, polling: 500 }).catch((e) => errs.push('timeout'));
  const st = await page.evaluate(() => {
    const g = window.__skysong; if (!g || !g.story) return { err: window.__skysongError };
    const s = g.story; const h = s.herd;
    return { state: s.state, chapter: s.chapterIndex, herdS: Math.round(h.s), calfS: Math.round(h.calfS || 0), mode: h.mode, calfY: Math.round(h.calf.pos.y), distMom: Math.round(h.calf.pos.distanceTo(h.mother.pos)), momY: Math.round(h.mother.pos.y), eaten: Math.round(s.eaten || 0), tasks: s.script.tasks.map((t) => t.name), err: window.__skysongError };
  });
  if (shots) {
    const durl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
    (await import('fs')).writeFileSync(`tools/out/ch${ch}.png`, Buffer.from(durl.split(',')[1], 'base64'));
  }
  console.log(`chapter ${ch} (${Math.round((Date.now() - t0) / 1000)}s):`, JSON.stringify(st), errs.length ? '\n  ERRORS: ' + errs.slice(0, 5).join('\n  ') : '');
  await page.close();
}
await browser.close();
