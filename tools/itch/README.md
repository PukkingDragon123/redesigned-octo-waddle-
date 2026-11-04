# itch.io art pipeline

These scripts make the cover GIF and the banner in `itch/` from real game renders.

1. **Render frames.** With a dev server on 5173:
   - `frames.mjs` captures a run of frames plus the singing whale's mouth position:
     `node frames.mjs "debug&test=whale&who=mother&sea&time=golden&anim&sing=1&hum=0.6&mouth=0.35&cam=-30,-1,22&look=2,7,4&yaw=-20&dt=0.0833" seq 30 24 630 500`
   - `still.mjs` renders a still from the game with a custom camera (used for the herd at the arch).
2. **Paint.** `painter.py` paints a frame (Kuwahara + contour-following brush strokes + ink edge + canvas).
3. **Title.** `compose.py` draws the song ribbons rising from the mouth and inks in SKYSONG letter by letter
   (fonts: Almendra SC in a `fonts/` folder next to it).
4. **Sequence.** `sequence.py` joins the painted scenes with brush-stroke wipes (set `SCENE1` and `SCENE2` to the stills).
5. **Encode.** ffmpeg: `fps=10, palettegen (stats_mode=diff), paletteuse (bayer, diff_mode=rectangle)`.
6. **Banner lettering.** `banner.py` adds the title to the banner.
