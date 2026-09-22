/**
 * Builds a demo's HyperFrames project from its video.json.
 *
 *   reelkit build <slug|dir> [--title ".."] [--subtitle ".."] [--trim-start s] [--trim-end s]
 *                            [--template name] [--intro name] [--recap name|none] [--outro name]
 *                            [--music file | --no-music]
 *
 * video.json is the source of truth; video/ is generated and can be deleted at
 * any time. The first build creates video.json from markers.json (one callout
 * per marker, a suggested trim); the flags above edit video.json in place.
 *
 * Writes <demo>/video/{index.html, hyperframes.json, package.json, assets/*}:
 * the template's stage with the chosen intro/recap/outro sections, its own assets
 * (vendored GSAP + fonts), each section's assets, the brand logo, the recording, narration
 * (when the recording has audio) and the music bed (trimmed, loudness-normalised,
 * faded; cached between builds).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { countLabel, fromRoot, type LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { renderComposition } from './composition.ts'
import { HYPERFRAMES_VERSION, RENDER_FLAGS } from './hyperframes.ts'
import {
    readMarkers,
    readSection,
    readVideoSpec,
    ReelkitError,
    resolveDesign,
    videoSchemaRef,
    type Design,
    type Section,
} from './project.ts'
import {
    computeTimeline,
    defaultCallouts,
    round,
    type Markers,
    type SectionChoice,
    type Timeline,
    type VideoSpec,
} from './timeline.ts'
import { compositionClicks, planZoom, ZoomError, type CompClick, type Zoom } from './zooms.ts'

export interface BuildOptions {
    title?: string
    subtitle?: string
    trimStart?: number
    trimEnd?: number
    template?: string
    /** Section per slot; stored in video.json `sections`. */
    sections?: SectionChoice
    /** A file for this video, or false for none; undefined keeps video.json / config. */
    music?: string | false
    log?: (line: string) => void
}

export interface Plan {
    spec: VideoSpec
    markers: Markers
    design: Design
    timeline: Timeline
    clicks: CompClick[]
    zooms: Zoom[]
    warnings: string[]
    /** video.json did not exist and was derived from markers.json. */
    created: boolean
}

/** Everything a build needs, computed without touching video/ (check uses it too). */
export function plan(demoDir: string, config: LoadedConfig, options: BuildOptions = {}): Plan {
    const markers = readMarkers(demoDir)
    const existing = readVideoSpec(demoDir)
    const spec: VideoSpec = existing ?? {
        title: options.title ?? humanize(basename(demoDir)),
        trim: { start: suggestTrimStart(markers) },
        callouts: defaultCallouts(markers),
        zooms: [],
    }
    applyOptions(spec, options)

    const design = resolveDesign(spec.template ?? config.template, [config.sections, spec.sections], config)
    let computed
    try {
        computed = computeTimeline(markers, spec, design.timing)
    } catch (error) {
        throw new ReelkitError(`${resolve(demoDir, 'video.json')}: ${(error as Error).message}`)
    }
    const { timeline, warnings } = computed
    const clicks = compositionClicks(markers, timeline)
    const zooms = (spec.zooms ?? []).map((z, i) => {
        try {
            return planZoom(z, clicks, timeline)
        } catch (error) {
            if (error instanceof ZoomError) {
                throw new ReelkitError(`video.json zooms[${i}]: ${error.message}`)
            }
            throw error
        }
    })

    return { spec, markers, design, timeline, clicks, zooms, warnings, created: existing === null }
}

export function build(demoDir: string, config: LoadedConfig, options: BuildOptions = {}): Plan {
    const log = options.log ?? console.log
    const recording = resolve(demoDir, 'recording.mp4')
    if (!existsSync(recording)) {
        throw new ReelkitError(`missing ${recording} — run \`reelkit record\` first (or export one from OpenScreen)`)
    }
    const result = plan(demoDir, config, options)
    const { spec, timeline, design } = result
    const { template } = design

    // video.json first: it is the source of truth even if a later step fails.
    const specPath = resolve(demoDir, 'video.json')
    const serialized =
        JSON.stringify({ $schema: videoSchemaRef(demoDir, config), ...withoutSchema(spec) }, null, 4) + '\n'
    if (!existsSync(specPath) || readFileSync(specPath, 'utf8') !== serialized) {
        writeFileSync(specPath, serialized)
        log(result.created ? `created ${specPath} — word the callouts and add zooms there` : `updated ${specPath}`)
    }

    const videoDir = resolve(demoDir, 'video')
    const assets = resolve(videoDir, 'assets')
    mkdirSync(assets, { recursive: true })
    if (existsSync(resolve(template.dir, 'assets'))) {
        cpSync(resolve(template.dir, 'assets'), assets, { recursive: true })
    }
    const sections = Object.values(design.sections)
        .filter((section): section is Section => section !== null)
        .map((section) => {
            const source = readSection(section)
            if (source.assets) {
                cpSync(resolve(section.dir, 'assets'), resolve(videoDir, source.assets), { recursive: true })
            }
            return source
        })
    const logo = copyLogo(spec, config, assets, log)
    copyIfChanged(recording, resolve(assets, 'recording.mp4'))
    const narration = extractNarration(recording, resolve(assets, 'narration.m4a'), timeline, log)
    const music = renderMusicBed(spec, config, timeline, resolve(assets, 'music.m4a'), narration, log)

    const brand = { ...config.brand, ...spec.brand }
    const html = renderComposition({
        stage: readFileSync(resolve(template.dir, 'stage.html'), 'utf8'),
        sections,
        timeline,
        zooms: result.zooms,
        narration,
        music,
        text: {
            language: config.language,
            brand,
            logo,
            title: spec.title,
            subtitle: spec.subtitle ?? '',
            recapTitle: spec.recapTitle ?? config.strings.recapTitle,
            stepsChip: countLabel(timeline.callouts.length, config.strings.stepsLabel, config.language),
            secondsChip: countLabel(Math.round(timeline.total), config.strings.secondsLabel, config.language),
        },
    })
    writeFileSync(resolve(videoDir, 'index.html'), html)
    writeFileSync(
        resolve(videoDir, 'hyperframes.json'),
        JSON.stringify(
            {
                $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
                paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
                // autoProxy swaps big media for a downscaled proxy, which throws away the 2x capture.
                media: { autoProxy: false },
            },
            null,
            2,
        ) + '\n',
    )
    const hf = `npx --yes hyperframes@${HYPERFRAMES_VERSION}`
    writeFileSync(
        resolve(videoDir, 'package.json'),
        JSON.stringify(
            {
                name: `reelkit-video-${basename(demoDir)}`,
                private: true,
                type: 'module',
                scripts: { dev: `${hf} preview`, check: `${hf} check`, render: `${hf} render ${RENDER_FLAGS.join(' ')}` },
            },
            null,
            2,
        ) + '\n',
    )

    const t = timeline
    const { intro, recap, outro } = design.sections
    log(`built ${resolve(videoDir, 'index.html')} (template '${template.name}')`)
    log(
        `  timeline: intro/${intro.name} 0–${t.intro.duration}s | recording ${t.clipStart}–${t.clipEnd}s (media ${t.mediaStart}–${t.mediaEnd}s) | ` +
            (recap && t.recap ? `recap/${recap.name} ${t.recap.start}–${round(t.recap.start + t.recap.duration)}s | ` : 'no recap | ') +
            `outro/${outro.name} ${t.outro.start}–${t.total}s`,
    )
    if (t.transitions.length) {
        log(`  hand-off card(s) at ${t.transitions.map((tr) => `${tr.at}s`).join(', ')}`)
    }
    log(`  frame ${t.frame.width}x${t.frame.height}, ${t.callouts.length} callout(s), ${result.zooms.length} zoom(s)`)
    for (const w of result.warnings) {
        log(`  warning: ${w}`)
    }

    return result
}

function applyOptions(spec: VideoSpec, o: BuildOptions): void {
    if (o.title !== undefined) spec.title = o.title
    if (o.subtitle !== undefined) spec.subtitle = o.subtitle
    if (o.template !== undefined) spec.template = o.template
    if (o.sections && Object.keys(o.sections).length) spec.sections = { ...spec.sections, ...o.sections }
    if (o.trimStart !== undefined) spec.trim = { ...spec.trim, start: o.trimStart }
    if (o.trimEnd !== undefined) spec.trim = { ...spec.trim, end: o.trimEnd }
    if (o.music !== undefined) spec.music = o.music
}

/** Where the footage should start: just before the first logged glide (after the login). */
export function suggestTrimStart(markers: Markers): number {
    const candidates = [
        ...(markers.clicks ?? []).map((c) => (c.move ?? c.at) - 0.5),
        ...markers.markers.map((m) => m.at - 0.8),
    ]
    if (!candidates.length) {
        return 0
    }
    return Math.max(0, round(Math.min(...candidates)))
}

function humanize(slug: string): string {
    const words = slug.replace(/[-_]+/g, ' ').trim()
    return words.charAt(0).toUpperCase() + words.slice(1)
}

/** video.json in a stable, readable key order, without `$schema` (re-added on write). */
function withoutSchema(spec: VideoSpec): VideoSpec {
    const { $schema: _ignored, ...rest } = spec as VideoSpec & { $schema?: string }
    const order: (keyof VideoSpec)[] = ['title', 'subtitle', 'template', 'sections', 'recapTitle', 'brand', 'trim', 'music', 'callouts', 'zooms']
    const known = order.filter((k) => rest[k] !== undefined).map((k) => [k, rest[k]])
    const others = Object.entries(rest).filter(([k]) => !order.includes(k as keyof VideoSpec))

    return Object.fromEntries([...known, ...others]) as VideoSpec
}

const LOGO_TYPES = ['.svg', '.png', '.webp']

/**
 * brand.logo (video.json over demo.config.json) → assets/brand-logo.<ext>. Returns its
 * path for the composition, or '' when the brand is drawn as a text wordmark.
 */
function copyLogo(spec: VideoSpec, config: LoadedConfig, assets: string, log: (l: string) => void): string {
    const file = spec.brand?.logo !== undefined ? spec.brand.logo : config.brand.logo
    if (!file) {
        return ''
    }
    const source = fromRoot(config, file)
    const ext = extname(source).toLowerCase()
    if (!LOGO_TYPES.includes(ext)) {
        throw new ReelkitError(`brand.logo must be ${LOGO_TYPES.join(', ')} (SVG stays sharpest), got ${source}`)
    }
    if (!existsSync(source)) {
        throw new ReelkitError(`brand logo not found: ${source} — fix brand.logo, or set it to null for the text wordmark`)
    }
    const height = ext === '.png' ? pngHeight(source) : null
    if (height !== null && height < MIN_LOGO_HEIGHT) {
        log(`  warning: ${basename(source)} is ${height}px tall — under ${MIN_LOGO_HEIGHT}px it looks soft on the cards; use an SVG or a taller PNG`)
    }
    const name = `brand-logo${ext}`
    copyIfChanged(source, resolve(assets, name))

    return `assets/${name}`
}

/** The biggest wordmark (168px tall on the outro) at 2x, so the logo stays crisp. */
const MIN_LOGO_HEIGHT = 340

function pngHeight(path: string): number | null {
    const header = readFileSync(path).subarray(0, 24)
    return header.toString('ascii', 12, 16) === 'IHDR' ? header.readUInt32BE(20) : null
}

function copyIfChanged(from: string, to: string): void {
    if (existsSync(to)) {
        const a = statSync(from)
        const b = statSync(to)
        if (a.size === b.size && b.mtimeMs >= a.mtimeMs) {
            return
        }
    }
    copyFileSync(from, to)
}

/** Extracts the recording's audio track (OpenScreen voiceover), if any. */
function extractNarration(source: string, target: string, t: Timeline, log: (l: string) => void): boolean {
    const probe = spawnSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', source],
        { encoding: 'utf8' },
    )
    if (probe.status !== 0 || probe.stdout.trim() === '') {
        return false
    }
    if (t.transitions.length) {
        log('  warning: narration is not split at hand-offs; it drifts after the first transition card')
    }
    if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
        return true
    }
    const extract = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', source, '-vn', '-c:a', 'aac', '-b:a', '160k', target], {
        stdio: 'inherit',
    })
    if (extract.status !== 0) {
        log('  warning: ffmpeg could not extract the audio track; continuing without narration')
        return false
    }
    log('  audio track found — narration extracted to assets/narration.m4a')
    return true
}

/**
 * Pre-renders the music bed with ffmpeg (trim, loudnorm, fades) so the
 * composition plays it at unity. Cached: re-rendered only when the source,
 * length or loudness changes.
 */
function renderMusicBed(
    spec: VideoSpec,
    config: LoadedConfig,
    t: Timeline,
    target: string,
    underNarration: boolean,
    log: (l: string) => void,
): boolean {
    const choice = spec.music ?? null
    if (choice === false) {
        return false
    }
    const file = typeof choice === 'string' ? choice : config.music.file
    if (!file) {
        log('  no music: set music.file in demo.config.json (or "music" in video.json)')
        return false
    }
    const source = fromRoot(config, file)
    if (!existsSync(source)) {
        throw new ReelkitError(`music not found: ${source} — fix music.file / video.json "music", or set "music": false`)
    }
    const lufs = underNarration ? config.music.lufsUnderNarration : config.music.lufs
    const fadeOut = 3
    const key = JSON.stringify({ source, mtime: statSync(source).mtimeMs, total: t.total, lufs })
    const stamp = `${target}.key`
    if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key) {
        return true
    }
    const filters = [
        `atrim=0:${t.total}`,
        `loudnorm=I=${lufs}:TP=-3:LRA=9`,
        'afade=t=in:st=0:d=0.8',
        `afade=t=out:st=${round(t.total - fadeOut)}:d=${fadeOut}`,
    ].join(',')
    const render = spawnSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-i', source, '-vn', '-af', filters, '-c:a', 'aac', '-b:a', '160k', target],
        { stdio: 'inherit' },
    )
    if (render.status !== 0) {
        throw new ReelkitError('ffmpeg could not render the music bed')
    }
    writeFileSync(stamp, key)
    log(`  music bed: ${basename(source)} → assets/music.m4a (${lufs} LUFS, fades 0.8s/${fadeOut}s)`)
    return true
}
