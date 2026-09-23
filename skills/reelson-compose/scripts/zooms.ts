/**
 * Zooms on the framed recording, planned from the cursor and checked against it.
 *
 * Rule (style guide #13): a zoom rides along with the cursor and is done before the click.
 *   1. zoom in while the cursor glides to the first click it frames: start at most
 *      EARLY s before the glide starts, and finish SETTLE s before the click;
 *   2. zoom out while the cursor glides to the next target: start at most EARLY s
 *      before that glide, finish SETTLE s before that click. A later click still in
 *      view that follows within ABSORB s joins the hold instead (no out-and-back-in);
 *      a longer pause ends the zoom — widen `clicks` to hold through it. When the next
 *      glide is more than MAX_IDLE s away, the zoom lingers, then leaves on its own;
 *   3. never ease during a click or while typing, and every click in the hold is
 *      inside the zoomed view.
 *
 * `planZoom` turns `{ clicks: [a, b], scale }` into a zoom that satisfies this;
 * `checkZoom` verifies any zoom (planned or manual) and suggests a fix. Pure.
 */
import type { Markers, Timeline, ZoomSpec } from './timeline.ts'
import { round } from './timeline.ts'

export const ZOOM_RULES = {
    defaultEase: 0.8, // the template's default zoom in/out duration
    minEase: 0.4, // shorter reads as a jump
    settle: 0.1, // the zoom is done this long before the click
    early: 0.35, // may start this long before the glide (not more: no waiting)
    linger: 1.2, // with no next target, hold this long after the last action
    absorb: 1.0, // a visible later click whose glide starts within this joins the hold
    maxIdle: 3.0, // a longer wait for the next glide: linger and zoom out, don't sit zoomed
    eps: 0.005, // float slack (13.03 + 4.36 must not fail against 17.39)
    margin: 0.03, // keep clicks this far (fraction of the frame) inside the view
}
const R = ZOOM_RULES

/** A zoom on the composition timeline, as the template consumes it. */
export interface Zoom {
    at: number
    duration: number
    x: number
    y: number
    scale: number
    in: number
    out: number
    /**
     * `follow`: the focus over time, [t, x, y] (transform-origin fractions, composition s),
     * so the view pans with the cursor. The stage tweens between the points.
     */
    path?: [number, number, number][]
}

/**
 * How a following zoom pans: sampled every `step` s, easing towards the cursor with `lag` s
 * of smoothing, aimed `lead` s ahead — where the cursor is going, not where it was (which
 * also cancels the smoothing's delay, and keeps the zoom-in on the click it glides to).
 */
export const FOLLOW = { step: 1 / 15, lag: 0.45, lead: 0.45 }

/**
 * The focus path of a zoom that follows the cursor: at each sample, the transform-origin
 * that puts the cursor in the middle of the zoomed view (clamped so the view never leaves
 * the frame), smoothed so the camera glides instead of jittering. Starts from the planned
 * focus. Pure; `cursor` is the timeline's cursor layer (composition s, recording px).
 */
export function followPath(z: Zoom, cursor: NonNullable<Timeline['cursor']>, viewport: { width: number; height: number }): [number, number, number][] {
    const at = (t: number): [number, number] => {
        const path = cursor.path
        let i = path.findIndex((p) => p[0] > t)
        if (i === -1) i = path.length
        const a = path[Math.max(0, i - 1)]
        const b = path[i]
        if (!b || i === 0 || b[0] - a[0] > 0.1) {
            return [a[1], a[2]]
        }
        const u = (t - a[0]) / (b[0] - a[0])
        return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
    }
    const originFor = (p: number): number => Math.min(1, Math.max(0, (p - 0.5 / z.scale) / (1 - 1 / z.scale)))
    const alpha = 1 - Math.exp(-FOLLOW.step / FOLLOW.lag)
    const end = z.at + z.duration
    let ox = z.x
    let oy = z.y
    const out: [number, number, number][] = [[round(z.at), z.x, z.y]]
    for (let t = z.at + FOLLOW.step; t < end + 1e-9; t += FOLLOW.step) {
        const [cx, cy] = at(Math.min(t + FOLLOW.lead, end))
        ox += (originFor(cx / viewport.width) - ox) * alpha
        oy += (originFor(cy / viewport.height) - oy) * alpha
        out.push([Math.round(t * 1000) / 1000, Math.round(ox * 10000) / 10000, Math.round(oy * 10000) / 10000])
    }
    return out
}

/** A recorded click placed on the composition timeline. */
export interface CompClick {
    /** 1-based position in markers.json `clicks` (what video.json zooms refer to). */
    index: number
    kind: 'click' | 'type'
    /** The click. */
    comp: number
    /** The glide towards it starts. */
    glide: number
    /** Typing ends (kind 'type'); equals comp for clicks. */
    until: number
    /** Position as a fraction of the frame. */
    fx: number
    fy: number
}

export class ZoomError extends Error {}

export function compositionClicks(markers: Markers, timeline: Timeline): CompClick[] {
    if (!markers.clicks || markers.clicks.some((c) => c.move === undefined)) {
        return []
    }
    return markers.clicks
        .map((c, i) => ({ c, index: i + 1 }))
        .filter(({ c }) => c.at >= timeline.mediaStart && c.at <= timeline.mediaEnd)
        .map(({ c, index }) => ({
            index,
            kind: c.kind,
            comp: timeline.toComposition(c.at),
            glide: timeline.toComposition(c.move ?? c.at),
            until: timeline.toComposition(c.until ?? c.at),
            fx: c.x / timeline.viewport.width,
            fy: c.y / timeline.viewport.height,
        }))
}

/** Resolves a video.json zoom (click-anchored or manual) to composition time. */
export function planZoom(spec: ZoomSpec, clicks: CompClick[], timeline: Timeline): Zoom {
    const scale = spec.scale
    if (!spec.clicks) {
        if (spec.at === undefined || spec.duration === undefined || spec.x === undefined || spec.y === undefined) {
            throw new ZoomError('a zoom needs `clicks`, or all of `at`, `duration`, `x`, `y` (manual)')
        }
        return {
            at: timeline.toComposition(spec.at),
            duration: spec.duration,
            x: spec.x,
            y: spec.y,
            scale,
            in: spec.in ?? R.defaultEase,
            out: spec.out ?? R.defaultEase,
        }
    }
    if (spec.at !== undefined || spec.duration !== undefined) {
        throw new ZoomError('a zoom with `clicks` is timed automatically; drop `at`/`duration` (or drop `clicks` for a manual zoom)')
    }

    const [a, b = a] = spec.clicks
    if (b < a) {
        throw new ZoomError(`clicks [${a}, ${b}]: the first number must not be after the second`)
    }
    const byIndex = (n: number): CompClick => {
        const found = clicks.find((c) => c.index === n)
        if (!found) {
            const available = clicks.map((c) => c.index)
            throw new ZoomError(
                `click ${n} is not in the trimmed recording (available: ${available.length ? `${available[0]}–${available.at(-1)}` : 'none — re-record to log clicks'})`,
            )
        }
        return found
    }
    const first = byIndex(a)
    byIndex(b)
    const selected = clicks.filter((c) => c.index >= a && c.index <= b)

    // A following zoom pans to each click, so they need not fit in one view: it starts with
    // the first click in the middle of the view.
    const centred = (p: number): number => Math.round(Math.min(1, Math.max(0, (p - 0.5 / scale) / (1 - 1 / scale))) * 10000) / 10000
    const x = spec.x ?? (spec.follow ? centred(first.fx) : fitFocus(selected.map((c) => c.fx), scale, `clicks ${a}–${b}`, 'wide'))
    const y = spec.y ?? (spec.follow ? centred(first.fy) : fitFocus(selected.map((c) => c.fy), scale, `clicks ${a}–${b}`, 'tall'))
    const visible = spec.follow ? () => true : isVisibleIn(viewOf(x, y, scale))

    const zoomIn = spec.in ?? R.defaultEase
    const at =
        spec.in !== undefined
            ? round(first.comp - R.settle - zoomIn)
            : round(Math.max(first.glide - R.early, first.comp - R.settle - R.defaultEase))
    const inEase = spec.in ?? round(Math.max(R.minEase, Math.min(R.defaultEase, first.comp - R.settle - at)))

    // The zoom holds its clicks, plus later ones it still shows that follow right away
    // (zooming out and straight back in would jump); the first other click ends it.
    let holdEnd = Math.max(...selected.map((c) => c.until))
    let next: CompClick | undefined
    for (const c of clicks.filter((c) => c.index > b)) {
        if (visible(c) && c.glide - holdEnd <= R.absorb) {
            holdEnd = Math.max(holdEnd, c.until)
            continue
        }
        next = c
        break
    }

    // The recording belts out before a hand-off card and fades out at the end.
    const nextCard = timeline.transitions.find((t) => t.at > first.comp)
    const limit = Math.min(timeline.clipEnd - 0.1, nextCard ? nextCard.at - timeline.belt : Infinity)

    let outEnd: number
    let outEase: number
    if (next && next.comp - R.settle <= limit && next.glide - holdEnd <= R.maxIdle) {
        outEnd = next.comp - R.settle
        const outStart = Math.max(next.glide - R.early, outEnd - R.defaultEase, holdEnd + 0.2)
        outEase = spec.out ?? Math.max(R.minEase, outEnd - outStart)
    } else {
        outEase = spec.out ?? R.defaultEase
        outEnd = Math.min(holdEnd + R.linger + outEase, limit)
    }

    return {
        at,
        duration: round(outEnd - at),
        x,
        y,
        scale,
        in: round(inEase),
        out: round(outEase),
    }
}

export interface ZoomCheck {
    problems: string[]
    framed: CompClick[]
}

/**
 * Zooms on screen at the same time (they would fight over the frame): one message per
 * overlapping pair, keyed by the 0-based index of the later zoom in video.json order.
 */
export function zoomOverlaps(zooms: Zoom[]): { index: number; message: string }[] {
    const found: { index: number; message: string }[] = []
    zooms.forEach((z, j) => {
        zooms.forEach((other, i) => {
            if (i < j && z.at < round(other.at + other.duration) && other.at < round(z.at + z.duration)) {
                found.push({
                    index: j,
                    message: `overlaps zoom ${i + 1} (${other.at}–${round(other.at + other.duration)}s) — one zoom over both click ranges, or drop one`,
                })
            }
        })
    })
    return found
}

/** Verifies a zoom against the clicks; problems carry a copy-paste fix. */
export function checkZoom(z: Zoom, clicks: CompClick[], timeline: Timeline): ZoomCheck {
    const end = round(z.at + z.duration)
    const visible = isVisibleIn(viewOf(z.x, z.y, z.scale))
    const describe = (c: CompClick): string =>
        `${c.kind} #${c.index} at ${c.comp}s (glide from ${c.glide}s, ${Math.round(c.fx * 100)}%, ${Math.round(c.fy * 100)}%)`

    const problems: string[] = []
    const inside = clicks.filter((c) => c.comp >= z.at && c.comp <= end)
    // A following zoom keeps the cursor in view: every click in it is framed.
    const framed = z.path ? inside : inside.filter(visible)
    const first = framed[0]
    const last = framed.at(-1)
    const next = clicks.find((c) => c.comp > (last?.comp ?? z.at) && !(c.comp <= end && (z.path || visible(c))))

    if (!first) {
        problems.push('frames no click — anchor it with `clicks`, or drop the zoom')
    } else {
        const fix = ` → use { "clicks": [${first.index}, ${(last ?? first).index}], "scale": ${z.scale} }`
        if (z.at + z.in > first.comp - R.settle + R.eps) {
            problems.push(`zoom-in not done before the ${describe(first)}${fix}`)
        } else if (z.at < first.glide - R.early - R.eps) {
            problems.push(`zoom-in starts before the cursor moves (the viewer waits)${fix}`)
        }
        for (const c of inside) {
            if (!visible(c) && !z.path) {
                problems.push(`${describe(c)} is outside the zoomed view${fix}`)
            } else if (c.comp > end - z.out + R.eps) {
                problems.push(`${describe(c)} happens while the zoom eases out${fix}`)
            } else if (c.until > end - z.out + R.eps) {
                problems.push(`typing (${describe(c)}) is still going when the zoom eases out${fix}`)
            }
        }
        if (next && end > next.comp - R.settle + R.eps && !inside.includes(next)) {
            problems.push(`zoom-out not done before the ${describe(next)}${fix}`)
        } else if (next && end - z.out < next.glide - R.early - R.eps && end > next.glide - R.early + R.eps) {
            // Easing out across the start of the glide without riding it (a zoom that is fully
            // out before the cursor even moves is fine: it lingered, then left).
            problems.push(`zoom-out starts before the cursor heads for the next target${fix}`)
        }
    }
    if (z.in < R.minEase || z.out < R.minEase) {
        problems.push(`ease shorter than ${R.minEase}s reads as a jump — add a beat in the scenario instead`)
    }
    if (end > timeline.clipEnd + R.eps) {
        problems.push(`runs past the end of the recording (${timeline.clipEnd}s)`)
    }
    for (const t of timeline.transitions) {
        if (z.at < t.at && end > t.at - timeline.belt + R.eps) {
            problems.push(`still zoomed when the recording leaves for the hand-off card at ${t.at}s`)
        }
    }

    return { problems, framed }
}

/** The part of the frame visible at full zoom (transform-origin = focus point). */
function viewOf(x: number, y: number, scale: number) {
    return {
        left: x - x / scale,
        right: x + (1 - x) / scale,
        top: y - y / scale,
        bottom: y + (1 - y) / scale,
    }
}

function isVisibleIn(view: ReturnType<typeof viewOf>): (c: CompClick) => boolean {
    return (c) =>
        c.fx >= view.left + R.margin - R.eps &&
        c.fx <= view.right - R.margin + R.eps &&
        c.fy >= view.top + R.margin - R.eps &&
        c.fy <= view.bottom - R.margin + R.eps
}

/**
 * A focus coordinate (0..1) that keeps every point visible at `scale`, as close
 * to their centre as possible. With origin o, point p shows iff
 * o - o/s ≤ p ≤ o + (1 - o)/s.
 */
function fitFocus(points: number[], scale: number, what: string, axis: string): number {
    const p1 = Math.min(...points) - R.margin
    const p2 = Math.max(...points) + R.margin
    const lo = Math.max(0, (p2 * scale - 1) / (scale - 1))
    const hi = Math.min(1, (p1 * scale) / (scale - 1))
    if (lo > hi + 1e-9) {
        throw new ZoomError(`${what} are too far apart (${axis}) to show at ${scale}x — lower the scale or split the zoom`)
    }
    const mid = (Math.min(...points) + Math.max(...points)) / 2

    return Math.round(Math.min(hi, Math.max(lo, mid)) * 1000) / 1000
}
