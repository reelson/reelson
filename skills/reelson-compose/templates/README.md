# Templates and sections

A video is a **template** (the stage) plus one **section** per slot:

```
 intro ──────▶ recording (callouts, zooms, hand-off cards) ──▶ recap ──▶ outro
 sections/intro/<name>      templates/<name>/stage.html       sections/recap/<name>   sections/outro/<name>
```

| Slot    | Kit sections                     | Rules every section in the slot keeps                                 |
|---------|----------------------------------|-----------------------------------------------------------------------|
| `intro` | `poster` (classic), `minimal`, `split` | **Frame 0 is the poster**: brand and title legible at t=0, never hidden or blurred. Hands the stage to the recording at `exit` with `stage.enter()`. |
| `recap` | `steps` (classic), `compact`, `none` | One numbered entry per callout, up to `maxSteps`. Cross-fades in over the recording's fade-out. |
| `outro` | `wordmark` (classic), `compact`, `endcard` | **Ends on the brand**, never on an empty frame (it is what players show when playback stops). No URLs. |

Pick them per project or per video; each level overrides the one before:

```jsonc
// template.json defaults  <  reelson.config.json  <  video.json  <  reelson build --intro/--recap/--outro
"template": "classic",
"sections": { "intro": "minimal", "recap": "none", "outro": "endcard" }
```

`reelson templates` lists everything a project can use, with descriptions. Sections only
rely on the stage's design tokens, so any section works with any template.

## Layout and lookup

Both live in this skill (`skills/reelson-compose/templates/` and `skills/reelson-compose/sections/`):

```
templates/<name>/
├── stage.html      ← required: page, tokens, background, #frame, callouts, hand-off cards
├── template.json   ← description, default sections, stage timing
└── assets/         ← optional: copied into video/assets/ (vendored GSAP + fonts)

sections/<slot>/<name>/
├── section.html    ← required: one <section id="<slot>"> root
├── section.css     ← selectors scoped under #<slot>
├── section.js      ← adds this section's tweens to the timeline
├── section.json    ← description, slot timing
└── assets/         ← optional: copied to video/assets/sections/<slot>-<name>/ ({{ASSETS}})
```

A project's own `<videosDir>/_templates/<name>/` and `<videosDir>/_sections/<slot>/<name>/` win
over the kit's, so a project can fork one without touching the kit. Keep everything
self-contained: scripts and fonts from `assets/`, never a CDN, so renders work offline and
never change underneath you.

## The stage (`stage.html`)

Owns everything that runs through the whole video: the page and fonts, the **design
tokens**, the background, the framed recording (`#frame`, zooms), callouts and hand-off
cards. It marks where the sections go:

| Placeholder          | Filled with                                                        |
|----------------------|--------------------------------------------------------------------|
| `{{SECTION_STYLES}}` | every section's CSS, inside the stage's `<style>`                  |
| `{{INTRO}}`          | the intro's markup — before `#screen`, so the recording rides over it |
| `{{RECAP}}`, `{{OUTRO}}` | recap / outro markup — after `#screen`, over the fading recording (empty recap for `none`) |
| `{{SECTION_SCRIPTS}}` | every section's script, after the stage's own tweens              |

**Tokens** — the only things a section may assume about the stage: `--brand`, `--brand-soft`,
`--ink`, `--muted`, `--line`, `--surface`, `--bg`, `--font`, and the shared classes
`.wordmark` (with `data-text` / `data-logo`: split into `.l` letters, or one `.l.logo` image),
`.brand-line`, `.brand-sub`, `.eyebrow`, `.accent`, `.meta[data-chip]` (filled with
"4 steps · 27 seconds") and `.n` (numbered badge). A new stage must provide all of them.

**Script API** — each section script runs inside `((section) => { … })(DEMO.sections.<slot>)`
after the stage's builder, with these in scope:

| Name | What |
|---|---|
| `section` | this slot's timing: intro `{ start, duration, exit }`, recap `{ start, duration, maxSteps }`, outro `{ start, duration }` |
| `tl` | the one paused GSAP timeline |
| `DEMO` | everything below (callouts, chip, total, …) |
| `later` | `{ immediateRender: false }` — spread into every tween that must not render at t=0 |
| `FADE` | 0.5 s, the stage's cross-fade |
| `node(tag, class, text)` | creates an element; text via `textContent`, never `innerHTML` |
| `stage.enter(at, style)` | brings the recording on screen: `'belt'` (rides in from below), `'zoom'` (grows from the middle) or `'fade'`. The intro calls it once, usually at `section.exit`; the stage fades it in at `clipStart` if nobody does. Sections never tween `#frame` themselves — zooms move it too. |

A section ends its script with `gsap.set(…, { opacity: 0 })` for everything whose entry tween
uses `later` (cold-seek safety). Intro tweens that start at t=0 must NOT use `later`: their
from-state is the poster.

Nothing on `tl` may run past `DEMO.total`: HyperFrames' snapshots and the studio player go by
the timeline's length. A looping effect lives on its own paused timeline, played to the end with
`tl.add(loop.tweenFromTo(0, DEMO.total, { duration: DEMO.total, ease: 'none' }), 0)` (see the
glows in `classic/stage.html`).

## Timing

`template.json` → `timing` (stage keys, seconds unless noted):

| Key               | Default   | Meaning                                                  |
|-------------------|-----------|----------------------------------------------------------|
| `overlap`         | 0.4       | recording → recap → outro cross-fade (no recap: the outro starts once the recording has faded) |
| `calloutDuration` | 3.0       | default callout length (capped so callouts never overlap) |
| `transitionGap`   | 2.6       | how long a hand-off card holds                           |
| `belt`            | 0.9       | the recording's exit/entry around a hand-off card        |
| `maxW`, `maxH`    | 1600, 940 | px box the framed recording is fitted into (1920x1080 stage) |

`section.json` → `timing`, per slot (unknown keys are an error with a "did you mean"):

| Slot    | Key        | Default | Meaning                                                    |
|---------|------------|---------|------------------------------------------------------------|
| intro   | `duration` | 4.0     | intro clip length                                          |
| intro   | `exit`     | 3.0     | when the recording starts (= `clipStart`); callouts and zooms follow automatically |
| recap   | `base`     | 2.4     | recap length before per-step time                          |
| recap   | `perStep`  | 0.45    | reading time per step                                      |
| recap   | `max`      | 7.5     | recap length cap                                           |
| recap   | `maxSteps` | 10      | capacity (the build warns above it)                        |
| outro   | `duration` | 2.6     | outro length                                               |

## Placeholders

In `stage.html` and every section file:

| Placeholder                                   | Value                                                   |
|-----------------------------------------------|---------------------------------------------------------|
| `{{LANG}}`                                    | `language` from config (`<html lang>`)                  |
| `{{BRAND}}`, `{{BRAND_SUB}}`, `{{EYEBROW}}`   | brand name, tagline, eyebrow (config, overridable per video; HTML-escaped). Hide an empty tagline with `:empty` |
| `{{BRAND_LOGO}}`                              | `assets/brand-logo.<ext>` when `brand.logo` is set, else empty — put it in `data-logo` on a `.wordmark` |
| `{{BRAND_COLOR}}`, `{{BRAND_COLOR_SOFT}}`     | `brand.color`, `brand.colorSoft` (sections use `var(--brand)` instead) |
| `{{TITLE}}`, `{{SUBTITLE}}`, `{{OUTRO_TITLE}}`| video.json title/subtitle, recap title                  |
| `{{TOTAL}}`, `{{FRAME_W}}`, `{{FRAME_H}}`     | composition length, framed recording size in px         |
| `{{STAGE_W}}`, `{{STAGE_H}}`, `{{FORMAT}}`, `{{FOOTAGE_W}}`, `{{FOOTAGE_H}}`, `{{BAND_ZOOM}}` | the layout (see **Layouts**): stage size, `landscape` / `portrait` / `square`, footage size, card zoom |

Only in sections: `{{START}}`, `{{DURATION}}`, `{{TRACK}}` (put all three on the root
`<section id="<slot>" class="clip" data-start data-duration data-track-index>`) and `{{ASSETS}}`
(the section's asset folder). Only in the stage: the slot markers above plus `{{VIDEOS}}`
(`<video>` clip(s), inside `#frame` › `#footage`), `{{TRANSITIONS}}` (hand-off `<section>`s),
`{{AUDIO}}`, `{{MUSIC}}` and `{{DEMO}}` (`const DEMO = {{DEMO}};`).

`DEMO` holds `total`, `clipStart`, `clipDuration`, `mediaStart`, `sections` (`intro`, `recap` or
`null`, `outro`, as above), `callouts` (`{ at, duration, text, group? }`), `zooms`
(`{ at, duration, x, y, scale, in, out }`), `transitions` (`{ at, gap }`), `chip`
(`{ steps, seconds }`, already pluralised) and `cursor` — all times in composition seconds.

A zoom may carry `path: [[t, x, y]]` (video.json `"follow": true`): its transform-origin over
time; tween the origin along it instead of fixing it at `x`/`y`.

`cursor` is `null` when the footage already shows the cursor (or video.json turned it off);
otherwise `{ size, ripple, idle, scale, path: [[t, x, y]], presses: [[t, x, y]] }` (`idle`: fade
out after that many seconds without a move or press, 0 = never) with x/y in
recording CSS px (× `scale` = `#frame` px) and `size` the arrow height in the same units. A stage
that gets a `cursor` must draw it — the recording has none. The classic stage draws it inside
`#frame` (so it rides with the footage), tweens between consecutive points (≤ 0.1 s apart; a
longer gap is a jump), counter-scales it during zooms and plays a ripple + squash per press.

**Layouts.** The build fills the stage up to three times: `index.html` (landscape, 1920x1080),
`portrait.html` (1080x1920, `reelson render --portrait`) and, when there is a square take,
`square.html` (1080x1080, `reelson render --square`: the square take fills the whole stage,
`#frame` is the stage). A stage sizes itself from
`{{STAGE_W}}`/`{{STAGE_H}}`, puts `{{FORMAT}}` (`landscape` | `portrait` | `square`) as a class on
`#root`, wraps `{{VIDEOS}}` and the cursor layer in `#footage` (`{{FOOTAGE_W}}`/`{{FOOTAGE_H}}`
in portrait and square, filling `#frame` in landscape), moves `#footage` with the portrait
camera `DEMO.layout.camera` (`[[t, k, x, y, h]]`, empty otherwise), and moves the recording and hand-off cards by
`DEMO.layout.stage.height` (cards inside the band: divided by `DEMO.layout.bandZoom`). In
portrait a section lays itself out for the tall 1080x1920 stage with `#root.portrait #<slot> …`
rules in its section.css (stack what sits side by side, bigger type) and says so with
`"portrait": true` in section.json — every kit section does. Square works the same way:
`#root.square #<slot> …` rules for the 1080x1080 stage (stacked, fitting the height) and
`"square": true`. A section without its own layout for a format gets class
`band` and the classic stage shows its 16:9 layout zoomed to the width (`zoom: {{BAND_ZOOM}}`):
it works, but its text is small and it leaves bands above and below. A script can check
`DEMO.layout.format` (the poster uses a gentler frame-0 scale when it is not `'landscape'`) and should move things off stage by
`DEMO.layout.stage.height`, not a fixed 1080. `#root.portrait.phone` is a phone take.

Placeholders are filled in one pass, so text from video.json is never read as one. The build
fails if a `{{PLACEHOLDER}}` is left unfilled: a file may omit ones it doesn't need but must
not invent new ones without adding them to `scripts/composition.ts`.

## Making a new section

1. Copy the closest one, e.g. `sections/outro/wordmark/` → `<videosDir>/_sections/outro/<name>/`
   (project) or `sections/outro/<name>/` (kit).
2. Change the markup, CSS (scoped under `#outro`) and script. Keep the slot's rules above.
   Set `description` and `timing` in `section.json`.
3. Try it on the example with each neighbour it may meet: from `examples/`,
   `reelson build todo-add-item --outro <name>` (this edits video.json — revert it after),
   `reelson check todo-add-item`, then `reelson studio todo-add-item`: scrub t=0, the settled
   intro, the hand-over, the recap and the last frame (<kbd>End</kbd>); it rebuilds on every save
   of your section files. `reelson snapshot todo-add-item --at …` gives PNGs of the same moments
   (a time past the last frame is clamped to it). Try `--recap none` too.
4. For a kit section, add it to the golden tests in `test/composition.test.ts` and to the
   `catalog` test.

## Making a new template (stage)

Copy `classic/`, change the background, frame or callouts, and keep every token, shared
class, slot marker and the `stage` API above — that is what lets every section work on it.
Set its default `sections` in `template.json`.
