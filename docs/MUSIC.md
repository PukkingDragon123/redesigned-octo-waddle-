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
| Everything else | The seven authored songs (section 3) at their story moments, and the adaptive score below between them. Any non-calm mood (chase, storm, danger, song...) fades the track out over up to 4 s and brings the score back. |

The track is only ever started from 0, faded, ducked and set in level, as the jam's rules require
(the recording may not be remixed, sampled or rearranged; covers and original music are fine). It
goes through the music bus after the ducker, so the music volume, ducking and cloud muffling apply.
While it plays the Conductor keeps time silently underneath, so the score returns in flow.
Implementation: `src/audio/Soundtrack.js` (`TRACK_MOODS`, `CARRY_MOODS`), `AudioSystem.setMood(name,
{ fade, track })`, `AudioSystem.update` → `soundtrack.update`.

## 3. The songbook: seven authored pieces

Over ~15 minutes one adaptive loop would wear thin, so the story's main moments each have their
own written song (`src/audio/songs.js`): its own tune, chords, counter-lines, form (sections
with their own dynamics that build, peak and resolve) and orchestration, all in the theme's world
(F minor family, a 60 BPM feel, the recorded VSCO instruments), echoing its contour (arpeggios
climbing to the sixth degree, the 5 / flat-6 lean, the D-flat - F minor loop) without quoting it.

| Song (`playSong` name) | Mood the story sets | Where it plays | Form and character |
|---|---|---|---|
| **First Light** (`lullaby`) | `dawn` | The hatching and Dawn Lagoon (ch. 0), the first hug and feeding, the calm after the lagoon rescue; under the title track's tail when the player starts early | A rocking music-box tune on the upright piano over harp (A-flat - D-flat/A-flat - ... - E-flat); the second verse adds a flute counter-line, the middle strain climbs the leitmotif's sequence, the last verse floats an octave up on strings and glockenspiel, a coda rocks to sleep. 56 BPM, ~2.5 min per pass. |
| **Skyward** (`skyward`) | `flight` | Open flight: The Spiral Reach (ch. 1) | Harp sixteenths (the theme's pulse) under a long-breathed tune on solo strings leaping in sixths; the B strain climbs D-flat - E-flat - C minor - F minor with flute and piano on top and a low string counter; the climax is the full leitmotif with the theme's kick and shaker, choir, brass and timpani. Intense flying jumps to the climax early. |
| **Coil Wonder** (`wonder`) | `forest` | The Coil Forest (ch. 3): exploring, discoveries | F dorian (the theme's own D-natural colour): marimba and glockenspiel glitter over i - IV, the flute asks a question, a warm B strain (A-flat major seventh), and a bloom (E-flat - B-flat/D) with choir and bells; excitement branches to the bloom. |
| **Tempest** (`tempest`) | `storm` | The Storm (ch. 6) | Spiccato sixteenths and timpani under a minor string tune (F - A-flat - C, the flat-6 lean down); the B strain rises to the raised dominant (C major); the climax is the leitmotif darkened with brass, taiko and choir; a two-bar hush lets the wind through. 72 BPM. |
| **Two Voices** (`duet`) | `courtship` | Act II, the courtship at golden hour | D-flat major (the theme's VI). He (solo strings, low) sings four bars, she (flute, high) answers; then they sing together in thirds and sixths; the spiral-dance strain (harp sixteenths, bells, shaker) with both voices high; a short coda. Intense dancing repeats the dance. |
| **The Guardian** (`guardian`) | `birth` | Act III, the egg watch in the maelstrom's eye (and after the predator) | The lullaby a generation on: first low and slow on solo strings over F minor harmony (the parent's voice), then high on the glockenspiel as the egg glows, then a rising strain (D-flat - E-flat - F minor - C) with horns and a soft drum: the guard standing up. |
| **Elegy** (`elegy`) | `rest` | Act IV, the elder's rest | A slow lament on solo strings over a C pedal, answered by choir; the leitmotif once more, very far away (glockenspiel and flute); a farewell strain on the theme's own opening chords (B-flat minor 7 - D-flat - F minor) that stops open on E-flat, so the theme track at the last dawn sounds like its continuation. 50 BPM. |

The other moods (title, krill, song, night, danger, chase, relief, cloudwall, oasis, finale) are
the adaptive score of section 4; the finale (end of Act I) carries the leitmotif and its cadence.

**The official track at a third moment?** Considered for the first hug, but that comes within the
first minutes, right after the title track has played (it often still carries under the
hatching), so a third whole play would be too close. It stays at the two bookends.
`audio.playSong('theme')` plays it whole on demand if a later peak wants it.

How a song is written and played:

- Notation: `theory.score('Ab4:2 C5 Db5> | C5:3 r')` (bars split by `|`, `:beats`, `r` rest,
  marks `>` accent, `_` soft, `.` staccato, `~` legato) gives `[midi, beats, accent, gate]` bars.
- A section has `bars` (chords), `melody`, optional `parts` (counter-lines, the duet's two
  voices, low lines) played by the `part` pattern on a sampler or solo line, and `energy` (its
  written dynamic level). `sectionEnergy` + `react` (0.3-0.45) let the game's intensity lean
  on the written dynamics, so layers still come and go with play.
- `branch: { at: 0.8, to: 'climax' }` (or `below`) on a section plays another section next
  once when the game is that intense (or calm); the form then carries on. `loopFrom` loops.
- Changing mood crossfades as before (the old song's accompaniment fades over the new harmony,
  its melody stops at once), and the songs share the score's key and tempo family, so every
  hand-over is in tune.
- API: `audio.setMood('dawn')` as the story does, or `audio.playSong('lullaby' | 'skyward' |
  'wonder' | 'tempest' | 'duet' | 'guardian' | 'elegy' | 'theme', { fade })`;
  `AudioSystem.songs` lists them. `getKey()` and the beat grid are unchanged.

## 4. The score, re-voiced to the theme

- **Key.** Home is the theme's F minor (aeolian, the notes of A-flat major) for every story mood;
  side keys stay inside its family: F dorian (the forest: the theme's D-natural lift), F phrygian
  (danger), D-flat major (the courtship: the theme's VI). `getKey()` reports root F (65), so the
  whale voices and the player's humming snap to the same notes.
- **Tempo.** 60 BPM for the title, flight, song, relief, oasis and finale (the theme's
  tempo, with harp and piano sixteenths as its pulse); 56 for the lullaby, night and the
  guardian, 50 for the elegy; 66 the duet, 72 the tempest, 80 danger and krill, and 120 for
  the chase (exactly double).
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

## 5. Samples: pipeline and budget

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

## 6. Checking the mix without ears

- `PORT=5241 node tools/audio-check.mjs --skip-sfx --wav --only=title,flight,chase` renders moods
  through an OfflineAudioContext into `tools/out/*.wav`; then
  `ffmpeg -i tools/out/audio-mood-flight.wav -lavfi showspectrumpic=s=1400x500:scale=log:fscale=log out.png`.
- `node <script>` with `theory.score` + a bar-sum / key / chord-tone check validates the songs'
  notation (every bar 4 beats, every note in the key; non-chord tones on strong beats listed).
- The score renders at about -20 to -28 dBFS RMS by mood (the songs -20 to -26); the track, at its level of 0.85 through
  the same chain, lands at about -26 dBFS RMS, so the hand-overs do not jump in level.
