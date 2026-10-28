// Doc builder check: runs a query headless (warp seconds, autopilot) and reports the life-cycle stage
// log, the documentary text on screen (card, lower-third, subtitle) and errors; optional page shot.
// Usage: EXTRA="&worldslice=4000" node tools/doc-check.mjs "<query>" <warp> [shot.png]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [q = 'hatch=1', warp = '30', shot = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('script error') || m.text().includes('[skysong]')) errs.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 300)));
const t0 = Date.now();
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?debug&${q}&auto&dt=0.05&warp=${warp}&frames=1${process.env.EXTRA || ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skysongError || (window.__skysong && window.__skysong.halted), null, { timeout: 900000, polling: 500 }).catch(() => errs.push('timeout'));
if (shot) await page.waitForTimeout(2500);
const st = await page.evaluate(() => {
  const g = window.__skysong; if (!g || !g.story) return { err: window.__skysongError };
  const s = g.story, h = s.herd, L = s.life, C = s.cine, N = L.nursery;
  return {
    t: Math.round(g.time), state: s.state, act: s.act, chapter: s.chapterIndex, stage: L.stage, log: L.stageLog,
    py: +h.calf.pos.y.toFixed(1), cine: C.active, card: C.cardText && (C.cardText.kicker || '') + ' | ' + C.cardText.title,
    lower: C.lowerText && C.lowerText.name, sub: C.subText, egg: N.egg ? (N.egg.constructor.name + ' ' + N.egg.position.y.toFixed(1)) : null,
    whirl: !!N.on, threats: N.threats.length, repelled: N.repelled, strikes: N.strikes, seen: [...C.seen],
    tasks: s.script.tasks.map((t) => t.name), err: window.__skysongError,
  };
});
console.log(`${q} warp ${warp} (${Math.round((Date.now() - t0) / 1000)}s):`, JSON.stringify(st), errs.length ? '\n  ERRORS: ' + errs.slice(0, 6).join('\n  ') : '');
if (shot && process.env.CANVAS) {
  // the canvas alone (cheap under load; the DOM overlay is checked by tools/doc-overlay.mjs)
  const durl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png')).catch((e) => { console.log('toDataURL failed', e.message.slice(0, 200)); return null; });
  if (durl) (await import('fs')).writeFileSync(shot, Buffer.from(durl.split(',')[1], 'base64'));
} else if (shot) await page.screenshot({ path: shot, timeout: 600000 }).catch((e) => console.log('screenshot failed', e.message.slice(0, 80)));
await browser.close();
