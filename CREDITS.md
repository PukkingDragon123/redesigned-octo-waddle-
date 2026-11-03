# Credits

## Sound effects, ambience and whale voices (public/audio/)

All recordings below were trimmed, faded, loudness-normalised (EBU R128) and re-encoded to Ogg Vorbis; ambience beds were made into seamless loops (equal-power crossfade at the loop point), some were pitch-shifted or filtered. The game layers them with its own Web Audio synthesis (src/audio/SampleLib.js, Sfx.js, Ambience.js, WhaleVoice.js), which also stands in when a file is missing.

### BigSoundBank (Joseph Sardin) - CC0 1.0 (public domain dedication)

Licence: https://creativecommons.org/publicdomain/zero/1.0/ (stated on each sound's page: "License CC0 (public domain): Free and royalty-free"; see https://bigsoundbank.com/licenses.html). Credit is not required; given with thanks.

| File(s) | Source sound | URL |
|---|---|---|
| amb/sea_calm.ogg | Sea of the beach of Dellec 1 (#2564) | https://bigsoundbank.com/sea-of-the-beach-of-dellec-1-s2564.html |
| amb/sea_rough.ogg | Cliff 1 (#2570) | https://bigsoundbank.com/cliff-1-s2570.html |
| amb/under.ogg (slowed, low-passed) | Sea waves (#0698) | https://bigsoundbank.com/sea-waves-s0698.html |
| amb/wind.ogg | Wind (#0595) | https://bigsoundbank.com/wind-s0595.html |
| amb/gale.ogg | Strong wind 4 (#0154) | https://bigsoundbank.com/strong-wind-4-s0154.html |
| amb/storm.ogg | Wind from inside 1 (#1714) | https://bigsoundbank.com/wind-from-inside-1-s1714.html |
| amb/rain.ogg | Rain and storm 2 (#0740) | https://bigsoundbank.com/rain-and-storm-2-s0740.html |
| amb/swarm.ogg | Many flies (#0822) | https://bigsoundbank.com/many-flies-s0822.html |
| sfx/thunder1-4.ogg | Thunder 2, 3, 4 and Thunder (#3113, #3114, #3115, #2718) | https://bigsoundbank.com/search?q=thunder |
| sfx/splash_s1-3.ogg | Splash small 1, 3, 5 (#1529, #1531, #1533) | https://bigsoundbank.com/search?q=splash |
| sfx/splash_b1-3.ogg | Splash big 1-3 (#1519, #1520, #1521) | https://bigsoundbank.com/search?q=splash |
| sfx/whoosh1-4.ogg | Whoosh 3, 4, 5, 10 (#1795, #1796, #1797, #1798) | https://bigsoundbank.com/search?q=whoosh |
| sfx/thump1-3.ogg | Punch 4, 5, 10 (#2459, #2460, #2465) | https://bigsoundbank.com/search?q=punch |
| sfx/blast_near.ogg, blast_far.ogg | Explosion 2, Explosion far away (#1808, #1023) | https://bigsoundbank.com/search?q=explosion |
| sfx/wing1-3.ogg | Flight bird 1-3 (#2891, #2892, #2893) | https://bigsoundbank.com/search?q=wings |
| sfx/bubbles1-3.ogg | Water bubbles (#0150) | https://bigsoundbank.com/water-bubbles-s0150.html |
| sfx/crunch1-3.ogg | Raw carrot crunched 1, Apple crunched 1 (#1594, #1113) | https://bigsoundbank.com/search?q=crunch |
| sfx/glug1-2.ogg | Gargle 1-2 (#1652, #1653) | https://bigsoundbank.com/search?q=gargle |
| sfx/breath1-4.ogg | Breath of a horse 1-2, Breath horse 4, Blow hard 2 (#0285, #0286, #1543, #1603) | https://bigsoundbank.com/search?q=breath |
| sfx/gull1-5.ogg | Gulls on the harbor (#2573) | https://bigsoundbank.com/gulls-on-the-harbor-s2573.html |

Files were downloaded from https://bigsoundbank.com/UPLOAD/flac/<id>.flac (or /ogg/<id>.ogg for older ids).

### NOAA Northeast Fisheries Science Center, Passive Acoustics Branch - public domain (U.S. Government work)

- sfx/w_chirp1-2, w_coo1-3, w_moan1-5, w_grunt, w_hum.ogg and amb/whalesong.ogg: humpback whale (Megaptera novaeangliae) song, "Meno-song-NOAA-PAGroup-13-humpback-clip.mp3", https://www.fisheries.noaa.gov/s3/2023-04/Meno-song-NOAA-PAGroup-13-humpback-clip.mp3, from "Sounds in the Sea" https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals . Citation: NOAA [National Oceanic and Atmospheric Administration]. Northeast Fisheries Science Center. Passive Acoustics Branch. Humpback whale song.

## Music

### Theme track - "thatgamejam#02 Official Theme Track", composed by Jason Grace

public/music/theme.mp3 is the theme track provided by thatgamecompany for thatgamejam #02 (https://itch.io/jam/thatgamejam-02), used unmodified within this jam entry as the jam's rules allow (encoded to MP3 for the web; no remixing, sampling, chopping, rearranging or re-pitching). It plays whole at the title and at the ending (src/audio/Soundtrack.js). All other music is an original score written for the game in the theme's style (docs/MUSIC.md).

### Score instruments: VS Chamber Orchestra 2 Community Edition (Versilian Studios) - CC0 1.0

Licence: CC0 1.0 Universal (https://github.com/sgossner/VSCO-2-CE/blob/master/LICENSE). Recorded by Sam Gossner and Simon Dalzell; sample cutting by Elan Hickler / Soundemote; the upright piano sampled by Simon Dalzell of Ivy Audio ("Credit to both original author and Versilian Studios is encouraged"). Source: https://github.com/sgossner/VSCO-2-CE (files fetched from raw.githubusercontent.com/sgossner/VSCO-2-CE/master/...).

The notes below were trimmed, faded, mixed to mono, loudness-matched per instrument, resampled to 32 kHz and encoded to Ogg Vorbis (q4); the string sustains were given crossfaded loops. They live in public/audio/music/ (about 2.2 MB in all); src/audio/musicSamples.js maps them, and the game's synthesized instruments stand in when a file is missing.

| public/audio/music/ | Instrument | VSCO-2-CE source files |
|---|---|---|
| piano/33-101.ogg (18 notes, every 4 semitones) | Upright piano | Keys/Upright Piano/Player_dyn2_rr1_006...040.wav |
| harp/35-98.ogg (19 notes) | Concert harp | Strings/Harp/KSHarp_B1...D7_mf.wav |
| celesta/79-108.ogg (6 notes) | Glockenspiel (plays the score's celesta part) | Percussion/Glock/glock_medium_G4...C7.wav |
| marimba/41-96.ogg (10 notes) | Marimba | Percussion/Marimba/Marimba_hit_Outrigger_*_loud_01.wav |
| pizz/36-86.ogg (17 notes) | Cello section pizzicato (low), violin section pizzicato | Strings/Cello Section/pizzT/pizzT_*_v2_RR1.wav, Strings/Violin Section/Pizz/VlnEns_Pizz_*_v2_rr1.wav |
| stac/36-86.ogg (17 notes) | Cello and violin section spiccato | Strings/Cello Section/spic/spic_*_v2_RR1.wav, Strings/Violin Section/Spic/VlnEns_Spic_*_v2_rr1.wav |
| strings/36-86.ogg (16 notes, looped) | Cello, viola and violin sections, sustained with vibrato | Strings/Cello Section/susvib/susvib_*_v1_1.wav, Strings/Viola Section/susvib/ViolaEns_susvib_*_v1_1.wav, Strings/Violin Section/susVib/VlnEns_susVib_*_v1.wav |
| kick/mp.ogg, kick/f.ogg | Concert bass drum | VSCO 1 Percussion/drums/bass/bdrum_mp_1.wav, bdrum_f_1.wav |
| shaker/a.ogg, shaker/b.ogg | Shaker ("Camo's Shaker") | VSCO 1 Percussion/varWood/Camo's Shaker/shake2.wav, shake5.wav |
