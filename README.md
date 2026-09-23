# reelson

Turn a prompt into a finished, branded demo video of a web app. Two
[Claude Code](https://claude.com/claude-code) skills plus a `reelson` CLI:

| Skill                                    | Does                                                                        | Output                                   |
|------------------------------------------|-----------------------------------------------------------------------------|------------------------------------------|
| [`reelson-record`](skills/reelson-record/)     | Playwright walkthrough with a visible human-paced cursor, dev chrome hidden, step markers and logged clicks | `<slug>/recording.mp4` + `markers.json` |
| [`reelson-compose`](skills/reelson-compose/)       | [HyperFrames](https://hyperframes.heygen.com) composition from a template + mix-and-match intro/recap/outro sections: poster intro, framed recording, callouts, cursor-timed zooms, recap, brand outro, music | `<slug>/video/renders/<slug>.mp4` |

The same prompt re-creates the video after a UI change: a scenario re-records in ~20 s,
headless, with identical pacing, and callouts/zooms follow their markers and clicks.

![The TodoMVC example: poster intro, the recorded walkthrough with callouts and zooms, recap and outro](https://cdn.jsdelivr.net/npm/reelson/docs/demo.webp)

<sub>The [example](examples/todo-add-item/scenario.ts), rendered by CI on every push
(`docs/demo.webp` is a 960 px cut of it).</sub>

```
scenario.ts ──reelson record──▶ recording.mp4 + markers.json
                                          │
video.json (title, trim, callouts, zooms) ┴──reelson build──▶ video/ ──reelson render──▶ .mp4 / .gif
          demo.config.json (brand, logo, language, music) + template + sections ┘
```

## Requirements

- Node 22.18+ and `ffmpeg` (`brew install ffmpeg`)
- The app you record, running locally
- HyperFrames is fetched by `npx` on first use (version pinned in
  [hyperframes.ts](skills/reelson-compose/scripts/hyperframes.ts))

## Install

```bash
npm install -g reelson
reelson install ~/code/my-app     # or: reelson install --global  (~/.claude/skills, every project)
```

`reelson install` downloads Playwright's Chromium, links both skills into
`my-app/.claude/skills/`, creates `my-app/demo.config.json` and prints the `.gitignore` lines.
The links point at the installed package, so `npm update -g reelson` updates every project.

To work on reelson itself, install from a checkout instead: the `reelson` command then runs the
TypeScript sources directly and `git pull` updates every project.

```bash
git clone git@github.com:reelson/reelson.git ~/reelson
~/reelson/install.sh ~/code/my-app     # npm link + reelson install
```

reelson was called reelkit before 0.7. Re-run `reelson install` (or `install.sh`) for each project: it drops the old
`reelkit` command and `reelkit-*` skill links. Then point scenario imports and `$schema` paths
at `.claude/skills/reelson-*`.

## Configure per project — `demo.config.json`

Everything project-specific lives in one file at the project root. It is validated against
[a JSON Schema](skills/reelson-record/schemas/demo.config.schema.json) (editors autocomplete it; a
typo is an error with a "did you mean" hint).

```jsonc
{
    "videosDir": "docs/videos",          // where <slug>/ folders live
    "language": "en", "locale": "en-US", // UI language: plurals, personas, <html lang>
    "brand": { "name": "ACME", "tagline": "PLATFORM", "eyebrow": "Acme",
               "color": "#dc2626", "colorSoft": "#f87171",
               "logo": "docs/brand/logo.svg" },      // optional: replaces the text wordmark
    "template": "classic",
    "sections": { "intro": "poster", "recap": "steps", "outro": "wordmark" },  // the defaults
    "strings": {                                       // optional: built in for en, ro, de, fr, es, it,
        "recapTitle": "In short",                      // pt, nl, pl, ru, uk, cs, sv, da, nb, fi, hu, tr
        "stepsLabel": { "one": "step", "other": "steps" },      // Intl.PluralRules categories
        "secondsLabel": { "one": "second", "other": "seconds" } // e.g. ro: one/few/other
    },
    "music": { "file": "docs/videos/_music/track.mp3", "lufs": -28, "lufsUnderNarration": -34 },
    "record": {
        "viewport": { "width": 1440, "height": 900 },
        "hideSelectors": [".environment-indicator"],   // local-only UI to hide on camera
        "extraHTTPHeaders": { "X-Demo-Recording": "1" },
        "personaDomain": "example.com",
        "cursor": "layer",                             // or "recorded": film it into the footage
        "capture": "screencast"                        // every painted frame → smooth 30 fps (or "playwright")
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
reelson doctor                                          # tools + cursor/footage sync on this machine
reelson new customers-search --url https://app.test    # scenario stub
reelson record customers-search [--headed]            # --mobile / --square: the takes for --portrait / --square; --all-takes: all three
reelson build customers-search --title "Find a customer"   # creates video.json on first run
#   edit video.json: callout wording, { "clicks": [2, 3], "scale": 1.8 } zooms, trim ("auto" or a marker)
reelson voice customers-search                          # "voice": true in video.json: speak the callouts (voice.provider: openai, elevenlabs, piper, command)
reelson check customers-search                          # schemas, zoom timing, hyperframes lint
reelson verify --all                                    # after an app change: every demo still records and fits
reelson studio customers-search                         # preview + edit on a layer timeline (saves video.json)
reelson templates                                       # templates and intro/recap/outro sections
reelson render customers-search [--gif] [--square] [--portrait] [--all-formats] [--draft]   # + .srt/.vtt captions
reelson render --all                                    # every demo; skips the unchanged ones
```

Per video, commit `scenario.ts`, `markers.json` and `video.json`; everything else is generated.

## Templates and sections

A video is a **template** (the stage: background, framed recording, callouts) plus one
**section** per slot, chosen separately in demo.config.json or per video in video.json:

| Slot    | Sections (first = default)                   |
|---------|----------------------------------------------|
| `intro` | `poster`, `minimal`, `split`                 |
| `recap` | `steps`, `compact`, `none`                   |
| `outro` | `wordmark`, `compact`, `endcard`             |

```jsonc
// video.json — this video only
"sections": { "intro": "minimal", "recap": "none", "outro": "endcard" }
```

Every intro keeps frame 0 as the poster and every outro ends on the brand, so any mix keeps
the house style. `brand.logo` (an SVG, or a PNG ≥ 340 px tall) replaces the text wordmark in all
of them. `classic` is the only template today. The contract for new templates and sections is in
[templates/README.md](skills/reelson-compose/templates/README.md); a project can keep its own under
`<videosDir>/_templates/<name>/` and `<videosDir>/_sections/<slot>/<name>/`. Templates ship
their scripts and fonts (no CDN).

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

### Publish to npm

Node will not run TypeScript from under `node_modules`, so the package ships `.js` compiled beside
each `.ts` (`npm run build`; `npm pack` / `npm publish` build first and clean up after).
`bin/run.js` picks the compiled CLI when installed from npm and the sources in a checkout.

1. Bump `version` in package.json, commit, tag `vX.Y.Z` and push the tag.
2. [.github/workflows/publish.yml](.github/workflows/publish.yml) runs the checks and publishes
   with npm trusted publishing (OIDC, with provenance; no token). Set it up once on npmjs.com →
   the package → Settings → Trusted publishing: GitHub Actions, `reelson/reelson`, `publish.yml`.

The very first release has to be published by hand (trusted publishing needs the package to
exist): `npm login && npm publish`. Check the contents first with `npm pack --dry-run`.

## Layout

```
bin/reelson.ts  the CLI (run.js: the npm entry point)
skills/
  reelson-record/  SKILL.md, scripts/ (record, scenario, cursor-overlay, config, validate), schemas/
  reelson-compose/   SKILL.md, scripts/ (build, check, timeline, zooms, composition, project, hyperframes),
                schemas/, templates/<name>/ (stages), sections/<slot>/<name>/
docs/           style-guide.md, prompting.md, demo.webp (the README clip)
examples/       demo.config.json + todo-add-item/ (scenario, markers, video.json)
test/           unit + golden tests, fixtures
music/          local-only tracks (git-ignored; licences are per project)
```

MIT licence ([LICENSE](LICENSE)). Third-party code and fonts: [NOTICE.md](NOTICE.md).
