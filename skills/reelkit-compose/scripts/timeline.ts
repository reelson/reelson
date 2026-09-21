/**
 * The composition timeline, computed from a recording's markers.json and the
 * video's video.json. Pure: no files, no ffmpeg — so it is unit-tested.
 *
 *   cover (0 → coverExit) → recording (callouts, zooms, hand-off cards)
 *   → recap card → brand card
 *
 * video.json times are recording times; everything this module returns is in
 * composition seconds.
 */

/** Timeline constants (seconds). A template's template.json can override any of them. */
export const TIMING_DEFAULTS = {
    cover: 4.0, // cover clip length
    coverExit: 3.0, // the cover lifts away and the recording rides in (= clipStart)
    recapBase: 2.4, // + recapPerStep per step, capped at recapMax
    recapPerStep: 0.45,
    recapMax: 7.5,
    brandOut: 2.6,
    overlap: 0.4, // recording → recap → brand card cross-fades
    calloutDuration: 3.0,
    transitionGap: 2.6, // seconds a hand-off card holds between the two belts
    belt: 0.9, // the recording's exit before a hand-off card (matches the template)
    maxW: 1600, // the framed recording's box inside the 1920x1080 stage
    maxH: 940,
    maxSteps: 10, // the recap card's capacity
}
export type Timing = typeof TIMING_DEFAULTS

export interface Click {
    at: number
    move?: number
    until?: number
    x: number
    y: number
    kind: 'click' | 'type'
}

export interface HandOff {
    at: number
    title: string
    subtitle?: string
    from?: string
    to?: string
}

/** What reelkit-record writes (or what build.ts probes from a manual recording). */
export interface Markers {
    scenario?: string
    viewport: { width: number; height: number }
    durationSeconds: number
    markers: { label: string; at: number }[]
    clicks?: Click[]
    transitions?: HandOff[]
    cuts?: { from: number; to: number }[]
}

export interface CalloutSpec {
    text: string
    marker?: string
    at?: number
    duration?: number
    group?: string
}

export interface ZoomSpec {
    scale: number
    clicks?: number[]
    x?: number
    y?: number
    at?: number
    duration?: number
    in?: number
    out?: number
}

/** video.json */
export interface VideoSpec {
    title: string
    subtitle?: string
    template?: string
    recapTitle?: string
    brand?: { name?: string; tagline?: string; eyebrow?: string }
    trim?: { start?: number; end?: number }
    music?: string | boolean | null
    callouts?: CalloutSpec[]
    zooms?: ZoomSpec[]
}

export interface Callout {
    at: number
    duration: number
    text: string
    group?: string
}

export interface Timeline {
    total: number
    cover: number
    coverExit: number
    clipStart: number
    clipDuration: number
    clipEnd: number
    /** Recording window used (trim). */
    mediaStart: number
    mediaEnd: number
    recapStart: number
    recapDuration: number
    brandOutStart: number
    brandOutDuration: number
    /** Seconds the recording takes to leave before a hand-off card. */
    belt: number
    frame: { width: number; height: number }
    viewport: { width: number; height: number }
    /** Hand-off cards: composition time the card is fully in, and how long it holds. */
    transitions: { at: number; gap: number; card: HandOff }[]
    /** One <video> clip per stretch of footage between hand-offs. */
    segments: { start: number; duration: number; mediaStart: number }[]
    callouts: Callout[]
    /** Recording time → composition time (footage after a hand-off is pushed back by the gap). */
    toComposition: (recordingTime: number) => number
}

export class TimelineError extends Error {}

export function computeTimeline(
    markers: Markers,
    spec: VideoSpec,
    timing: Timing = TIMING_DEFAULTS,
): { timeline: Timeline; warnings: string[] } {
    const warnings: string[] = []
    const mediaStart = spec.trim?.start ?? 0
    const mediaEnd = Math.min(spec.trim?.end ?? markers.durationSeconds, markers.durationSeconds)
    const mediaDuration = round(mediaEnd - mediaStart)
    if (mediaDuration <= 0) {
        throw new TimelineError(`trim window is empty (start ${mediaStart}s, end ${mediaEnd}s)`)
    }

    const clipStart = timing.coverExit
    const handOffs = (markers.transitions ?? []).filter((t) => t.at > mediaStart && t.at < mediaEnd)
    const gap = timing.transitionGap
    const clipDuration = round(mediaDuration + gap * handOffs.length)
    const clipEnd = round(clipStart + clipDuration)
    const toComposition = (t: number): number =>
        round(clipStart + (t - mediaStart) + gap * handOffs.filter((h) => h.at <= t).length)
    const transitions = handOffs.map((card, i) => ({
        at: round(clipStart + (card.at - mediaStart) + gap * i),
        gap,
        card,
    }))

    const bounds = [mediaStart, ...handOffs.map((t) => t.at), mediaEnd]
    const segments = bounds.slice(0, -1).map((from, i) => ({
        start: round(clipStart + (from - mediaStart) + gap * i),
        duration: round(bounds[i + 1] - from),
        mediaStart: round(from),
    }))

    // Callouts: resolve each to a recording time, keep the ones inside the window, in order.
    const specs = spec.callouts ?? defaultCallouts(markers)
    const unknown = specs.filter((c) => c.marker !== undefined && !markers.markers.some((m) => m.label === c.marker))
    if (unknown.length) {
        throw new TimelineError(
            `callout(s) reference unknown markers: ${unknown.map((c) => JSON.stringify(c.marker)).join(', ')} ` +
                `— markers.json has ${markers.markers.map((m) => JSON.stringify(m.label)).join(', ') || 'none'}`,
        )
    }
    const timed = specs
        .map((c) => {
            if ((c.marker === undefined) === (c.at === undefined)) {
                throw new TimelineError(`callout "${c.text}" needs exactly one of \`marker\` or \`at\``)
            }
            const recordingAt = c.at ?? (markers.markers.find((m) => m.label === c.marker) as { at: number }).at
            return { ...c, recordingAt }
        })
        .filter((c) => {
            const inside = c.recordingAt >= mediaStart && c.recordingAt <= mediaEnd
            if (!inside) {
                warnings.push(`callout "${c.text}" at ${c.recordingAt}s is outside the trim window — dropped`)
            }
            return inside
        })
        .sort((a, b) => a.recordingAt - b.recordingAt)

    const transitionTimes = transitions.map((t) => t.at)
    const callouts: Callout[] = timed.map((c, i) => {
        const at = toComposition(c.recordingAt)
        const next = timed[i + 1]
        const nextTransition = transitionTimes.find((t) => t > at)
        // Never overlap the next callout or a hand-off card; never outlive the recording.
        const cap = Math.min(
            next ? toComposition(next.recordingAt) - 0.2 : Infinity,
            nextTransition !== undefined ? nextTransition - timing.belt - 0.1 : Infinity,
            clipEnd - 0.3,
        )
        const duration = round(c.duration ?? Math.max(1, Math.min(timing.calloutDuration, cap - at)))
        if (c.duration !== undefined && at + c.duration > cap + 0.01) {
            warnings.push(`callout "${c.text}" (${c.duration}s) overlaps the next step or the end of the recording`)
        }
        // Two-actor videos: tag each step with who does it (the hand-off card's roles).
        const before = handOffs.filter((t) => t.at <= c.recordingAt)
        const group = c.group ?? (before.length ? before.at(-1)?.to : handOffs[0]?.from)

        return { at, duration, text: c.text, ...(group ? { group } : {}) }
    })
    if (callouts.length > timing.maxSteps) {
        warnings.push(
            `${callouts.length} callouts — the recap holds ${timing.maxSteps}; merge or drop steps (extra ones are left out of the recap)`,
        )
    }

    const scale = Math.min(timing.maxW / markers.viewport.width, timing.maxH / markers.viewport.height)
    const recapStart = round(clipEnd - timing.overlap)
    const recapDuration = round(
        Math.min(timing.recapMax, timing.recapBase + timing.recapPerStep * Math.min(callouts.length, timing.maxSteps)),
    )
    const brandOutStart = round(recapStart + recapDuration - timing.overlap)
    const total = round(brandOutStart + timing.brandOut)

    return {
        timeline: {
            total,
            cover: timing.cover,
            coverExit: timing.coverExit,
            clipStart,
            clipDuration,
            clipEnd,
            mediaStart: round(mediaStart),
            mediaEnd: round(mediaEnd),
            recapStart,
            recapDuration,
            brandOutStart,
            brandOutDuration: timing.brandOut,
            belt: timing.belt,
            frame: {
                width: Math.round(markers.viewport.width * scale),
                height: Math.round(markers.viewport.height * scale),
            },
            viewport: markers.viewport,
            transitions,
            segments,
            callouts,
            toComposition,
        },
        warnings,
    }
}

/** One callout per marker, worded as the marker label: the starting point of a new video.json. */
export function defaultCallouts(markers: Markers): CalloutSpec[] {
    return markers.markers.map((m) => ({ marker: m.label, text: m.label }))
}

export function round(n: number): number {
    return Math.round(n * 100) / 100
}
