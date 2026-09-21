# Templates

A template is a folder with one HyperFrames composition that `scaffold.ts` fills in:

```
templates/<name>/
├── index.html      ← required: the composition with {{PLACEHOLDERS}}
├── template.json   ← optional: timing overrides, description
└── assets/         ← optional: copied into video/assets/ (logos, fonts, textures)
```

Lookup order: `<videosDir>/_templates/<name>/` in the project, then this folder. Choose one
with `--template <name>` or `template` in `demo.config.json`.

## Making a new template

1. Copy `classic/` to `<new-name>/`.
2. Change the design of the section you want (cover, recap, brand card, transition card,
   callouts, background) — keep the placeholders and the element IDs the builder script uses.
3. If a card gets longer or shorter, set it in `template.json` so the scaffold computes the
   timeline correctly:

   ```json
   {
       "description": "Light background, logo image instead of a wordmark",
       "timing": { "cover": 4.5, "coverExit": 3.5, "brandOut": 3.0, "maxSteps": 8 }
   }
   ```

4. Test it on the example: from the kit root,
   `node skills/demo-video/scripts/scaffold.ts examples/todo-add-item --title "Plan your day" --template <new-name> --force`,
   then `hyperframes check` + `snapshot`, and render once.

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
| `maxSteps`        | 10      | recap capacity (the scaffold warns above it)                      |

## Placeholders

| Placeholder                                   | Value                                                   |
|-----------------------------------------------|---------------------------------------------------------|
| `{{LANG}}`                                    | `language` from config (`<html lang>`)                  |
| `{{BRAND}}`, `{{BRAND_SUB}}`, `{{EYEBROW}}`   | `brand.name`, `brand.tagline`, `brand.eyebrow` (HTML-escaped) |
| `{{BRAND_COLOR}}`, `{{BRAND_COLOR_SOFT}}`     | `brand.color`, `brand.colorSoft`                        |
| `{{TITLE}}`, `{{SUBTITLE}}`, `{{OUTRO_TITLE}}`| `--title`, `--subtitle`, `strings.recapTitle`           |
| `{{STEPS_LABEL}}`, `{{SECONDS_LABEL}}`        | `strings.*`, escaped for a single-quoted JS string      |
| `{{MAX_STEPS}}`                               | `timing.maxSteps`                                       |
| `{{TOTAL}}`                                   | composition length                                      |
| `{{COVER_DURATION}}`, `{{COVER_EXIT}}`        | cover clip length / exit time                           |
| `{{CLIP_START}}`, `{{CLIP_DURATION}}`, `{{MEDIA_START}}` | recording on the timeline; `MEDIA_START` = `--trim-start` |
| `{{RECAP_START}}`, `{{RECAP_DURATION}}`       | recap card                                              |
| `{{BRAND_OUT_START}}`, `{{BRAND_OUT_DURATION}}` | closing card                                          |
| `{{FRAME_W}}`, `{{FRAME_H}}`                  | framed recording size in px                             |
| `{{VIDEOS}}`                                  | `<video>` clip(s), one per actor segment — put inside `#frame` |
| `{{TRANSITIONS}}`                             | hand-off card `<section>`s (`#transition-N`, `.stack`, `.roles`, `.role.from/.to`, `.arrow`, `.title`, `.subtitle`) |
| `{{TRANSITION_TIMES}}`                        | `[{ at, gap }]` for the builder                         |
| `{{CALLOUTS}}`                                | `[{ at, duration, text, group? }]`                      |
| `{{AUDIO}}`, `{{MUSIC}}`                      | narration / music `<audio>` clips (or empty)            |

The scaffold fails if any `{{PLACEHOLDER}}` is left unfilled, so a template may omit ones it
doesn't need but must not invent new ones without adding them to `scaffold.ts`.

`check-zooms.ts` reads the `const DEMO = { ... }` block (it must stay pure literals, closed by
`\n      };` at six spaces of indentation) and needs `clipStart`, `mediaStart`, `zooms` and
`transitions` in it.
