# reelkit

Turn a prompt into a finished, branded demo video of a web app. Two
[Claude Code](https://claude.com/claude-code) skills plus a `reelkit` CLI:

| Skill                                    | Does                                                                        | Output                                   |
|------------------------------------------|-----------------------------------------------------------------------------|------------------------------------------|
| [`reelkit-record`](skills/reelkit-record/)     | Playwright walkthrough with a visible human-paced cursor, dev chrome hidden, step markers and logged clicks | `<slug>/recording.mp4` + `markers.json` |
| [`reelkit-compose`](skills/reelkit-compose/)       | [HyperFrames](https://hyperframes.heygen.com) composition from a template: cover, framed recording, callouts, cursor-timed zooms, recap, brand card, music | `<slug>/video/renders/<slug>.mp4` |

The same prompt re-creates the video after a UI change: a scenario re-records in ~20 s,
headless, with identical pacing, and callouts/zooms follow their markers and clicks.

```
scenario.ts ──reelkit record──▶ recording.mp4 + markers.json
                                          │
video.json (title, trim, callouts, zooms) ┴──reelkit build──▶ video/ ──reelkit render──▶ .mp4 / .gif
                     demo.config.json (brand, language, music) + template ┘
```

## Requirements

- Node 22.18+ (TypeScript runs directly, no build step) and `ffmpeg` (`brew install ffmpeg`)
- The app you record, running locally
- HyperFrames is fetched by `npx` on first use (version pinned in
  [hyperframes.ts](skills/reelkit-compose/scripts/hyperframes.ts))

## Install

```bash
git clone git@github.com:reelkit/reelkit.git ~/workspace/my-projects/reelkit
~/workspace/my-projects/reelkit/install.sh ~/code/my-app     # or --global for ~/.claude/skills
```

`install.sh` installs Playwright + Chromium, links the `reelkit` command (`npm link`), links
both skills into `my-app/.claude/skills/`, creates `my-app/demo.config.json` and prints the
`.gitignore` lines. The links point at this checkout, so `git pull` here updates every project.

## Configure per project — `demo.config.json`

Everything project-specific lives in one file at the project root. It is validated against
[a JSON Schema](skills/reelkit-record/schemas/demo.config.schema.json) (editors autocomplete it; a
typo is an error with a "did you mean" hint).

```jsonc
{
    "videosDir": "docs/videos",          // where <slug>/ folders live
    "language": "en", "locale": "en-US", // UI language: plurals, personas, <html lang>
    "brand": { "name": "ACME", "tagline": "PLATFORM", "eyebrow": "Acme",
               "color": "#dc2626", "colorSoft": "#f87171" },
    "template": "classic",
    "strings": {
        "recapTitle": "In short",
        "stepsLabel": { "one": "step", "other": "steps" },      // Intl.PluralRules categories
        "secondsLabel": { "one": "second", "other": "seconds" } // e.g. ro: one/few/other
    },
    "music": { "file": "docs/videos/_music/track.mp3", "lufs": -28, "lufsUnderNarration": -34 },
    "record": {
        "viewport": { "width": 1440, "height": 900 },
        "hideSelectors": [".environment-indicator"],   // local-only UI to hide on camera
        "extraHTTPHeaders": { "X-Demo-Recording": "1" },
        "personaDomain": "example.com"
    }
}
```

## Use

Ask Claude in the project, e.g.:

> Make a demo video of searching a customer. Admin area on https://app.test as the admin.
> Steps: open Customers, type a name in the table search, hover the match. Title "Find a
> customer". Zoom on the search box while typing. Slug customers-search.

More prompts in [docs/prompting.md](docs/prompting.md); the rules every video follows in
[docs/style-guide.md](docs/style-guide.md). By hand:

```bash
reelkit new customers-search --url https://app.test    # scenario stub
reelkit record customers-search [--headed]
reelkit build customers-search --title "Find a customer"   # creates video.json on first run
#   edit video.json: callout wording, { "clicks": [2, 3], "scale": 1.8 } zooms, trim
reelkit check customers-search                          # schemas, zoom timing, hyperframes lint
reelkit render customers-search [--gif]                 # or: reelkit render --all
```

Per video, commit `scenario.ts`, `markers.json` and `video.json`; everything else is generated.

## Templates

Intro/outro/recap designs are templates: [skills/reelkit-compose/templates/](skills/reelkit-compose/templates/).
`classic` ships today; a new one is a copy with its own design and `template.json` timings — see
[templates/README.md](skills/reelkit-compose/templates/README.md) for the contract. A project can keep
its own under `<videosDir>/_templates/<name>/`. Templates ship their scripts and fonts (no CDN).

## Develop

```bash
npm run setup          # deps + Chromium
npm run typecheck      # tsc --noEmit
npm test               # unit + golden tests (node:test)
npm run test:update-golden   # after an intended template/composition change — review the diff
npm run example:record && npm run example:build && npm run example:check && npm run example:render
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the type check and tests, then
records the TodoMVC example, builds, checks and renders it, and uploads the MP4 and frames.

## Layout

```
bin/reelkit.ts          the CLI
skills/
  reelkit-record/  SKILL.md, scripts/ (record, scenario, cursor-overlay, config, validate), schemas/
  reelkit-compose/   SKILL.md, scripts/ (build, check, timeline, zooms, composition, project, hyperframes),
                schemas/, templates/<name>/
docs/           style-guide.md, prompting.md
examples/       demo.config.json + todo-add-item/ (scenario, markers, video.json)
test/           unit + golden tests, fixtures
music/          local-only tracks (git-ignored; licences are per project)
```

Third-party code and fonts: [NOTICE.md](NOTICE.md).
