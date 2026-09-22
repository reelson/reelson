/**
 * File-level plumbing shared by build, check and the CLI: where a demo lives,
 * reading markers.json / video.json (validated), finding a template and its sections.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromRoot, type LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { closest, loadSchema, validate } from '../../reelkit-record/scripts/validate.ts'
import type { SectionSource } from './composition.ts'
import {
    SECTION_TIMING,
    SLOTS,
    STAGE_TIMING,
    type Markers,
    type SectionChoice,
    type Slot,
    type StageTiming,
    type Timing,
    type VideoSpec,
} from './timeline.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
export const KIT_ROOT = resolve(HERE, '../../..')
export const VIDEO_SCHEMA_PATH = resolve(HERE, '../schemas/video.schema.json')
export const BUILTIN_TEMPLATES = resolve(HERE, '../templates')
export const BUILTIN_SECTIONS = resolve(HERE, '../sections')

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

    return validateVideoSpec(raw, path)
}

/** `raw` checked against the video.json schema; `where` names it in the error. */
export function validateVideoSpec(raw: unknown, where: string): VideoSpec {
    const problems = validate(raw, loadSchema(VIDEO_SCHEMA_PATH))
    if (problems.length) {
        throw new ReelkitError(`${where} is invalid:\n  ${problems.join('\n  ')}`)
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
    description: string
    /** Sections used when neither demo.config.json nor video.json picks one. */
    sections: Record<Slot, string>
    stage: StageTiming
}

export interface Section {
    slot: Slot
    name: string
    dir: string
    description: string
    timing: Record<string, number>
    /** Has its own portrait layout (`#root.portrait …` rules); otherwise portrait zooms its 16:9 card. */
    portrait: boolean
}

/** A template plus the section chosen for each slot: everything the build draws with. */
export interface Design {
    template: Template
    /** recap is null when the video has none. */
    sections: { intro: Section; recap: Section | null; outro: Section }
    timing: Timing
}

/** The recap slot accepts this instead of a section name. */
export const NO_SECTION = 'none'

const templateDirs = (config: LoadedConfig) => [
    resolve(fromRoot(config, config.videosDir), '_templates'),
    BUILTIN_TEMPLATES,
]
const sectionDirs = (config: LoadedConfig, slot: Slot) => [
    resolve(fromRoot(config, config.videosDir), '_sections', slot),
    resolve(BUILTIN_SECTIONS, slot),
]

/**
 * Template lookup: a project-local <videosDir>/_templates/<name>/ wins over the
 * kit's templates/<name>/, so a project can fork a template without touching the kit.
 */
export function findTemplate(name: string, config: LoadedConfig): Template {
    const candidates = templateDirs(config).map((d) => resolve(d, name))
    const dir = candidates.find((d) => existsSync(resolve(d, 'stage.html')))
    if (!dir) {
        throw new ReelkitError(`template "${name}" not found${hint(name, available(templateDirs(config), 'stage.html'))}; looked in:\n  ${candidates.join('\n  ')}`)
    }
    const metaPath = resolve(dir, 'template.json')
    const meta = readJson(metaPath) as { description?: string; sections?: SectionChoice; timing?: Partial<StageTiming> }
    unknownKeys(metaPath, meta, ['description', 'sections', 'timing'])
    unknownKeys(`${metaPath} timing`, meta.timing ?? {}, Object.keys(STAGE_TIMING))
    unknownKeys(`${metaPath} sections`, meta.sections ?? {}, SLOTS)
    const sections = { intro: 'poster', recap: 'steps', outro: 'wordmark', ...meta.sections }

    return { name, dir, description: meta.description ?? '', sections, stage: { ...STAGE_TIMING, ...meta.timing } }
}

/** Section lookup: <videosDir>/_sections/<slot>/<name>/ first, then the kit's sections/<slot>/<name>/. */
export function findSection(slot: Slot, name: string, config: LoadedConfig): Section {
    const candidates = sectionDirs(config, slot).map((d) => resolve(d, name))
    const dir = candidates.find((d) => existsSync(resolve(d, 'section.html')))
    if (!dir) {
        const names = [...available(sectionDirs(config, slot)), ...(slot === 'recap' ? [NO_SECTION] : [])]
        throw new ReelkitError(
            `${slot} section "${name}" not found${hint(name, names)} (available: ${names.join(', ')}); looked in:\n  ${candidates.join('\n  ')}`,
        )
    }
    const metaPath = resolve(dir, 'section.json')
    const meta = readJson(metaPath) as { description?: string; timing?: Record<string, number>; portrait?: boolean }
    unknownKeys(metaPath, meta, ['description', 'timing', 'portrait'])
    unknownKeys(`${metaPath} timing`, meta.timing ?? {}, Object.keys(SECTION_TIMING[slot]))

    return { slot, name, dir, description: meta.description ?? '', timing: { ...SECTION_TIMING[slot], ...meta.timing }, portrait: meta.portrait === true }
}

/**
 * The template plus one section per slot. Later choices win: the template's
 * defaults, then each entry of `choices` in order (demo.config.json, video.json).
 */
export function resolveDesign(templateName: string, choices: (SectionChoice | undefined)[], config: LoadedConfig): Design {
    const template = findTemplate(templateName, config)
    const picked = Object.assign({}, template.sections, ...choices.filter(Boolean)) as Record<Slot, string>
    for (const slot of ['intro', 'outro'] as const) {
        if (picked[slot] === NO_SECTION) {
            throw new ReelkitError(
                `the ${slot} can't be "none": every video opens on a poster and ends on the brand (style guide rules 1–2)`,
            )
        }
    }
    const intro = findSection('intro', picked.intro, config)
    const recap = picked.recap === NO_SECTION ? null : findSection('recap', picked.recap, config)
    const outro = findSection('outro', picked.outro, config)

    return {
        template,
        sections: { intro, recap, outro },
        timing: {
            stage: template.stage,
            intro: intro.timing as Timing['intro'],
            recap: recap ? (recap.timing as NonNullable<Timing['recap']>) : null,
            outro: outro.timing as Timing['outro'],
        },
    }
}

/** A section's files for the composer; its assets/ (if any) belong at `assets` inside video/. */
export function readSection(section: Section): SectionSource {
    const read = (file: string): string => {
        const path = resolve(section.dir, file)
        return existsSync(path) ? readFileSync(path, 'utf8') : ''
    }

    return {
        slot: section.slot,
        name: section.name,
        html: read('section.html'),
        css: read('section.css'),
        js: read('section.js'),
        assets: existsSync(resolve(section.dir, 'assets')) ? `assets/sections/${section.slot}-${section.name}` : '',
        portrait: section.portrait,
    }
}

/** Every template and section a project can use (project-local ones first), for `reelkit templates`. */
export function catalog(config: LoadedConfig): {
    templates: { name: string; description: string; local: boolean }[]
    sections: Record<Slot, { name: string; description: string; local: boolean }[]>
} {
    const templates = available(templateDirs(config), 'stage.html').map((name) => {
        const { dir, description } = findTemplate(name, config)
        return { name, description, local: dir !== resolve(BUILTIN_TEMPLATES, name) }
    })
    const sections = Object.fromEntries(
        SLOTS.map((slot) => {
            const found = available(sectionDirs(config, slot)).map((name) => {
                const { dir, description } = findSection(slot, name, config)
                return { name, description, local: dir !== resolve(BUILTIN_SECTIONS, slot, name) }
            })
            if (slot === 'recap') {
                found.push({ name: NO_SECTION, description: 'No recap: the outro follows the recording.', local: false })
            }
            return [slot, found]
        }),
    ) as Record<Slot, { name: string; description: string; local: boolean }[]>

    return { templates, sections }
}

/** Folder names under `dirs` that hold `marker` (default section.html), deduplicated and sorted. */
function available(dirs: string[], marker = 'section.html'): string[] {
    const names = dirs.flatMap((d) =>
        existsSync(d)
            ? readdirSync(d, { withFileTypes: true })
                  .filter((e) => e.isDirectory() && existsSync(resolve(d, e.name, marker)))
                  .map((e) => e.name)
            : [],
    )
    return [...new Set(names)].sort()
}

function hint(name: string, names: string[]): string {
    const match = closest(name, names)
    return match ? ` — did you mean "${match}"?` : ''
}

function readJson(path: string): unknown {
    if (!existsSync(path)) {
        return {}
    }
    try {
        return JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
        throw new ReelkitError(`${path} is not valid JSON: ${(error as Error).message}`)
    }
}

function unknownKeys(where: string, value: object, known: readonly string[]): void {
    const unknown = Object.keys(value).filter((k) => !known.includes(k) && !k.startsWith('$'))
    if (unknown.length) {
        throw new ReelkitError(
            `${where}: unknown key(s) ${unknown.map((k) => `"${k}"${hint(k, [...known])}`).join(', ')} (known: ${known.join(', ')})`,
        )
    }
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
