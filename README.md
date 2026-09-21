# reelwright

Two [Claude Code](https://claude.com/claude-code) skills that turn a prompt into a finished,
branded demo video of a web app:

| Skill                                    | Does                                                                        | Output                                   |
|------------------------------------------|-----------------------------------------------------------------------------|------------------------------------------|
| [`demo-record`](skills/demo-record/)     | Playwright walkthrough with a visible human-paced cursor, dev chrome hidden, step markers | `<slug>/recording.mp4` + `markers.json` |
| [`demo-video`](skills/demo-video/)       | [HyperFrames](https://hyperframes.heygen.com) composition from a template: cover, framed recording, callouts, zooms, recap, brand card, music | `<slug>/video/renders/<slug>.mp4` |

The same prompt re-creates the video after a UI change: a scenario re-records in ~20 s,
headless, with identical pacing.

```
prompt ─▶ scenario.ts ─▶ record.ts ─▶ recording.mp4 + markers.json ─▶ scaffold.ts ─▶ video/index.html ─▶ hyperframes render ─▶ .mp4 / .gif
                         (demo-record)                                (demo-video, template + demo.config.json)
```

## Requirements

- Node 22.6+ (the scripts are TypeScript run directly by `node`, no build step)
- `ffmpeg` / `ffprobe` on PATH (`brew install ffmpeg`)
- The app you record, running locally
- HyperFrames is fetched by `npx` on first use (pinned version)

## Install into a project

```bash
git clone git@github.com:icaliman/reelwright.git ~/workspace/my-projects/reelwright
cd ~/workspace/my-projects/reelwright && npm run setup     # Playwright + Chromium, once

./install.sh ~/code/my-app             # symlinks both skills into my-app/.claude/skills/
./install.sh ~/code/my-app --copy      # or copy them (for teammates without the kit)
./install.sh --global                  # or ~/.claude/skills/ for every project
```

The installer creates `my-app/demo.config.json` from [demo.config.example.json](demo.config.example.json)
and prints the `.gitignore` lines for generated files. Symlinks keep every project on the
latest kit; `git pull` in the kit updates them all.

## Configure per project — `demo.config.json`

Everything project-specific lives in one file at the project root; nothing in the skills is
tied to a product.

```jsonc
{
    "videosDir": "docs/videos",          // where <slug>/ folders live
    "language": "en", "locale": "en-US", // UI language: callouts, personas, <html lang>
    "brand": { "name": "ACME", "tagline": "PLATFORM", "eyebrow": "Acme",
               "color": "#dc2626", "colorSoft": "#f87171" },
    "template": "classic",               // skills/demo-video/templates/<name> or <videosDir>/_templates/<name>
    "strings": { "recapTitle": "In short", "stepsLabel": "steps", "secondsLabel": "seconds" },
    "music": { "file": "docs/videos/_music/track.mp3", "lufs": -28, "lufsUnderNarration": -34 },
    "record": {
        "viewport": { "width": 1440, "height": 900 },
        "hideSelectors": [".environment-indicator"],   // local-only UI to hide on camera
        "extraHTTPHeaders": { "X-Demo-Recording": "1" },
        "personaDomain": "example.com"
    }
}
```

Personas ship for English and Romanian (`language: "ro"`); add more in
[scenario.ts](skills/demo-record/scripts/scenario.ts).

## Use

Ask Claude in the project, e.g.:

> Make a demo video of searching a customer. Admin area on https://app.test as the admin.
> Steps: open Customers, type a name in the table search, hover the match. Title "Find a
> customer". Zoom on the search box while typing. Slug customers-search.

More prompts in [docs/prompting.md](docs/prompting.md); the rules every video follows in
[docs/style-guide.md](docs/style-guide.md).

By hand:

```bash
node .claude/skills/demo-record/scripts/record.ts docs/videos/<slug>/scenario.ts [--headed]
node .claude/skills/demo-video/scripts/scaffold.ts docs/videos/<slug> --title "..." --trim-start 4.8
node .claude/skills/demo-video/scripts/check-zooms.ts docs/videos/<slug>
cd docs/videos/<slug>/video && npx --yes hyperframes@0.8.46 check . && npm run render -- -o renders/<slug>.mp4
```

## Templates

Intro/outro/recap designs are templates: [skills/demo-video/templates/](skills/demo-video/templates/).
`classic` ships today; add a new one by copying it and adjusting `template.json` timings —
see [templates/README.md](skills/demo-video/templates/README.md) for the placeholder contract.
A project can also keep its own under `<videosDir>/_templates/<name>/`.

## Try it

The kit records a public TodoMVC app, so it can be smoke-tested anywhere:

```bash
npm run example:record
npm run example:scaffold -- --trim-start 2.6
npm run example:check
cd examples/todo-add-item/video && npx --yes hyperframes@0.8.46 render . --video-frame-format jpg -q delivery -o renders/todo-add-item.mp4
```

## Layout

```
skills/
  demo-record/  SKILL.md, scripts/{record,scenario,cursor-overlay,config}.ts
  demo-video/   SKILL.md, scripts/{scaffold,check-zooms}.ts, templates/<name>/
docs/           style-guide.md, prompting.md
examples/       demo.config.json + todo-add-item/ (scenario, markers, composition)
music/          local-only tracks (git-ignored; licences are per project)
install.sh, demo.config.example.json
```
