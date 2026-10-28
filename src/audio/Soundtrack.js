// The game jam's soundtrack: a recorded track that, when its file is present, becomes the game's
// music. It plays through the music bus after the duck, so the music volume setting, the ducking
// under big moments and the cloud and underwater muffling all apply to it. While it plays, the
// synthesized score and its stingers fall silent (whale voices, effects and ambience stay).
// Without the file the procedural score plays as before.
//
// Drop the file in public/music/ as theme.mp3 (or .ogg / .m4a / .wav); the artifact publishes it
// at the same relative path.
import { clamp, glide, holdAt, finite } from './util.js';

export const SOUNDTRACK_URLS = ['music/theme.mp3', 'music/theme.ogg', 'music/theme.m4a', 'music/theme.wav'];

export class Soundtrack {
  constructor(sys, urls = SOUNDTRACK_URLS) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.urls = urls;
    this.buffer = null;
    this.src = null;
    this.out = null;
    this.level = 1;
    this.loading = null;
    this.playing = false;
    this.wanted = true; // the story's 'silence' mood fades it out; any other mood brings it back
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
          return true;
        } catch (e) { /* try the next format */ }
      }
      return false;
    })();
    return this.loading;
  }

  /** Start the loop (fading in), and hand the music over from the synthesized score. */
  play(fade = 4) {
    if (!this.buffer || this.playing) return;
    const ctx = this.ctx, B = this.sys.bus, now = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // after the duck: the recording keeps its own mix, the bus volume, ducking and muffling apply
    this.out.connect(B.duck);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.out);
    src.start(now + 0.05);
    this.src = src;
    this.playing = true;
    glide(this.out.gain, this.wanted ? this.level : 0, now, fade / 3);
    // the synthesized score and its stingers make way for the track
    for (const p of [B.musicDry.gain, B.musicWet.gain, B.stingDry.gain, B.stingWet.gain]) {
      holdAt(p, now);
      glide(p, 0, now, fade / 3);
    }
  }

  /** Overall level of the track (0..1), e.g. lower under narration. */
  setLevel(k, fade = 1.5) {
    this.level = clamp(finite(+k, 1));
    if (!this.out) return;
    const now = this.ctx.currentTime;
    holdAt(this.out.gain, now);
    glide(this.out.gain, this.wanted ? this.level : 0, now, fade / 3);
  }

  /** Follow the story's moods: 'silence' fades the track out, anything else brings it back. */
  setMood(name, fade = 6) {
    this.wanted = name !== 'silence';
    this.setLevel(this.level, fade);
  }

  stop(fade = 2) {
    if (!this.src) return;
    const now = this.ctx.currentTime;
    holdAt(this.out.gain, now);
    glide(this.out.gain, 0, now, fade / 3);
    try { this.src.stop(now + fade + 0.1); } catch (e) { /* ignore */ }
    this.src = null;
    this.playing = false;
  }
}
