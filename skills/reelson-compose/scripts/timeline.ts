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
    /** A step's callout stays this long after its marker (the result), next step permitting. */
    calloutHold: 1.2,
    /** The least a step's callout is up before the next step's may replace it. */
    calloutMinimum: 1.8,
    transitionGap: 2.6, // seconds a hand-off card holds between the two belts
    belt: 0.9, // the recording's exit before a hand-off card (matches the stage)
    maxW: 1600, // the framed recording's box inside the 1920x1080 stage
    maxH: 940,
}
/** A spoken callout stays up this long after its line ends (a breath before the next step). */
const SPOKEN_TAIL = 0.3

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

/** What reelson-record writes (or what build.ts probes from a manual recording). */
export interface Markers {
    scenario?: string
    viewport: { width: number; height: number }
    durationSeconds: number
    markers: { label: string; at: number }[]
    clicks?: Click[]
    transitions?: HandOff[]
    cuts?: { from: number; to: number }[]
    cursor?: CursorLog
    /** What the demo worked on (reelson-record's Focus): recording s, viewport CSS px. */
    focus?: { at: number; box: Box; area: Box }[]
}

export interface Box {
    x: number
    y: number
    width: number
    height: number
}

/** The cursor as reelson-record logged it: [t, x, y] in recording seconds and viewport CSS px. */
export interface CursorLog {
    /** Already filmed into recording.mp4 (record.cursor "recorded"): the video must not draw it. */
    drawn: boolean
    path: [number, number, number][]
    presses: [number, number, number][]
}

/** video.json `cursor`: how the video draws a logged cursor. */
export interface CursorSpec {
    /** Arrow height in recording CSS px (44 = the classic macOS-style size). */
    size?: number
    /** The ring on each press. */
    ripple?: boolean
    /** Fade the cursor out after this many seconds without moving or clicking (0 = never). */
    idle?: number
}

export interface CalloutSpec {
    text: string
    marker?: string
    /**
     * Where a marker callout starts: "step" (default) — as its step begins, i.e. the first
     * glide or click after the previous marker (the marker comes after the action it names);
     * "marker" — on the marker itself.
     */
    anchor?: 'step' | 'marker'
    /** Seconds after (or, negative, before) that start. */
    offset?: number
    at?: number
    duration?: number
    group?: string
    /** Voice-over: what is spoken for this step (default: its text); false: nothing. */
    say?: string | false
    /** Where it sits over the footage (default: video.json `calloutPosition`). */
    position?: CalloutPosition
}

/**
 * Where a callout sits over the footage (landscape, square): "auto" — at the bottom, or at the
 * top while the bottom would cover what the demo works on; "top" / "bottom" — always there.
 */
export type CalloutPosition = 'auto' | 'top' | 'bottom'

export interface ZoomSpec {
    scale: number
    /** Pan with the cursor while zoomed (needs a logged cursor: record.cursor "layer"). */
    follow?: boolean
    clicks?: number[]
    x?: number
    y?: number
    at?: number
    duration?: number
    in?: number
    out?: number
}

/**
 * A trim edge in video.json: a recording time, "auto" (start only: just before the first
 * glide or marker), or a time relative to a marker / to the glide towards a click — so a
 * re-record moves the trim with the footage.
 */
export type TrimPoint = number | 'auto' | { marker: string; offset?: number } | { click: number; offset?: number }

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
    trim?: { start?: TrimPoint; end?: TrimPoint }
    music?: string | boolean | null
    callouts?: CalloutSpec[]
    /** Where every callout sits unless it says otherwise (default "auto"). */
    calloutPosition?: CalloutPosition
    zooms?: ZoomSpec[]
    /** false: no cursor at all. Only for recordings with a logged (not filmed) cursor. */
    cursor?: false | CursorSpec
    /**
     * Where the portrait video (`render --portrait`) comes from: "mobile" — the phone take
     * (`reelson record --mobile`); "desktop" — a camera over the desktop recording; "auto"
     * (default) — the phone take when there is one.
     */
    portrait?: 'auto' | 'mobile' | 'desktop'
    /**
     * Voice-over: true speaks each callout (reelson.config.json `voice` settings); an object
     * overrides the provider / model / voice / instructions / speed for this video and may add
     * a line over the intro.
     */
    voice?:
        | boolean
        | {
              provider?: 'openai' | 'elevenlabs' | 'piper' | 'command'
              model?: string
              voice?: string
              instructions?: string
              speed?: number
              intro?: string
          }
    /** Versions every `reelson render` adds besides the 16:9 one (as --portrait / --square). */
    formats?: ('portrait' | 'square')[]
    /** How `reelson publish` words the upload (default: title, subtitle + steps). */
    publish?: { title?: string; description?: string; tags?: string[] }
}

export interface Callout {
    at: number
    duration: number
    text: string
    group?: string
    /** Voice-over line, when it differs from the text (false: silent). */
    say?: string | false
    /** Pinned to the top or the bottom (none: placed automatically). */
    position?: 'top' | 'bottom'
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
    /**
     * The cursor layer, or null when the footage already shows the cursor (or none is wanted).
     * Composition seconds; x/y in recording CSS px (× `scale` for frame px).
     */
    cursor: {
        size: number
        ripple: boolean
        /** Seconds of stillness before it fades out; 0 = always shown. */
        idle: number
        /** A phone take: show the taps (ripples) only, no arrow. */
        touch?: boolean
        scale: number
        path: [number, number, number][]
        presses: [number, number, number][]
    } | null
    /** What the demo worked on, in composition time (empty for recordings made before 0.5). */
    focus: { at: number; box: Box; area: Box }[]
    /** Recording time → composition time (footage after a hand-off is pushed back by the gap). */
    toComposition: (recordingTime: number) => number
}

export class TimelineError extends Error {}

export function computeTimeline(
    markers: Markers,
    spec: VideoSpec,
    timing: Timing = TIMING_DEFAULTS,
    /**
     * Voice-over: seconds from a callout appearing until its spoken line is done (0: silent or
     * not spoken yet). Such a callout stays up at least that long, and the next one waits.
     */
    spoken: (c: { text: string; say?: string | false }) => number = () => 0,
): { timeline: Timeline; warnings: string[] } {
    const warnings: string[] = []
    const mediaStart = Math.max(0, resolveTrimPoint(spec.trim?.start, markers, 'start') ?? 0)
    const mediaEnd = Math.min(resolveTrimPoint(spec.trim?.end, markers, 'end') ?? markers.durationSeconds, markers.durationSeconds)
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
            if (c.anchor !== undefined && c.marker === undefined) {
                throw new TimelineError(`callout "${c.text}": \`anchor\` needs a \`marker\``)
            }
            if (c.at !== undefined) {
                return { ...c, recordingAt: c.at, shownUntil: c.at, source }
            }
            const marker = (markers.markers.find((m) => m.label === c.marker) as { at: number }).at
            const start = c.anchor === 'marker' ? marker : stepStart(markers, marker, mediaStart)
            return { ...c, recordingAt: round(start + (c.offset ?? 0)), shownUntil: marker, source }
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
    // When each shows. A step that starts as the footage does waits for the recording to
    // arrive; one that starts right after the previous (a step that was only a page load) waits
    // until that one has been up long enough to read. An explicit `at` is kept as given.
    // With a voice-over, that is until its line has been said (and never past the recording).
    const speaking = timed.map((c) => spoken(c))
    const minimum = (i: number): number => Math.max(stage.calloutMinimum, speaking[i] ? speaking[i] + SPOKEN_TAIL : 0)
    const starts: number[] = []
    timed.forEach((c, i) => {
        const at = toComposition(c.recordingAt)
        const after = i ? starts[i - 1] + minimum(i - 1) : 0
        starts.push(
            c.at === undefined
                ? round(Math.max(at, clipStart + stage.belt, Math.min(after, Math.max(at, clipEnd - stage.calloutMinimum))))
                : at,
        )
    })
    const callouts: Callout[] = timed.map((c, i) => {
        const at = starts[i]
        const next = starts[i + 1]
        const nextTransition = transitionTimes.find((t) => t > at)
        // Never overlap the next callout or a hand-off card; never outlive the recording.
        const cap = Math.min(
            next !== undefined ? next - 0.2 : Infinity,
            nextTransition !== undefined ? nextTransition - stage.belt - 0.1 : Infinity,
            clipEnd - 0.3,
        )
        // Through its step, and a moment on its result (the marker), at least calloutDuration.
        const wanted = Math.max(stage.calloutDuration, toComposition(c.shownUntil) - at + stage.calloutHold, speaking[i])
        const duration = round(c.duration ?? Math.max(1, Math.min(wanted, cap - at)))
        if (c.duration !== undefined && at + c.duration > cap + 0.01) {
            warnings.push(`callout "${c.text}" (${c.duration}s) overlaps the next step or the end of the recording`)
        }
        if (speaking[i] > duration + 0.25) {
            warnings.push(
                `voice-over: "${c.say || c.text}" is still being said ${round(speaking[i] - duration)}s after its callout goes — ` +
                    'shorten its `say`, or pause longer in the scenario',
            )
        }
        // Two-actor videos: tag each step with who does it (the hand-off card's roles).
        const before = handOffs.filter((t) => t.at <= c.recordingAt)
        const group = c.group ?? (before.length ? before.at(-1)?.to : handOffs[0]?.from)

        const position = c.position ?? spec.calloutPosition
        return {
            at,
            duration,
            text: c.text,
            ...(group ? { group } : {}),
            ...(c.say !== undefined ? { say: c.say } : {}),
            ...(position && position !== 'auto' ? { position } : {}),
            source: c.source,
        }
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

    const frame = {
        width: Math.round(markers.viewport.width * scale),
        height: Math.round(markers.viewport.height * scale),
    }
    const log = markers.cursor
    if (spec.cursor !== undefined && (!log || log.drawn)) {
        warnings.push(
            'video.json `cursor` has no effect: this recording has the cursor filmed in — re-record (record.cursor "layer") to draw it as a layer',
        )
    }
    let cursor: Timeline['cursor'] = null
    if (log && !log.drawn && spec.cursor !== false && log.path.length) {
        const inside = (t: number): boolean => t >= mediaStart && t <= mediaEnd
        // Where the cursor rests when the footage starts: the last move before the trim.
        const before = log.path.filter(([t]) => t < mediaStart).at(-1)
        const path: [number, number, number][] = [
            ...(before ? [[clipStart, before[1], before[2]] as [number, number, number]] : []),
            ...log.path.filter(([t]) => inside(t)).map(([t, x, y]): [number, number, number] => [toComposition(t), x, y]),
        ]
        cursor = {
            size: spec.cursor?.size ?? 44,
            ripple: spec.cursor?.ripple ?? true,
            idle: spec.cursor?.idle ?? 0,
            scale: Math.round((frame.width / markers.viewport.width) * 10000) / 10000,
            path,
            presses: log.presses.filter(([t]) => inside(t)).map(([t, x, y]) => [toComposition(t), x, y]),
        }
    }

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
            frame,
            viewport: markers.viewport,
            transitions,
            segments,
            callouts,
            cursor,
            focus: (markers.focus ?? [])
                .filter((f) => f.at >= mediaStart && f.at <= mediaEnd)
                .map((f) => ({ ...f, at: toComposition(f.at) })),
            toComposition,
        },
        warnings,
    }
}

/** A trim edge in recording seconds (undefined: not set). */
/**
 * When the step that ends at `marker` began: the first glide (or click) after the previous
 * marker — and after `from`, the trim — else the marker itself (nothing logged in between,
 * e.g. a page load).
 */
export function stepStart(markers: Markers, marker: number, from: number): number {
    const previous = Math.max(from, ...markers.markers.map((m) => m.at).filter((at) => at < marker - 1e-6))
    const first = (markers.clicks ?? [])
        .map((c) => c.move ?? c.at)
        .filter((t) => t >= previous - 1e-6 && t < marker)
        .sort((a, b) => a - b)[0]
    return first ?? marker
}

export function resolveTrimPoint(point: TrimPoint | undefined, markers: Markers, edge: 'start' | 'end'): number | undefined {
    if (point === undefined || typeof point === 'number') {
        return point
    }
    if (point === 'auto') {
        if (edge === 'end') {
            throw new TimelineError('trim.end cannot be "auto" — leave it out to keep the recording to its end')
        }
        return suggestTrimStart(markers)
    }
    if ('marker' in point) {
        const found = markers.markers.find((m) => m.label === point.marker)
        if (!found) {
            throw new TimelineError(
                `trim.${edge}: no marker "${point.marker}" — markers.json has ${markers.markers.map((m) => JSON.stringify(m.label)).join(', ') || 'none'}`,
            )
        }
        return round(found.at + (point.offset ?? 0))
    }
    const click = markers.clicks?.[point.click - 1]
    if (!click) {
        throw new TimelineError(`trim.${edge}: no click ${point.click} — markers.json has ${markers.clicks?.length ?? 0}`)
    }
    return round((click.move ?? click.at) + (point.offset ?? 0))
}

/** Where the footage should start: just before the first logged glide (after the login). */
export function suggestTrimStart(markers: Markers): number {
    const candidates = [
        ...(markers.clicks ?? []).map((c) => (c.move ?? c.at) - 0.5),
        ...markers.markers.map((m) => m.at - 0.8),
    ]
    if (!candidates.length) {
        return 0
    }
    return Math.max(0, round(Math.min(...candidates)))
}

/** One callout per marker, worded as the marker label: the starting point of a new video.json. */
export function defaultCallouts(markers: Markers): CalloutSpec[] {
    return markers.markers.map((m) => ({ marker: m.label, text: m.label }))
}

export function round(n: number): number {
    return Math.round(n * 100) / 100
}
