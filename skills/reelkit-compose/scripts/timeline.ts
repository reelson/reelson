/**
 * The composition timeline, computed from a recording's markers.json and the
 * video's video.json. Pure: no files, no ffmpeg — so it is unit-tested.
 *
 *   intro (0 → exit) → recording (callouts, zooms, hand-off cards)
 *   → recap (optional) → outro
 *
 * video.json times are recording times; everything this module returns is in
 * composition seconds.
 */

/**
 * Timeline constants (seconds). The stage keys come from the template's
 * template.json, the rest from the section chosen for each slot (section.json).
 */
export const STAGE_TIMING = {
    overlap: 0.4, // recording → recap → outro cross-fades
    calloutDuration: 3.0,
    transitionGap: 2.6, // seconds a hand-off card holds between the two belts
    belt: 0.9, // the recording's exit before a hand-off card (matches the stage)
    maxW: 1600, // the framed recording's box inside the 1920x1080 stage
    maxH: 940,
}
export const SECTION_TIMING = {
    intro: {
        duration: 4.0, // intro clip length
        exit: 3.0, // the intro hands over and the recording starts (= clipStart)
    },
    recap: {
        base: 2.4, // + perStep per step, capped at max
        perStep: 0.45,
        max: 7.5,
        maxSteps: 10, // the recap's capacity
    },
    outro: {
        duration: 2.6,
    },
}
export type StageTiming = typeof STAGE_TIMING
export type IntroTiming = typeof SECTION_TIMING.intro
export type RecapTiming = typeof SECTION_TIMING.recap
export type OutroTiming = typeof SECTION_TIMING.outro
export type Slot = keyof typeof SECTION_TIMING
export const SLOTS = Object.keys(SECTION_TIMING) as Slot[]

export interface Timing {
    stage: StageTiming
    intro: IntroTiming
    /** null: no recap section ("recap": "none"). */
    recap: RecapTiming | null
    outro: OutroTiming
}
export const TIMING_DEFAULTS: Timing = { stage: STAGE_TIMING, ...SECTION_TIMING }

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
    /** Seconds after (or, negative, before) the marker. */
    offset?: number
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

/** Section name per slot; "none" is allowed for the recap only. */
export type SectionChoice = Partial<Record<Slot, string>>

/** video.json */
export interface VideoSpec {
    title: string
    subtitle?: string
    template?: string
    sections?: SectionChoice
    recapTitle?: string
    brand?: { name?: string; tagline?: string; eyebrow?: string; logo?: string | null }
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
    /** Index in video.json `callouts` (or in the default callouts when it has none). */
    source: number
}

export interface Timeline {
    total: number
    intro: { start: number; duration: number; exit: number }
    recap: { start: number; duration: number; maxSteps: number } | null
    outro: { start: number; duration: number }
    clipStart: number
    clipDuration: number
    clipEnd: number
    /** Recording window used (trim). */
    mediaStart: number
    mediaEnd: number
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

    const stage = timing.stage
    const clipStart = timing.intro.exit
    const handOffs = (markers.transitions ?? []).filter((t) => t.at > mediaStart && t.at < mediaEnd)
    const gap = stage.transitionGap
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
        .map((c, source) => {
            if ((c.marker === undefined) === (c.at === undefined)) {
                throw new TimelineError(`callout "${c.text}" needs exactly one of \`marker\` or \`at\``)
            }
            if (c.offset !== undefined && c.marker === undefined) {
                throw new TimelineError(`callout "${c.text}": \`offset\` shifts a \`marker\`; with \`at\`, change \`at\` instead`)
            }
            const recordingAt =
                c.at ?? round((markers.markers.find((m) => m.label === c.marker) as { at: number }).at + (c.offset ?? 0))
            return { ...c, recordingAt, source }
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
            nextTransition !== undefined ? nextTransition - stage.belt - 0.1 : Infinity,
            clipEnd - 0.3,
        )
        const duration = round(c.duration ?? Math.max(1, Math.min(stage.calloutDuration, cap - at)))
        if (c.duration !== undefined && at + c.duration > cap + 0.01) {
            warnings.push(`callout "${c.text}" (${c.duration}s) overlaps the next step or the end of the recording`)
        }
        // Two-actor videos: tag each step with who does it (the hand-off card's roles).
        const before = handOffs.filter((t) => t.at <= c.recordingAt)
        const group = c.group ?? (before.length ? before.at(-1)?.to : handOffs[0]?.from)

        return { at, duration, text: c.text, ...(group ? { group } : {}), source: c.source }
    })
    const recapTiming = timing.recap
    if (recapTiming && callouts.length > recapTiming.maxSteps) {
        warnings.push(
            `${callouts.length} callouts — the recap holds ${recapTiming.maxSteps}; merge or drop steps (extra ones are left out of the recap)`,
        )
    }

    const scale = Math.min(stage.maxW / markers.viewport.width, stage.maxH / markers.viewport.height)
    // recording → recap → outro, each cross-fading into the next by `overlap`. Without a
    // recap the outro waits for the recording to fade out: its text never lands on the footage.
    const recapStart = round(clipEnd - stage.overlap)
    const recap = recapTiming
        ? {
              start: recapStart,
              duration: round(
                  Math.min(
                      recapTiming.max,
                      recapTiming.base + recapTiming.perStep * Math.min(callouts.length, recapTiming.maxSteps),
                  ),
              ),
              maxSteps: recapTiming.maxSteps,
          }
        : null
    const outroStart = recap ? round(recap.start + recap.duration - stage.overlap) : clipEnd
    const total = round(outroStart + timing.outro.duration)

    return {
        timeline: {
            total,
            intro: { start: 0, duration: timing.intro.duration, exit: timing.intro.exit },
            recap,
            outro: { start: outroStart, duration: timing.outro.duration },
            clipStart,
            clipDuration,
            clipEnd,
            mediaStart: round(mediaStart),
            mediaEnd: round(mediaEnd),
            belt: stage.belt,
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
