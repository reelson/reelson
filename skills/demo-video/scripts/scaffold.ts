/**
 * Scaffolds a HyperFrames project around a recording made by the demo-record
 * skill.
 *
 *   node <skills>/demo-video/scripts/scaffold.ts <demo-dir> \
 *       --title "Title" [--subtitle "..."] [--template classic] \
 *       [--brand "ACME"] [--tagline "PLATFORM"] [--eyebrow "Acme"] [--outro-title "In short"] \
 *       [--trim-start <s>] [--trim-end <s>] [--music <file> | --no-music] [--force]
 *
 * Brand, strings, template and music default to the project's
 * demo.config.json (see demo-record/scripts/config.ts); flags override them
 * for one video.
 *
 * <demo-dir> must contain recording.mp4; markers.json (written by the
 * demo-record skill) is optional — without it (e.g. an OpenScreen export) the
 * duration and size are probed with ffprobe and no callouts are pre-filled.
 * Writes <demo-dir>/video/{index.html,hyperframes.json,package.json,assets/*}.
 *
 * Timeline it produces:
 *   cover (wordmark + title; frame 0 is the poster) → recording (callouts, zooms)
 *   → recap card → brand card
 *
 * A recording with an audio track (OpenScreen voiceover) gets its narration
 * extracted to assets/narration.m4a and played in sync as an <audio> clip.
 *
 * The project's music bed (demo.config.json `music.file`) is laid under the
 * whole timeline unless --no-music: trimmed to the total length, loudness
 * normalised to a quiet bed (quieter still under narration), faded in and out,
 * written to assets/music.m4a. --music <file> swaps the track for one video.
 *
 * Templates: templates/<name>/index.html in this skill, or a project-local
 * <videosDir>/_templates/<name>/index.html (checked first). A template may
 * ship template.json to override the timing constants below and an assets/
 * folder that is copied next to the recording. See templates/README.md.
 *
 * Hand-offs recorded with demo.transition() (markers.json "transitions") split
 * the footage there: the recording leaves through the top, a transition card
 * ("Manager → Employee", title, subtitle) holds for TRANSITION_GAP seconds, and
 * the next actor's footage rides back in from below. Later callouts shift by
 * the gap automatically.
 *
 * Every markers.json marker becomes a placeholder callout (text = label) so
 * the timings are already right; edit the DEMO block in index.html to word
 * them, drop the ones you don't want, and add zooms.
 */
import { spawnSync } from 'node:child_process'
import {
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromRoot, loadConfig } from '../../demo-record/scripts/config.ts'

const HYPERFRAMES_VERSION = '0.8.46'

/**
 * Timeline constants (seconds). Cards overlap by `overlap` where one fades into
 * the next. The cover holds until `coverExit`, when it lifts away and the
 * recording rides in from below (the recording starts right there); the cover
 * clip ends at `cover`. A template's template.json can override any of these.
 */
const TIMING_DEFAULTS = {
    cover: 4.0,
    coverExit: 3.0,
    recapBase: 2.4, // + recapPerStep per step, capped at recapMax
    recapPerStep: 0.45,
    recapMax: 7.5,
    brandOut: 2.6,
    overlap: 0.4,
    calloutDuration: 3.0,
    transitionGap: 2.6, // seconds a hand-off card holds between the two belts
    belt: 0.9, // the recording's exit before a hand-off card (matches the template)
    maxW: 1600, // the framed recording's box inside the 1920x1080 stage
    maxH: 940,
    maxSteps: 10, // the recap card's capacity
}

const args = process.argv.slice(2)
const demoDirArg = args.find((a) => !a.startsWith('--'))
if (!demoDirArg) {
    console.error('usage: scaffold.ts <demo-dir> --title "..." [options]')
    process.exit(2)
}

function flag(name: string, fallback = ''): string {
    const i = args.indexOf(name)
    return i === -1 ? fallback : (args[i + 1] ?? fallback)
}

const demoDir = resolve(demoDirArg)
const config = loadConfig(demoDir)
const templateName = flag('--template', config.template)
const templateDir = findTemplate(templateName)
const timing = {
    ...TIMING_DEFAULTS,
    ...(existsSync(resolve(templateDir, 'template.json'))
        ? (JSON.parse(
              readFileSync(resolve(templateDir, 'template.json'), 'utf8'),
          ).timing ?? {})
        : {}),
} as typeof TIMING_DEFAULTS
const COVER = timing.cover
const COVER_EXIT = timing.coverExit
const BRAND_OUT = timing.brandOut
const OVERLAP = timing.overlap
const CALLOUT_DURATION = timing.calloutDuration
const TRANSITION_GAP = timing.transitionGap
const BELT = timing.belt
const MAX_W = timing.maxW
const MAX_H = timing.maxH
const videoDir = resolve(demoDir, 'video')
const recording = resolve(demoDir, 'recording.mp4')
const markersPath = resolve(demoDir, 'markers.json')
const indexPath = resolve(videoDir, 'index.html')

if (!existsSync(recording)) {
    console.error(
        `missing ${recording} — run the demo-record skill first (or export one from OpenScreen)`,
    )
    process.exit(1)
}
if (existsSync(indexPath) && !args.includes('--force')) {
    console.error(
        `${indexPath} exists; pass --force to overwrite (your DEMO edits will be lost)`,
    )
    process.exit(1)
}

interface Markers {
    durationSeconds: number
    viewport: { width: number; height: number }
    markers: { label: string; at: number }[]
    transitions?: {
        at: number
        title: string
        subtitle?: string
        from?: string
        to?: string
    }[]
}
const markers: Markers = existsSync(markersPath)
    ? JSON.parse(readFileSync(markersPath, 'utf8'))
    : probeRecording(recording)

const trimStart = Number.parseFloat(flag('--trim-start', '0')) || 0
const trimEnd =
    Number.parseFloat(flag('--trim-end', String(markers.durationSeconds))) ||
    markers.durationSeconds
const mediaDuration = round(trimEnd - trimStart)
if (mediaDuration <= 0) {
    console.error('trim window is empty')
    process.exit(1)
}

// Timeline. Each hand-off inside the trim window adds TRANSITION_GAP seconds.
const clipStart = COVER_EXIT
const transitions = (markers.transitions ?? []).filter(
    (t) => t.at > trimStart && t.at < trimEnd,
)
const clipDuration = round(mediaDuration + TRANSITION_GAP * transitions.length)
/** Recording time → composition time (footage after a hand-off is pushed back by the gap). */
const toComposition = (t: number): number =>
    round(
        clipStart +
            (t - trimStart) +
            TRANSITION_GAP * transitions.filter((tr) => tr.at <= t).length,
    )
// Composition time at which each hand-off card is fully in (the recording has just left).
const transitionTimes = transitions.map((t, i) =>
    round(clipStart + (t.at - trimStart) + TRANSITION_GAP * i),
)
const recapStart = round(clipStart + clipDuration - OVERLAP)

// Fit the recording inside the stage keeping its aspect ratio.
const scale = Math.min(
    MAX_W / markers.viewport.width,
    MAX_H / markers.viewport.height,
)
const frameW = Math.round(markers.viewport.width * scale)
const frameH = Math.round(markers.viewport.height * scale)

const inWindow = markers.markers.filter(
    (m) => m.at >= trimStart && m.at <= trimEnd,
)
const callouts = inWindow.map((m, i) => {
    const at = toComposition(m.at)
    const next = inWindow[i + 1]
    const nextTransition = transitionTimes.find((t) => t > at)
    // Never overlap the next callout or a hand-off card; never outlive the recording.
    const cap = Math.min(
        next ? toComposition(next.at) - 0.2 : Infinity,
        nextTransition !== undefined ? nextTransition - BELT - 0.1 : Infinity,
        clipStart + clipDuration - 0.3,
    )

    // Two-actor videos: tag each step with who does it (the hand-off card's roles);
    // the recap then shows one titled list per role.
    const handOffsBefore = transitions.filter((t) => t.at <= m.at)
    const group = handOffsBefore.length
        ? handOffsBefore.at(-1)?.to
        : transitions[0]?.from

    return {
        at,
        duration: round(Math.max(1, Math.min(CALLOUT_DURATION, cap - at))),
        text: m.label,
        ...(group ? { group } : {}),
    }
})

if (callouts.length > timing.maxSteps) {
    console.warn(
        `WARNING: ${callouts.length} markers — the '${templateName}' recap holds at most ${timing.maxSteps} steps; merge or drop markers in the scenario`,
    )
}

// The recap lists the steps; give viewers time to read them.
const recapDuration = round(
    Math.min(
        timing.recapMax,
        timing.recapBase + timing.recapPerStep * callouts.length,
    ),
)
const brandOutStart = round(recapStart + recapDuration - OVERLAP)
const total = round(brandOutStart + BRAND_OUT)

const templatePath = resolve(templateDir, 'index.html')
const replacements: Record<string, string> = {
    LANG: escapeHtml(config.language),
    BRAND_COLOR: escapeHtml(config.brand.color),
    BRAND_COLOR_SOFT: escapeHtml(config.brand.colorSoft),
    STEPS_LABEL: jsString(config.strings.stepsLabel),
    SECONDS_LABEL: jsString(config.strings.secondsLabel),
    MAX_STEPS: String(timing.maxSteps),
    TOTAL: String(total),
    COVER_DURATION: String(COVER),
    COVER_EXIT: String(COVER_EXIT),
    CLIP_START: String(clipStart),
    CLIP_DURATION: String(clipDuration),
    MEDIA_START: String(trimStart),
    VIDEOS: renderVideoSegments(),
    TRANSITIONS: transitions
        .map((t, i) => renderTransitionCard(t, i, transitionTimes[i]))
        .join('\n'),
    TRANSITION_TIMES: transitionTimes.length
        ? '[' +
          transitionTimes
              .map((at) => JSON.stringify({ at, gap: TRANSITION_GAP }))
              .join(', ') +
          ']'
        : '[]',
    RECAP_START: String(recapStart),
    RECAP_DURATION: String(recapDuration),
    BRAND_OUT_START: String(brandOutStart),
    BRAND_OUT_DURATION: String(BRAND_OUT),
    FRAME_W: String(frameW),
    FRAME_H: String(frameH),
    BRAND: escapeHtml(flag('--brand', config.brand.name)),
    BRAND_SUB: escapeHtml(
        flag('--tagline', flag('--brand-sub', config.brand.tagline)),
    ),
    EYEBROW: escapeHtml(flag('--eyebrow', config.brand.eyebrow)),
    TITLE: escapeHtml(flag('--title', 'Demo')),
    SUBTITLE: escapeHtml(flag('--subtitle', '')),
    OUTRO_TITLE: escapeHtml(flag('--outro-title', config.strings.recapTitle)),
    CALLOUTS: callouts.length
        ? '[\n' +
          callouts.map((c) => `          ${JSON.stringify(c)},`).join('\n') +
          '\n        ]'
        : '[]',
}
let html = readFileSync(templatePath, 'utf8')
for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value)
}

mkdirSync(resolve(videoDir, 'assets'), { recursive: true })
if (existsSync(resolve(templateDir, 'assets'))) {
    cpSync(resolve(templateDir, 'assets'), resolve(videoDir, 'assets'), {
        recursive: true,
    })
}
copyFileSync(recording, resolve(videoDir, 'assets/recording.mp4'))
const narration = extractNarration(
    recording,
    resolve(videoDir, 'assets/narration.m4a'),
)
html = html.replace('{{AUDIO}}', narration)
html = html.replace(
    '{{MUSIC}}',
    renderMusicBed(resolve(videoDir, 'assets/music.m4a'), narration !== ''),
)
const leftover = html.match(/{{[A-Z_]+}}/g)
if (leftover) {
    console.error(`template placeholders left unfilled: ${leftover.join(', ')}`)
    process.exit(1)
}
writeFileSync(indexPath, html)
writeFileSync(
    resolve(videoDir, 'hyperframes.json'),
    JSON.stringify(
        {
            $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
            paths: {
                blocks: 'compositions',
                components: 'compositions/components',
                assets: 'assets',
            },
            // autoProxy swaps big media for a downscaled proxy, which throws away the 2x capture.
            media: { autoProxy: false },
        },
        null,
        2,
    ) + '\n',
)
writeFileSync(
    resolve(videoDir, 'package.json'),
    JSON.stringify(
        {
            name: `demo-video-${demoDir.split('/').at(-1)}`,
            private: true,
            type: 'module',
            scripts: {
                dev: `npx --yes hyperframes@${HYPERFRAMES_VERSION} preview`,
                check: `npx --yes hyperframes@${HYPERFRAMES_VERSION} check`,
                render: `npx --yes hyperframes@${HYPERFRAMES_VERSION} render --video-frame-format jpg -q delivery`,
            },
        },
        null,
        2,
    ) + '\n',
)

console.log(`scaffolded ${indexPath} (template '${templateName}')`)
console.log(
    `  timeline: cover 0–${COVER}s (exit ${COVER_EXIT}s) | recording ${clipStart}–${round(clipStart + clipDuration)}s (media ${trimStart}–${trimEnd}s) | recap ${recapStart}–${round(recapStart + recapDuration)}s | brand ${brandOutStart}–${total}s`,
)
if (transitions.length) {
    console.log(
        `  hand-off card(s) at ${transitionTimes.map((t) => `${t}s`).join(', ')} (+${TRANSITION_GAP}s each)`,
    )
}
console.log(
    `  frame ${frameW}x${frameH}, ${callouts.length} placeholder callout(s) from markers`,
)

/**
 * One <video> clip per stretch of footage between hand-offs. Each segment is
 * its own timed clip (same file, different data-media-start), so the footage
 * pauses while a transition card is on screen.
 */
function renderVideoSegments(): string {
    const bounds = [trimStart, ...transitions.map((t) => t.at), trimEnd]

    return bounds
        .slice(0, -1)
        .map((from, i) => {
            const start = round(
                clipStart + (from - trimStart) + TRANSITION_GAP * i,
            )
            const duration = round(bounds[i + 1] - from)
            const id = i === 0 ? 'recording' : `recording-${i + 1}`

            return `          <video id="${id}" class="clip" src="assets/recording.mp4" muted playsinline
            data-start="${start}" data-duration="${duration}" data-media-start="${round(from)}" data-track-index="1"></video>`
        })
        .join('\n')
}

/** Markup for a hand-off card; the template's builder animates it from DEMO.transitions. */
function renderTransitionCard(
    t: NonNullable<Markers['transitions']>[number],
    i: number,
    at: number,
): string {
    const start = round(at - BELT)
    const duration = round(TRANSITION_GAP + 2 * BELT)
    const roles =
        t.from && t.to
            ? `
          <div class="roles">
            <div class="role from">${escapeHtml(t.from)}</div>
            <div class="arrow"></div>
            <div class="role to"><div class="fill"></div><span>${escapeHtml(t.to)}</span></div>
          </div>`
            : ''
    const subtitle = t.subtitle
        ? `
          <p class="subtitle">${escapeHtml(t.subtitle)}</p>`
        : ''

    return `      <!-- Hand-off ${i + 1}: demo.transition() in the scenario -->
      <section id="transition-${i}" class="clip transition-card" data-start="${start}" data-duration="${duration}" data-track-index="2">
        <div class="stack">${roles}
          <h1 class="title">${escapeHtml(t.title)}</h1>${subtitle}
        </div>
      </section>`
}

/**
 * Pre-renders the music bed with ffmpeg (trim, loudnorm, fades) so the
 * composition just plays it at unity — no reliance on renderer-side automation.
 * Returns the <audio> clip markup, or '' when disabled/missing.
 */
function renderMusicBed(target: string, underNarration: boolean): string {
    if (args.includes('--no-music')) {
        return ''
    }
    const override = flag('--music')
    const configured = override
        ? resolve(override)
        : config.music.file
          ? fromRoot(config, config.music.file)
          : null
    if (!configured) {
        console.log(
            'no music: set music.file in demo.config.json or pass --music <file>',
        )
        return ''
    }
    const source = configured
    if (!existsSync(source)) {
        console.error(
            `music not found: ${source} — fix music.file in demo.config.json, pass --music <file> or --no-music`,
        )
        process.exit(1)
    }
    const lufs = underNarration
        ? config.music.lufsUnderNarration
        : config.music.lufs
    const fadeOut = 3
    const filters = [
        `atrim=0:${total}`,
        `loudnorm=I=${lufs}:TP=-3:LRA=9`,
        'afade=t=in:st=0:d=0.8',
        `afade=t=out:st=${round(total - fadeOut)}:d=${fadeOut}`,
    ].join(',')
    const render = spawnSync(
        'ffmpeg',
        [
            '-y',
            '-loglevel',
            'error',
            '-i',
            source,
            '-vn',
            '-af',
            filters,
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            target,
        ],
        { stdio: 'inherit' },
    )
    if (render.status !== 0) {
        console.error('ffmpeg could not render the music bed')
        process.exit(1)
    }
    console.log(
        `music bed: ${source.split('/').at(-1)} → assets/music.m4a (${lufs} LUFS, fades 0.8s/${fadeOut}s)`,
    )

    return `      <!-- Music bed, pre-rendered by scaffold.ts (trim + loudnorm + fades) -->
      <audio id="music" class="clip" src="assets/music.m4a" data-start="0" data-duration="${total}" data-track-index="4"></audio>`
}

/** Returns the <audio> clip markup when the recording carries an audio track, else ''. */
function extractNarration(source: string, target: string): string {
    const probe = spawnSync(
        'ffprobe',
        [
            '-v',
            'error',
            '-select_streams',
            'a',
            '-show_entries',
            'stream=codec_name',
            '-of',
            'csv=p=0',
            source,
        ],
        { encoding: 'utf8' },
    )
    if (probe.status !== 0 || probe.stdout.trim() === '') {
        return ''
    }
    if (transitions.length) {
        console.warn(
            'WARNING: narration is not split at hand-offs; it will drift after the first transition card',
        )
    }
    const extract = spawnSync(
        'ffmpeg',
        [
            '-y',
            '-loglevel',
            'error',
            '-i',
            source,
            '-vn',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            target,
        ],
        { stdio: 'inherit' },
    )
    if (extract.status !== 0) {
        console.error(
            'ffmpeg could not extract the audio track; continuing without narration',
        )
        return ''
    }
    console.log(
        'audio track found — narration extracted to assets/narration.m4a',
    )

    return `      <!-- Narration from the recording (kept in sync via the same start/media-start) -->
      <audio id="narration" class="clip" src="assets/narration.m4a" data-start="${clipStart}" data-duration="${mediaDuration}" data-media-start="${trimStart}" data-track-index="3"></audio>`
}

function probeRecording(path: string): Markers {
    const probe = spawnSync(
        'ffprobe',
        [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height:format=duration',
            '-of',
            'json',
            path,
        ],
        { encoding: 'utf8' },
    )
    if (probe.status !== 0) {
        console.error('ffprobe failed — install ffmpeg (brew install ffmpeg)')
        process.exit(1)
    }
    const info = JSON.parse(probe.stdout)
    console.log(
        'no markers.json — probed the recording; add callouts by hand in the DEMO block',
    )

    return {
        durationSeconds: Number.parseFloat(info.format.duration),
        viewport: {
            width: info.streams[0].width,
            height: info.streams[0].height,
        },
        markers: [],
    }
}

/**
 * Template lookup: a project-local <videosDir>/_templates/<name>/ wins over the
 * kit's templates/<name>/, so a project can fork a template without touching the kit.
 */
function findTemplate(name: string): string {
    const candidates = [
        resolve(fromRoot(config, config.videosDir), '_templates', name),
        resolve(dirname(fileURLToPath(import.meta.url)), '../templates', name),
    ]
    const found = candidates.find((dir) => existsSync(resolve(dir, 'index.html')))
    if (!found) {
        console.error(
            `template '${name}' not found; looked in:\n  ${candidates.join('\n  ')}`,
        )
        process.exit(1)
    }

    return found
}

/** A JS string literal body (the template drops it inside quotes). */
function jsString(s: string): string {
    return JSON.stringify(s).slice(1, -1).replace(/</g, '\\u003c')
}

function round(n: number): number {
    return Math.round(n * 100) / 100
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
