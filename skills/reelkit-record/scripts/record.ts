/**
 * Records a scripted browser walkthrough of the app as a video.
 *
 *   reelkit record <slug> [--headed]
 *   node <skills>/reelkit-record/scripts/record.ts <scenario.ts> [--out <dir>] [--headed]
 *
 * The scenario module default-exports a `Scenario` (see ./scenario.ts). The
 * recorder drives it with Playwright, logs the cursor (or draws it, record.cursor
 * "recorded"), hides local dev chrome, films the page with Chrome's screencast
 * (see ./capture.ts; record.capture "playwright" uses Playwright's video) and writes
 * into --out (default: the scenario's directory). Project settings (viewport, locale,
 * brand colour, hidden selectors, persona domain) come from demo.config.json
 * (see ./config.ts):
 *
 *   recording.mp4    H.264, 30 fps (what HyperFrames consumes); recording.failed.mp4 on failure
 *   markers.json     { durationSeconds, viewport, markers, clicks, cuts, transitions, cursor }
 *
 * Markers are the timestamps (seconds from the start of the video) of every
 * `demo.marker()` call, so callouts/zooms in the composition can be timed
 * against the real footage instead of guessed.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import {
    existsSync,
    mkdirSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { encodeFrames, frameSchedule, startScreencast, type CameraSwitch } from './capture.ts'
import { COMMON_DEV_CHROME, ConfigError, loadConfig } from './config.ts'
import { CURSOR_BINDING, cursorOverlayScript, hideDevChromeScript, type CursorEvent } from './cursor-overlay.ts'
import { createDemo, type Scenario } from './scenario.ts'

const args = process.argv.slice(2)
const scenarioArg = args.find((a) => !a.startsWith('--'))
if (!scenarioArg) {
    console.error('usage: record.ts <scenario.ts> [--out <dir>] [--headed]')
    process.exit(2)
}

const scenarioPath = resolve(scenarioArg)
const outDir = resolve(flag('--out') ?? dirname(scenarioPath))
const headed = args.includes('--headed')

function flag(name: string): string | undefined {
    const i = args.indexOf(name)
    return i === -1 ? undefined : args[i + 1]
}

const config = (() => {
    try {
        return loadConfig(dirname(scenarioPath))
    } catch (error) {
        console.error(error instanceof ConfigError ? `reelkit: ${error.message}` : error)
        process.exit(1)
    }
})()
// The project's own Playwright when the scenario can see one: its helpers (a login from the
// e2e suite) import it too, and Playwright refuses to be loaded twice from two places.
const { chromium } = await import(playwrightFor(scenarioPath))
const scenario: Scenario = (await import(pathToFileURL(scenarioPath).href))
    .default
const viewport = scenario.viewport ?? config.record.viewport
const captureScale =
    scenario.deviceScaleFactor ?? config.record.deviceScaleFactor
const rawDir = resolve(outDir, '.raw')
const screencast = config.record.capture === 'screencast'

mkdirSync(outDir, { recursive: true })
rmSync(rawDir, { recursive: true, force: true })

// Chrome's screencast (what Playwright films) only delivers device pixels when the
// scale factor is forced at launch; the context's deviceScaleFactor alone films
// CSS pixels padded into the bigger canvas.
const browser: Browser = await chromium.launch({
    headless: !headed,
    args: [`--force-device-scale-factor=${captureScale}`],
})
const context: BrowserContext = await browser.newContext({
    baseURL: scenario.baseURL,
    ignoreHTTPSErrors: true,
    locale: config.locale,
    viewport,
    deviceScaleFactor: captureScale,
    // Film at device pixels (2x by default) so text survives the frame scaling and zooms.
    ...(screencast
        ? {}
        : {
              recordVideo: {
                  dir: rawDir,
                  size: { width: viewport.width * captureScale, height: viewport.height * captureScale },
              },
          }),
    // Tells the app it is being recorded (X-Demo-Recording by default), so it can skip
    // dev conveniences that would look wrong on camera (pre-filled forms, pre-ticked consents).
    extraHTTPHeaders: config.record.extraHTTPHeaders,
})
// The page reports every cursor move and press (its own clock = this machine's clock);
// with record.cursor "layer" (the default) it draws nothing and the video draws the cursor.
// Every page gets an id: the first is 0, pop-ups and new tabs count up. Frames and cursor
// events carry it, so the video (and its cursor) show only the page the demo is on.
const pageIds = new Map<Page, number>()
const idOf = (p: Page): number => {
    if (!pageIds.has(p)) pageIds.set(p, pageIds.size)
    return pageIds.get(p) as number
}
const cursorEvents: (CursorEvent & { page: number })[] = []
await context.exposeBinding(CURSOR_BINDING, (source, event: CursorEvent) => {
    cursorEvents.push({ ...event, page: source.page ? idOf(source.page) : 0 })
})
await context.addInitScript(
    cursorOverlayScript(config.brand.color, { draw: config.record.cursor === 'recorded', report: true }),
)
// Local-only chrome that must never appear in a docs video.
const hideScript = hideDevChromeScript([
    ...COMMON_DEV_CHROME,
    ...config.record.hideSelectors,
])
if (hideScript) {
    await context.addInitScript(hideScript)
}

const page: Page = await context.newPage()
idOf(page)
const filming = screencast ? [await startScreencast(context, page, rawDir, 0)] : []
// Pop-ups and new tabs: filmed from the moment they open; the video shows them once the
// scenario moves there (demo.popup / demo.switchTo).
const opened: { id: number; url: string }[] = []
const pendingCasts: Promise<void>[] = []
context.on('page', (p) => {
    if (p === page) return
    const id = idOf(p)
    opened.push({ id, url: p.url() })
    p.once('load', () => {
        const entry = opened.find((o) => o.id === id)
        if (entry) entry.url = p.url()
    })
    if (screencast) {
        pendingCasts.push(startScreencast(context, p, rawDir, id).then((cast) => void filming.push(cast)).catch(() => {}))
    }
})
const camera: CameraSwitch[] = []
const demo = createDemo(
    page,
    hashSeed(scenario.name),
    { domain: config.record.personaDomain, language: config.language },
    { onSwitch: (p) => camera.push({ t: Date.now(), page: idOf(p) }) },
)
camera.push({ t: demo.startedAt, page: 0 })

let failure: unknown = null
try {
    // Start with the cursor resting mid-screen (not at 0,0), even before the first goto.
    await demo.rest()
    await demo.pause(scenario.leadInMs ?? 800)
    await scenario.run(demo)
    await demo.pause(scenario.leadOutMs ?? 1200)
} catch (error) {
    failure = error
    console.error('scenario failed:', error)
}

const endedAt = Date.now()
await Promise.all(pendingCasts)
const frames = (await Promise.all(filming.map((cast) => cast.stop()))).flat()
if (!screencast && camera.some((c) => c.page !== 0)) {
    console.warn('warning: record.capture "playwright" films only the first page — the pop-up/new tab is not in the video; use "screencast"')
}
const unfilmed = opened.filter((o) => !camera.some((c) => c.page === o.id))
for (const o of unfilmed) {
    console.warn(
        `warning: a new tab / pop-up opened (${o.url || 'about:blank'}) and was not filmed — ` +
            'open it with `await demo.popup(() => demo.click(link))` to show it in the video',
    )
}
const videoPath = screencast ? undefined : await page.video()?.path()
await context.close()
await browser.close()

const mp4 = resolve(outDir, 'recording.mp4')
if (screencast) {
    // Frames painted after the scenario ended are not part of it.
    const schedule = frameSchedule(frames.filter((f) => f.t <= endedAt), demo.startedAt, endedAt, failure ? [] : demo.cuts, camera)
    const target = failure ? resolve(outDir, 'recording.failed.mp4') : mp4
    if (!(await encodeFrames(schedule, target))) {
        console.error(schedule.length ? 'ffmpeg could not encode the frames (is ffmpeg installed? brew install ffmpeg)' : 'no frames were captured')
        process.exit(1)
    }
    rmSync(rawDir, { recursive: true, force: true })
    if (failure) {
        console.error(`partial capture kept for debugging: ${target}`)
        process.exit(1)
    }
} else {
    transcodePlaywrightVideo()
}

function transcodePlaywrightVideo(): void {
const webm = resolve(
    outDir,
    failure ? 'recording.failed.webm' : 'recording.webm',
)
const produced = videoPath ?? resolve(rawDir, readdirSync(rawDir)[0] ?? '')
if (!produced || !existsSync(produced)) {
    console.error('no video was produced')
    process.exit(1)
}
renameSync(produced, webm)
rmSync(rawDir, { recursive: true, force: true })

if (failure) {
    console.error(`partial capture kept for debugging: ${webm}`)
    process.exit(1)
}

// Playwright captures VP8/WebM at 25 fps; HyperFrames wants a plain H.264 MP4.
// Ranges collected by demo.cut() are removed here (trim + concat), so the
// published recording and markers.json are already tidy.
const keep = keptRanges(demo.cuts)
const videoFilter =
    keep.length > 1
        ? keep
              .map(
                  (r, i) =>
                      `[0:v]trim=${r.from}:${r.to},setpts=PTS-STARTPTS[v${i}]`,
              )
              .join(';') +
          ';' +
          keep.map((_, i) => `[v${i}]`).join('') +
          `concat=n=${keep.length}:v=1:a=0,scale=trunc(iw/2)*2:trunc(ih/2)*2[v]`
        : null
const ffmpeg = spawnSync(
    'ffmpeg',
    [
        '-y',
        '-loglevel',
        'error',
        '-i',
        webm,
        ...(videoFilter
            ? ['-filter_complex', videoFilter, '-map', '[v]']
            : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']),
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '15',
        '-pix_fmt',
        'yuv420p',
        '-r',
        '30',
        // A keyframe every second: HyperFrames seeks frame-by-frame and warns (and can
        // freeze frames) on sparse keyframes.
        '-g',
        '30',
        '-keyint_min',
        '30',
        '-movflags',
        '+faststart',
        '-an',
        mp4,
    ],
    { stdio: 'inherit' },
)
if (ffmpeg.status !== 0) {
    console.error(
        'ffmpeg transcode failed (is ffmpeg installed? brew install ffmpeg)',
    )
    process.exit(1)
}
}

/**
 * Seconds between the page handling an input event and the frame that shows it in the
 * capture (measured on the example, see the reelkit-record SKILL.md).
 */
const CAPTURE_LATENCY = screencast ? 0 : 0.04

/**
 * The cursor as the video saw it: [t, x, y] per move and per press (video seconds after
 * cuts, CSS px). `drawn`: whether it is already in the footage (record.cursor "recorded").
 */
function cursorLog(
    events: CursorEvent[],
    startedAt: number,
    cuts: { from: number; to: number }[],
    drawn: boolean,
): { drawn: boolean; path: [number, number, number][]; presses: [number, number, number][] } {
    const toVideo = (e: CursorEvent): [number, number, number] => [
        Number(toCutTime((e.t - startedAt) / 1000 + CAPTURE_LATENCY, cuts, 3).toFixed(3)),
        Number(e.x.toFixed(1)),
        Number(e.y.toFixed(1)),
    ]
    // Moves inside a cut collapse onto its start: keep only the last one per instant, so
    // the cursor jumps once to where it is after the cut.
    const kept = events.filter((e) => e.t >= startedAt).sort((a, b) => a.t - b.t)
    const path: [number, number, number][] = []
    for (const point of kept.filter((e) => e.type === 'move').map(toVideo)) {
        if (path.length && path[path.length - 1][0] === point[0]) {
            path[path.length - 1] = point
        } else {
            path.push(point)
        }
    }
    const inCut = (e: CursorEvent): boolean => {
        const t = (e.t - startedAt) / 1000
        return cuts.some((c) => t > c.from && t < c.to)
    }
    const presses = kept.filter((e) => e.type === 'down' && !inCut(e)).map(toVideo)

    return { drawn, path, presses }
}

/** The cursor events of the page the video showed at that moment. */
function onCamera(events: (CursorEvent & { page: number })[], switches: CameraSwitch[]): CursorEvent[] {
    const sorted = [...switches].sort((a, b) => a.t - b.t)
    const pageAt = (t: number): number => sorted.filter((s) => s.t <= t).at(-1)?.page ?? 0
    return events.filter((e) => e.page === pageAt(e.t))
}

/** Complement of the cut ranges over [0, ∞): what stays in the video. */
function keptRanges(
    cuts: { from: number; to: number }[],
): { from: number; to: string | number }[] {
    const sorted = [...cuts].sort((a, b) => a.from - b.from)
    const ranges: { from: number; to: string | number }[] = []
    let cursor = 0
    for (const c of sorted) {
        if (c.from > cursor) {
            ranges.push({ from: cursor, to: c.from })
        }
        cursor = Math.max(cursor, c.to)
    }
    ranges.push({ from: cursor, to: 1e9 })

    return ranges
}

/** Recording time → time in the cut video. Times inside a cut collapse to its start. */
function toCutTime(t: number, cuts: { from: number; to: number }[], digits = 2): number {
    let removed = 0
    for (const c of [...cuts].sort((a, b) => a.from - b.from)) {
        if (t >= c.to) {
            removed += c.to - c.from
        } else if (t > c.from) {
            removed += t - c.from
        }
    }

    return Number((t - removed).toFixed(digits))
}

const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4],
    { encoding: 'utf8' },
)
const durationSeconds =
    Number.parseFloat(probe.stdout.trim()) || demo.elapsedSeconds()

writeFileSync(
    resolve(outDir, 'markers.json'),
    JSON.stringify(
        {
            scenario: scenario.name,
            baseURL: scenario.baseURL,
            viewport,
            durationSeconds,
            cuts: demo.cuts,
            transitions: demo.transitions.map((t) => ({
                ...t,
                at: toCutTime(t.at, demo.cuts),
            })),
            clicks: demo.clicks
                .filter(
                    (c) =>
                        !demo.cuts.some(
                            (cut) => c.at > cut.from && c.at < cut.to,
                        ),
                )
                .map((c) => ({
                    ...c,
                    at: toCutTime(c.at, demo.cuts),
                    move: toCutTime(c.move, demo.cuts),
                    ...(c.until !== undefined
                        ? { until: toCutTime(c.until, demo.cuts) }
                        : {}),
                })),
            markers: demo.markers.map((m) => ({
                ...m,
                at: toCutTime(m.at, demo.cuts),
            })),
            cursor: cursorLog(onCamera(cursorEvents, camera), demo.startedAt, demo.cuts, config.record.cursor === 'recorded'),
        },
        null,
        2,
    )
        // One [t, x, y] per line instead of one number per line.
        .replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2, $3]') + '\n',
)

console.log(
    `recorded ${scenario.name}: ${mp4} (${durationSeconds.toFixed(1)}s, ${demo.markers.length} markers)`,
)

/**
 * The @playwright/test the project uses — seen from the scenario, else from the working
 * directory (the project root) — or reelkit's own when the project has none.
 */
function playwrightFor(scenarioFile: string): string {
    for (const from of [scenarioFile, resolve(process.cwd(), 'package.json')]) {
        try {
            const pkg = createRequire(from).resolve('@playwright/test/package.json')
            return pathToFileURL(resolve(dirname(pkg), 'index.mjs')).href
        } catch {
            // not installed there
        }
    }
    return '@playwright/test'
}

function hashSeed(text: string): number {
    let h = 2166136261
    for (const ch of text) {
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    }
    return h >>> 0
}
