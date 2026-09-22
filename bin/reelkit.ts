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
import { build, type BuildOptions } from '../skills/reelkit-compose/scripts/build.ts'
import { check } from '../skills/reelkit-compose/scripts/check.ts'
import { hyperframes, RENDER_FLAGS } from '../skills/reelkit-compose/scripts/hyperframes.ts'
import { catalog, KIT_ROOT, listDemos, ReelkitError, resolveDemoDir } from '../skills/reelkit-compose/scripts/project.ts'
import { SLOTS, type SectionChoice } from '../skills/reelkit-compose/scripts/timeline.ts'

const HELP = `reelkit — scripted walkthroughs → branded demo videos

Usage: reelkit <command> [options]

  init                          create demo.config.json in this directory
  new <slug> [--url <origin>]   start <videosDir>/<slug>/scenario.ts
  record <slug> [--headed]      run the scenario → recording.mp4 + markers.json
  build <slug> [options]        video.json → video/ (HyperFrames project)
      --title, --subtitle, --template <name>
      --intro <name>, --recap <name|none>, --outro <name>
      --trim-start <s>, --trim-end <s>, --music <file> | --no-music
  check <slug> [--no-hyperframes]   schemas, zoom timing, hyperframes lint
  snapshot <slug> --at 1,3.5,8  PNG frames into video/snapshots/
  preview <slug>                open the HyperFrames studio
  templates                     list templates and intro/recap/outro sections
  render <slug...> | --all [--gif] [--no-build]
                                build + render video/renders/<slug>.mp4 (and .gif)

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
        case 'new':
            return create(argv)
        case 'record':
            return record(argv)
        case 'build':
            return buildCommand(argv)
        case 'check':
            return checkCommand(argv)
        case 'snapshot':
            return snapshot(argv)
        case 'preview':
            return preview(argv)
        case 'render':
            return render(argv)
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
 * callout (≤ 10); each becomes a timed callout in video.json.
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
        options: { headed: { type: 'boolean' }, out: { type: 'string' } },
    })
    const target = one(positionals, 'record <slug|scenario.ts> [--headed]')
    const scenario = target.endsWith('.ts') ? resolve(target) : resolve(resolveDemoDir(target, config()), 'scenario.ts')
    if (!existsSync(scenario)) {
        throw new ReelkitError(`no scenario at ${scenario} — create one with \`reelkit new\``)
    }
    const script = resolve(KIT_ROOT, 'skills/reelkit-record/scripts/record.ts')
    const args = [script, scenario, ...(values.headed ? ['--headed'] : []), ...(values.out ? ['--out', values.out] : [])]

    return spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1
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
    const cfg = config()
    const options: BuildOptions = {
        title: values.title,
        subtitle: values.subtitle,
        template: values.template,
        sections: Object.fromEntries(SLOTS.filter((slot) => values[slot] !== undefined).map((slot) => [slot, values[slot]])) as SectionChoice,
        trimStart: seconds(values['trim-start'], 'trim-start'),
        trimEnd: seconds(values['trim-end'], 'trim-end'),
        // video.json stores the path relative to the project root.
        music: values['no-music'] ? false : values.music ? relative(cfg.root, resolve(values.music)) : undefined,
    }

    return { options, positionals }
}

function buildCommand(argv: string[]): number {
    const { options, positionals } = buildOptions(argv)
    const cfg = config()
    build(resolveDemoDir(one(positionals, 'build <slug> [options]'), cfg), cfg, options)
    return 0
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
        options: { at: { type: 'string' } },
    })
    const slug = one(positionals, 'snapshot <slug> --at 1,3.5,8')
    return hyperframes(['snapshot', '.', ...(values.at ? ['--at', values.at] : [])], builtVideoDir(slug))
}

function preview(argv: string[]): number {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true })
    return hyperframes(['preview', '.'], builtVideoDir(one(positionals, 'preview <slug>')))
}

function render(argv: string[]): number {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { all: { type: 'boolean' }, gif: { type: 'boolean' }, 'no-build': { type: 'boolean' } },
    })
    const cfg = config()
    const dirs = values.all ? listDemos(cfg) : positionals.map((p) => resolveDemoDir(p, cfg))
    if (!dirs.length) {
        throw new ReelkitError(values.all ? 'no demos with a video.json under videosDir' : 'usage: reelkit render <slug...> | --all')
    }

    let failures = 0
    for (const dir of dirs) {
        const slug = basename(dir)
        if (!values['no-build']) {
            build(dir, cfg)
        }
        const videoDir = resolve(dir, 'video')
        const outputs = [['-o', `renders/${slug}.mp4`]]
        if (values.gif) {
            outputs.push(['--format', 'gif', '--fps', '15', '-o', `renders/${slug}.gif`])
        }
        for (const output of outputs) {
            const status = hyperframes(['render', '.', ...RENDER_FLAGS, ...output], videoDir)
            if (status !== 0) {
                failures++
                console.error(`reelkit: render failed for ${slug} (${output.at(-1)})`)
            } else {
                console.log(`rendered ${resolve(videoDir, output.at(-1) as string)}`)
            }
        }
    }
    return failures ? 1 : 0
}
