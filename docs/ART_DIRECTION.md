# SKYSONG: Art Direction & Reference Study

> A short, focused journey about being a tiny sky-whale calf migrating with its family
> through an enormous living sky. The game should play like an animated film.

This document records the reference study done before production and the decisions
that came out of it. Every system in `src/` traces back to a line in here.

---

## 1. Pillars

1. **Scale and tenderness.** The calf is tiny, the mother is huge, the sky is endless.
   Every shot sets something small against something vast.
2. **Show magic through shape, light and motion, not effects.** No random glows, no neon,
   no heavy bloom. When something glows, the creature's biology explains it (krill
   bioluminescence, membranes lit from behind).
3. **Everything is alive and has a job.** Plankton feed krill, krill feed rays and whales,
   and falcons hunt calves. Every creature belongs to that food chain.
4. **Zero UI.** Breathing, eyes, fins, voices, music and weather carry all information.
5. **Weight and grace.** Nothing slides. Every motion has anticipation, follow-through and
   momentum.

---

## 2. Visual references studied

| Reference | What we took | What we avoided |
|---|---|---|
| *Sky: Children of the Light* (thatgamecompany; GDC Summer 2020 *Art of Sky* talk by Yuichiro Tanabe) | Light as an emotional theme across a sequence of levels, soft simplified forms, cloud seas, warm/cool lighting, quiet orchestral score | Copying their characters or architecture |
| Studio Ghibli backgrounds (Kazuo Oga; Osamu Masuyama's sky demo) | A four-colour sky palette (two blues for the gradient, white for lit cloud, grey for cloud shadow). Wet-paper softness at cloud edges. Painting from big shapes down to small | Over-detailing. The painted feel comes from simplified value groups |
| *Avatar: The Way of Water* (tulkun, Pandoran ecosystems, floating-mountain concept art) | Alien wilderness with layered strata and floating rocks, hexapod anatomy, crests and sensor organs, a pod culture with protected calves, a huge gas giant in the sky | Photoreal textures and saturated neon bioluminescence |
| *Subnautica* reefback | An elder whale carrying a living garden on its back, with fish (here: birds) living around it | Horror-scale realism |
| *Monster Hunter* creature design | Anatomy that explains behaviour: every organ has a job and a visible tell | Armour plating and aggressive spikes on gentle animals |

## 3. Technique references studied

| Topic | Source | Applied in |
|---|---|---|
| Shell-texture fur | Lengyel et al. 2001 *Real-Time Fur over Arbitrary Surfaces*; NVIDIA *Fur (Shells and Fins)* whitepaper | `render/shaders/fur.js`: N skinned shells with per-strand taper, alpha-to-coverage |
| Fur and grass in motion | Banisch & Wüthrich 2006 *Making Grass and Fur Move* (shells displaced sideways by a mass-spring) | Shell displacement from wind, body inertia (spring-filtered acceleration) and gravity, scaled by shell height² |
| Anime cel shading | Community breakdowns of Genshin-style shading: soft NdotL transition, separate lit/shadow tints, a thin harder secondary band | `render/shaders/common.js` `stylizedLight()`: soft ramp, cool tinted shadows, a warm saturated terminator band, rim light |
| Clouds | Harris 2002 *Real-Time Cloud Rendering for Games* (impostor puffs); Schneider, *Nubis* (Advances 2023) for density/lighting intuition | `world/Clouds.js`: lit puff impostors with cauliflower erosion, silver lining, depth-soft edges; heightfield-raymarched cloud sea |
| Secondary motion | Spring-damper bone chains. Slightly under-damped (ζ≈0.5–0.7) reads as alive, critical damping reads as mechanical | `creatures/Spring.js`, `WhaleAnimator.js` |
| Falcon stoop | Ponitz et al. 2014; Gowree et al. 2018 (*Commun. Biol.*); Selim et al. 2021: the tucked *teardrop* (T) dive, then a *cupped* (C) and *M-shape* during pull-out | `creatures/Falcon.js` dive pose sequence T → C → M → strike |
| Whale fin stroke | Humpbacks flap their long flippers in a lift-generating stroke just before opening the mouth (Kosma et al. 2019) | Calf and adults give a power-stroke burst before every krill lunge |
| Lunge feeding | Rorqual throat pleats expand with each gulp and contract to push water out through the baleen | Throat pouch inflates on gulp. Baleen-like filter combs show in the open mouth. Gills flare to filter |
| Whale song | Payne & McVay hierarchy: units → phrases → themes → song. Phrases repeat with steady rhythm, so the listener can anticipate the next one | `audio/WhaleVoice.js` and the singing game: call/response phrases built from units, with rhythm carried by breathing |

---

## 4. Creature design

### 4.1 The skywhale (original species)

The skywhale is a *buoyant filter-feeding flyer*, not a whale with wings.

| Organ | Function | Visible tell |
|---|---|---|
| Insulating fur | Survives cold high-altitude air | Soft shells. Thicker mane over the shoulders. Moves in wind. Flattens and darkens in rain |
| Pectoral wing-fins | Main propulsion: a muscular furred leading-edge arm with a thin membrane stretched over 4 flexible rays | Phase-lagged flap (shoulder → elbow → wrist) with feathering twist. The membrane billows behind the arm and glows warm when backlit |
| Tail fluke | Pitch control and power strokes | Dorso-ventral stroke wave, flexible tips |
| Buoyancy sacs (internal, two along the lower flanks) | Lighter-than-air gas bladders | Translucent pale domes. They inflate when climbing or resting and deflate in dives. They pulse with breathing |
| Cloud-filtering gills | Strain moisture and plankton out of clouds | Neck slits plus feathery external gill fronds. The fronds flare while feeding and flatten when afraid |
| Filter mouth | Wide gape with baleen-like filter combs | The jaw drops in a lunge, combs strain krill, the throat pouch swells |
| Throat resonator | Song and sonic boom | A pleated ventral sac that swells and visibly vibrates while humming or charging |
| Eyes | Large, expressive, front-set | Lids blink, smile and widen. The pupils track targets and dilate when afraid |

**Calf proportions:** a head about 40% of body length, short fins, big eyes, long fluffy fur,
fast slightly irregular flaps, and an under-damped wobble.
**Adult proportions:** long torso, fins spanning 1.3× body length, slow heavy strokes,
calm eyes. Individuals are told apart by markings, mane shape and fin scallops. The
elder carries a garden on its back.

### 4.2 The storm falcon (apex predator)

A Pandoran-style hexapod: **two pairs of wings and a pair of talons.** A hooked beak,
a crimson sound-sensing crest (it hunts by listening for whale song), two primary eyes
plus two small secondary eyes, a barred pale underside and a slate-blue back. Streamer
tail feathers.
Its flight follows the falcon references: slow powerful beats, long soaring circles,
the teardrop stoop, then the M-shape pull-out and talon strike.

### 4.3 The food chain

`moisture-rich cloud → cloud plankton (drifting motes) → sky krill (swarms) → sky rays,
whales → (calves) → storm falcon`. Sky jellies drift with the wind and graze plankton.
Puffbirds clean the elders' back-gardens.

---

## 5. Lighting and colour script

| Chapter | Time | Key | Palette notes |
|---|---|---|---|
| Dawn Cradle | sunrise | low warm sun from the horizon | rose and peach sky, lilac shadows, golden rim on fur |
| Floating Valleys | morning | high warm sun | clear cerulean, white cloud tops, grey-violet strata |
| Krill Fields | late morning | top light | turquoise haze, glittering krill |
| Cloud Forest | afternoon | dappled light through canopy | deep greens, mist, shafts of light |
| The Herd Song | golden hour | sun at the horizon, behind the herd | amber and rose, silver linings, long shadows on the cloud sea |
| Night Passage | night | moon and starlight | deep indigo, faint krill glow, giant planet rim-lit |
| The Storm | storm | lightning flashes | slate and teal, desaturated, white-violet flashes |
| The Falcon | stormy dawn | broken sunlight | cold gold through torn cloud, high contrast |
| The Oasis | morning | soft sun with god rays through mist | jade water, emerald trees, cream clouds, rainbow mist at waterfalls |

**Rules:**
- Shadows are tinted, never black: a cool hue from the sky, the cloud sea bounces warm
  light up into bellies, and the terminator band is warm and saturated.
- Atmospheric perspective carries scale. Distance desaturates toward the horizon colour,
  and scattering warms toward the sun.
- Bloom stays restrained: only the sun, lightning and backlit membranes go past 1.0.

## 6. Sound

Score: soft piano, celesta and bells, warm string ensemble, wordless choir, harp, and
low drums for danger. The score adapts to exploration, speed, weather, singing and
danger. Whale voices are tuned to the current chord so the herd sings *inside* the
score. Everything is synthesised at runtime, with no audio files.

## 7. Sources

- GDC Vault: *Art of Sky: Children of the Light*: https://gdcvault.com/play/1026903/Art-of-Sky-Children-of
- Recap of the GDC talk *Dynamic Environment Lighting in Sky: Children of the Light*: https://recapio.com/digest/dynamic-environment-lighting-in-sky-children-of-the-light-gdcrewind-gdc2026-gaming-by-gdc-festival-o
- Gurney Journey, *Painting in Ghibli style*: https://gurneyjourney.blogspot.com/2018/05/painting-in-ghibli-style.html
- Open Culture, Kazuo Oga's painting process: https://www.openculture.com/2021/01/a-look-inside-the-painting-process-of-the-studio-ghibli-artist-kazuo-oga.html
- NVIDIA, *Fur (Shells and Fins)*: https://developer.download.nvidia.com/SDK/10.5/direct3d/Source/Fur/doc/FurShellsAndFins.pdf
- Banisch & Wüthrich, *Making Grass and Fur Move*: https://dspace5old.zcu.cz/bitstream/11025/1349/1/Banisch.pdf
- Harris, *Real-Time Cloud Rendering for Games* (GDC 2002): https://aurora.cs.uaf.edu/~olawlor/academic/thesis/ref/RTCloudsForGames_HarrisGDC2002.pdf
- Schneider, *Nubis Cubed* (Advances in Real-Time Rendering 2023): https://advances.realtimerendering.com/s2023/Nubis%20Cubed%20(Advances%202023).pdf
- Genshin-style toon shader breakdown (Godot Shaders): https://godotshaders.com/shader/toon-shader-inspired-of-genshin-impact/
- Peregrine stoop morphing: https://doi.org/10.1038/s42003-018-0029-3 and https://ar5iv.labs.arxiv.org/html/2008.03948
- Humpback flipper stroke and lunge feeding: https://capemaywhalewatch.com/blog/new-ways-of-propulsion-discovered-in-humpback-whales/ and https://cascadiaresearch.org/files/Goldbogen-et-al.2006.pdf
- Humpback song structure: https://en.wikipedia.org/wiki/Whale_vocalization and https://www.bioacoustics.info/article/hierarchical-and-rhythmic-organization-songs-humpback-whales-megaptera-novaeangliae
- Spring-damper secondary motion: https://masterallarts.pages.dev/learn/threejs-from-zero/s3-05-procedural-animation/
