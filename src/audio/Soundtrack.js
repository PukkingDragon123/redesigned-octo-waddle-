// The game jam's theme track ("thatgamejam#02 Official Theme Track", Jason Grace), played whole
// and unmodified at the film's bookends (docs/MUSIC.md):
//   - the title menu: it starts from the top when the title mood is asked for, and plays once
//     through; if the player begins meanwhile it carries on under the calm opening (the hatching
//     at dawn) until its own ending, then the score takes over. A title left idle hears it again
//     after a while.
//   - the ending: the last egg at dawn (setMood('dawn', { track: true })) begins it; it runs on
//     through the closing dissolve into the title card.
// Elsewhere the procedural score plays: the same key (F minor), tempo (60) and harmony, so the
// hand-overs are crossfades within one piece of music.
//
// The recording is only ever started from 0, faded, ducked and set in level (the jam's rules
// allow no remix, sampling or rearranging). It plays through the music bus after the duck, so
// the music volume, ducking and cloud muffling apply. While it plays, the score and its stingers
// are faded out underneath (the Conductor keeps time silently, so it comes back in flow).
import { clamp, glide, holdAt, finite } from './util.js';

export const SOUNDTRACK_URLS = ['music/theme.mp3', 'music/theme.ogg', 'music/theme.m4a', 'music/theme.wav'];
/** Moods that start the track. */
export const TRACK_MOODS = new Set(['title']);
/** Calm moods the track may carry on into (anything else fades it out). */
const CARRY_MOODS = new Set(['title', 'dawn', 'birth', 'night', 'rest']);
const HANDOVER = 7.5; // seconds before the track's end when the score begins to fade back in
const REPLAY = 150; // an idle title menu hears the track again after this many seconds of score
const LEVEL = 0.85; // the recording against the score (its LUFS is a little above the score's)

export class Soundtrack {
  constructor(sys, urls = SOUNDTRACK_URLS) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.urls = urls;
    this.buffer = null;
    this.src = null;
    this.out = null;
    this.level = LEVEL;
    this.loading = null;
    this.playing = false;
    this.wanted = false; // the current mood asked for the track (it starts when the file is in)
    this.mood = null;
    this.endAt = 0;
    this.lastEnd = -Infinity;
    this.handedBack = true;
    this.plays = 0;
  }

  get available() {
    return !!this.buffer;
  }

  /** Look for the track file; resolves to true when one was decoded. Never throws. */
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (typeof fetch === 'undefined') return false;
      for (const url of this.urls) {
        try {
          const res = await fetch(url, { cache: 'force-cache' });
          if (!res.ok) continue;
          const type = res.headers.get('content-type') || '';
          if (type.includes('text/html')) continue; // a dev server's fallback page, not audio
          const data = await res.arrayBuffer();
          if (data.byteLength < 1024) continue;
          this.buffer = await this.ctx.decodeAudioData(data);
          this.url = url;
          if (this.wanted && !this.playing) this.play();
          return true;
        } catch (e) { /* try the next format */ }
      }
      return false;
    })();
    return this.loading;
  }

  /** Fade the synthesized score (and stingers) out under the track, or back in. */
  _score(on, fade) {
    const B = this.sys.bus;
    const now = this.ctx.currentTime;
    for (const p of [B.musicDry.gain, B.musicWet.gain, B.stingDry.gain, B.stingWet.gain]) {
      holdAt(p, now);
      glide(p, on ? 1 : 0, now, fade / 3);
    }
    this.handedBack = on;
  }

  /** Play the track once from the top (fading in), handing the music over from the score. */
  play(fade = 2.5) {
    if (!this.buffer) {
      this.wanted = true;
      return;
    }
    if (this.playing) return;
    const ctx = this.ctx, B = this.sys.bus, now = ctx.currentTime;
    const t = now + 0.05;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(B.duck);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.out);
    src.start(t);
    const out = this.out;
    src.onended = () => {
      try { out.disconnect(); } catch (e) { /* ignore */ }
    };
    this.src = src;
    this.playing = true;
    this.plays++;
    this.endAt = t + this.buffer.duration;
    glide(this.out.gain, this.level, now, fade / 3);
    this._score(false, fade);
  }

  /** Overall level of the track (0..1), e.g. lower under narration. */
  setLevel(k, fade = 1.5) {
    this.level = clamp(finite(+k, LEVEL));
    if (!this.out || !this.playing) return;
    const now = this.ctx.currentTime;
    holdAt(this.out.gain, now);
    glide(this.out.gain, this.level, now, fade / 3);
  }

  /**
   * Follow the story's moods: the title (or { track: true }) starts the track; calm moods let
   * it play on to its end; any other mood (and 'silence') fades it out and the score returns.
   */
  setMood(name, fade = 6, opts = {}) {
    this.mood = name;
    const want = TRACK_MOODS.has(name) || !!(opts && opts.track);
    this.wanted = want;
    if (want) {
      // the title asked again while the ending's track plays on: keep it going
      if (!this.playing) this.play(Math.min(Math.max(fade, 1.5), 4));
      return;
    }
    if (this.playing && !CARRY_MOODS.has(name)) this.stop(Math.min(Math.max(fade, 1), 4));
  }

  /** Per frame: hand the music back to the score as the track ends; replay at an idle title. */
  update(now) {
    if (this.playing) {
      if (!this.handedBack && now > this.endAt - HANDOVER) this._score(true, 6);
      if (now > this.endAt + 0.1) {
        this.playing = false;
        this.src = null;
        this.lastEnd = now;
        this.wanted = false;
      }
    } else if (this.buffer && this.mood === 'title' && this.plays > 0 && now - this.lastEnd > REPLAY) {
      this.play(4);
    }
  }

  stop(fade = 2) {
    if (!this.src) return;
    const now = this.ctx.currentTime;
    holdAt(this.out.gain, now);
    glide(this.out.gain, 0, now, fade / 3);
    try { this.src.stop(now + fade + 0.1); } catch (e) { /* ignore */ }
    this.src = null;
    this.playing = false;
    this.lastEnd = now;
    if (!this.handedBack) this._score(true, fade * 1.5);
  }
}
