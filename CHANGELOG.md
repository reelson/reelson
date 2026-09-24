# Changelog

All notable changes to reelson. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/) (before 1.0, a minor version may change
`video.json` or `demo.config.json`; the notes say how to update).

## 0.9.0 — 2026-09-24

Nothing to update. Re-render a video with a rotating title to fix its captions.

### Added
- **`reelson render --low-memory`**: HyperFrames' low-memory mode (one browser, frames streamed to
  the encoder instead of kept on disk) for a machine short on RAM or temporary disk space; slower,
  the same video. It is not part of the render key, so the next render without it still says up
  to date. A failed render suggests it.
- **`reelson render --4k`**: 3840x2160 (portrait 2160x3840, square 2160x2160), Chrome rendering the
  same composition at twice the scale from the 2x capture.
- **`reelson render <slug> -- <flags>`** passes the flags after `--` to `hyperframes render`
  (`-- --crf 18`, `-- --workers 2`); a different set renders again.
- **`video.json` `captionTitle`**: the title as text, for a rotating title whose first option reads
  badly. Templates get the title parsed as `DEMO.title` (`{ plain, parts }`) and `{{TITLE_PLAIN}}`.
- `reelson <command> --help` (and `reelson help <command>`) prints that command's usage.
- Troubleshooting: what to do when a render runs out of disk space or memory.

### Fixed
- **A rotating title in the captions**: a title like `"Automate {anything|workflows} in Filament"`
  (animated by a project template) went into the .srt/.vtt captions, and so to YouTube and screen
  readers, as raw markup. Captions and the upload's default title now read each phrase as its
  first option, or as `captionTitle`. The built-in intro and outro sections show that text too.
- `reelson render --help` (any `<command> --help`) crashed with ERR_PARSE_ARGS_UNKNOWN_OPTION; a
  mistyped option now prints one line (`reelson render: unknown option --foo, see reelson render
  --help`) instead of a stack trace.

### Changed
- A docs website, [reelson.github.io/reelson](https://reelson.github.io/reelson), and a logo
  (reels·on) for it and the README.

## 0.8.0 — 2026-09-24

### Changed
- **The `classic` background is an aurora now**: three wide, blurred ribbons in the brand colours
  sweep, tilt and breathe over a deeper navy, and a slow spotlight wanders over the dot grid (it
  was four drifting glows). Nothing to update; re-render to get it.
- **`demo.config.json` is now `reelson.config.json`** (and its schema
  `reelson.config.schema.json`; the example `reelson.config.example.json`). A project that still
  has `demo.config.json` keeps working, with a notice to rename it. To update: rename the file,
  and in its `$schema` change `demo.config.schema.json` to `reelson.config.schema.json`.
- README: the pipeline diagram is an SVG (`.github/readme/pipeline.svg`), and a link to the
  1-minute launch video, recorded and edited with reelson itself.

### Added
- **`video.json` `cursor.lag`** (seconds, default 0) draws the cursor that much later, for a page
  that paints late: on a heavy page a dragged card otherwise trails the cursor. The Orbit
  example uses 0.08.
- **Orbit example** (`examples/orbit/` + `examples/orbit-ship-it/`): a pretend project board in one
  static page — add a task, assign it, drag it to Done (the phone take taps it instead). It opens
  from disk (`baseURL` is a `file://` URL next to the scenario), so it needs no server. It brings its own
  template, `examples/_templates/orbit/` (a project template forked from classic: deep space violet,
  a neon aurora, orbital rings with travelling moons, twinkling stars). CI now
  records, renders and cuts the README clip from it; the TodoMVC example stays as a second example.
- **`reelson publish <slug...>`** uploads the rendered video to the channels listed under a new
  `"channels"` key in reelson.config.json. A project lists any number of channels, each
  with a `type` and its settings; `--to a,b` (or `--to a --to b`) or `--all-channels` picks
  them (or it asks).
  `--dry-run` shows the title, description, tags and file; `published.json` in the demo folder
  records each upload, and a channel that has the video is skipped unless `--again` (a second
  copy) or `--replace` (after a re-recording: the new render goes up, the old video is made
  private — never deleted — and kept under `replaced`; the new id is printed for your own link).
- **`reelson publish <slug> --update`** changes a video that is up without uploading it again:
  the URL, views and comments stay. The title, description and tags come from today's video.json
  and channel settings, the captions from the render's `.srt` (reelson's track is replaced; left
  alone when the render changed after the upload), and it joins the channel's playlist if it is
  not in it. Privacy stays as set in YouTube Studio. `published.json` now keeps each upload's
  `sha1` and when it was `updated`.
- **YouTube** (`"type": "youtube"`), the first service: resumable upload, privacy, category,
  playlist, captions from the render's `.srt` and the playlist (both tried again while YouTube is
  still taking in the new video), a `channelId` guard, per-channel `format`
  (landscape / portrait / square), `tags` and description `footer`. Sign-in with your own Google
  OAuth client (`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` in `.env`).
- **`reelson channels`** lists the channels and who each is logged in as; `channels init` adds
  starter channels to the config, `channels login|logout <name>`. Sign-ins live in
  `~/.config/reelson/credentials/`, never in the project.
- video.json **`publish`**: `title`, `description`, `tags` for the upload.
- video.json **`calloutPosition`** (`auto` / `top` / `bottom`) and a callout's **`position`**: pin
  the callouts to the bottom (or top) of the footage instead of letting them move up while the
  cursor works under them.
- Services are pluggable: a `Publisher` per `type` (publish.ts), with a shared browser OAuth
  sign-in (oauth.ts).
- A **Sponsor** button (GitHub Sponsors) and `funding` in package.json, so `npm fund` lists reelson.

### Fixed
- `reelson render` refreshes the timestamp of a render it finds up to date, so `publish` no longer
  refuses it as older than a video.json edit that does not change the video (a `publish` block).

## 0.7.2 — 2026-09-23

The first release published by CI (staged, then approved on npm).

### Changed
- The README clip is re-rendered by CI on every push to main and served from the rolling `demo`
  pre-release, so the npm package no longer ships it (2.6 MB → about 0.3 MB).
- Hardened publishing: actions pinned to commit SHAs (Dependabot keeps them current, npm updates
  after a 7-day cooldown), npm pinned, no install scripts or cache in the publish job, no token left
  in the checkout, and the publish runs in the `npm` environment (approval before each release).
  CI only **stages** a release (`npm stage publish`); it goes live once approved on npm with 2FA.
- README: a pipeline diagram that renders the same in every font, commands with their notes above them.

## 0.7.1 — 2026-09-23

### Changed
- **Works with any agent that reads Agent Skills**, not only Claude Code: `reelson install` links the
  skills into `.agents/skills/` (Codex and others) and links `.claude/skills/` to them (nothing to do
  when the whole `.claude/skills` folder already links to `.agents/skills`); `--global` does the same
  in the home folder. New `demo.config.json` `$schema` paths and scenario imports go through
  `.agents/skills`; existing `.claude/skills` paths keep working. The `.gitignore` hint adds the links.
- **`reelson install` asks where** when neither `--global` nor a folder is given: every project
  (the default: `~/.agents/skills` + `~/.claude/skills`), this project, or another folder. `-y` takes
  the default; without a terminal it never asks. (0.7.0 installed into the current folder.)
- Agent-neutral wording in the README, the skills and the prompting guide.

## 0.7.0 — 2026-09-23

The first release on npm.

### Changed
- **Renamed reelkit → reelson**: the `reelson` command, the `reelson-record` / `reelson-compose`
  skills, the Piper cache in `~/.cache/reelson`. Re-run `reelson install` (or `install.sh`) for each
  project: it drops the old `reelkit` command and `reelkit-*` skill links. Then point scenario
  imports and `$schema` paths at `.claude/skills/reelson-*`.

### Added
- **npm package** (MIT): `npm install -g reelson`. It ships JavaScript compiled beside the
  TypeScript sources; a checkout still runs the sources directly.
- **`reelson install [<dir> | --global] [--no-browser]`**: links the skills into a project (or
  `~/.claude/skills`), creates `demo.config.json` and downloads Playwright's Chromium.
  `install.sh` now `npm link`s a checkout and calls it.
- **Voice-over providers**: `voice.provider` picks `openai` (or an OpenAI-compatible server via
  `baseURL`), `elevenlabs`, `piper` (a local neural voice, downloaded on first use) or `command` (any
  local program); speed, options and per-video provider/model/voice overrides. Lines are trimmed of
  the silence around them. `reelson voices` lists the voices (`--library`: the ElevenLabs Voice Library);
  `reelson doctor` says whether the provider can speak here.
- A spoken callout stays up until its line is said, and the next step waits for it (`build` and `check`
  warn when a line cannot fit). API keys are read from a `.env` beside `demo.config.json` or in the
  reelson install; the environment wins.

### Fixed
- `render --gif` works again: the GIF (720 px, 12 fps) is now cut from the rendered MP4 with ffmpeg
  instead of HyperFrames' GIF encoder, which failed with ffmpeg 7.0 and rendered every frame a second
  time. It is skipped while the MP4 is unchanged.
- `moveTo` scrolls an out-of-sight target into view smoothly instead of jumping.
- The voice track is resampled to 48 kHz and padded so it never falls short of its slot.

## 0.6.0 — 2026-09-22

### Added
- **Portrait** (1080×1920): a phone take (`record --mobile`, a Playwright device) in a phone frame,
  or a camera that frames each element of the desktop take; `video.json` `"portrait": auto|mobile|desktop`.
  Every kit section has its own portrait layout.
- **Square** (1080×1080): a square take (`record --square`) filling the frame, with square layouts for
  every section.
- `record --all-takes`, `verify` covers every take, `render --all-formats` and `--only <format>`.
- **Voice-over**: `"voice": true` speaks each callout (its `say`, else its text) with OpenAI
  text-to-speech, cached in `<demo>/voice/`; the build mixes the track and ducks the music.
- Pop-ups and new tabs: `demo.popup()` / `switchTo()` move the demo and the camera there and back.

### Changed
- Callouts start with their step (not after its marker), get a minimum reading time, and move to the
  top over action at the bottom of the screen.
- `reelson check` lints each composition on its own.

## 0.5.0 — 2026-09-22

### Added
- **Screencast capture**: Chrome's screencast films every painted frame on the cursor's clock →
  a smooth 30 fps recording (`record.capture "playwright"` keeps the old 25 fps video).
- Zooms can follow the cursor (`"follow"`); the cursor fades when idle (`"cursor": { "idle": s }`).
- Trims follow the footage (`"auto"`, marker and click anchors); `check` warns about fixed times.
- `render --draft` (15 fps, ~2× faster); renders are skipped when nothing changed (`--force`).
- `.srt` / `.vtt` captions; `--square` / `--portrait` social versions.
- `reelson doctor`: the tools, plus a measured cursor-to-footage sync on this machine.
- `reelson verify`: re-records every demo into a scratch folder and checks `video.json` still fits.
- Built-in recap strings and plural forms for 18 languages; more dev toolbars hidden by default.

## 0.4.0 — 2026-09-22

### Added
- **Cursor as a layer**: logged by the page, drawn by the video, so it stays smooth and the same
  size under zooms, and can be restyled without re-recording. Clicks land where the glide ends.
- **Studio** (`reelson studio`): a preview with a layer timeline; edit callouts, trims, zooms, sections
  and titles (saved to `video.json`, with undo).

### Fixed
- Dev-chrome hiding works again (the injected script had a syntax error since 0.2).
- Scenarios use the project's Playwright, so they can import its helpers.

## 0.3.0 — 2026-09-22

### Added
- Templates are a stage plus mix-and-match sections per slot: intro (`poster`, `minimal`, `split`),
  recap (`steps`, `compact`, `none`), outro (`wordmark`, `compact`, `endcard`), chosen in
  `demo.config.json`, `video.json` or with `--intro` / `--recap` / `--outro`.
- `brand.logo` replaces the text wordmark; `reelson templates` lists what is available.

## 0.2.0 — 2026-09-21

### Added
- `video.json` as the source of truth for a video (zooms anchored by click number, auto-timed).
- The CLI: `init`, `new`, `record`, `build`, `check`, `snapshot`, `preview`, `render`.
- Validation against JSON Schemas with "did you mean" hints, unit and golden tests, CI.

## 0.1.0 — 2026-09-21

- The first kit: a recording skill and a composing skill, the classic template, branding from config.
