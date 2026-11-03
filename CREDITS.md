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
