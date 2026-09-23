# Style guide

The house style for every video made with the kit. The scripts, the `classic` template and
every kit section already implement it; this page exists so a fresh session knows *why* and doesn't undo it.
A project can tighten these rules in its own docs (e.g. its payment test cards or seeded
accounts), but should not loosen them without a reason.

## Standing instructions

1. **Structure**: intro → framed recording with numbered callouts and zooms → recap (optional)
   → outro. Intro, recap and outro are sections picked per project or per video; the classic
   set is the poster cover, a recap with the title left and ONE column of numbered steps right,
   and a wordmark card (letters growing in from farther out, line wiping from the left). The
   video **ends on the brand**, never on an empty frame: the last frame is what players show
   when playback stops. `wordmark` and `compact` settle at 15 % opacity; `endcard` stays fully
   readable. No URLs on any card.
2. **Intro = poster**: **frame 0 shows the brand and the title legibly** — chat apps, GitHub
   and Finder use it as the thumbnail — never hidden or blurred. The classic `poster`: wordmark,
   accent line, tagline, then title, subtitle and the "N steps · S seconds" chip, centred; at
   t=0 everything is big (130 %) and 60 % transparent. It "breathes" down into place (sine.inOut,
   letters one after another from the centre), holds ~1.8 s, and at 3.0 s lifts out through
   the top while the recording rides in from below on the same upward motion. Other intros
   keep the poster rule and hand over with `stage.enter()`.
3. **Background**: deep navy gradient with four soft glows (brand colour, blue, violet, teal)
   drifting and breathing on 4–6.5 s loops — slow but perceptible — plus a faint dot grid.
4. **Cursor**: large black macOS-style arrow with a white outline, press squash, and a
   brand-coloured double ring on click. It never jumps on click, and it keeps its size
   during zooms (the video draws it as a layer from the recorder's log).
5. **Motion**: gently curved, eased mouse paths with a little tremor, landing slightly
   off-centre; typing with uneven per-key delays. Human, never slow. The recording opens with
   the cursor resting in the middle third of the screen, never jumping in from a corner.
6. **People**: realistic names and emails in the UI's language from `demo.persona()`. Never
   `test@`, `e2e-123` or seeded-looking data typed on camera.
7. **Payments / external services**: use the provider's test mode and test data, the page in
   the UI's language, and remove waits (3-D Secure, redirects) with `demo.cut()`.
8. **Audio**: one music bed per project (`music.file`) under every video at −28 LUFS with
   fades; −34 LUFS under narration. Don't pick a different track per video.
9. **Quality**: capture at 2x (2880x1800 for 1440x900, CRF 15) so text stays sharp in the
   1080p frame and under zooms; render with `--video-frame-format jpg -q delivery`; keep
   `media.autoProxy: false` and no `will-change` on `#frame`.
10. **Language**: the product UI's language. Callouts are imperative steps (≤ 6 words)
    because they also become the recap. **At most 10 steps** per video.
11. **Nothing pre-filled on camera**: the recorder sends `X-Demo-Recording: 1`; the app should
    skip local-only prefills when it sees it. Checkboxes and consents are ticked on camera.
12. **Verify with frames**, not logs: frame 0 (poster), settled intro, the hand-over to the
    recording, a callout, a zoom, the recap, the last frame of a real render.
13. **Zooms ride along with the cursor and finish before the click**: zoom in while the cursor
    glides to the first click it frames (starting ≤ 0.35 s before the glide), fully in 0.1 s
    before that click; zoom out while it glides to the next target, done before that click.
    A zoom holds its own clicks (plus a click in view right after them, < 1 s), not everything
    still on screen; when the next glide is > 3 s away it lingers 1.2 s and leaves. No easing during a click. No extra pauses in the scenario to make room
    for zooms — shorten the ease (≥ 0.4 s) instead. A zoom anchored with `clicks` in video.json
    is timed this way automatically; `reelson check` enforces it for every zoom.

## What makes a video good

**Plan the steps before the pixels.** One feature, 3–6 visible state changes, each a sentence a
reader could follow without the video. If you can't write the callouts, the video isn't ready.

**Recording**

- `demo.marker()` right after the UI reaches the state, not before the click. The marker ends
  its step: the callout starts as the step begins (the first glide or click after the previous
  marker), stays through it and a moment on its result, so the viewer reads "Type the name"
  while the name is typed.
- Pause 1–1.5 s after anything the viewer must read (a modal, a notification, results). The
  default settle after a click (0.7 s) is enough for menus only.
- `demo.click` / `demo.type` / `demo.moveTo`, never raw `page.click` / `fill()`.
- Small `demo.scroll()` steps over big jumps; or navigate straight to the section.
- Read values from the page instead of hard-coding seeded data.
- Wrap slow waits in `demo.cut()`; a short glimpse is kept so the cut doesn't feel like a glitch.
- Trim the login off (video.json `"trim": { "start": "auto" }`, the default) unless the video
  is about logging in. Tie trims to markers or clicks, never to plain seconds: a re-record
  moves the footage.
- Keep the 1440x900 viewport; wider makes text tiny inside the 1920x1080 frame.

**Composition**

- Callouts: imperative, in the UI's language, ≤ 6 words ("Click Save", not "Now the user
  clicks the save button"). One on screen at a time, ≥ 2 s each.
- Zoom only where the UI is small (a field, a toggle, a badge), scale 1.5–2.0, timed by the
  cursor (rule 13).
- Title = the task ("Find a customer"), subtitle = the benefit or context. Keep the intro at
  its section's default (3 s for `poster`); longer intros get skipped.
- Recap rows must read as steps on their own ("Choose Card"), not commentary ("Here is the form").
- Length: 15–30 s is the sweet spot. Over 45 s, split into two videos.

**Verify the artifact, not the log**

1. `reelson check <slug>` says "ready to render" (schemas, zoom timing, `hyperframes check`).
2. Extract and look at frames: t=0, settled intro, each callout, the zoom, the recap, the end.
3. `ffprobe` duration matches the timeline the build printed.
4. Watch it once at 1x. If a step is unreadable, pause longer in the scenario, not in the
   composition.

## Iterating

| Want to change            | Do                                                                          |
|---------------------------|-----------------------------------------------------------------------------|
| Callout text, zoom, trims | Edit `video.json`, `reelson render <slug>` (it rebuilds).                   |
| Pacing, missing step      | Edit `scenario.ts`, `reelson record`, add the new marker to video.json, render. |
| UI changed                | `reelson record` then `reelson render`: callouts follow their markers, zooms their click numbers (re-check if the clicks changed). |
| Look of intro/recap/outro | Pick another section (`reelson templates`), or make one (`templates/README.md`) — never per-video edits. |

## Troubleshooting

- **Scenario timed out on a locator**: open `recording.failed.mp4`, re-run with `--headed`.
- **`video_nested_in_timed_element` lint error**: a timed `<video>` inside a timed wrapper.
- **A callout flashes at t=0 or a zoom starts zoomed in**: an "out" tween without
  `immediateRender: false`.
- **Blurry UI text (worst in zooms)**: capture must be 2x (`ffprobe recording.mp4` →
  2880x1800), `hyperframes.json` `autoProxy: false`, no `will-change` on `#frame`.
- **Callout clipped during a zoom**: it ended up inside `#frame`; callouts live in `#callouts`.
- **`Cannot find module '@playwright/test'`** or **`reelson: command not found`**: run
  `npm install -g reelson && reelson install` (or the kit checkout's `install.sh`).
- **`… is invalid: … unknown key — did you mean …`**: a typo in demo.config.json or video.json;
  the message names the path. Editors autocomplete both through their `$schema`.
