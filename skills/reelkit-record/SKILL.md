---
name: reelkit-record
description: Use when the user wants a screen recording / walkthrough video of a feature of their web app — "record a demo of X", "make a video showing how to Y", "screen capture the Z flow", "docs video". Drives the app with Playwright via `reelkit record`, draws a visible human-paced cursor, hides dev chrome, and writes recording.mp4 + markers.json into <videosDir>/<slug>/. Pair with the reelkit-compose skill (HyperFrames) for the intro/outro/callouts and the final MP4. Also covers the manual OpenScreen path.
---

# reelkit-record

Produces the raw footage for a demo video: a scripted, repeatable browser walkthrough of
the app, captured as video, with timestamps for every step you want to call out later.

**Read `docs/style-guide.md` in the kit first** (next to this skill's real path: `../../docs/`
— resolve the symlink with `realpath` if the skill is linked into a project). Its rules are
the house style every video follows; the scripts implement them, so don't work around them
with raw Playwright calls.

```
<videosDir>/<slug>/
├── scenario.ts      ← you write this (committed)
├── recording.mp4    ← generated: H.264, 2x viewport, no audio (git-ignored)
├── recording.webm   ← generated: raw Playwright capture (ignored)
└── markers.json     ← generated: duration, viewport, markers, clicks, cuts (committed)
```

`recording.mp4` + `markers.json` are the input contract of the `reelkit-compose` skill. Everything
runs through the `reelkit` CLI (`reelkit help`); if it is missing, run the kit's `install.sh`.

## Project config

Everything project-specific lives in `demo.config.json` at the project root (found by
walking up from the scenario). Read it before writing a scenario — it tells you the videos
directory, the UI language (callouts and personas follow it), the brand, and what to hide.
If it is missing, run `reelkit init` and ask the user for the brand name/colour and UI
language. It is validated against `schemas/demo.config.schema.json` — a mistyped key is an
error with a "did you mean" hint. Fields (all optional, see `scripts/config.ts`):

| Field                          | Used for                                                          |
|--------------------------------|-------------------------------------------------------------------|
| `videosDir`                    | where `<slug>/` folders live (default `docs/videos`)              |
| `language`, `locale`           | persona names, browser locale, `<html lang>` of the composition   |
| `brand.color`                  | click-ring colour (and the cards in reelkit-compose)                   |
| `record.viewport`              | default 1440x900; keep 16:10 or 16:9                              |
| `record.hideSelectors`         | extra local-only UI to hide (env badges, dev-login buttons)       |
| `record.extraHTTPHeaders`      | default `X-Demo-Recording: 1`, so the app can skip dev prefills   |
| `record.personaDomain`         | email domain for `demo.persona()` (must resolve if a gateway checks) |

Common dev overlays (Laravel Debugbar, Vite/Next.js/webpack error overlays) are always hidden.

## What the recorder adds on top of plain Playwright video

- **Visible cursor**: a large black macOS-style arrow with a press squash and a brand-coloured
  double ring on click (Playwright's synthetic mouse is otherwise invisible).
- **Human pacing**: curved, eased glides with a faint tremor, landing slightly off-centre;
  typing with uneven delays and beats after spaces/punctuation. Seeded per scenario, so
  re-records are identical. Never slow.
- **Cursor starts mid-screen**: parked at a random point in the middle third before the first
  action and before every `demo.goto()`, so the video never opens with a jump from a corner.
  Raw `page.click()`/`fill()` (e.g. a login helper) move the mouse without telling `demo`; the
  next `demo.goto()` re-syncs, so keep such raw steps before a goto.
- **Markers**: `demo.marker('label')` stamps the video time; `reelkit-compose` turns each into a
  pre-timed callout and a row in the recap.
- **Cuts**: `demo.cut(fn)` removes slow waits (3-D Secure, spinners, queued jobs) from the
  video and shifts the markers.
- **Personas**: `demo.persona()` gives a believable customer in the UI's language (name,
  unique email, phone, company) — never `test@` or `e2e-123` strings on camera.
- **2x capture + MP4 transcode** (ffmpeg, CRF 15, yuv420p, 30 fps, keyframe every second).

## Prerequisites

- The app running and reachable at the scenario's `baseURL`.
- reelkit installed once per machine (`install.sh` in the kit: Playwright + Chromium, the
  `reelkit` command, the skill links).
- `ffmpeg` on PATH (`brew install ffmpeg`). Node 22.18+ (TypeScript runs directly).

## Workflow

1. **Pick the origin, panel and account.** Look for existing e2e helpers in the project
   (login, table/modal locators) and reuse them from the scenario — a scenario is mostly an
   e2e test with a cursor. Check the project's CLAUDE.md / e2e docs for seeded accounts.

2. **Write `<videosDir>/<slug>/scenario.ts`.** `reelkit new <slug> --url <origin>` creates a
   stub with the right type import; the kit's `examples/todo-add-item/scenario.ts` is a full
   example. Rules:
   - `demo.marker('...')` right **after** the UI reaches each state worth a callout. Labels
     become the callouts in video.json (and its `marker` keys) — write them in the UI language
     as imperative steps, and keep them stable: video.json refers to them by label.
     **At most 10 markers** (the recap holds ten); fold small steps together.
   - **Don't pause for zooms.** Zooms ride along with the cursor's glide; `demo.click` /
     `demo.type` log every glide and click into `markers.json` (`clicks`), and a zoom in
     video.json is anchored to click numbers and timed from them.
   - Hold ~2–3 s after the last marker so its callout can be read.
   - Nothing pre-filled on camera: if the app pre-fills forms or ticks consents locally,
     gate that on the `X-Demo-Recording` header in the app rather than working around it.
     Tick checkboxes with `demo.click` on camera.
   - Keep it 10–40 s of footage, one feature per video. Login is recorded and trimmed away
     later (video.json `trim.start`, suggested automatically).
   - Use `demo.click` / `demo.type` / `demo.moveTo` / `demo.scroll`, not raw `page.click` or
     `fill()` (those teleport the cursor and paste text). Raw `demo.page` is for waits, reads
     and `selectOption` (glide there with `demo.moveTo` first).
   - Data hygiene: read real values from the page instead of hard-coding seeded names; type
     `demo.persona()` data into forms.
   - Cookie banners mount after load: `waitFor({ timeout: 3000 })` then `demo.click` it.
   - Wrap slow waits in `demo.cut(() => page.waitForURL(...), { keepMs: 900 })`.
   - External pages (payment gateways, OAuth) are fair game; use their test modes and cut
     the waits.

3. **Record.**

   ```bash
   reelkit record <slug>
   reelkit record <slug> --headed     # watch it
   ```

   Prints the duration and marker count. On a scenario error the partial capture is kept as
   `recording.failed.webm`. Flows that create records do so for real — point scenarios at a
   local environment, never staging/prod.

4. **Verify before handing off.** Pull frames at the marker times and look at them:

   ```bash
   ffmpeg -y -loglevel error -ss <marker at> -i <videosDir>/<slug>/recording.mp4 -frames:v 1 /tmp/m1.png
   ```

   Check: the intended state is on screen, no dev toolbars/env badges/dev-login buttons,
   nothing personal (real emails, tokens), cursor where the callout will point. New dev UI
   on screen → add its selector to `record.hideSelectors`.

5. **Compose** with the `reelkit-compose` skill (`reelkit build <slug> --title "..."`).

## Scenario API (`scripts/scenario.ts`)

```ts
export default {
    name: 'slug',
    baseURL: 'https://app.test',
    viewport: { width: 1440, height: 900 },   // default from config; keep 16:10 or 16:9
    leadInMs: 800, leadOutMs: 1200,           // silence at both ends
    async run(demo) {
        demo.page          // Playwright Page for anything else
        demo.marker(label) // stamp current video time
        demo.persona()     // { firstName, lastName, fullName, email, phone, company }
        demo.cut(fn, { keepMs })   // run fn; drop that stretch from the video
        demo.transition(fn, { title, subtitle, from, to })  // actor hand-off, see below
        demo.pause(ms)
        demo.goto(path)    // waits for networkidle + settle
        demo.moveTo(loc)   // glide cursor to the element (scrolls into view)
        demo.click(loc, { settleMs })
        demo.type(loc, text)
        demo.scroll(deltaY, { stepPx })
    },
} satisfies Scenario
```

**Two actors (e.g. manager → employee)**: wrap the account switch in `demo.transition()`.
Everything inside `fn` (clear cookies, log in as the other account, `demo.goto` their first
page) is cut, and `markers.json` gets a `transitions` entry; reelkit-compose splits the footage
there and shows a hand-off card (`from` → `to`, title, subtitle). Leave ~3 s after the last
marker before it. Uploading a file on camera: generate it (e.g. a PDF via
`browser.newPage().pdf()`) and answer the `filechooser` event.

## Alternative: OpenScreen (manual recordings)

[OpenScreen](https://github.com/getopenscreen/openscreen) is a free desktop recorder with
auto-zoom, cursor smoothing and on-device captions. Use it when a human narrates, or the flow
can't be scripted (native dialogs, hardware keys).

```bash
OS=/Applications/Openscreen.app/Contents/MacOS/Openscreen
$OS sources --json
$OS record --window "Chrome" --duration 30 --project <videosDir>/<slug>/demo.openscreen --json
$OS export <videosDir>/<slug>/demo.openscreen -o <videosDir>/<slug>/recording.mp4 --auto-zoom --json
```

Then `reelkit build <slug>` as usual — without `markers.json` it probes the file; give the
callouts an `at` (recording seconds) in video.json. Zooms need manual `at`/`x`/`y` (no clicks
are logged). **Don't combine OpenScreen with the Playwright recorder**: its
effects follow the OS cursor, which Playwright never moves.
