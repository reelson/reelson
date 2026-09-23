import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeTimeline, round, stepStart, suggestTrimStart, TIMING_DEFAULTS, TimelineError, type VideoSpec } from '../skills/reelson-compose/scripts/timeline.ts'
import { fixture } from './helpers.ts'

const spec = (extra: Partial<VideoSpec> = {}): VideoSpec => ({ title: 'T', trim: { start: 1 }, ...extra })

describe('computeTimeline', () => {
    it('places the recording right after the intro and maps recording → composition time', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec({ trim: { start: 2.6 } }))
        assert.equal(t.clipStart, TIMING_DEFAULTS.intro.exit)
        assert.equal(t.toComposition(2.6), 3)
        assert.equal(t.toComposition(6.74), 7.14)
        assert.equal(t.mediaEnd, 20.13)
        assert.equal(t.clipEnd, 20.53)
    })

    it('times one callout per marker by default and never lets callouts overlap', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec({ trim: { start: 2.6 } }))
        assert.deepEqual(
            t.callouts.map((c) => c.text),
            ['Type a task and press Enter', 'Add as many as you need', 'Tick a task when it is done', 'Filter what is left'],
        )
        t.callouts.forEach((c, i) => {
            const next = t.callouts[i + 1]
            if (next) {
                assert.ok(c.at + c.duration <= next.at - 0.2 + 1e-9, `callout ${i} overlaps the next`)
            }
            assert.ok(c.at + c.duration <= t.clipEnd - 0.3 + 1e-9, `callout ${i} outlives the recording`)
        })
    })

    it('keeps a spoken callout up until its line is said, and the next one waits', () => {
        const plain = computeTimeline(fixture('todo'), spec({ trim: { start: 2.6 } })).timeline.callouts
        const first = (c: { text: string }) => (c.text.startsWith('Type') ? 4 : 0)
        const { timeline: t, warnings } = computeTimeline(fixture('todo'), spec({ trim: { start: 2.6 } }), TIMING_DEFAULTS, first)
        assert.equal(t.callouts[0].at, plain[0].at)
        assert.ok(t.callouts[0].duration >= 4, 'up while it is said')
        assert.ok(t.callouts[1].at >= t.callouts[0].at + 4.3 - 1e-9, 'the next step waits for the line')
        assert.deepEqual(t.callouts.slice(2), plain.slice(2), 'later steps keep their time when there is room')
        assert.deepEqual(warnings, [])
    })

    it('warns when a spoken line cannot fit before the next step', () => {
        const { warnings } = computeTimeline(fixture('todo'), spec({ trim: { start: 2.6 } }), TIMING_DEFAULTS, () => 9)
        assert.ok(warnings.some((w) => /voice-over: "Filter what is left" is still being said/.test(w)))
    })

    it('sizes the recap and the total from the step count', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec({ trim: { start: 2.6 } }))
        assert.deepEqual(t.recap, { start: 20.13, duration: 4.2, maxSteps: 10 }) // 2.4 + 0.45 × 4
        assert.deepEqual(t.outro, { start: 23.93, duration: 2.6 })
        assert.equal(t.total, 26.53)
    })

    it('fits the frame into the stage keeping the aspect ratio', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec())
        assert.deepEqual(t.frame, { width: 1504, height: 940 })
    })

    it('uses callout wording and order from video.json, timed from markers or explicit times', () => {
        const { timeline: t } = computeTimeline(
            fixture('todo'),
            spec({
                callouts: [
                    { marker: 'Filter what is left', text: 'Filter' },
                    { at: 5, text: 'Manual', duration: 2 },
                ],
            }),
        )
        assert.deepEqual(
            t.callouts.map((c) => [c.text, c.at, c.duration]),
            [
                ['Manual', 7, 2],
                // From its step (the glide at 13.41) through 1.2 s past its marker (15.97).
                ['Filter', t.toComposition(13.41), 3.76],
            ],
        )
    })

    it('starts each marker callout as its step begins, not after it (anchor "marker": on the marker)', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec())
        // Each marker follows its action: the callout starts with the glide after the previous marker.
        assert.deepEqual(t.callouts.map((c) => c.at), [3.13, 6.74, 11.17, 13.41].map(t.toComposition))
        t.callouts.slice(0, -1).forEach((c, i) => {
            assert.ok(round(c.at + c.duration) <= round(t.callouts[i + 1].at - 0.2), `callout ${i + 1} ends before the next step`)
        })
        const onMarker = computeTimeline(fixture('todo'), spec({ callouts: [{ marker: 'Filter what is left', text: 'x', anchor: 'marker' }] })).timeline
        assert.equal(onMarker.callouts[0].at, t.toComposition(15.97))
        // Nothing logged between two markers (a page load): the callout stays on its marker.
        assert.equal(stepStart({ ...fixture('todo'), clicks: [] }, 11.17, 0), 11.17)
        // The first step starts no earlier than the trim.
        assert.equal(stepStart(fixture('todo'), 6.74, 3.5), 6.74)
        assert.throws(() => computeTimeline(fixture('todo'), spec({ callouts: [{ at: 5, anchor: 'marker', text: 'x' }] })), /`anchor` needs a `marker`/)
    })

    it('gives a step that was only a page load time to be read before the next one', () => {
        // "Open the list" is a page load; the next step's glide starts right after it.
        const m = {
            ...fixture('todo'),
            markers: [{ label: 'Open the list', at: 5 }, { label: 'Search', at: 9 }],
            clicks: [{ move: 5.05, at: 5.6, x: 100, y: 100, kind: 'type' as const }],
        }
        const { timeline: t } = computeTimeline(m, spec({ trim: { start: 4.5 }, callouts: undefined }))
        const [open, search] = t.callouts
        assert.equal(search.at, round(open.at + TIMING_DEFAULTS.stage.calloutMinimum))
        assert.ok(open.at + open.duration <= search.at - 0.2 + 1e-9)
    })

    it('drops callouts outside the trim window with a warning', () => {
        const { timeline: t, warnings } = computeTimeline(fixture('todo'), spec({ trim: { start: 8 } }))
        assert.equal(t.callouts.length, 3)
        assert.match(warnings[0], /Type a task and press Enter.*outside the trim window/)
    })

    it('warns when the recap cannot hold every step', () => {
        const callouts = Array.from({ length: 11 }, (_, i) => ({ at: 2 + i, text: `Step ${i}` }))
        const { warnings } = computeTimeline(fixture('todo'), spec({ callouts }))
        assert.ok(warnings.some((w) => /recap holds 10/.test(w)))
    })

    it('rejects unknown markers, ambiguous callouts and empty trims', () => {
        assert.throws(() => computeTimeline(fixture('todo'), spec({ callouts: [{ marker: 'Nope', text: 'x' }] })), /unknown markers: "Nope"/)
        assert.throws(
            () => computeTimeline(fixture('todo'), spec({ callouts: [{ marker: 'Filter what is left', at: 3, text: 'x' }] })),
            TimelineError,
        )
        assert.throws(() => computeTimeline(fixture('todo'), spec({ trim: { start: 30 } })), /trim window is empty/)
    })

    it('takes each part of the timeline from its section', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec(), {
            ...TIMING_DEFAULTS,
            intro: { duration: 2.7, exit: 2.6 },
            recap: { base: 1.8, perStep: 0.35, max: 5.5, maxSteps: 10 },
            outro: { duration: 4 },
        })
        assert.deepEqual(t.intro, { start: 0, duration: 2.7, exit: 2.6 })
        assert.equal(t.clipStart, 2.6)
        assert.equal(t.recap?.duration, 3.2) // 1.8 + 0.35 × 4
        assert.equal(t.total, round(t.outro.start + 4))
    })

    it('runs the outro straight after the recording without a recap', () => {
        const callouts = Array.from({ length: 11 }, (_, i) => ({ at: 2 + i, text: `Step ${i}` }))
        const { timeline: t, warnings } = computeTimeline(fixture('todo'), spec({ callouts }), { ...TIMING_DEFAULTS, recap: null })
        assert.equal(t.recap, null)
        // no cross-fade: the outro's text never lands on the fading footage
        assert.equal(t.outro.start, t.clipEnd)
        assert.equal(t.total, round(t.clipEnd + 2.6))
        assert.ok(!warnings.some((w) => /recap holds/.test(w)), 'no recap, no capacity warning')
    })

    it('respects stage timing overrides', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec(), {
            ...TIMING_DEFAULTS,
            stage: { ...TIMING_DEFAULTS.stage, overlap: 0.6, maxW: 1200 },
        })
        assert.equal(t.outro.start, round((t.recap?.start ?? 0) + (t.recap?.duration ?? 0) - 0.6))
        assert.equal(t.frame.width, 1200)
    })
})

describe('hand-offs (demo.transition)', () => {
    const { timeline: t } = computeTimeline(fixture('handoff'), spec())

    it('pushes footage after the card back by the gap', () => {
        assert.equal(t.toComposition(3), 5)
        assert.equal(t.toComposition(13), 17.6)
        assert.equal(t.clipDuration, 21.6) // 19 s of footage + 2.6 s card
        assert.deepEqual(t.transitions.map((tr) => tr.at), [12])
    })

    it('splits the footage into one clip per actor', () => {
        assert.deepEqual(t.segments, [
            { start: 3, duration: 9, mediaStart: 1 },
            { start: 14.6, duration: 10, mediaStart: 10 },
        ])
    })

    it('ends a callout before the recording leaves for the card', () => {
        const sendIt = t.callouts.find((c) => c.text === 'Send it')
        // Its step starts at the glide at 4 s (composition 6); the card is fully in at 12.
        assert.deepEqual(sendIt && [sendIt.at, sendIt.duration], [6, 5])
    })

    it('tags steps with the acting role', () => {
        assert.deepEqual(
            t.callouts.map((c) => c.group),
            ['Manager', 'Manager', 'Employee'],
        )
    })

    it('shifts a marker callout by its offset and remembers where each callout came from', () => {
        const callouts = [
            { marker: 'Add as many as you need', text: 'second' },
            { marker: 'Type a task and press Enter', text: 'first', offset: 0.5 },
        ]
        const plain = computeTimeline(fixture('todo'), spec({ callouts: [{ marker: 'Type a task and press Enter', text: 'x' }] })).timeline
        const { timeline: t } = computeTimeline(fixture('todo'), spec({ callouts }))
        assert.deepEqual(t.callouts.map((c) => [c.text, c.source]), [['first', 1], ['second', 0]])
        assert.equal(t.callouts[0].at, round(plain.callouts[0].at + 0.5))
        assert.throws(() => computeTimeline(fixture('todo'), spec({ callouts: [{ at: 5, offset: 1, text: 'x' }] })), /`offset` shifts a `marker`/)
    })

    it('maps the logged cursor into composition time: trimmed, pushed past hand-off cards', () => {
        const markers = {
            ...fixture('handoff'),
            cursor: {
                drawn: false,
                path: [[0.5, 10, 10], [1.5, 20, 20], [4, 30, 30], [12, 40, 40]] as [number, number, number][],
                presses: [[4, 30, 30], [0.2, 1, 1]] as [number, number, number][],
            },
        }
        const { timeline: t } = computeTimeline(markers, spec({ trim: { start: 1 } }))
        assert.ok(t.cursor)
        // The last move before the trim is where the cursor rests when the footage starts.
        assert.deepEqual(t.cursor.path.map((p) => p[0]), [t.clipStart, t.toComposition(1.5), t.toComposition(4), t.toComposition(12)])
        assert.deepEqual(t.cursor.path[0].slice(1), [10, 10])
        assert.equal(round(t.toComposition(12) - t.toComposition(4)), round(8 + t.transitions[0].gap))
        assert.deepEqual(t.cursor.presses, [[t.toComposition(4), 30, 30]])
        assert.equal(t.cursor.size, 44)
        assert.ok(Math.abs(t.cursor.scale - t.frame.width / markers.viewport.width) < 1e-4)

        assert.equal(computeTimeline(markers, spec({ cursor: false })).timeline.cursor, null)
        assert.equal(computeTimeline(markers, spec({ cursor: { size: 60, ripple: false } })).timeline.cursor?.size, 60)
        const filmed = { ...markers, cursor: { ...markers.cursor, drawn: true } }
        const { timeline, warnings } = computeTimeline(filmed, spec({ cursor: { size: 60 } }))
        assert.equal(timeline.cursor, null)
        assert.match(warnings.join(), /cursor filmed in/)
    })

    it('anchors the trim to markers and clicks, so a re-record moves it along', () => {
        const markers = fixture('todo')
        const first = markers.markers[0]
        const at = (trim: VideoSpec['trim']) => {
            const { timeline } = computeTimeline(markers, spec({ trim }))
            return [timeline.mediaStart, timeline.mediaEnd]
        }
        assert.equal(at({ start: 'auto' })[0], suggestTrimStart(markers))
        assert.equal(at({ start: { marker: first.label, offset: -0.8 } })[0], round(first.at - 0.8))
        const click = markers.clicks![1]
        assert.equal(at({ start: { click: 2 } })[0], click.move)
        assert.equal(at({ end: { marker: markers.markers.at(-1)!.label, offset: 2 } })[1], round(markers.markers.at(-1)!.at + 2))

        // The same video.json after a re-record where everything happens 1.5 s later.
        const later = {
            ...markers,
            durationSeconds: markers.durationSeconds + 1.5,
            markers: markers.markers.map((m) => ({ ...m, at: m.at + 1.5 })),
            clicks: markers.clicks!.map((c) => ({ ...c, at: c.at + 1.5, move: (c.move ?? c.at) + 1.5 })),
        }
        const anchored = { start: { marker: first.label, offset: -0.8 } }
        assert.equal(computeTimeline(later, spec({ trim: anchored })).timeline.mediaStart, round(first.at + 1.5 - 0.8))
        assert.equal(computeTimeline(later, spec({ trim: { start: 'auto' } })).timeline.mediaStart, round(suggestTrimStart(markers) + 1.5))

        assert.throws(() => at({ start: { marker: 'nope' } }), /trim.start: no marker "nope"/)
        assert.throws(() => at({ start: { click: 99 } }), /no click 99/)
        assert.throws(() => at({ end: 'auto' }), /trim.end cannot be "auto"/)
    })
})
