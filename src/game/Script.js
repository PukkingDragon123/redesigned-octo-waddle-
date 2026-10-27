// Tiny coroutine runner for story scripting.
// Inside a generator: `yield 2.5` waits seconds, `yield () => cond` waits for a condition,
// `yield* other()` runs a sub-sequence.
export class Script {
  constructor() {
    this.tasks = [];
  }

  run(gen, name = '') {
    const t = { it: gen, wait: 0, cond: null, name, done: false };
    this.tasks.push(t);
    return t;
  }

  cancel(name) {
    for (const t of this.tasks) if (!name || t.name === name) t.done = true;
    this.tasks = this.tasks.filter((t) => !t.done);
  }

  running(name) {
    return this.tasks.some((t) => t.name === name && !t.done);
  }

  update(dt) {
    for (const t of this.tasks.slice()) {
      if (t.done) continue;
      if (t.wait > 0) {
        t.wait -= dt;
        if (t.wait > 0) continue;
      }
      if (t.cond) {
        let ok = false;
        try { ok = t.cond(); } catch (e) { console.error(e); ok = true; }
        if (!ok) continue;
        t.cond = null;
      }
      let r;
      try {
        r = t.it.next(dt);
      } catch (e) {
        console.error('[skysong] script error in', t.name, e);
        r = { done: true };
      }
      if (r.done) {
        t.done = true;
        continue;
      }
      const v = r.value;
      if (typeof v === 'number') t.wait = v;
      else if (typeof v === 'function') t.cond = v;
    }
    this.tasks = this.tasks.filter((t) => !t.done);
  }
}

/** Wait for a condition or a timeout, whichever comes first. */
export function* until(cond, timeout = Infinity) {
  let t = 0;
  while (!cond() && t < timeout) {
    t += yield 0;
  }
  return t < timeout;
}
