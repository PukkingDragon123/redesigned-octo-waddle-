# SKYSONG

*A cinematic 3D fantasy adventure about the whole life of a flying whale on Vur Sok, an ocean
planet of spiral islands: from hatching in a whirlpool to an elder at rest. About fifteen
minutes, with no text on screen.*

You wake at sunrise in a lagoon beside your mother, in a herd of enormous horned, fluffy
flying whales. The great migration to the legendary **Oasis** is about to begin. Fly low over
the sea with your family through the Spiral Reach, dive with them to feast in the shoals,
play in the Coil Forest, sing the herd song at golden hour, cross the night under a spiral
galaxy, survive a violent storm and the hunt of a gigantic falcon, then find your way
through the fog into the Oasis atoll and its Mother Tree. Then the seasons turn: you grow up,
find a mate, bring a calf of your own into the world, and lead the herd as its elder.

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
| Tail slap (a fluke flick in the air) | X | D-pad down |
| Spout (bubbles under water) | V | D-pad up |
| Loop | Z | D-pad left or R3 |
| Dash (a dive bomb when pointing down at the sea) | G or double-tap Shift | D-pad right or double-click L3 |
| Corkscrew | Q / E again mid-roll | LB / RB again |
| Breach | Dive deep, then race up | same |
| Pause | Esc | Start |

On a touch screen: drag to look (you swim while touching), two fingers to hum, double-tap
and hold to gather a sonic boom, flick sideways to roll, three-finger tap to pause.
Flick up for a loop, flick down for a tail slap, tap with two fingers to spout, and
double-tap quickly to dash.

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
- Chase the glowing moths, gnat spirals and sea-skimming skitterflies and eat them; when a
  playmate spins and chirps at you, race it through the rings of moths.
- Dive deep, then race up to breach in a slow-motion leap; roll in the air for a spin.
- When the herd sings, watch your mother breathe in before each note, and answer her.
- In the storm, fly in your mother's lee: her body breaks the wind.
- When the falcon comes, get between the adults.

---

## The journey

The game is one life, told without a single word on screen: short, seamless camera moments
that glide out of play and back, and soft dissolves where the years pass. About fifteen
minutes from hatching to rest. Hold any key, button or touch for a moment to skip a cinematic.

**The hatching**: each season the herd returns to the Spiral Maelstrom, a slow sea vortex.
The female lays a single glowing egg in its calm eye and leaves to feed while the males circle
and guard it. You hatch: push out of the shell and rise to your first breath.

**Season one · the calf**: your first migration with your mother and the herd.

| Chapter | Light | What happens |
|---|---|---|
| Dawn Lagoon | sunrise | The season's migration begins: the elder calls, the herd wakes, you learn to fly |
| The Spiral Reach | morning | Spiral sea stacks, waterfalls into the sea, call and answer, the Spiral Arch |
| The Feasting Shoals | noon | The adults blow a spiral bubble net; your mother dives, lunges, and takes you down to feast |
| The Coil Forest | afternoon | Giant coil trees and alien meadows; playmates invite you to a chase |
| The Herd Song | golden hour | Call-and-response singing with the whole herd |
| Night Passage | night | A spiral galaxy, two moons, glowing plankton in the wakes |
| The Storm | storm | Gales, 9 m seas, rain, lightning; a downdraft tears you away |
| The Falcon | stormy dawn | A huge shadow, a hunt, a living shelter of whales |
| The Fog Wall | whiteout | Flying blind through sea fog, following her voice |
| The Oasis | morning | A spiral atoll, the Mother Tree, the gathering, home |

**Year nine · the song of two**: you are grown. At golden hour a mate answers your
voice: sing a duet, then follow and mirror her rising spiral dance into the night.

**New life**: your mate lays your egg in the maelstrom's eye and goes to feed. Guard it
against lanternjacks and skimmers with slaps, dashes, breaches and booms until it hatches,
then lift your calf to its first breath and teach it to follow, answer and feed.

**Year thirty-one · the elder**: years pass. You lead the herd's migration, sing the last song under the
galaxy, and come to rest in the deep, where your body becomes a glowing garden. At dawn a new
calf wakes beside its mother.

Progress is saved at each chapter and act. **Continue** in the title menu resumes from there.

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
  and splashes (`Swim.js`), the mother's care AI, the coroutine-scripted story director and
  the life-cycle acts (`life/`), a seamless cinematic camera (`Cinematics.js`), tricks
  and flying bugs (`Moves.js`, `Activities.js`, `creatures/bugs`), the singing game, weather,
  sonic booms and the floating menu.
- **Wildlife and falcon** (`src/creatures/Ecosystem.js`, `eco/`, `Falcon.js`): glintfin bait
  balls, spiralback and lanternjack fish, skimmer and coilwing bird-reptiles, night plankton;
  reef life under the sea (kelp forests, tube corals, anemones, hermit, glass and plate crabs,
  jelly blooms, rays, puffers and ribbon eels); plus the storm falcon.
- **Audio** (`src/audio`): a Web Audio score synthesized at runtime (piano, celesta,
  strings, choir, harp, flute, drums and brass), adaptive moods, spatial whale voices tuned
  to the current key, and ambience: wind, rain, the sea's swell and foam, and the muffled
  deep with bubbles under water.

The Vur Sok design contract is [`docs/VUR_SOK.md`](docs/VUR_SOK.md).
The visual and audio research behind all of this is in
[`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md).

### Debug parameters

Add `?debug` to the URL, then optionally:
- `&hatch` to play the hatching opening (`&hatch=push` starts at the push), `&chapter=N` to
  jump to a chapter (0-9, skipping the hatching), `&act=2|3|4` for the courtship, new life and
  elder parts (or `&chapter=10|11|12`), `&intro` to play the opening from the menu.
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
| `node tools/story-acts.mjs 2 60 [shot]` | Plays an act headless (2, 3 or 4) and reports its state |
| `node tools/story-pace.mjs` | Measures how long each chapter and act takes with the autopilot |
| `node tools/doc-check.mjs` | Runs the hatching or an act and logs its beats (`CANVAS=1` saves the frame) |

`EXTRA="&worldslice=4000"` makes the world build much faster in headless checks.
