# SKYSONG

*A cinematic 3D fantasy adventure about being a tiny flying-whale calf on its first migration
across Vur Sok, an ocean planet of spiral islands.*

You wake at sunrise in a lagoon beside your mother, in a herd of enormous horned, fluffy
flying whales. The great migration to the legendary **Oasis** is about to begin. Fly low over
the sea with your family through the Spiral Reach, dive with them to feast in the shoals,
play in the Coil Forest, sing the herd song at golden hour, cross the night under a spiral
galaxy, survive a violent storm and the hunt of a gigantic falcon, then find your way
through the fog into the Oasis atoll and its Mother Tree.

The whole world is painted: soft Tiny Glade-like light, brush-stroke shading, hand-painted
whales with ink-drawn contours, moving alien plants and realistic rock.

The game has **no UI at all**: no HUD, no meters, no prompts, no markers. Everything is
told through the world: your mother's movements and voice, your calf's breathing and
body language, the music, the weather, the light.

Everything you see and hear is generated in code: every creature, island, tree, cloud,
waterfall, every note of the score and every whale voice. There are no models, textures or
audio files.

---

## Play

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # static build in dist/ (open with any static file server)
```

A browser with WebGL 2 is required (recent Chrome, Edge, Firefox or Safari). A dedicated
GPU is recommended. Quality steps down on its own if frames run slow; you can also pick it
in **Settings**.

### Controls

| | Keyboard and mouse | Gamepad |
|---|---|---|
| Look and steer (you swim where you look) | Mouse (click once to capture it; or drag) | Right stick |
| Turn / rise / dive | A D / Space C (or the arrow keys) | Left stick, A / B |
| Swim | W or left click | RT |
| Slow down / hover | S | LT |
| Surge | Shift | L3 |
| Barrel roll | Q / E | LB / RB |
| Hum (hold to sing) | F (or H, middle click) | X |
| Sonic boom: hold to gather, release | R or right click | Y |
| Pause | Esc | Start |

On a touch screen: drag to look (you swim while touching), two fingers to hum, double-tap
and hold to gather a sonic boom, flick sideways to roll, three-finger tap to pause.

Controls are also listed under **Settings → Controls** in the floating title menu. That
menu is the only place text ever appears.

### Things to try

- Fly close to your mother and nuzzle her.
- Hum. She always answers. Tilt your nose up while humming to sing higher.
- Dive into the sea at the Feasting Shoals and swim through a bait ball: your mouth opens by
  itself. Come up for air before your breath runs out; you spout when you surface.
- Skim the waves, breach, carve tunnels through clouds, roll through waterfall spray.
- Bump into your playmates: they bump back or start a chase. Bump your mother softly.
- Fly low over the islands: the anemones curl shut as you pass.
- When the herd sings, watch your mother breathe in before each note, and answer her.
- In the storm, fly in your mother's lee: her body breaks the wind.
- When the falcon comes, get between the adults.

---

## The journey

| Chapter | Light | What happens |
|---|---|---|
| Dawn Lagoon | sunrise | Waking in a lagoon, following your mother, learning to fly |
| The Spiral Reach | morning | Spiral sea stacks, waterfalls into the sea, call and answer, the Spiral Arch |
| The Feasting Shoals | noon | The adults blow a spiral bubble net; your mother dives, lunges, and takes you down to feast |
| The Coil Forest | afternoon | Giant coil trees and alien meadows; playmates invite you to a chase |
| The Herd Song | golden hour | Call-and-response singing with the whole herd |
| Night Passage | night | A spiral galaxy, two moons, glowing plankton in the wakes |
| The Storm | storm | Gales, 9 m seas, rain, lightning; a downdraft tears you away |
| The Falcon | stormy dawn | A huge shadow, a hunt, a living shelter of whales |
| The Fog Wall | whiteout | Flying blind through sea fog, following her voice |
| The Oasis | morning | A spiral atoll, the Mother Tree, the gathering, the final song |

Progress is saved at each chapter. **Continue** in the title menu resumes from there.

---

## How it is made

- **Renderer** (`src/render`): Three.js WebGL 2 with a custom pipeline. Shadow map, MSAA
  HDR opaque pass, half-res GTAO ambient occlusion, a sorted transparent pass (the ocean,
  clouds, particles), then post: bloom, crepuscular rays, sonic-boom distortion, grading, and
  the painterly chain (`render/painterly`): an anisotropic Kuwahara brush filter, canvas,
  painted grade and a depth-aware depth of field with title, gameplay and cinematic looks.
  All lighting goes through one stylized model (`render/shaders/common.js`) with sky fill,
  warm bounce and soft wide shadows.
- **Ocean** (`world/Ocean.js`): wind sea and swell up to storm seas, CPU-mirrored heights for
  physics, sky and screen-space reflections, clear shallows over reefs, foam, wakes and
  splashes, plankton glow, and an underwater view with caustics, light shafts and Snell's
  window. The sky has a ringed gas giant, two moons and a spiral galaxy.
- **Whales** (`src/creatures/whale`): rorqual-and-tulkun anatomy with armoured back plates,
  Monster Hunter-style resonance horns, a flaring sensor crest, four small golden eyes,
  barbels, six fins and fluffy clumped shell fur; GPU-baked skin, painted brush-stroke
  shading with ink contours, a palette per whale (the scarred alpha with a torn wing, the
  barnacled elder, the mother, the calf). The animator is procedural and spring-driven.
- **World** (`src/world`, `src/flora`): one migration route at sea level through ten
  chapters. Spiral islands rising from the sea (helical stacks, coils, ammonites, peaks,
  forming volcanic islands), reefs and atolls, a detailed rock shader, painted backdrops,
  fluffy painted grass, a few accent trees and the Mother Tree, and nine species of
  animated alien plants, built time-sliced behind the menu.
- **Herd and story** (`src/game`): bouncy whale-to-whale physics (`WhalePhysics.js`), social
  behaviours and the spiral bubble-net hunt (`HerdBehaviors.js`), swimming, buoyancy, breath
  and splashes (`Swim.js`), the mother's care AI, the coroutine-scripted story director, the
  singing game, weather, sonic booms and the floating menu.
- **Wildlife and falcon** (`src/creatures/Ecosystem.js`, `eco/`, `Falcon.js`): glintfin bait
  balls, spiralback and lanternjack fish, skimmer and coilwing bird-reptiles, night
  plankton, plus the storm falcon.
- **Audio** (`src/audio`): a Web Audio score synthesized at runtime (piano, celesta,
  strings, choir, harp, flute, drums and brass), adaptive moods, spatial whale voices tuned
  to the current key, and ambience: wind, rain, the sea's swell and foam, and the muffled
  deep with bubbles under water.

The Vur Sok design contract is [`docs/VUR_SOK.md`](docs/VUR_SOK.md).
The visual and audio research behind all of this is in
[`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md).

### Debug parameters

Add `?debug` to the URL, then optionally:
- `&chapter=N` to jump to a chapter (0-9), `&intro` to play the opening.
- `&auto` for an autopilot that follows the mother; `&dt=0.05&warp=30` to simulate ahead.
- `&test=fly|whale|islands|world|ocean|flora|painterly|herd|ecosystem` (dev scenes in
  `src/dev/`; add `&ocean` to give a dev scene the real ocean), `&time=dawn|morning|…`.
- `&quality=high|medium|low`, `&nobloom`, `&norays`, `&noshadow`, `&nosea`.

### Headless checks

All of these drive headless Chromium against the dev server (`npm run dev`):

| Command | What it checks |
|---|---|
| `node tools/chapters.mjs 0,1,2 25 [shots]` | Runs chapters with the autopilot and reports state and errors (and screenshots) |
| `node tools/probe.mjs "<query>" out.png <frames> <w> <h>` | Captures a frame; `EVAL="<js>"` prints an expression (`g` is the game) |
| `node tools/falcon-run.mjs 150` | Plays the falcon encounter and logs every falcon event and the herd's shelter |
| `node tools/audio-check.mjs` | Renders every mood, voice and effect offline: no NaNs, nothing silent, gain staging |
| `node tools/audio-game.mjs 4 40` | Runs a chapter with live audio and reports the mood, chords and audio errors |
| `node tools/touch-check.mjs` | Phone viewport: taps New Game on the floating menu with a touch event |
