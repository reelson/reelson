/**
 * Layouts: where the stage, the recording frame and the footage sit, per output format.
 *
 * Landscape (1920x1080) is the classic stage: the footage fills the frame. Portrait
 * (1080x1920) is a phone-first video: a tall frame shows the footage at a readable size —
 * wider than the frame — and the footage pans to keep the cursor in view (smoothed and aimed
 * a little ahead, like a following zoom); zooms and the cursor ride along. The intro, recap,
 * outro and hand-off cards keep their 16:9 design, zoomed to the stage width. Pure.
 */
import type { Timeline } from './timeline.ts'
import { round } from './timeline.ts'
import type { Zoom } from './zooms.ts'

export type LayoutFormat = 'landscape' | 'portrait'

export interface Layout {
    format: LayoutFormat
    stage: { width: number; height: number }
    frame: { width: number; height: number }
    /** The footage box inside the frame (larger than the frame in portrait). */
    footage: { width: number; height: number }
    /** Zoom of the 16:9 cards (intro, recap, outro, hand-offs) on this stage. */
    bandZoom: number
    /** Footage offset inside the frame over time: [t, x, y] px (empty = none). */
    pan: [number, number, number][]
}

export const PORTRAIT = {
    stage: { width: 1080, height: 1920 },
    frame: { width: 1000, height: 1250 },
    /** Pan samples, smoothing and look-ahead (s). */
    step: 1 / 15,
    lag: 0.6,
    lead: 0.5,
}

export function landscapeLayout(t: Timeline): Layout {
    return { format: 'landscape', stage: { width: 1920, height: 1080 }, frame: t.frame, footage: t.frame, bandZoom: 1, pan: [] }
}

/** The portrait layout, and the timeline's cursor and zooms moved into its frame. */
export function portraitLayout(t: Timeline, zooms: Zoom[]): { layout: Layout; cursor: Timeline['cursor']; zooms: Zoom[] } {
    const { frame } = PORTRAIT
    const view = t.viewport
    const scale = Math.max(frame.width / view.width, frame.height / view.height)
    const footage = { width: Math.round(view.width * scale), height: Math.round(view.height * scale) }
    const maxX = footage.width - frame.width
    const maxY = footage.height - frame.height

    const cursorAt = cursorSampler(t)
    const target = (time: number): [number, number] => {
        const at = cursorAt(time)
        const [cx, cy] = at ?? [view.width / 2, view.height / 2]
        return [clamp(cx * scale - frame.width / 2, 0, maxX), clamp(cy * scale - frame.height / 2, 0, maxY)]
    }
    const alpha = 1 - Math.exp(-PORTRAIT.step / PORTRAIT.lag)
    let [px, py] = target(t.clipStart + PORTRAIT.lead)
    const pan: [number, number, number][] = [[round(t.clipStart), Math.round(px), Math.round(py)]]
    for (let time = t.clipStart + PORTRAIT.step; time < t.clipEnd + 1e-9; time += PORTRAIT.step) {
        const [tx, ty] = target(Math.min(time + PORTRAIT.lead, t.clipEnd))
        px += (tx - px) * alpha
        py += (ty - py) * alpha
        pan.push([Math.round(time * 1000) / 1000, Math.round(px * 10) / 10, Math.round(py * 10) / 10])
    }
    const panAt = (time: number): [number, number] => {
        const i = pan.findIndex((p) => p[0] > time)
        const p = pan[Math.max(0, (i === -1 ? pan.length : i) - 1)]
        return [p[1], p[2]]
    }
    // A transform-origin on the footage (fraction) → the same spot on the frame at `time`.
    const toFrame = (ox: number, oy: number, time: number): [number, number] => {
        const [x, y] = panAt(time)
        return [
            Math.round(clamp((ox * footage.width - x) / frame.width, 0, 1) * 10000) / 10000,
            Math.round(clamp((oy * footage.height - y) / frame.height, 0, 1) * 10000) / 10000,
        ]
    }

    return {
        layout: { format: 'portrait', stage: PORTRAIT.stage, frame, footage, bandZoom: PORTRAIT.stage.width / 1920, pan },
        cursor: t.cursor ? { ...t.cursor, scale: Math.round((footage.width / view.width) * 10000) / 10000 } : null,
        // The footage is already shown larger than in landscape: a zoom ends at the same size
        // on screen as it does there, so it magnifies less (never below 1.05x).
        zooms: zooms.map((z) => {
            const [x, y] = toFrame(z.x, z.y, z.at + z.in)
            const landscape = t.frame.width / view.width
            return {
                ...z,
                scale: Math.max(1.05, Math.round(((z.scale * landscape) / scale) * 100) / 100),
                x,
                y,
                ...(z.path ? { path: z.path.map(([time, ox, oy]) => [time, ...toFrame(ox, oy, time)] as [number, number, number]) } : {}),
            }
        }),
    }
}

/** The cursor's position (recording px) at a composition time, or null without a cursor log. */
function cursorSampler(t: Timeline): (time: number) => [number, number] | null {
    const path = t.cursor?.path ?? []
    if (!path.length) {
        return () => null
    }
    return (time) => {
        let i = path.findIndex((p) => p[0] > time)
        if (i === -1) i = path.length
        const a = path[Math.max(0, i - 1)]
        const b = path[i]
        if (!b || i === 0 || b[0] - a[0] > 0.1) {
            return [a[1], a[2]]
        }
        const u = (time - a[0]) / (b[0] - a[0])
        return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
    }
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n))
}
