/**
 * Layouts: where the stage, the recording frame and the footage sit, per output format.
 *
 * Landscape (1920x1080) is the classic stage: the footage fills the frame.
 *
 * Portrait (1080x1920) has two sources:
 *   - a mobile recording (`reelson record --mobile`: the app at a phone viewport) — shown whole
 *     in a tall frame, like a phone screen: nothing cropped, text at full size;
 *   - the desktop recording — too wide to show whole at a readable size, so a camera frames
 *     what the demo is working on (reelson-record's `focus`: the element it moved to, with its
 *     surroundings, e.g. a form field with its label) as close as it can while the whole area
 *     still fits, and eases between framings. It never crops the element in use; with nothing
 *     to frame it shows the full width. The frame grows and shrinks with the camera, so it
 *     never shows empty space.
 *
 * Square (1080x1080) comes from a square take (`reelson record --square`: the app in a square
 * browser), which fills the whole stage: no bands above or below it.
 *
 * Sections lay themselves out per format (`#root.portrait …`, `#root.square …`); one without
 * its own layout keeps its 16:9 card, zoomed to the stage width. Pure.
 */
import type { Box, Timeline } from './timeline.ts'
import { round } from './timeline.ts'
import type { Zoom } from './zooms.ts'

export type LayoutFormat = 'landscape' | 'portrait' | 'square'

export interface Layout {
    format: LayoutFormat
    /** Portrait from a phone take (the frame is the phone screen). */
    phone?: boolean
    stage: { width: number; height: number }
    /** The frame box (desktop portrait: its tallest; its height follows the camera). */
    frame: { width: number; height: number }
    /** The footage box at camera scale 1. */
    footage: { width: number; height: number }
    /** Zoom of the 16:9 cards (intro, recap, outro, hand-offs) on this stage. */
    bandZoom: number
    /**
     * The camera over time: [t, k, x, y, h] — footage scale k (1 = full width), footage offset
     * x/y and frame height h, px. Empty: the footage fills the frame, still.
     */
    camera: [number, number, number, number, number][]
}

export const PORTRAIT = {
    stage: { width: 1080, height: 1920 },
    frame: { width: 1000, maxHeight: 1450 },
    /** A mobile recording's frame fits in this box (the stage keeps room for one callout). */
    phone: { maxWidth: 900, maxHeight: 1660 },
    /** Closest framing: stage px per recording CSS px (1.4 ≈ text at 1.4x its size). */
    maxScale: 1.4,
    /** Room around the framed area, recording CSS px. */
    padding: 40,
    /** Moving to a new framing: starts as the cursor heads there, takes this long (s). */
    ease: 0.7,
    lead: 0.15,
    /** After this long with nothing new to frame, ease back to the full width. */
    rest: 3.5,
    step: 1 / 15,
}

export function landscapeLayout(t: Timeline): Layout {
    return { format: 'landscape', stage: { width: 1920, height: 1080 }, frame: t.frame, footage: t.frame, bandZoom: 1, camera: [] }
}

const bandZoom = PORTRAIT.stage.width / 1920

export const SQUARE = { stage: { width: 1080, height: 1080 } }

/** Square from a square take: the recording fills the stage, edge to edge. */
export function squareLayout(t: Timeline): { layout: Layout; cursor: Timeline['cursor'] } {
    const { width, height } = SQUARE.stage
    const scale = Math.max(width / t.viewport.width, height / t.viewport.height)
    const footage = { width: Math.round(t.viewport.width * scale), height: Math.round(t.viewport.height * scale) }
    return {
        layout: { format: 'square', stage: SQUARE.stage, frame: SQUARE.stage, footage, bandZoom: width / 1920, camera: [] },
        cursor: t.cursor ? { ...t.cursor, scale: Math.round(scale * 10000) / 10000 } : null,
    }
}

/** Portrait from a mobile recording: the whole phone screen in a tall frame. */
export function phoneLayout(t: Timeline): { layout: Layout; cursor: Timeline['cursor']; zooms: Zoom[] } {
    const view = t.viewport
    const scale = Math.min(PORTRAIT.phone.maxWidth / view.width, PORTRAIT.phone.maxHeight / view.height)
    const box = { width: Math.round(view.width * scale), height: Math.round(view.height * scale) }
    return {
        layout: { format: 'portrait', phone: true, stage: PORTRAIT.stage, frame: box, footage: box, bandZoom, camera: [] },
        // A phone is tapped: the ripples show where, an arrow would look wrong.
        cursor: t.cursor ? { ...t.cursor, scale: Math.round(scale * 10000) / 10000, touch: true } : null,
        zooms: [],
    }
}

interface Shot {
    /** Stage px per recording CSS px. */
    s: number
    /** Recording CSS px at the middle of the frame. */
    cx: number
    cy: number
}

/** Portrait from the desktop recording: the camera described above. */
export function portraitLayout(t: Timeline): { layout: Layout; cursor: Timeline['cursor']; zooms: Zoom[] } {
    const view = t.viewport
    const { width: W, maxHeight: H } = PORTRAIT.frame
    const fit = W / view.width
    const frameHeight = (s: number) => Math.min(H, view.height * s)

    const overview: Shot = { s: fit, cx: view.width / 2, cy: view.height / 2 }
    const shotFor = (area: Box): Shot => {
        const pad = PORTRAIT.padding
        const s = clamp(Math.min(PORTRAIT.maxScale, W / (area.width + 2 * pad), H / (area.height + 2 * pad)), fit, Math.max(fit, PORTRAIT.maxScale))
        const halfW = W / (2 * s)
        const halfH = frameHeight(s) / (2 * s)
        return {
            s,
            cx: clamp(area.x + area.width / 2, halfW, view.width - halfW),
            cy: clamp(area.y + area.height / 2, halfH, view.height - halfH),
        }
    }

    // Moves: when a new framing starts, and where it goes.
    const moves: { at: number; to: Shot }[] = []
    const focus = [...t.focus].sort((a, b) => a.at - b.at)
    focus.forEach((f, i) => {
        moves.push({ at: Math.max(t.clipStart, f.at - PORTRAIT.lead), to: shotFor(f.area) })
        const next = focus[i + 1]
        const quiet = f.at + PORTRAIT.rest
        if (!next || next.at - PORTRAIT.lead > quiet + PORTRAIT.ease) {
            moves.push({ at: quiet, to: overview })
        }
    })
    // Each move starts from wherever the previous one had got to when it begins.
    const progress = (j: number, from: Shot, time: number): Shot =>
        mix(from, moves[j].to, easeInOut(Math.min(1, Math.max(0, (time - moves[j].at) / PORTRAIT.ease))))
    const starts: Shot[] = []
    moves.forEach((move, j) => {
        starts.push(j === 0 ? overview : progress(j - 1, starts[j - 1], move.at))
    })
    const shotAt = (time: number): Shot => {
        const j = moves.findLastIndex((m) => m.at <= time)
        return j === -1 ? overview : progress(j, starts[j], time)
    }

    const camera: Layout['camera'] = []
    for (let time = t.clipStart; time < t.clipEnd + 1e-9; time += PORTRAIT.step) {
        const shot = shotAt(time)
        const h = frameHeight(shot.s)
        camera.push([
            Math.round(time * 1000) / 1000,
            Math.round((shot.s / fit) * 10000) / 10000,
            Math.round((W / 2 - shot.cx * shot.s) * 10) / 10,
            Math.round((h / 2 - shot.cy * shot.s) * 10) / 10,
            Math.round(h),
        ])
    }

    const landscapeScale = t.frame.width / view.width
    return {
        layout: {
            format: 'portrait',
            stage: PORTRAIT.stage,
            frame: { width: W, height: H },
            footage: { width: W, height: Math.round(view.height * fit) },
            bandZoom,
            camera,
        },
        // Positions in footage px (scale `fit`); drawn at the size it has in landscape.
        cursor: t.cursor
            ? { ...t.cursor, scale: Math.round(fit * 10000) / 10000, size: round((t.cursor.size * landscapeScale) / fit) }
            : null,
        // The camera frames what matters; landscape zooms would fight it.
        zooms: [],
    }
}

function mix(a: Shot, b: Shot, u: number): Shot {
    return { s: a.s + (b.s - a.s) * u, cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u }
}

function easeInOut(u: number): number {
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n))
}

/** Stage px a bottom callout covers (its 34–40 px margin, a line or two of pill). */
export const CALLOUT_BAND = 150

/**
 * Callouts that would cover what the demo works on while they show: the cursor (moves and
 * presses) or the focused area reaching into the band a bottom callout covers. The stage
 * shows those at the top instead. Only where callouts sit over the footage (landscape,
 * square); portrait puts them below the frame.
 */
export function calloutsAtTop(t: Timeline, layout: Layout): Set<number> {
    const top = new Set<number>()
    if (layout.format === 'portrait') {
        return top
    }
    // Where the band starts, as recording CSS px (the frame is centred on the stage).
    const frameTop = (layout.stage.height - layout.frame.height) / 2
    const scale = layout.footage.height / t.viewport.height
    const footageTop = frameTop + (layout.frame.height - layout.footage.height) / 2
    const limit = (layout.stage.height - CALLOUT_BAND - footageTop) / scale
    const points = [...(t.cursor?.path ?? []), ...(t.cursor?.presses ?? [])]
    t.callouts.forEach((c, i) => {
        const during = (at: number) => at >= c.at && at <= c.at + c.duration
        const low =
            points.some(([at, , y]) => during(at) && y > limit) ||
            t.focus.some((f) => during(f.at) && f.area.y + f.area.height > limit)
        if (low) top.add(i)
    })
    return top
}
