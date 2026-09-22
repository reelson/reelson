import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeTimeline, round, suggestTrimStart, TIMING_DEFAULTS, TimelineError, type VideoSpec } from '../skills/reelkit-compose/scripts/timeline.ts'
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
                ['Filter', t.toComposition(15.97), 3],
            ],
        )
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
        assert.deepEqual(sendIt && [sendIt.at, sendIt.duration], [10, 1])
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
