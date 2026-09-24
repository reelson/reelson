#!/usr/bin/env node
/**
 * reelson — scripted Playwright walkthroughs → branded HyperFrames demo videos.
 * Run `reelson help` for the commands. Project settings come from the nearest
 * reelson.config.json (walking up from the working directory).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { basename, relative, resolve } from 'node:path'
import { parseArgs, parseEnv } from 'node:util'
import { CONFIG_FILE, CONFIG_SCHEMA_PATH, ConfigError, LEGACY_CONFIG_FILE, fromRoot, loadConfig, viaProjectSkills, type LoadedConfig } from '../skills/reelson-record/scripts/config.ts'
import { doctor } from '../skills/reelson-record/scripts/doctor.ts'
import { build, plan, type BuildOptions } from '../skills/reelson-compose/scripts/build.ts'
import { captionCues, toSrt, toVtt } from '../skills/reelson-compose/scripts/captions.ts'
import { check } from '../skills/reelson-compose/scripts/check.ts'
import { studio } from '../skills/reelson-compose/scripts/studio.ts'
import { fetchLines, spokenTexts, voiceSettings, type VoiceSettings } from '../skills/reelson-compose/scripts/voice.ts'
import { listVoices, missingSetup, PROVIDERS, type Provider } from '../skills/reelson-compose/scripts/tts.ts'
import { TAKES, verify } from '../skills/reelson-compose/scripts/verify.ts'
import { DRAFT_FLAGS, FPS, gifIfChanged, hyperframes, hyperframesOn, RENDER_FLAGS, renderIfChanged } from '../skills/reelson-compose/scripts/hyperframes.ts'
import { catalog, KIT_ROOT, listDemos, RECORD_SCRIPT, ReelsonError, resolveDemoDir } from '../skills/reelson-compose/scripts/project.ts'
import { SLOTS, type SectionChoice, type Timeline } from '../skills/reelson-compose/scripts/timeline.ts'
import {
    channelsTemplate,
    credentialsFor,
    loadChannels,
    metadata,
    pickChannels,
    publisherFor,
    readPublished,
    recordPublished,
    renderFiles,
    renderProblem,
    type ChannelContext,
    type Channels,
    type Format,
} from '../skills/reelson-compose/scripts/publish.ts'

const HELP = `reelson — scripted walkthroughs → branded demo videos

Usage: reelson <command> [options]

  install [<project-dir> | --global] [-y] [--no-browser]
                                link the reelson-record + reelson-compose skills into
                                .agents/skills/ (Codex and other agents) and .claude/skills/
                                (Claude Code): --global in ~/ for every project, or in a
                                project (which also gets a reelson.config.json); asks which when
                                neither is given (-y, or no terminal: --global). Downloads
                                Playwright's Chromium (--no-browser: skip it)
  init                          create reelson.config.json in this directory
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
                                reelson.config.json voice.provider: openai, elevenlabs, piper (local)
                                or command (local); cached in <demo>/voice/)
  voices [--provider <name>] [--all] [--library]
                                the voices to pick for voice.voice (openai; elevenlabs: your
                                account's, --library: the Voice Library's in the project's
                                language, paid plans; piper: the project's language, --all: every one)
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
  publish <slug...> [--to <channel,...> | --all-channels] [--dry-run] [--again]
                                upload the rendered video to the config's channels
                                (asks which without --to); a channel that already has it
                                (published.json) is skipped unless --again; --dry-run shows
                                what would go up
  channels [init | login <name> | logout <name>]
                                list the channels and who each is logged in as; init adds
                                starter ones to the config; login signs a channel in (browser)

<slug> is a folder under videosDir, or a path to a demo folder or its scenario.ts.
Docs: ${KIT_ROOT}/README.md`

const [command, ...rest] = process.argv.slice(2)
const SECRETS = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET']

try {
    loadSecrets()
    process.exitCode = await run(command, rest)
} catch (error) {
    if (error instanceof ReelsonError || error instanceof ConfigError) {
        console.error(`reelson: ${error.message}`)
        process.exitCode = 1
    } else {
        throw error
    }
}

/**
 * Picks the secrets reelson reads (SECRETS: API keys, YouTube's OAuth client) up from a .env next to reelson.config.json, else from one in the reelson checkout;
 * a variable already in the environment wins. The rest of those files is left alone.
 */
function loadSecrets(): void {
    for (const dir of [loadConfig(process.cwd()).root, KIT_ROOT]) {
        const file = resolve(dir, '.env')
        if (!existsSync(file)) {
            continue
        }
        const values = parseEnv(readFileSync(file, 'utf8'))
        for (const name of SECRETS) {
            if (!process.env[name] && values[name]) {
                process.env[name] = values[name]
            }
        }
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
        case 'install':
            return await install(argv)
        case 'init':
            return init()
        case 'doctor':
            const problems = await doctor()
            voiceDoctor()
            return problems ? 1 : 0
        case 'new':
            return create(argv)
        case 'record':
            return record(argv)
        case 'build':
            return buildCommand(argv)
        case 'voice':
            return voiceCommand(argv)
        case 'voices':
            return voicesCommand(argv)
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
        case 'publish':
            return await publishCommand(argv)
        case 'channels':
            return await channelsCommand(argv)
        default:
            console.error(`reelson: unknown command "${cmd}"\n\n${HELP}`)
            return 2
    }
}

/** `reelson doctor`'s voice-over line: can the configured provider speak here? (A note: not every project uses it.) */
function voiceDoctor(): void {
    const settings = voiceSettings({ title: '', voice: true }, loadConfig(process.cwd())) as VoiceSettings
    const problem = missingSetup(settings)
    const what = `voice-over: ${settings.provider}${settings.voice ? ` (${settings.voice})` : ''}`
    console.log(problem ? `· ${what} — for "voice": true videos: ${problem}` : `✓ ${what}`)
}

function config(): LoadedConfig {
    const loaded = loadConfig(process.cwd())
    if (!loaded.path) {
        console.warn('reelson: no reelson.config.json found — using defaults (run `reelson init`)')
    }
    return loaded
}

function one(positionals: string[], usage: string): string {
    if (positionals.length !== 1) {
        throw new ReelsonError(`usage: reelson ${usage}`)
    }
    return positionals[0]
}

/**
 * `reelson install`: links the skills into a project (or the home folder) and prepares the machine. The links
 * point at this installation, so `npm update -g reelson` (or `git pull` in a checkout) updates every project.
 */
async function install(argv: string[]): Promise<number> {
    const skillNames = ['reelson-record', 'reelson-compose']
    // Names used before 0.7 (demo-* before that): their links are dropped when they point at a reelson install.
    const oldNames = ['demo-record', 'demo-video', 'reelkit-record', 'reelkit-compose']
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { global: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' }, 'no-browser': { type: 'boolean' } },
    })
    if (positionals.length > 1 || (values.global && positionals.length)) {
        throw new ReelsonError('usage: reelson install [<project-dir> | --global] [-y] [--no-browser]')
    }
    // Asked only when neither --global nor a folder is given and someone is at the terminal.
    const where = values.global ? null : positionals.length ? resolve(positionals[0]) : values.yes || !process.stdin.isTTY ? null : await askWhere()
    const global = where === null
    const target = where ?? homedir()
    if (!existsSync(target)) {
        throw new ReelsonError(`${target} does not exist`)
    }
    if (spawnSync('ffmpeg', ['-version']).status !== 0) {
        console.warn('warning: ffmpeg not found — brew install ffmpeg')
    }
    if (!values['no-browser']) {
        console.log('Installing Playwright\'s Chromium (skipped when it is already there)…')
        const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
        const status = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' }).status
        if (status !== 0) {
            throw new ReelsonError('could not install Chromium — run `npx playwright install chromium`')
        }
    }

    // .agents/skills links to this installation; .claude/skills links to .agents/skills (unless the
    // whole folder already is a link to it), so both agents see the same skills.
    const agents = resolve(target, '.agents/skills')
    const claude = resolve(target, '.claude/skills')
    mkdirSync(agents, { recursive: true })
    mkdirSync(claude, { recursive: true })
    const shared = realpathSync(agents) === realpathSync(claude)
    const isLink = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false
    const link = (path: string, to: string): void => {
        if (existsSync(path) && !isLink(path)) {
            throw new ReelsonError(`${path} is a folder, not a link to reelson — move it away and run install again`)
        }
        if (isLink(path)) {
            rmSync(path)
        }
        symlinkSync(to, path, 'dir')
        console.log(`  linked ${path} → ${to}`)
    }
    for (const dir of shared ? [agents] : [agents, claude]) {
        for (const old of oldNames) {
            const path = resolve(dir, old)
            if (isLink(path) && (resolve(dir, readlinkSync(path)).startsWith(`${KIT_ROOT}/`) || /[\\/]skills[\\/](reelkit|reelson)-/.test(readlinkSync(path)))) {
                rmSync(path)
                console.log(`  removed old link ${path}`)
            }
        }
    }
    for (const skill of skillNames) {
        link(resolve(agents, skill), resolve(KIT_ROOT, 'skills', skill))
        if (!shared) {
            link(resolve(claude, skill), relative(claude, resolve(agents, skill)))
        }
    }

    if (!global) {
        if (![CONFIG_FILE, LEGACY_CONFIG_FILE].some((name) => existsSync(resolve(target, name)))) {
            init(target)
        }
        const videos = loadConfig(target).videosDir.replace(/^\.?\/+|\/+$/g, '')
        console.log(`
Add to ${resolve(target, '.gitignore')} (the skill links point at this machine's reelson):

    /.agents/skills/reelson-*
    /.claude/skills/reelson-*
    /${videos}/**/recording*.mp4
    /${videos}/**/.raw*/
    /${videos}/**/video/
    /${videos}/**/*.openscreen`)
    }
    console.log(global ? '\nDone — every project sees the skills. In a project: reelson init, then reelson doctor' : '\nDone. Try: reelson doctor')
    return 0
}

/** `reelson install`'s question: every project (the default), this one, or another folder → null for global, else the project. */
async function askWhere(): Promise<string | null> {
    const home = (path: string): string => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path)
    const here = process.cwd()
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        console.log(`Where should reelson install its skills?
  1. Every project (default): ~/.agents/skills, linked from ~/.claude/skills
  2. This project: ${home(here)}/.agents/skills, linked from .claude/skills
  3. Another project…`)
        for (;;) {
            const answer = (await rl.question('Choose [1]: ')).trim()
            if (answer === '' || answer === '1') return null
            if (answer === '2') return here
            if (answer === '3') {
                const dir = (await rl.question('Project folder: ')).trim().replace(/^~(?=$|\/)/, homedir())
                if (dir && existsSync(dir)) return resolve(dir)
                console.log(`  no folder ${dir || '(empty)'}`)
                continue
            }
            console.log('  type 1, 2 or 3 (Enter: 1)')
        }
    } catch (error) {
        // Ctrl+D (or Ctrl+C) at the question: stop quietly, nothing linked yet.
        if ((error as Error).name === 'AbortError') {
            throw new ReelsonError('install cancelled — nothing was changed')
        }
        throw error
    } finally {
        rl.close()
    }
}

function init(dir = process.cwd()): number {
    const target = resolve(dir, CONFIG_FILE)
    if (existsSync(target)) {
        throw new ReelsonError(`${target} already exists`)
    }
    if (existsSync(resolve(dir, LEGACY_CONFIG_FILE))) {
        throw new ReelsonError(`${resolve(dir, LEGACY_CONFIG_FILE)} already exists — rename it to ${CONFIG_FILE}`)
    }
    const example = JSON.parse(readFileSync(resolve(KIT_ROOT, 'reelson.config.example.json'), 'utf8'))
    delete example.$comment
    delete example.$schema
    const schema = viaProjectSkills(dir, 'reelson-record/schemas/reelson.config.schema.json') ?? CONFIG_SCHEMA_PATH
    let schemaRef = relative(dir, schema)
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
        throw new ReelsonError(`${scenario} already exists`)
    }
    mkdirSync(dir, { recursive: true })
    const typesFile =
        viaProjectSkills(cfg.root, 'reelson-record/scripts/scenario.ts') ?? resolve(KIT_ROOT, 'skills/reelson-record/scripts/scenario.ts')
    let importPath = relative(dir, typesFile)
    if (!/^\.{1,2}\//.test(importPath)) {
        importPath = `./${importPath}`
    }
    writeFileSync(
        scenario,
        `/**
 * Demo: ${slug}
 *
 *   reelson record ${slug}      (--headed to watch)
 *   reelson build ${slug} --title "..."
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
        throw new ReelsonError('record: --mobile, --square or --all-takes')
    }
    const target = one(positionals, 'record <slug|scenario.ts> [--headed] [--mobile | --square | --all-takes]')
    const scenario = target.endsWith('.ts') ? resolve(target) : resolve(resolveDemoDir(target, config()), 'scenario.ts')
    if (!existsSync(scenario)) {
        throw new ReelsonError(`no scenario at ${scenario} — create one with \`reelson new\``)
    }
    const takes = values['all-takes']
        ? TAKES.map((take) => take.flags)
        : [[...(values.mobile ? ['--mobile'] : []), ...(values.square ? ['--square'] : [])]]
    for (const flags of takes) {
        const args = [RECORD_SCRIPT, scenario, ...(values.headed ? ['--headed'] : []), ...flags, ...(values.out ? ['--out', values.out] : [])]
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
            throw new ReelsonError(`--${name} expects seconds, got "${v}"`)
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
        if (strict || !(error instanceof ReelsonError || error instanceof TypeError)) {
            throw error
        }
        console.warn(`reelson: ${error.message} — building without those lines`)
        return 0
    }
}

async function voiceCommand(argv: string[]): Promise<number> {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true })
    const cfg = config()
    const dir = resolveDemoDir(one(positionals, 'voice <slug>'), cfg)
    if (!voiceSettings(plan(dir, cfg).spec, cfg)) {
        throw new ReelsonError(`${basename(dir)} has no voice-over — set "voice": true in its video.json`)
    }
    const fetched = await speak(dir, cfg, true)
    console.log(fetched ? `spoke ${fetched} line(s) into ${resolve(dir, 'voice')}` : 'every line is already spoken')
    return 0
}

async function voicesCommand(argv: string[]): Promise<number> {
    const { values } = parseArgs({ args: argv, options: { provider: { type: 'string' }, all: { type: 'boolean' }, library: { type: 'boolean' } } })
    const cfg = loadConfig(process.cwd())
    const provider = (values.provider ?? cfg.voice.provider) as Provider
    if (!PROVIDERS.includes(provider)) {
        throw new ReelsonError(`--provider expects ${PROVIDERS.join(', ')}, got "${provider}"`)
    }
    const current = voiceSettings({ title: '', voice: { provider } }, cfg) as VoiceSettings
    const voices = await listVoices(provider, cfg.language, values.all, values.library)
    const width = Math.min(40, Math.max(...voices.map((v) => (v.name === v.id ? v.id : `${v.name} ${v.id}`).length)))
    const scope = values.library ? ` in the Voice Library for "${cfg.language}" (paid plans)` : provider === 'piper' && !values.all ? ` for "${cfg.language}"` : ''
    console.log(`${provider} voices${scope} (voice.voice; * = the one used now):`)
    for (const v of voices) {
        const label = v.name === v.id ? v.id : `${v.name} ${v.id}`
        const used = v.id === current.voice || v.name.toLowerCase() === current.voice.toLowerCase()
        console.log(`${used ? '*' : ' '} ${label.padEnd(width)}  ${v.about}`)
    }
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
        throw new ReelsonError(values.all ? 'no demos with a video.json under videosDir' : 'usage: reelson verify <slug...> | --all [--update]')
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
        throw new ReelsonError(`${dir} is not built — run \`reelson build ${slug}\``)
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
        throw new ReelsonError(`no ${composition} — ${format === 'square' ? `record the square take (\`reelson record ${slug} --square\`) and ` : ''}run \`reelson build ${slug}\``)
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
                    throw new ReelsonError(`--at expects seconds, got "${v}"`)
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
        throw new ReelsonError(`--port expects a port number, got "${values.port}"`)
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
        throw new ReelsonError(`--only expects landscape, portrait or square, got "${values.only}"`)
    }
    const cfg = config()
    const dirs = values.all ? listDemos(cfg) : positionals.map((p) => resolveDemoDir(p, cfg))
    if (!dirs.length) {
        throw new ReelsonError(values.all ? 'no demos with a video.json under videosDir' : 'usage: reelson render <slug...> | --all')
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
        const [video, flags] = values.draft ? [`renders/${slug}.draft.mp4`, DRAFT_FLAGS] : [`renders/${slug}.mp4`, RENDER_FLAGS]
        const report = (outcome: 'rendered' | 'unchanged' | 'failed', output: string): void => {
            if (outcome === 'failed') {
                failures++
                console.error(`reelson: render failed for ${slug} (${output})`)
                return
            }
            console.log(`${outcome === 'unchanged' ? 'up to date' : 'rendered'} ${resolve(videoDir, output)}`)
        }
        if (!values.only || values.only === 'landscape') {
            const outcome = renderIfChanged(videoDir, video, flags, values.force)
            report(outcome, video)
            // The GIF is cut from the MP4 just rendered (ffmpeg), not rendered a second time.
            if (values.gif && outcome !== 'failed') {
                const gif = video.replace(/\.mp4$/, '.gif')
                report(gifIfChanged(videoDir, video, gif, values.force), gif)
            }
        }
        // Asked for here (--portrait, --square, --all-formats, --only) or in video.json "formats".
        const wanted = new Set(result.spec.formats ?? [])
        const asked = (format: 'portrait' | 'square') =>
            values.only ? values.only === format : values[format] || values['all-formats'] || wanted.has(format)
        // Portrait: its own composition (tall frame, footage panning with the cursor).
        if (asked('portrait')) {
            if (result.versions) captions(result.versions.portrait, `${slug}.portrait`)
            const output = video.replace(/\.mp4$/, '.portrait.mp4')
            report(renderIfChanged(videoDir, output, flags, values.force, 'portrait.html'), output)
        }
        // Square: its own composition, from the square take (`reelson record --square`).
        if (asked('square')) {
            const output = video.replace(/\.mp4$/, '.square.mp4')
            const hint = `run \`reelson record ${slug} --square\` (a square browser), then render again`
            if (existsSync(resolve(videoDir, 'square.html'))) {
                if (result.versions?.square) captions(result.versions.square, `${slug}.square`)
                report(renderIfChanged(videoDir, output, flags, values.force, 'square.html'), output)
            } else if (values.square || values.only === 'square') {
                failures++
                console.error(`reelson: no square take for ${slug} — ${hint}`)
            } else {
                console.log(`skipped the square version of ${slug}: no square take — ${hint}`)
            }
        }
    }
    return failures ? 1 : 0
}

function openInBrowser(url: string): void {
    console.log(`Opening the sign-in page in your browser — if it does not open, visit:\n  ${url}`)
    spawnSync(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], { stdio: 'ignore' })
}

function channelContext(channels: Channels, name: string, cfg: LoadedConfig): ChannelContext {
    return { name, channel: channels.channels[name], config: cfg, credentials: credentialsFor(cfg, name), open: openInBrowser, log: console.log }
}

async function channelsCommand(argv: string[]): Promise<number> {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true })
    const [action, name, ...extra] = positionals
    const usage = 'usage: reelson channels [init | login <name> | logout <name>]'
    const cfg = config()
    if (action === 'init') {
        if (!cfg.path) {
            throw new ReelsonError('channels live in the project config — run `reelson init` first')
        }
        if (cfg.channels) {
            throw new ReelsonError(`${cfg.path} has "channels" already`)
        }
        const raw = JSON.parse(readFileSync(cfg.path, 'utf8')) as Record<string, unknown>
        writeFileSync(cfg.path, JSON.stringify({ ...raw, channels: channelsTemplate() }, null, 4) + '\n')
        console.log(`added "channels" to ${cfg.path} — then: reelson channels login youtube`)
        return 0
    }
    const channels = loadChannels(cfg)
    if (action === 'login' || action === 'logout') {
        if (!name || extra.length) {
            throw new ReelsonError(usage)
        }
        pickChannels(channels, name)
        const ctx = channelContext(channels, name, cfg)
        if (action === 'logout') {
            console.log(ctx.credentials.remove() ? `logged ${name} out (removed ${ctx.credentials.path})` : `${name} was not logged in`)
            return 0
        }
        const account = await publisherFor(ctx.channel).login(ctx)
        console.log(`✓ ${name} is logged in to ${account}`)
        return 0
    }
    if (action !== undefined) {
        throw new ReelsonError(usage)
    }
    const width = Math.max(...Object.keys(channels.channels).map((n) => n.length))
    console.log(`Channels in ${channels.path}:`)
    for (const channelName of Object.keys(channels.channels)) {
        const ctx = channelContext(channels, channelName, cfg)
        const publisher = publisherFor(ctx.channel)
        const account = publisher.account(ctx)
        const state = account ? `→ ${account}` : `not logged in (${publisher.missingSetup(ctx) ?? `reelson channels login ${channelName}`})`
        console.log(`  ${channelName.padEnd(width)}  ${publisher.label}: ${publisher.summary(ctx.channel)}  ${state}`)
    }
    return 0
}

async function publishCommand(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { to: { type: 'string', multiple: true }, 'all-channels': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, again: { type: 'boolean' } },
    })
    if (!positionals.length) {
        throw new ReelsonError('usage: reelson publish <slug...> [--to <channel,...> | --all-channels] [--dry-run] [--again]')
    }
    const cfg = config()
    const dirs = positionals.map((p) => resolveDemoDir(p, cfg))
    const channels = loadChannels(cfg)
    const names = pickChannels(channels, values.to, values['all-channels']) ?? (await askChannels(channels))

    // A channel that has the video already is skipped (--again: uploaded anew).
    const jobs = dirs
        .flatMap((dir) => names.map((name) => ({ dir, slug: basename(dir), name })))
        .filter(({ dir, slug, name }) => {
            const previous = readPublished(dir)[name]
            if (previous && !values.again) {
                console.log(`${slug} → ${name}: already published ${previous.at.slice(0, 10)} (${previous.url}) — --again uploads it anew`)
            }
            return !previous || values.again
        })
    // Everything is checked before the first upload: renders, the setup and sign-in of each channel.
    const problems: string[] = []
    const ready = jobs.filter(({ dir, slug, name }) => {
        const problem = renderProblem(dir, slug, channels.channels[name].format ?? 'landscape')
        if (problem) problems.push(`${slug} → ${name}: ${problem}`)
        return !problem
    })
    for (const name of values['dry-run'] ? [] : new Set(jobs.map((job) => job.name))) {
        const ctx = channelContext(channels, name, cfg)
        const publisher = publisherFor(ctx.channel)
        if (!publisher.account(ctx)) {
            const setup = publisher.missingSetup(ctx)
            if (setup || !process.stdin.isTTY) {
                problems.push(`${name}: not logged in — ${setup ?? `run \`reelson channels login ${name}\``}`)
                continue
            }
            console.log(`${name} is not logged in yet:`)
            console.log(`✓ ${name} is logged in to ${await publisher.login(ctx)}`)
        }
    }
    if (problems.length && !values['dry-run']) {
        throw new ReelsonError(`nothing was published:\n  ${problems.join('\n  ')}`)
    }

    let failures = problems.length
    problems.forEach((problem) => console.error(`reelson: ${problem}`))
    for (const { dir, slug, name } of ready) {
        const ctx = channelContext(channels, name, cfg)
        const publisher = publisherFor(ctx.channel)
        const format: Format = ctx.channel.format ?? 'landscape'
        const { spec, timeline } = plan(dir, cfg)
        const { file, captions } = renderFiles(dir, slug, format)
        const job = {
            slug,
            demoDir: dir,
            format,
            file,
            captions: existsSync(captions) ? captions : null,
            language: cfg.language,
            metadata: metadata(spec, timeline.callouts.map((c) => c.text), ctx.channel),
        }
        if (values['dry-run']) {
            const account = publisher.account(ctx)
            console.log(`${slug} → ${name} (${publisher.label}: ${publisher.summary(ctx.channel)}, ${account ?? 'not logged in'})`)
            console.log(`  file:        ${relative(process.cwd(), file)}${job.captions ? ` + ${basename(job.captions)}` : ''}`)
            console.log(`  title:       ${job.metadata.title}`)
            console.log(`  tags:        ${job.metadata.tags.join(', ') || '(none)'}`)
            console.log(`  description: ${job.metadata.description.replace(/\n(?=.)/g, '\n               ') || '(empty)'}`)
            continue
        }
        console.log(`${slug} → ${name} (${publisher.label}):`)
        try {
            const published = await publisher.publish(job, ctx)
            recordPublished(dir, name, { type: ctx.channel.type, ...published, at: new Date().toISOString(), file: relative(dir, file) })
            console.log(`✓ ${published.url}`)
        } catch (error) {
            if (!(error instanceof ReelsonError)) {
                throw error
            }
            failures++
            console.error(`reelson: ${slug} → ${name}: ${error.message}`)
        }
    }
    return failures ? 1 : 0
}

/** `reelson publish` without --to, at a terminal: which channels (numbers, comma-separated, or "all"). */
async function askChannels(channels: Channels): Promise<string[]> {
    const names = Object.keys(channels.channels)
    if (!process.stdin.isTTY) {
        throw new ReelsonError(`which channels? --to <${names.join(',')}> or --all-channels`)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        console.log('Publish to which channels?')
        names.forEach((name, i) => {
            const publisher = publisherFor(channels.channels[name])
            console.log(`  ${i + 1}. ${name} — ${publisher.label}: ${publisher.summary(channels.channels[name])}`)
        })
        for (;;) {
            const answer = (await rl.question('Numbers or names, comma-separated (or "all"): ')).trim()
            if (answer === 'all') return names
            const picked = answer.split(',').map((a) => a.trim()).filter(Boolean).map((a) => (/^\d+$/.test(a) ? names[Number(a) - 1] : a))
            if (picked.length && picked.every((p) => p && names.includes(p))) return [...new Set(picked)]
            console.log(`  pick from 1–${names.length} or ${names.join(', ')}`)
        }
    } catch (error) {
        if ((error as Error).name === 'AbortError') {
            throw new ReelsonError('publish cancelled — nothing was uploaded')
        }
        throw error
    } finally {
        rl.close()
    }
}
