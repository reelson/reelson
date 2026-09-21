/**
 * File-level plumbing shared by build, check and the CLI: where a demo lives,
 * reading markers.json / video.json (validated), finding a template.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromRoot, type LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { loadSchema, validate } from '../../reelkit-record/scripts/validate.ts'
import { TIMING_DEFAULTS, type Markers, type Timing, type VideoSpec } from './timeline.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
export const KIT_ROOT = resolve(HERE, '../../..')
export const VIDEO_SCHEMA_PATH = resolve(HERE, '../schemas/video.schema.json')
export const BUILTIN_TEMPLATES = resolve(HERE, '../templates')

/** A user-facing failure: printed without a stack trace. */
export class ReelkitError extends Error {}

/** `slug`, a demo directory, or a file inside one → the demo directory. */
export function resolveDemoDir(arg: string, config: LoadedConfig): string {
    const asPath = resolve(arg)
    if (existsSync(asPath)) {
        return arg.endsWith('.ts') || arg.endsWith('.json') ? dirname(asPath) : asPath
    }
    const inVideos = resolve(fromRoot(config, config.videosDir), arg)
    if (existsSync(inVideos)) {
        return inVideos
    }
    throw new ReelkitError(`no demo "${arg}" (looked for ${asPath} and ${inVideos})`)
}

/** Every demo folder under videosDir that has a video.json (for `render --all`). */
export function listDemos(config: LoadedConfig): string[] {
    const dir = fromRoot(config, config.videosDir)
    if (!existsSync(dir)) {
        return []
    }
    const found = spawnSync('find', [dir, '-mindepth', '2', '-maxdepth', '2', '-name', 'video.json'], {
        encoding: 'utf8',
    })

    return found.stdout
        .split('\n')
        .filter(Boolean)
        .map((p) => dirname(p))
        .filter((d) => !basename(d).startsWith('_'))
        .sort()
}

export function readMarkers(demoDir: string): Markers {
    const path = resolve(demoDir, 'markers.json')
    if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf8')) as Markers
    }
    const recording = resolve(demoDir, 'recording.mp4')
    if (!existsSync(recording)) {
        throw new ReelkitError(`${demoDir} has no recording.mp4 — run \`reelkit record\` first (or export one from OpenScreen)`)
    }

    return probeRecording(recording)
}

export function readVideoSpec(demoDir: string): VideoSpec | null {
    const path = resolve(demoDir, 'video.json')
    if (!existsSync(path)) {
        return null
    }
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
        throw new ReelkitError(`${path} is not valid JSON: ${(error as Error).message}`)
    }
    const problems = validate(raw, loadSchema(VIDEO_SCHEMA_PATH))
    if (problems.length) {
        throw new ReelkitError(`${path} is invalid:\n  ${problems.join('\n  ')}`)
    }

    return raw as VideoSpec
}

/**
 * `$schema` for a new video.json: through the project's .claude/skills link
 * when there is one (portable), else straight to the kit.
 */
export function videoSchemaRef(demoDir: string, config: LoadedConfig): string {
    const viaProject = resolve(config.root, '.claude/skills/reelkit-compose/schemas/video.schema.json')
    const target =
        existsSync(viaProject) && realpathSync(viaProject) === realpathSync(VIDEO_SCHEMA_PATH)
            ? viaProject
            : VIDEO_SCHEMA_PATH

    return relative(demoDir, target)
}

export interface Template {
    name: string
    dir: string
    timing: Timing
}

/**
 * Template lookup: a project-local <videosDir>/_templates/<name>/ wins over the
 * kit's templates/<name>/, so a project can fork a template without touching the kit.
 */
export function findTemplate(name: string, config: LoadedConfig): Template {
    const candidates = [
        resolve(fromRoot(config, config.videosDir), '_templates', name),
        resolve(BUILTIN_TEMPLATES, name),
    ]
    const dir = candidates.find((d) => existsSync(resolve(d, 'index.html')))
    if (!dir) {
        throw new ReelkitError(`template "${name}" not found; looked in:\n  ${candidates.join('\n  ')}`)
    }
    const meta = resolve(dir, 'template.json')
    const overrides = existsSync(meta) ? ((JSON.parse(readFileSync(meta, 'utf8')).timing ?? {}) as Partial<Timing>) : {}
    const unknown = Object.keys(overrides).filter((k) => !(k in TIMING_DEFAULTS))
    if (unknown.length) {
        throw new ReelkitError(`${meta}: unknown timing key(s) ${unknown.join(', ')} (known: ${Object.keys(TIMING_DEFAULTS).join(', ')})`)
    }

    return { name, dir, timing: { ...TIMING_DEFAULTS, ...overrides } }
}

function probeRecording(path: string): Markers {
    const probe = spawnSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path],
        { encoding: 'utf8' },
    )
    if (probe.status !== 0) {
        throw new ReelkitError('ffprobe failed — install ffmpeg (brew install ffmpeg)')
    }
    const info = JSON.parse(probe.stdout)

    return {
        durationSeconds: Number.parseFloat(info.format.duration),
        viewport: { width: info.streams[0].width, height: info.streams[0].height },
        markers: [],
    }
}
