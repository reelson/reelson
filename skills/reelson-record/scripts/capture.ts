/**
 * Films the page with Chrome's screencast instead of Playwright's video.
 *
 * Playwright's recorder writes a fixed 25 fps WebM, so in the 30 fps recording.mp4
 * scrolling, hovers and UI transitions stutter (one frame in six repeats). The screencast
 * hands over every frame the compositor paints (up to 60 fps, full device pixels), each
 * stamped with the time it was painted on this machine's clock — the same clock as the
 * markers, clicks and cursor log. `frameSchedule` turns those frames into a constant-rate
 * video: at every instant, the latest frame painted so far, with demo.cut() ranges removed.
 */
import type { BrowserContext, CDPSession, Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface Frame {
    file: string
    /** When Chrome painted it: epoch milliseconds. */
    t: number
    /** Which page painted it (0 = the first); see `frameSchedule` switches. */
    page?: number
}

/** From `t` (epoch ms) on, the video shows `page`. */
export interface CameraSwitch {
    t: number
    page: number
}

export interface Screencast {
    /** Stops filming and waits until every frame is on disk. */
    stop: () => Promise<Frame[]>
}

/** Starts filming `page`; frames are written into `dir` as they arrive, tagged `pageId`. */
export async function startScreencast(context: BrowserContext, page: Page, dir: string, pageId = 0, quality = 92): Promise<Screencast> {
    mkdirSync(dir, { recursive: true })
    const cdp: CDPSession = await context.newCDPSession(page)
    const frames: Frame[] = []
    const writes: Promise<void>[] = []
    cdp.on('Page.screencastFrame', (event: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
        // Ack first: Chrome sends the next frame only after the previous one is acknowledged.
        cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
        const file = resolve(dir, `${pageId ? `p${pageId}-` : ''}f${String(frames.length).padStart(6, '0')}.jpg`)
        frames.push({ file, t: (event.metadata.timestamp ?? Date.now() / 1000) * 1000, page: pageId })
        writes.push(writeFile(file, Buffer.from(event.data, 'base64')))
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, everyNthFrame: 1 })

    return {
        stop: async () => {
            await cdp.send('Page.stopScreencast').catch(() => {})
            await Promise.all(writes)
            await cdp.detach().catch(() => {})
            return frames
        },
    }
}

/**
 * How long each frame stays on screen in the finished video (seconds), in order. Video
 * time 0 is `startedAt` (the recording clock of createDemo); a frame shows from the moment
 * it was painted until the next one; the first frame also covers anything before it.
 * `cuts` are ranges of that clock (seconds) left out of the video. With `switches`, only
 * the page the camera is on counts at each moment (a pop-up, then back to its opener, which
 * shows its last frame from before); without, every frame counts.
 */
export function frameSchedule(
    frames: Frame[],
    startedAt: number,
    endedAt: number,
    cuts: { from: number; to: number }[],
    switches?: CameraSwitch[],
): { file: string; duration: number }[] {
    const end = (endedAt - startedAt) / 1000
    const seconds = (t: number) => (t - startedAt) / 1000
    const camera = switches?.length
        ? [...switches].sort((a, b) => a.t - b.t).map((s) => ({ at: Math.max(0, seconds(s.t)), page: s.page }))
        : [{ at: 0, page: -1 }]
    const pieces = camera.map((c, i) => ({ from: i === 0 ? 0 : c.at, to: i + 1 < camera.length ? camera[i + 1].at : end, page: c.page }))
    const kept = keptRanges(cuts, end)
    const out: { file: string; duration: number }[] = []
    const add = (file: string, from: number, to: number) => {
        for (const range of kept) {
            const overlap = Math.min(to, range.to) - Math.max(from, range.from)
            if (overlap <= 0) {
                continue
            }
            const last = out[out.length - 1]
            if (last?.file === file) {
                last.duration += overlap
            } else {
                out.push({ file, duration: overlap })
            }
        }
    }
    for (const piece of pieces.filter((p) => p.to > p.from)) {
        const own = frames
            .filter((f) => piece.page === -1 || (f.page ?? 0) === piece.page)
            .sort((a, b) => a.t - b.t)
            .map((f) => ({ file: f.file, t: seconds(f.t) }))
        if (!own.length) {
            continue
        }
        // On screen at the start of the piece: the page's latest frame so far, else its first.
        let i = Math.max(0, own.findLastIndex((f) => f.t <= piece.from))
        for (; i < own.length && own[i].t < piece.to; i++) {
            const from = Math.max(piece.from, own[i].t)
            const to = Math.min(piece.to, i + 1 < own.length ? own[i + 1].t : piece.to)
            if (to > from) {
                add(own[i].file, i === 0 && own[i].t > piece.from ? piece.from : from, to)
            }
        }
    }

    return out
}

/** [0, end] minus the cuts. */
function keptRanges(cuts: { from: number; to: number }[], end: number): { from: number; to: number }[] {
    const ranges: { from: number; to: number }[] = []
    let at = 0
    for (const c of [...cuts].sort((a, b) => a.from - b.from)) {
        if (c.from > at) {
            ranges.push({ from: at, to: Math.min(c.from, end) })
        }
        at = Math.max(at, c.to)
    }
    if (at < end) {
        ranges.push({ from: at, to: end })
    }
    return ranges.filter((r) => r.to > r.from)
}

/** The finished recording's frame rate. */
export const FPS = 30

/**
 * Encodes the schedule as the H.264 recording.mp4 HyperFrames consumes: output frame k
 * (at k / FPS s) is the latest frame painted by then, piped straight into ffmpeg at a
 * constant rate. (ffmpeg's concat demuxer would snap image timestamps to 25 fps.)
 */
export async function encodeFrames(schedule: { file: string; duration: number }[], mp4: string): Promise<boolean> {
    if (!schedule.length) {
        return false
    }
    const total = schedule.reduce((sum, e) => sum + e.duration, 0)
    const count = Math.max(1, Math.round(total * FPS))
    const ffmpeg = spawn(
        'ffmpeg',
        [
            '-y', '-loglevel', 'error',
            '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS),
            // A keyframe every second: HyperFrames seeks frame by frame.
            '-g', String(FPS), '-keyint_min', String(FPS),
            '-movflags', '+faststart', '-an', mp4,
        ],
        { stdio: ['pipe', 'inherit', 'inherit'] },
    )
    const done = new Promise<boolean>((resolveDone) => {
        ffmpeg.on('error', () => resolveDone(false))
        ffmpeg.on('close', (code) => resolveDone(code === 0))
    })
    ffmpeg.stdin.on('error', () => {}) // ffmpeg exiting early is reported by `done`

    let index = 0
    let endOfCurrent = schedule[0].duration
    let loaded = -1
    let bytes = Buffer.alloc(0)
    for (let k = 0; k < count; k++) {
        const t = k / FPS
        while (index < schedule.length - 1 && t >= endOfCurrent - 1e-9) {
            index++
            endOfCurrent += schedule[index].duration
        }
        if (index !== loaded) {
            bytes = readFileSync(schedule[index].file)
            loaded = index
        }
        if (!ffmpeg.stdin.write(bytes)) {
            await new Promise((drained) => ffmpeg.stdin.once('drain', drained))
        }
    }
    ffmpeg.stdin.end()

    return done
}
