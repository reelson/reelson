/**
 * `reelkit doctor`: is this machine ready to record and render, and does the cursor layer
 * line up with the footage here? Checks the tools, then films a local test page the way
 * `reelkit record` does (screencast + the page's cursor log) with a magenta dot drawn at the
 * pointer, finds the dot in every frame and measures how far the logged cursor is from it.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startScreencast, type Frame } from './capture.ts'
import { CURSOR_BINDING, cursorOverlayScript, type CursorEvent } from './cursor-overlay.ts'

export interface SyncResult {
    /** Frames per second while the page moves. */
    fps: number
    /** Video time − logged time that fits best (ms); ~0 means the layer sits on the footage. */
    lagMs: number
    /** Median distance (CSS px) between the logged cursor and the drawn dot at that lag. */
    errorPx: number
    frames: number
}

type Log = (line: string) => void

export async function doctor(log: Log = console.log): Promise<number> {
    let problems = 0
    const check = (ok: boolean, good: string, bad: string): void => {
        log(`${ok ? '✓' : '✗'} ${ok ? good : bad}`)
        if (!ok) problems++
    }
    const [major, minor] = process.versions.node.split('.').map(Number)
    check(major > 22 || (major === 22 && minor >= 18), `Node ${process.versions.node}`, `Node ${process.versions.node} — reelkit needs 22.18+`)
    for (const tool of ['ffmpeg', 'ffprobe']) {
        const found = spawnSync(tool, ['-version'], { encoding: 'utf8' })
        check(found.status === 0, `${found.stdout.split('\n')[0]}`, `${tool} not found — brew install ffmpeg`)
    }
    try {
        const { hyperframesDist, HYPERFRAMES_VERSION } = await import('../../reelkit-compose/scripts/hyperframes.ts')
        hyperframesDist()
        check(true, `HyperFrames ${HYPERFRAMES_VERSION}`, '')
    } catch (error) {
        check(false, '', `HyperFrames: ${(error as Error).message}`)
    }
    try {
        const sync = await measureCursorSync()
        check(sync.fps >= 30, `screencast: ${sync.fps.toFixed(0)} fps at 2x`, `screencast only ${sync.fps.toFixed(0)} fps — footage will stutter; try record.capture "playwright"`)
        check(
            Math.abs(sync.lagMs) <= 34 && sync.errorPx <= 3,
            `cursor layer lines up with the footage: offset ${sync.lagMs} ms, ${sync.errorPx.toFixed(1)} px (${sync.frames} frames)`,
            `cursor layer is off by ${sync.lagMs} ms / ${sync.errorPx.toFixed(1)} px on this machine — use record.cursor "recorded", and report it`,
        )
    } catch (error) {
        check(false, '', `could not film a test page: ${(error as Error).message} — npx playwright install chromium`)
    }
    log(problems ? `\n${problems} problem(s)` : '\nready to record and render')
    return problems
}

const PAGE = `<body style="margin:0;background:#fff"><div id="dot" style="position:fixed;left:0;top:0;width:8px;height:8px;background:#f0f;transform:translate(-99px,-99px)"></div>
<script>document.addEventListener('mousemove', (e) => { dot.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 4) + 'px)' }, true)</script></body>`

/** Films a local page with a pointer moving over it; see the file comment. */
export async function measureCursorSync(): Promise<SyncResult> {
    const { chromium } = await import('@playwright/test')
    const dir = mkdtempSync(join(tmpdir(), 'reelkit-doctor-'))
    const viewport = { width: 1440, height: 900 }
    const browser = await chromium.launch({ args: ['--force-device-scale-factor=2'] })
    try {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
        const events: CursorEvent[] = []
        await context.exposeBinding(CURSOR_BINDING, (_source, event: CursorEvent) => {
            events.push(event)
        })
        await context.addInitScript(cursorOverlayScript('#6366f1', { draw: false, report: true }))
        const page = await context.newPage()
        // A real navigation (setContent would replace the document the cursor log listens on).
        await page.route('https://reelkit.doctor/', (route) => route.fulfill({ contentType: 'text/html', body: PAGE }))
        await page.goto('https://reelkit.doctor/')
        const filming = await startScreencast(context, page, dir)

        await page.mouse.move(200, 200)
        for (let i = 0; i < 150; i++) {
            const u = i / 150
            await page.mouse.move(200 + 1000 * u, 200 + 400 * Math.sin(u * Math.PI * 2) * 0.5 + 200 * u)
            await page.waitForTimeout(16)
        }
        const frames = await filming.stop()
        return analyse(frames, events.filter((e) => e.type === 'move'), viewport)
    } finally {
        await browser.close()
        rmSync(dir, { recursive: true, force: true })
    }
}

function analyse(frames: Frame[], moves: CursorEvent[], viewport: { width: number; height: number }): SyncResult {
    const { width: w, height: h } = viewport
    // Decode every frame at CSS size in one ffmpeg run, then find the magenta dot in each.
    const decoded = spawnSync(
        'ffmpeg',
        ['-loglevel', 'error', '-i', resolve(frames[0].file, '..', 'f%06d.jpg'), '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { maxBuffer: w * h * 3 * (frames.length + 1) },
    )
    const size = w * h * 3
    const dots: { t: number; x: number; y: number }[] = []
    frames.forEach((frame, i) => {
        const px = decoded.stdout.subarray(i * size, (i + 1) * size)
        let sx = 0
        let sy = 0
        let n = 0
        for (let p = 0; p + 2 < px.length; p += 3) {
            if (px[p] > 180 && px[p + 2] > 180 && px[p + 1] < 90) {
                const k = p / 3
                sx += k % w
                sy += Math.floor(k / w)
                n++
            }
        }
        if (n >= 12) {
            dots.push({ t: frame.t, x: sx / n, y: sy / n })
        }
    })
    const at = (t: number): CursorEvent | undefined => {
        let last: CursorEvent | undefined
        for (const m of moves) {
            if (m.t <= t) last = m
            else break
        }
        return last
    }
    const errorAt = (lag: number): number => {
        const errors = dots.flatMap((d) => {
            const m = at(d.t - lag)
            return m ? [Math.hypot(d.x - m.x, d.y - m.y)] : []
        })
        errors.sort((a, b) => a - b)
        return errors.length ? errors[errors.length >> 1] : Infinity
    }
    let best = { lag: 0, error: errorAt(0) }
    for (let lag = -100; lag <= 100; lag += 4) {
        const error = errorAt(lag)
        if (error < best.error - 0.05) best = { lag, error }
    }
    const span = (frames.at(-1)!.t - frames[0].t) / 1000

    return { fps: frames.length / Math.max(span, 0.001), lagMs: best.lag, errorPx: best.error, frames: dots.length }
}
