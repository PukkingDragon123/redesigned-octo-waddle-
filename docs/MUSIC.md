# SKYSONG music

The jam's theme is a piece of music: **"thatgamejam#02 Official Theme Track" by Jason Grace**
(60 s, 48 kHz stereo). The game plays that recording whole at its two bookends and an original,
adaptive score in the same style everywhere else, so the film sounds like one piece of music.

## 1. The theme track, analysed

There is no listening in this pipeline, so everything below was measured from the lossless file
(ffmpeg spectrograms, numpy/scipy onset, HPSS, chroma and spectral-peak tracking). Times are from
the start of the file; "bar n" counts from the first downbeat at 1.47 s.

| | |
|---|---|
| Tempo / metre | **60 BPM, 4/4** (onset autocorrelation peak 60.1 BPM, r = 0.93; bars of exactly 4.0 s). The groove runs on a 0.25 s sixteenth grid, so it is also felt as a 120 BPM half-time. First downbeat 1.47 s, a soft pickup from ~1.0 s. |
| Key / mode | **F minor (aeolian)**: Krumhansl key correlation 0.93 (next best D-flat major 0.56). Pitch-class weight F > A-flat > D-flat ≈ C; E-flat and B-flat only as colour; no E natural. Tuning A = 440 Hz (0 cents). |
| Loudness | Integrated -15.6 LUFS, LRA 6.6 LU, true peak about -1 dBFS. |
| Form | **Intro** bars 0-4 (1.5-21.5 s, solo keys and a soft pad, about -20 dB RMS). **Groove** bars 5-12 (21.5-53.5 s): bass and drums enter at 21.47 s, about 3 dB louder, a little fuller again from bar 9 (37.5 s). **Close** bar 13 (53.5 s): the last chord, then a ~6 s fade/tail to silence at 60 s. |

**Harmony** (bass peaks + chroma per half bar):

- Intro: `B-flat m7 | D-flat | F m | D-flat (maj7) | F m` (iv7 - VI - i - VI - i).
- Groove: a two-bar loop `D-flat | F m`, four times, with A-flat passing in the bass at the end
  of some F minor bars (beats 3-4 of bars 8, 10, 12).
- Close: B-flat and D natural appear over an A-flat bass (`B-flat/D`, the **dorian IV**, the
  piece's one borrowed colour) and the music settles on **F minor with an added 11th**
  (F, A-flat, C, E-flat, B-flat sounding together in the tail).
- In relative-major terms the loop is IV - vi of A-flat major: the piece hovers between F minor
  and A-flat major, the bittersweet "rising but unresolved" sound of thatgamecompany scores.

**Melody** (spectral peak tracking of new onsets):

- Intro: a held F5 falling to D-flat5 - C5, then rising C5 → C6 → **D-flat6**: the fifth leaning
  up a semitone to the minor sixth (bars 3 and 4, 15.5-16.5 s and 19.5-20.5 s), answered by A-flat5.
- Groove hook (over D-flat, bars 5, 7, 9, 11): **A-flat5 (beat 1) - C6 (beat 2) - D-flat6 (beat 3) -
  F5 (beat 4)**, a D-flat-major arpeggio climbing to its top and dropping to the tonic. Over F
  minor: a long A-flat5 or C6, then C - F. Doubled in octaves (C5 + C6, D-flat5 + D-flat6).
- Range F4 - D-flat6, almost entirely F, A-flat, C, D-flat (a four-note core), E-flat and B-flat as
  passing tones.

**Rhythm** (per-sixteenth onset histograms, percussive component, bars 5-12):

- Low drum (below 200 Hz): steps 0, 3, 8, 11 of 16, i.e. `X..x....X..x....` (beat 1, the "a" of
  1, beat 3, the "a" of 3), a soft dotted heartbeat; plus a deep hit on beat 3.
- High percussion (above 4 kHz): steps 2, 6, 10, 14, i.e. **off-beat eighths** (shaker / hi-hat).
- The intro is unmetred by drums: keys onsets on steps 0, 3, 4, 6 (dotted figures).

**Instrumentation** (from envelope and spectrum, so a best estimate): piano / keys carrying the
melody (sharp attacks, long decays, octave doublings); a sustained string-like pad from the start;
from bar 5 a deep bass (D-flat 2 / F 2 roots), a soft kick, an off-beat shaker and a fuller pad
and string bed; a long, bright reverb (the tail decays about 60 dB in 6 s).

## 2. What plays where

| Moment | Music |
|---|---|
| Title menu | **The theme track, whole**, from the top (2.5 s fade-in). If the player starts during it, it carries on under the calm opening (the hatching at dawn) to its own ending; 7.5 s before the end the score fades back in under the track's tail (the same key and tempo, so it is one crossfade). An idle title hears the score, then the track again after 150 s. |
| The ending (the last egg at dawn, Year 32) | **The theme track, whole** (`setMood('dawn', { track: true })` in LifeCycle.dawnAgain), running on through the closing dissolve into the title card. |
| Everything else | The adaptive score below. Any non-calm mood (chase, storm, danger, song...) fades the track out over up to 4 s and brings the score back. |

The track is only ever started from 0, faded, ducked and set in level, as the jam's rules require
(the recording may not be remixed, sampled or rearranged; covers and original music are fine). It
goes through the music bus after the ducker, so the music volume, ducking and cloud muffling apply.
While it plays the Conductor keeps time silently underneath, so the score returns in flow.
Implementation: `src/audio/Soundtrack.js` (`TRACK_MOODS`, `CARRY_MOODS`), `AudioSystem.setMood(name,
{ fade, track })`, `AudioSystem.update` → `soundtrack.update`.

## 3. The score, re-voiced to the theme

- **Key.** Home is the theme's F minor (aeolian, the notes of A-flat major) for every story mood;
  side keys stay inside its family: F dorian (the forest: the theme's D-natural lift), F phrygian
  (danger), D-flat major (the courtship: the theme's VI). `getKey()` reports root F (65), so the
  whale voices and the player's humming snap to the same notes.
- **Tempo.** 60 BPM for the title, dawn, flight, song, relief, oasis and finale (the theme's
  tempo, with harp and piano sixteenths as its pulse); 56 / 50 for night, birth and rest; 66
  storm, 80 danger and krill, and 120 for the chase (exactly double).
- **Harmony.** The theme's loop `D-flat | F m` drives flight, the title interlude and the
  leitmotif; its opening `B-flat m7 | D-flat (maj7) | F m` opens the title; its dorian close
  (`B-flat/D` → `F m9`) ends the finale and colours the coda; the resolve stinger is the aeolian
  cadence VI - VII - i in the current key.
- **Leitmotif** (`THEME` in theory.js, 8 bars over `D-flat | F m | D-flat6 | A-flat/C | B-flat m7 |
  D-flat | B-flat m7 E-flat | F m`): A-flat - C - D-flat climbing to the minor sixth, the lean resolving
  down to C, then the climb sequenced a fourth higher (D-flat - F - A-flat) and a fall home to F. It
  echoes the theme's contour (arpeggio up to the sixth degree, the 5 ↔ flat-6 semitone) without
  quoting its rhythm or notes. The mother hums its first phrase in the finale (Story.js).
- **Groove.** The theme's kick `X..x....X..x....` and off-beat shaker come in with intensity in
  flight, song, oasis and the finale (the shaker alone in the krill dance).
- **Instruments.** Real CC0 recordings (VSCO-2 Community Edition, see CREDITS.md): upright piano,
  harp, glockenspiel (the celesta part), marimba, string pizzicato and spiccato, looped string
  sections (violins, violas, celli) for the pads, the bass line and the stinger pad, a concert
  bass drum and a shaker. The choir, brass, drone, solo lines (lead strings, flute), bells,
  timpani and taiko remain synthesized. If a sample set fails to load the synthesis plays instead.

## 4. Samples: pipeline and budget

- 107 notes, 2.2 MB of Ogg Vorbis (q4, mono, 32 kHz) in `public/audio/music/<instrument>/<midi>.ogg`,
  mapped in `src/audio/musicSamples.js` (midi, file, measured tuning in cents, loop points).
- Every 3-5 semitones per instrument (the sampler pitch-shifts between them), trimmed at the
  onset, faded at the tail, loudness-matched within each instrument (median RMS of the first
  0.4 s), and scaled per instrument (`level`) to the loudness of the synthesized instrument it
  replaces, so the mix gains in Conductor.js hold for both.
- String sustains: 0.6 s of attack plus a 2.0 s loop whose last 120 ms are an equal-power
  crossfade with the audio before the loop start (seam jump measured below the typical sample step).
  `Section` plays them as looped buffer sources, crossfading (re-bowing) on every chord change.
- Loading (`SampleBank.preloadSamples`): fetched and decoded on a small OfflineAudioContext from
  page load (no user gesture needed), 6 at a time. `loadBank` waits up to 2.5 s for them; later
  arrivals are swapped in (`Conductor.useSamples`).

## 5. Checking the mix without ears

- `PORT=5241 node tools/audio-check.mjs --skip-sfx --wav --only=title,flight,chase` renders moods
  through an OfflineAudioContext into `tools/out/*.wav`; then
  `ffmpeg -i tools/out/audio-mood-flight.wav -lavfi showspectrumpic=s=1400x500:scale=log:fscale=log out.png`.
- The score renders at about -21 to -28 dBFS RMS by mood; the track, at its level of 0.85 through
  the same chain, lands at about -26 dBFS RMS, so the hand-overs do not jump in level.
