// Touch smoke test: tap "New Game" in the menu on a phone-sized viewport, then drag to steer.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5173/?debug&dt=0.05', { waitUntil: 'load' });
await page.waitForFunction(() => window.__skysong && window.__skysong.story && window.__skysong.frame > 12, null, { timeout: 300000, polling: 500 });
// find the New Game item on screen
const pt = await page.evaluate(() => {
  const g = window.__skysong; const m = g.story.menu; const it = m.items.find((i) => i.action === 'new');
  it.mesh.updateMatrixWorld(true);
  const v = it.mesh.getWorldPosition(new (it.mesh.position.constructor)()).project(g.engine.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, scale: m.group.scale.x };
});
console.log('new game at', pt);
const f0 = await page.evaluate(() => {
  const g = window.__skysong; window.__log = [];
  g.engine.canvas.addEventListener('touchstart', (e) => { const r = g.engine.canvas.getBoundingClientRect(); window.__log.push('ts ' + e.touches.length + ' cx=' + e.changedTouches[0].clientX + ' rect=' + [r.left, r.top, r.width, r.height].join(',') + ' inner=' + innerWidth + 'x' + innerHeight + ' vv=' + (visualViewport && visualViewport.width)); }, { passive: true });
  g.engine.canvas.addEventListener('touchend', (e) => window.__log.push('te'), { passive: true });
  const act = g.story.menu.activate.bind(g.story.menu);
  g.story.menu.activate = (it) => { window.__log.push('activate ' + (it && it.action)); return act(it); };
  const upd = g.story.menu.update.bind(g.story.menu);
  g.story.menu.update = (dt) => { if (g.input.clicked) window.__log.push('clicked ' + g.input.mouseX.toFixed(2) + ',' + g.input.mouseY.toFixed(2) + ' lock=' + g.input.lockWanted); return upd(dt); };
  return g.frame;
});
await page.touchscreen.tap(pt.x, pt.y);
await page.waitForFunction((f) => window.__skysong.frame > f + 3, f0, { timeout: 120000, polling: 200 });
const st = await page.evaluate(() => ({ state: window.__skysong.story.state, frame: window.__skysong.frame, sel: window.__skysong.story.menu.sel, vis: window.__skysong.story.menu.visible }));
console.log('after tap', st, await page.evaluate(() => window.__log));
await browser.close();
