# Templates

A template is a folder with one HyperFrames composition that `reelkit build` fills in:

```
templates/<name>/
├── index.html      ← required: the composition with {{PLACEHOLDERS}}
├── template.json   ← optional: timing overrides, description
└── assets/         ← optional: copied into video/assets/ (logos, fonts, textures, vendored JS)
```

Lookup order: `<videosDir>/_templates/<name>/` in the project, then this folder. Choose one
with `template` in video.json or demo.config.json (or `reelkit build <slug> --template <name>`).

Keep templates self-contained: load scripts and fonts from `assets/` (see `classic/assets/vendor/`:
GSAP + Inter), never from a CDN, so renders work offline and never change underneath you.

## Making a new template

1. Copy `classic/` to `<new-name>/`.
2. Change the design of the section you want (cover, recap, brand card, transition card,
   callouts, background) — keep the placeholders and the element IDs the builder script uses.
3. If a card gets longer or shorter, set it in `template.json` so the build computes the
   timeline correctly (unknown keys are an error):

   ```json
   {
       "description": "Light background, logo image instead of a wordmark",
       "timing": { "cover": 4.5, "coverExit": 3.5, "brandOut": 3.0, "maxSteps": 8 }
   }
   ```

4. Test it on the example: from `examples/`, `reelkit build todo-add-item --template <new-name>`,
   `reelkit check todo-add-item`, `reelkit snapshot todo-add-item --at 0,2,8,13,22`, and render
   once. Add a golden test for it next to `test/composition.test.ts` (copy the classic one).

## Timing keys (`template.json` → `timing`, seconds unless noted)

| Key               | Default | Meaning                                                           |
|-------------------|---------|-------------------------------------------------------------------|
| `cover`           | 4.0     | cover clip length                                                 |
| `coverExit`       | 3.0     | when the cover leaves and the recording starts (= `clipStart`)    |
| `recapBase`       | 2.4     | recap length before per-step time                                 |
| `recapPerStep`    | 0.45    | reading time per recap row                                        |
| `recapMax`        | 7.5     | recap length cap                                                  |
| `brandOut`        | 2.6     | closing card length                                               |
| `overlap`         | 0.4     | cross-fade between recording → recap → brand card                 |
| `calloutDuration` | 3.0     | default callout length (capped so callouts never overlap)         |
| `transitionGap`   | 2.6     | how long a hand-off card holds                                    |
| `belt`            | 0.9     | the recording's exit/entry around a hand-off card                 |
| `maxW`, `maxH`    | 1600, 940 | px box the framed recording is fitted into (1920x1080 stage)    |
| `maxSteps`        | 10      | recap capacity (the build warns above it)                         |

## Placeholders

| Placeholder                                   | Value                                                   |
|-----------------------------------------------|---------------------------------------------------------|
| `{{LANG}}`                                    | `language` from config (`<html lang>`)                  |
| `{{BRAND}}`, `{{BRAND_SUB}}`, `{{EYEBROW}}`   | brand name, tagline, eyebrow (config, overridable per video; HTML-escaped). Hide an empty tagline with `:empty` |
| `{{BRAND_COLOR}}`, `{{BRAND_COLOR_SOFT}}`     | `brand.color`, `brand.colorSoft`                        |
| `{{TITLE}}`, `{{SUBTITLE}}`, `{{OUTRO_TITLE}}`| video.json title/subtitle, recap title                  |
| `{{TOTAL}}`                                   | composition length                                      |
| `{{COVER_DURATION}}`                          | cover clip length                                       |
| `{{RECAP_START}}`, `{{RECAP_DURATION}}`       | recap card                                              |
| `{{BRAND_OUT_START}}`, `{{BRAND_OUT_DURATION}}` | closing card                                          |
| `{{FRAME_W}}`, `{{FRAME_H}}`                  | framed recording size in px                             |
| `{{VIDEOS}}`                                  | `<video>` clip(s), one per actor segment — put inside `#frame` |
| `{{TRANSITIONS}}`                             | hand-off card `<section>`s (`#transition-N`, `.stack`, `.roles`, `.role.from/.to`, `.arrow`, `.title`, `.subtitle`) |
| `{{AUDIO}}`, `{{MUSIC}}`                      | narration / music `<audio>` clips (or empty)            |
| `{{DEMO}}`                                    | the timeline as a JS object literal, for the builder script: `const DEMO = {{DEMO}};` |

`DEMO` holds `total`, `coverDuration`, `coverExit`, `clipStart`, `clipDuration`, `mediaStart`,
`recapStart`, `recapDuration`, `brandOutStart`, `brandOutDuration`, `callouts` (`{ at, duration,
text, group? }`), `zooms` (`{ at, duration, x, y, scale, in, out }`), `transitions` (`{ at, gap }`),
`chip` (`{ steps, seconds }`, already pluralised) and `maxSteps` — all times in composition seconds.
Insert any text from it with `textContent`, never `innerHTML`.

The build fails if a `{{PLACEHOLDER}}` is left unfilled, so a template may omit ones it doesn't
need but must not invent new ones without adding them to `scripts/composition.ts`.
