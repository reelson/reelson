#!/usr/bin/env node
/**
 * reelkit — scripted Playwright walkthroughs → branded HyperFrames demo videos.
 * Run `reelkit help` for the commands. Project settings come from the nearest
 * demo.config.json (walking up from the working directory).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { CONFIG_SCHEMA_PATH, ConfigError, fromRoot, loadConfig, type LoadedConfig } from '../skills/reelkit-record/scripts/config.ts'
import { doctor } from '../skills/reelkit-record/scripts/doctor.ts'
import { build, plan, type BuildOptions } from '../skills/reelkit-compose/scripts/build.ts'
import { captionCues, toSrt, toVtt } from '../skills/reelkit-compose/scripts/captions.ts'
import { check } from '../skills/reelkit-compose/scripts/check.ts'
import { studio } from '../skills/reelkit-compose/scripts/studio.ts'
import { fetchLines, spokenTexts, voiceSettings } from '../skills/reelkit-compose/scripts/voice.ts'
import { TAKES, verify } from '../skills/reelkit-compose/scripts/verify.ts'
import { DRAFT_FLAGS, FPS, hyperframes, hyperframesOn, RENDER_FLAGS, renderIfChanged } from '../skills/reelkit-compose/scripts/hyperframes.ts'
import { catalog, KIT_ROOT, listDemos, ReelkitError, resolveDemoDir } from '../skills/reelkit-compose/scripts/project.ts'
import { SLOTS, type SectionChoice, type Timeline } from '../skills/reelkit-compose/scripts/timeline.ts'

const HELP = `reelkit — scripted walkthroughs → branded demo videos

Usage: reelkit <command> [options]

  init                          create demo.config.json in this directory
  doctor                        check the tools and that the cursor layer lines up here
  new <slug> [--url <origin>]   start <videosDir>/<slug>/scenario.ts
  record <slug> [--headed] [--mobile | --square | --all-takes]
                                run the scenario → recording.mp4 + markers.json; --mobile: on a
                                phone (record.mobile.device) → recording.mobile.mp4, for --portrait;
                                --square: in a square browser (record.square.viewport) →
                                recording.square.mp4, for --square; --all-takes: all three
  build <slug> [options]        video.json → video/ (HyperFrames project)
      --title, --subtitle, --template <name>
      --intro <name>, --recap <name|none>, --outro <name>
      --trim-start <s|auto>, --trim-end <s>, --music <file> | --no-music
  voice <slug>                  speak the voice-over lines not spoken yet (video.json "voice": true;
                                OpenAI text-to-speech, needs OPENAI_API_KEY; cached in <demo>/voice/)
  check <slug> [--no-hyperframes]   schemas, zoom timing, hyperframes lint
  verify <slug...> | --all [--update]
                                re-record every take (desktop, phone, square) headless into a
                                scratch folder and check video.json still fits (markers, click
                                numbers, zooms); --update keeps them
  snapshot <slug> --at 1,3.5,8 [--portrait | --square]
                                PNG frames into video/snapshots/ (…/portrait/, …/square/)
  studio <slug> [--port 4800] [--no-open]
                                preview + edit on a timeline of every layer (saves video.json)
  preview <slug>                open the HyperFrames studio (raw composition)
  templates                     list templates and intro/recap/outro sections
  render <slug...> | --all [--gif] [--square] [--portrait] [--all-formats] [--only <format>]
         [--draft] [--force] [--no-build]
                                build + render video/renders/<slug>.mp4 + .srt/.vtt captions;
                                skips a video unchanged since its last render (--force);
                                --gif, --square (1080², the square take filling the frame),
                                --portrait (1080x1920 phone layout) add versions, --all-formats
                                both (also video.json "formats": ["portrait", "square"]);
                                --only landscape|portrait|square renders just that version;
                                --draft: a 2x faster 15 fps look → renders/<slug>.draft.mp4

<slug> is a folder under videosDir, or a path to a demo folder or its scenario.ts.
Docs: ${KIT_ROOT}/README.md`

const [command, ...rest] = process.argv.slice(2)

try {
    process.exitCode = await run(command, rest)
} catch (error) {
    if (error instanceof ReelkitError || error instanceof ConfigError) {
        console.error(`reelkit: ${error.message}`)
        process.exitCode = 1
    } else {
        throw error
    }
}

async function run(cmd: string | undefined, argv: string[]): Promise<number> {
    switch (cmd) {
        case undefined:
        case 'help':
        case '--help':
        case '-h':
            console.log(HELP)
            return 0
        case '--version':
        case '-v':
            console.log(JSON.parse(readFileSync(resolve(KIT_ROOT, 'package.json'), 'utf8')).version)
            return 0
        case 'init':
            return init()
        case 'doctor':
            return (await doctor()) ? 1 : 0
        case 'new':
            return create(argv)
        case 'record':
            return record(argv)
        case 'build':
            return buildCommand(argv)
        case 'voice':
            return voiceCommand(argv)
        case 'check':
            return checkCommand(argv)
        case 'verify':
            return verifyCommand(argv)
        case 'snapshot':
            return snapshot(argv)
        case 'studio':
            return studioCommand(argv)
        case 'preview':
            return preview(argv)
        case 'render':
            return await render(argv)
        case 'templates':
            return templates()
        default:
            console.error(`reelkit: unknown command "${cmd}"\n\n${HELP}`)
            return 2
    }
}

function config(): LoadedConfig {
    const loaded = loadConfig(process.cwd())
    if (!loaded.path) {
        console.warn('reelkit: no demo.config.json found — using defaults (run `reelkit init`)')
    }
    return loaded
}

function one(positionals: string[], usage: string): string {
    if (positionals.length !== 1) {
        throw new ReelkitError(`usage: reelkit ${usage}`)
    }
    return positionals[0]
}

function init(): number {
    const target = resolve(process.cwd(), 'demo.config.json')
    if (existsSync(target)) {
        throw new ReelkitError(`${target} already exists`)
    }
    const example = JSON.parse(readFileSync(resolve(KIT_ROOT, 'demo.config.example.json'), 'utf8'))
    delete example.$comment
    delete example.$schema
    const viaProject = resolve(process.cwd(), '.claude/skills/reelkit-record/schemas/demo.config.schema.json')
    const schema = existsSync(viaProject) ? viaProject : CONFIG_SCHEMA_PATH
    let schemaRef = relative(process.cwd(), schema)
    if (!/^\.{1,2}\//.test(schemaRef) && !schemaRef.startsWith('/')) {
        schemaRef = `./${schemaRef}`
    }
    writeFileSync(target, JSON.stringify({ $schema: schemaRef, ...example }, null, 4) + '\n')
    console.log(`created ${target} — set brand, language and music`)
    return 0
}

function create(argv: string[]): number {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { url: { type: 'string' } },
    })
    const slug = one(positionals, 'new <slug> [--url https://app.test]')
    const cfg = config()
    const dir = resolve(fromRoot(cfg, cfg.videosDir), slug)
    const scenario = resolve(dir, 'scenario.ts')
    if (existsSync(scenario)) {
        throw new ReelkitError(`${scenario} already exists`)
    }
    mkdirSync(dir, { recursive: true })
    const viaProject = resolve(cfg.root, '.claude/skills/reelkit-record/scripts/scenario.ts')
    const typesFile = existsSync(viaProject) ? viaProject : resolve(KIT_ROOT, 'skills/reelkit-record/scripts/scenario.ts')
    let importPath = relative(dir, typesFile)
    if (!/^\.{1,2}\//.test(importPath)) {
        importPath = `./${importPath}`
    }
    writeFileSync(
        scenario,
        `/**
 * Demo: ${slug}
 *
 *   reelkit record ${slug}      (--headed to watch)
 *   reelkit build ${slug} --title "..."
 *
 * Call demo.marker('Step text') right after the UI reaches each state worth a
 * callout (≤ 10); each becomes a callout in video.json, shown from the start of
 * that step (the first glide/click after the previous marker).
 */
import type { Scenario } from '${importPath}'

export default {
    name: '${slug}',
    baseURL: '${values.url ?? 'https://app.test'}',
    async run(demo) {
        // Log in with the project's helpers here (it is trimmed away later), then:
        await demo.goto('/')
        demo.marker('First step')

        // Hold so the last callout can be read before the recording ends.
        await demo.pause(2000)
    },
} satisfies Scenario
`,
    )
    console.log(`created ${scenario}`)
    return 0
}

function record(argv: string[]): number {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            headed: { type: 'boolean' },
            mobile: { type: 'boolean' },
            square: { type: 'boolean' },
            'all-takes': { type: 'boolean' },
            out: { type: 'string' },
        },
    })
    if ([values.mobile, values.square, values['all-takes']].filter(Boolean).length > 1) {
        throw new ReelkitError('record: --mobile, --square or --all-takes')
    }
    const target = one(positionals, 'record <slug|scenario.ts> [--headed] [--mobile | --square | --all-takes]')
    const scenario = target.endsWith('.ts') ? resolve(target) : resolve(resolveDemoDir(target, config()), 'scenario.ts')
    if (!existsSync(scenario)) {
        throw new ReelkitError(`no scenario at ${scenario} — create one with \`reelkit new\``)
    }
    const script = resolve(KIT_ROOT, 'skills/reelkit-record/scripts/record.ts')
    const takes = values['all-takes']
        ? TAKES.map((take) => take.flags)
        : [[...(values.mobile ? ['--mobile'] : []), ...(values.square ? ['--square'] : [])]]
    for (const flags of takes) {
        const args = [script, scenario, ...(values.headed ? ['--headed'] : []), ...flags, ...(values.out ? ['--out', values.out] : [])]
        const status = spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1
        if (status !== 0) {
            return status
        }
    }
    return 0
}

function buildOptions(argv: string[]): { options: BuildOptions; positionals: string[] } {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            template: { type: 'string' },
            intro: { type: 'string' },
            recap: { type: 'string' },
            outro: { type: 'string' },
            'trim-start': { type: 'string' },
            'trim-end': { type: 'string' },
            music: { type: 'string' },
            'no-music': { type: 'boolean' },
        },
    })
    const seconds = (v: string | undefined, name: string): number | undefined => {
        if (v === undefined) {
            return undefined
        }
        const n = Number.parseFloat(v)
        if (!Number.isFinite(n) || n < 0) {
            throw new ReelkitError(`--${name} expects seconds, got "${v}"`)
        }
        return n
    }
    const trimPoint = (v: string | undefined, name: string) => (v === 'auto' ? 'auto' : seconds(v, name))
    const cfg = config()
    const options: BuildOptions = {
        title: values.title,
        subtitle: values.subtitle,
        template: values.template,
        sections: Object.fromEntries(SLOTS.filter((slot) => values[slot] !== undefined).map((slot) => [slot, values[slot]])) as SectionChoice,
        trimStart: trimPoint(values['trim-start'], 'trim-start'),
        trimEnd: seconds(values['trim-end'], 'trim-end'),
        // video.json stores the path relative to the project root.
        music: values['no-music'] ? false : values.music ? relative(cfg.root, resolve(values.music)) : undefined,
    }

    return { options, positionals }
}

async function buildCommand(argv: string[]): Promise<number> {
    const { options, positionals } = buildOptions(argv)
    const cfg = config()
    const dir = resolveDemoDir(one(positionals, 'build <slug> [options]'), cfg)
    build(dir, cfg, options)
    // Voice-over lines not spoken yet: fetch them, then build again to mix them in.
    if (await speak(dir, cfg)) {
        build(dir, cfg, { log: () => {} })
    }
    return 0
}

/**
 * Fetches the voice-over lines this demo is missing (see voice.ts); how many it fetched.
 * Unless `strict`, a failure (no OPENAI_API_KEY, offline) is a warning: the video is built
 * with the lines it has.
 */
async function speak(dir: string, cfg: LoadedConfig, strict = false): Promise<number> {
    const { spec, timeline } = plan(dir, cfg)
    const settings = voiceSettings(spec, cfg)
    if (!settings) {
        return 0
    }
    try {
        return await fetchLines(spokenTexts(spec, timeline.callouts), settings, resolve(dir, 'voice'), console.log)
    } catch (error) {
        if (strict || !(error instanceof ReelkitError || error instanceof TypeError)) {
            throw error
        }
        console.warn(`reelkit: ${error.message} — building without those lines`)
        return 0
    }
}

async function voiceCommand(argv: string[]): Promise<number> {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true })
    const cfg = config()
    const dir = resolveDemoDir(one(positionals, 'voice <slug>'), cfg)
    if (!voiceSettings(plan(dir, cfg).spec, cfg)) {
        throw new ReelkitError(`${basename(dir)} has no voice-over — set "voice": true in its video.json`)
    }
    const fetched = await speak(dir, cfg, true)
    console.log(fetched ? `spoke ${fetched} line(s) into ${resolve(dir, 'voice')}` : 'every line is already spoken')
    return 0
}

function verifyCommand(argv: string[]): number {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { all: { type: 'boolean' }, update: { type: 'boolean' } },
    })
    const cfg = config()
    const dirs = values.all ? listDemos(cfg) : positionals.map((p) => resolveDemoDir(p, cfg))
    if (!dirs.length) {
        throw new ReelkitError(values.all ? 'no demos with a video.json under videosDir' : 'usage: reelkit verify <slug...> | --all [--update]')
    }
    let failing = 0
    for (const dir of dirs) {
        if (verify(dir, cfg, { update: values.update })) {
            failing++
        }
    }
    console.log(failing ? `\n${failing} of ${dirs.length} demo(s) need attention` : `\nall ${dirs.length} demo(s) still record and fit their video.json`)
    return failing ? 1 : 0
}

function checkCommand(argv: string[]): number {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { 'no-hyperframes': { type: 'boolean' } },
    })
    const cfg = config()
    const problems = check(resolveDemoDir(one(positionals, 'check <slug> [--no-hyperframes]'), cfg), cfg, {
        hyperframes: !values['no-hyperframes'],
    })
    return problems ? 1 : 0
}

function templates(): number {
    const cfg = config()
    const { templates: found, sections } = catalog(cfg)
    const row = (name: string, description: string, local: boolean) =>
        `  ${(name + (local ? ' (project)' : '')).padEnd(22)} ${description}`
    console.log('Templates (the stage: background, frame, callouts) — "template":')
    found.forEach((t) => console.log(row(t.name, t.description, t.local)))
    for (const slot of SLOTS) {
        console.log(`\nSections — "sections": { "${slot}": … }`)
        sections[slot].forEach((s) => console.log(row(s.name, s.description, s.local)))
    }
    console.log(`\nProject: template "${cfg.template}", sections ${JSON.stringify(cfg.sections)} (video.json overrides both)`)
    return 0
}

function builtVideoDir(slug: string): string {
    const dir = resolve(resolveDemoDir(slug, config()), 'video')
    if (!existsSync(resolve(dir, 'index.html'))) {
        throw new ReelkitError(`${dir} is not built — run \`reelkit build ${slug}\``)
    }
    return dir
}

function snapshot(argv: string[]): number {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { at: { type: 'string' }, portrait: { type: 'boolean' }, square: { type: 'boolean' } },
    })
    const slug = one(positionals, 'snapshot <slug> --at 1,3.5,8 [--portrait | --square]')
    const videoDir = builtVideoDir(slug)
    const format = values.portrait ? 'portrait' : values.square ? 'square' : null
    const composition = format ? `${format}.html` : 'index.html'
    if (!existsSync(resolve(videoDir, composition))) {
        throw new ReelkitError(`no ${composition} — ${format === 'square' ? `record the square take (\`reelkit record ${slug} --square\`) and ` : ''}run \`reelkit build ${slug}\``)
    }
    let at = values.at
    if (at) {
        // There is no frame at the very end (it would come out blank): clamp to the last one.
        const html = readFileSync(resolve(videoDir, composition), 'utf8')
        const total = Number.parseFloat(/data-composition-id="main"[^>]*data-duration="([\d.]+)"/.exec(html)?.[1] ?? 'NaN')
        const last = Math.floor(total * FPS - 1e-6) / FPS
        at = at
            .split(',')
            .map((v) => {
                const t = Number.parseFloat(v)
                if (!Number.isFinite(t) || t < 0) {
                    throw new ReelkitError(`--at expects seconds, got "${v}"`)
                }
                if (t <= last) {
                    return v.trim()
                }
                console.log(`snapshot: ${t}s is past the last frame — using ${last.toFixed(3)}s`)
                return last.toFixed(3)
            })
            .join(',')
    }
    const out = resolve(videoDir, 'snapshots', ...(format ? [format] : []))
    return hyperframesOn(videoDir, composition, ['snapshot', '.', '-o', out, ...(at ? ['--at', at] : [])])
}

async function studioCommand(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { port: { type: 'string' }, 'no-open': { type: 'boolean' } },
    })
    const cfg = config()
    const dir = resolveDemoDir(one(positionals, 'studio <slug> [--port 4800] [--no-open]'), cfg)
    const port = values.port === undefined ? undefined : Number.parseInt(values.port, 10)
    if (port !== undefined && !(port > 0 && port < 65536)) {
        throw new ReelkitError(`--port expects a port number, got "${values.port}"`)
    }
    const url = await studio(dir, cfg, { port })
    console.log(`studio for ${basename(dir)}: ${url}  (watching video.json, markers.json, templates, sections — Ctrl+C to stop)`)
    if (!values['no-open']) {
        spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' })
    }
    // The server keeps the process alive; the exit code is set when it is stopped.
    return 0
}

function preview(argv: string[]): number {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true })
    return hyperframes(['preview', '.'], builtVideoDir(one(positionals, 'preview <slug>')))
}

async function render(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            all: { type: 'boolean' },
            gif: { type: 'boolean' },
            square: { type: 'boolean' },
            portrait: { type: 'boolean' },
            'all-formats': { type: 'boolean' },
            only: { type: 'string' },
            draft: { type: 'boolean' },
            force: { type: 'boolean' },
            'no-build': { type: 'boolean' },
        },
    })
    if (values.only && !['landscape', 'portrait', 'square'].includes(values.only)) {
        throw new ReelkitError(`--only expects landscape, portrait or square, got "${values.only}"`)
    }
    const cfg = config()
    const dirs = values.all ? listDemos(cfg) : positionals.map((p) => resolveDemoDir(p, cfg))
    if (!dirs.length) {
        throw new ReelkitError(values.all ? 'no demos with a video.json under videosDir' : 'usage: reelkit render <slug...> | --all')
    }

    let failures = 0
    for (const dir of dirs) {
        const slug = basename(dir)
        if (!values['no-build']) {
            await speak(dir, cfg)
        }
        const result = values['no-build'] ? { ...plan(dir, cfg), versions: null } : build(dir, cfg)
        const videoDir = resolve(dir, 'video')
        mkdirSync(resolve(videoDir, 'renders'), { recursive: true })
        // Captions: the same words as the cards, timed to each video (the phone and square
        // takes have their own timing).
        const captions = (timeline: Timeline, name: string) => {
            const cues = captionCues(timeline, result.spec.title, result.spec.subtitle)
            writeFileSync(resolve(videoDir, `renders/${name}.srt`), toSrt(cues))
            writeFileSync(resolve(videoDir, `renders/${name}.vtt`), toVtt(cues))
        }
        captions(result.timeline, slug)
        const outputs: [string, string[]][] = values.draft
            ? [[`renders/${slug}.draft.mp4`, DRAFT_FLAGS]]
            : [[`renders/${slug}.mp4`, RENDER_FLAGS]]
        if (values.gif) {
            outputs.push([`renders/${slug}.gif`, [...RENDER_FLAGS, '--format', 'gif', '--fps', '15']])
        }
        const report = (outcome: 'rendered' | 'unchanged' | 'failed', output: string): void => {
            if (outcome === 'failed') {
                failures++
                console.error(`reelkit: render failed for ${slug} (${output})`)
                return
            }
            console.log(`${outcome === 'unchanged' ? 'up to date' : 'rendered'} ${resolve(videoDir, output)}`)
        }
        if (!values.only || values.only === 'landscape') {
            for (const [output, flags] of outputs) {
                report(renderIfChanged(videoDir, output, flags, values.force), output)
            }
        }
        // Asked for here (--portrait, --square, --all-formats, --only) or in video.json "formats".
        const wanted = new Set(result.spec.formats ?? [])
        const asked = (format: 'portrait' | 'square') =>
            values.only ? values.only === format : values[format] || values['all-formats'] || wanted.has(format)
        // Portrait: its own composition (tall frame, footage panning with the cursor).
        if (asked('portrait')) {
            if (result.versions) captions(result.versions.portrait, `${slug}.portrait`)
            const output = outputs[0][0].replace(/\.mp4$/, '.portrait.mp4')
            report(renderIfChanged(videoDir, output, outputs[0][1], values.force, 'portrait.html'), output)
        }
        // Square: its own composition, from the square take (`reelkit record --square`).
        if (asked('square')) {
            const output = outputs[0][0].replace(/\.mp4$/, '.square.mp4')
            const hint = `run \`reelkit record ${slug} --square\` (a square browser), then render again`
            if (existsSync(resolve(videoDir, 'square.html'))) {
                if (result.versions?.square) captions(result.versions.square, `${slug}.square`)
                report(renderIfChanged(videoDir, output, outputs[0][1], values.force, 'square.html'), output)
            } else if (values.square || values.only === 'square') {
                failures++
                console.error(`reelkit: no square take for ${slug} — ${hint}`)
            } else {
                console.log(`skipped the square version of ${slug}: no square take — ${hint}`)
            }
        }
    }
    return failures ? 1 : 0
}
