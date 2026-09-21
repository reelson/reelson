---
name: demo-video
description: Use when the user wants the finished demo video — intro/outro title cards, numbered callouts, zoom-ins, branded framing — rendered to MP4/GIF from a screen recording, or mentions HyperFrames. Takes <videosDir>/<slug>/recording.mp4 (+ markers.json) from the demo-record skill, scaffolds a HyperFrames composition from a template (brand, language and music from demo.config.json), and renders <videosDir>/<slug>/video/renders/<slug>.mp4.
---

# demo-video

Turns raw footage from `demo-record` into a finished video with
[HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP → deterministic MP4, rendered
frame-by-frame in headless Chrome). Nothing to install: the scaffolded project pins
`npx --yes hyperframes@0.8.46`. Needs Node 22.6+ and `ffmpeg`.

**Read the kit's `docs/style-guide.md` first** (`realpath` this skill to find the kit). The
templates implement it; edit the `DEMO` block, not the design — design changes belong in a
template (see `templates/README.md`).

```
<videosDir>/<slug>/video/
├── index.html            ← the composition (committed; edit the DEMO block)
├── hyperframes.json
├── package.json          ← dev / check / render scripts, pinned version
├── assets/recording.mp4  ← copied from ../recording.mp4 (ignored)
├── assets/music.m4a      ← the project's music bed, trimmed + normalised (ignored)
└── renders/<slug>.mp4    ← output (ignored)
```

## Inputs from demo.config.json

Brand wordmark/tagline/eyebrow/colours, the recap title and chip wording (`strings`), the
UI `language`, the default `template` and the music bed (`music.file`, loudness) all come
from the project's `demo.config.json` (see demo-record's `scripts/config.ts`). Flags override
them for one video. No `music.file` → the video is silent (the scaffold says so).

## Templates

`templates/<name>/index.html` in this skill, or `<videosDir>/_templates/<name>/` in the
project (checked first, so a project can fork one). Pick with `--template <name>` or the
config's `template`. Shipped:

- **classic** — 1920x1080, 30 fps, Inter, deep navy gradient with four drifting glows and a
  dot grid:

  ```
  COVER (0 → 3.0s exit)                RECORDING               RECAP (2.4s + 0.45s/step)   BRAND (2.6s)
  wordmark · line · tagline            framed clip, callouts,  title left ·                wordmark big,
  title · subtitle · "N steps · S s"   zooms, hand-off cards   one column of steps right   ends at 15% opacity
  ```

  Frame 0 is the poster (thumbnail in Slack/Telegram/GitHub/Finder): every cover entry
  tween's *from* state is legible (big + 60 % opacity), never hidden or blurred.

**Hand-offs**: when `markers.json` has `transitions` (from `demo.transition()`), the scaffold
splits the footage into one `<video>` per actor and inserts a card between them; callouts
after it shift automatically and get a `group` (the role) so the recap splits per role.

## Workflow

1. **Scaffold** (once per video; `--force` regenerates and drops your DEMO edits):

   ```bash
   node .claude/skills/demo-video/scripts/scaffold.ts <videosDir>/<slug> \
       --title "Find a customer" \
       --subtitle "Search any customer from the list" \
       --trim-start 4.8            # seconds of recording to skip (the login)
       # --trim-end <s> --template <name> --brand .. --tagline .. --eyebrow .. --outro-title ..
       # --music <file> | --no-music
   ```

   `--trim-start` is usually the first click's `move` time minus ~0.5 s (or the first marker
   minus ~0.8 s). The recording starts at 3.0 s, when the cover lifts away. The scaffold prints
   the timeline; every marker becomes a callout at the right composition time.

2. **Edit the `DEMO` block** in `video/index.html`:
   - `callouts: [{ at, duration, text }]` — imperative steps in the UI's language, ≤ 6 words
     ("Type the name in Search"). They also become the recap.
   - `zooms: [{ at, duration, x, y, scale, in?, out? }]` — `x`/`y` are 0..1 fractions of the
     frame; `scale` 1.4–2.2; `in`/`out` ease durations (default 0.8 s, min 0.4 s). **Time zooms
     by the cursor** (`clicks` in markers.json: `move` = glide start, `at` = click):
     zoom in with the glide to the first click it frames (≤ 0.35 s earlier, fully in 0.1 s
     before the click); zoom out with the glide to the next target outside it; no easing
     during a click. Never add pauses to the scenario for a zoom — shorten `in`/`out`.
     Rough numbers are fine: `check-zooms.ts` prints the exact `{ at, in, duration, out }`.
   - Times are **composition** seconds: `clipStart + (recordingTime - mediaStart)`.
   - Timing numbers in DEMO must agree with the matching `data-*` attributes in the HTML; to
     change trims, re-run scaffold with `--force` and paste your callouts/zooms back.

3. **Check and look before rendering** (render ≈ 30–60 s per 12 s of video):

   ```bash
   node .claude/skills/demo-video/scripts/check-zooms.ts <videosDir>/<slug>
   cd <videosDir>/<slug>/video
   npx --yes hyperframes@0.8.46 check .                         # lint + runtime + layout + contrast
   npx --yes hyperframes@0.8.46 snapshot . --at 1.2,3.5,6,10    # PNGs in snapshots/ — read them
   ```

   Both must pass with 0 errors. Layout `info` about text near the edge and off-canvas glows
   is fine; `panel_out_of_canvas` on a callout means it ended up inside `#frame`.

4. **Render**:

   ```bash
   npx --yes hyperframes@0.8.46 render . --video-frame-format jpg -q delivery -o renders/<slug>.mp4
   npx --yes hyperframes@0.8.46 render . --video-frame-format jpg --format gif --fps 15 -o renders/<slug>.gif
   ```

   Sharp UI text comes from the 2x capture; keep `media.autoProxy: false` and no
   `will-change` on `#frame`. jpg frames are as sharp as png at 2x, and png can stall.

5. **Verify the artifact**, not the log: `ffprobe` duration ≈ the printed total; extract
   frames (`ffmpeg -ss <t> -i renders/<slug>.mp4 -frames:v 1 f.png`) at t=0 (poster), ~2 s,
   a callout, a zoom, the recap, the end. Look at them. Then report the file path.

## Audio

The scaffold handles audio; don't add `<audio>` clips by hand.

- **Music bed** from `music.file`: trimmed to the total length, normalised to `music.lufs`
  (−28 LUFS), faded in 0.8 s / out 3 s, written to `assets/music.m4a`. One track per project
  is part of the brand; `--music` is for one-offs, `--no-music` for clips that sit next to
  other audio. Re-run scaffold if the total length changes.
- **Narration** when the recording has an audio track (OpenScreen): extracted to
  `assets/narration.m4a`, played in sync, and the bed drops to `music.lufsUnderNarration`.
- Verify: `ffprobe -show_entries stream=codec_type renders/<slug>.mp4` lists `audio`.

## HyperFrames rules that bite (keep these when editing a template)

- **A timed `<video>` may not sit inside a timed element.** `#screen` is untimed on purpose.
- **`fromTo()` renders its from-state at construction** (`immediateRender`). Every "out"
  tween needs `immediateRender: false` (`...later` in the template) or it overwrites the
  entry state at t=0. Anything whose entry uses `...later` needs an explicit hidden state in
  the final `gsap.set` block. Cover entry tweens must NOT use `later` (frame 0 is the poster).
- **Animate transforms/opacity only** (`x`, `y`, `scale`, `scaleX`, `opacity`, `filter`);
  `letterSpacing`/`width`/`top` fail lint (`gsap_non_transform_motion`).
- One `gsap.timeline({ paused: true })`, registered as `window.__timelines[<composition id>]`.
  Explicit positions on every tween. No `.play()`, `Math.random()`, `Date.now()`, rAF, async.
- `<video>` must be `muted`; audio goes in separate `<audio>` clips.
- No CSS `transform` on anything GSAP moves with `x`/`y`. Callouts centre with
  `left:0; right:0; margin:auto; width:max-content`.
- Root `data-duration` defines the output length; media doesn't extend it.

## Going beyond the template

Narration (`npx hyperframes tts`), captions, shader transitions, device mockups: install the
official skills (`npx skills add heygen-com/hyperframes`) or read
https://hyperframes.heygen.com/llms.txt (`reference/html-schema`, `guides/gsap-animation`,
`prompting/rules-and-anti-patterns`, `guides/media`, `guides/rendering`). A new look that
should be reusable → a new template, not per-video edits.
