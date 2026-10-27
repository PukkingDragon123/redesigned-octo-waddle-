// Runs the falcon chapter headless with the autopilot and logs the encounter's events.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const total = +(process.argv[2] || 150);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?debug&chapter=7&auto&dt=0.05&frames=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skysongError || (window.__skysong && window.__skysong.halted), null, { timeout: 600000, polling: 500 });
const out = await page.evaluate((total) => {
  const g = window.__skysong, S = g.story, F = S.falcon, herd = S.herd, calf = herd.calf;
  const log = [];
  const t0 = g.time;
  const stamp = () => (g.time - t0).toFixed(1);
  if (F) for (const ev of ['screech', 'shadowOver', 'stoop', 'strikeHit', 'strikeMiss', 'knockback', 'passDone', 'retreated', 'modeChange']) {
    F.on(ev, (e) => {
      if (ev === 'modeChange') log.push(`${stamp()} mode ${e.prev}->${e.mode}`);
      else log.push(`${stamp()} ${ev}${e && e.blocked ? ' (blocked)' : ''}${e && e.interrupted ? ' (interrupted)' : ''}${e && e.distant ? ' (distant)' : ''}${e && e.minDist !== undefined && isFinite(e.minDist) ? ' minDist=' + e.minDist.toFixed(1) : ''}`);
    });
  }
  const samples = [];
  for (let k = 0; k < total; k += 5) {
    g.warp(5);
    const pc = herd.protectCenter;
    const adultsD = pc ? herd.adults.map((w) => w.pos.distanceTo(pc).toFixed(0)).join(',') : '-';
    samples.push(`${stamp()} herd=${herd.mode} F=${F ? F.mode : '-'} dCalf=${F ? F.pos.distanceTo(calf.pos).toFixed(0) : '-'} safe=${pc ? calf.pos.distanceTo(pc).toFixed(0) : '-'} mom=${pc ? herd.mother.pos.distanceTo(pc).toFixed(0) : '-'} calfMom=${calf.pos.distanceTo(herd.mother.pos).toFixed(0)} adults=[${adultsD}] care=${herd.care && herd.care.mode} ms=${!!herd.motherScript} momYawErr=${pc ? (Math.atan2(pc.x - herd.mother.pos.x, pc.z - herd.mother.pos.z) - herd.mother.ctl.targetYaw).toFixed(2) : '-'} momV=${herd.mother.vel.length().toFixed(1)} momThr=${herd.mother.ctl.thrust.toFixed(2)} dy=${pc ? (herd.mother.pos.y - pc.y).toFixed(0) : '-'} calfV=${calf.vel.length().toFixed(1)} nan=${isNaN(calf.pos.x) || (F && isNaN(F.pos.x))}`);
  }
  return { log, samples, err: window.__skysongError || null };
}, total);
console.log(out.samples.join('\n'));
console.log('--- events');
console.log(out.log.join('\n'));
console.log('--- errors', out.err, errs.slice(0, 10));
await browser.close();
