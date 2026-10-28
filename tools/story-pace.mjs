// Story builder pacing check: plays chapters (or acts) headless with the autopilot, warping in
// 10 s steps, and reports how long each one lasts in game seconds (until the next chapter, the
// next act, or the title). Usage: node tools/story-pace.mjs 0,1,2 | act=2,act=3,act=4
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const list = (process.argv[2] || '0,1,2,3,4,5,6,7,8,9').split(',');
const limit = +(process.argv[3] || 900);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const item of list) {
  const q = item.includes('=') ? item : `chapter=${item}`;
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('script error')) errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?debug&${q}&auto&dt=0.05&frames=1${process.env.EXTRA || ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__skysongError || (window.__skysong && window.__skysong.halted), null, { timeout: 900000, polling: 500 }).catch(() => errs.push('timeout'));
  const start = await page.evaluate(() => { const s = window.__skysong.story; return { t: window.__skysong.time, ch: s.chapterIndex, act: s.act }; });
  let st = null;
  for (let k = 0; k < limit / 10; k++) {
    st = await page.evaluate((start) => {
      const g = window.__skysong, s = g.story;
      g.warp(10);
      return { t: Math.round(g.time - start.t), ch: s.chapterIndex, act: s.act, state: s.state, s: Math.round(s.herd.s), stage: s.life.stage, err: window.__skysongError };
    }, start);
    if (st.err) break;
    if (start.act === 1 && (st.ch !== start.ch || st.act !== 1 || st.stage === 'skip')) break;
    if (start.act > 1 && (st.act !== start.act || st.state === 'menu')) break;
  }
  const log = await page.evaluate(() => window.__skysong.story.life.stageLog);
  console.log(`${q}: ${st.t}s game time (${Math.round((Date.now() - t0) / 1000)}s wall)`, JSON.stringify(st), log ? JSON.stringify(log) : '', errs.length ? '\n  ERRORS: ' + errs.slice(0, 5).join('\n  ') : '');
  await page.close();
}
await browser.close();
