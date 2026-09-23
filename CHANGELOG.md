# Changelog

All notable changes to reelson. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/) (before 1.0, a minor version may change
`video.json` or `demo.config.json`; the notes say how to update).

## Unreleased

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
