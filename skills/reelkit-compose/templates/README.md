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
// template.json defaults  <  demo.config.json  <  video.json  <  reelkit build --intro/--recap/--outro
"template": "classic",
"sections": { "intro": "minimal", "recap": "none", "outro": "endcard" }
```

`reelkit templates` lists everything a project can use, with descriptions. Sections only
rely on the stage's design tokens, so any section works with any template.

## Layout and lookup

Both live in this skill (`skills/reelkit-compose/templates/` and `skills/reelkit-compose/sections/`):

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

Only in sections: `{{START}}`, `{{DURATION}}`, `{{TRACK}}` (put all three on the root
`<section id="<slot>" class="clip" data-start data-duration data-track-index>`) and `{{ASSETS}}`
(the section's asset folder). Only in the stage: the slot markers above plus `{{VIDEOS}}`
(`<video>` clip(s), inside `#frame`), `{{TRANSITIONS}}` (hand-off `<section>`s),
`{{AUDIO}}`, `{{MUSIC}}` and `{{DEMO}}` (`const DEMO = {{DEMO}};`).

`DEMO` holds `total`, `clipStart`, `clipDuration`, `mediaStart`, `sections` (`intro`, `recap` or
`null`, `outro`, as above), `callouts` (`{ at, duration, text, group? }`), `zooms`
(`{ at, duration, x, y, scale, in, out }`), `transitions` (`{ at, gap }`) and `chip`
(`{ steps, seconds }`, already pluralised) — all times in composition seconds.

Placeholders are filled in one pass, so text from video.json is never read as one. The build
fails if a `{{PLACEHOLDER}}` is left unfilled: a file may omit ones it doesn't need but must
not invent new ones without adding them to `scripts/composition.ts`.

## Making a new section

1. Copy the closest one, e.g. `sections/outro/wordmark/` → `<videosDir>/_sections/outro/<name>/`
   (project) or `sections/outro/<name>/` (kit).
2. Change the markup, CSS (scoped under `#outro`) and script. Keep the slot's rules above.
   Set `description` and `timing` in `section.json`.
3. Try it on the example with each neighbour it may meet: from `examples/`,
   `reelkit build todo-add-item --outro <name>` (this edits video.json — revert it after),
   `reelkit check todo-add-item`, `reelkit snapshot todo-add-item --at …` at t=0, the settled
   intro, the hand-over, the recap and just before the end, and render once to see the real
   last frame (a snapshot exactly at the end can come out empty). Try `--recap none` too.
4. For a kit section, add it to the golden tests in `test/composition.test.ts` and to the
   `catalog` test.

## Making a new template (stage)

Copy `classic/`, change the background, frame or callouts, and keep every token, shared
class, slot marker and the `stage` API above — that is what lets every section work on it.
Set its default `sections` in `template.json`.
