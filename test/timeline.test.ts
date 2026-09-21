import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeTimeline, TIMING_DEFAULTS, TimelineError, type VideoSpec } from '../skills/reelkit-compose/scripts/timeline.ts'
import { fixture } from './helpers.ts'

const spec = (extra: Partial<VideoSpec> = {}): VideoSpec => ({ title: 'T', trim: { start: 1 }, ...extra })

describe('computeTimeline', () => {
    it('places the recording right after the cover and maps recording → composition time', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec({ trim: { start: 2.6 } }))
        assert.equal(t.clipStart, TIMING_DEFAULTS.coverExit)
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
        assert.equal(t.recapDuration, 4.2) // 2.4 + 0.45 × 4
        assert.equal(t.recapStart, 20.13)
        assert.equal(t.brandOutStart, 23.93)
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

    it('respects template timing overrides', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec(), { ...TIMING_DEFAULTS, coverExit: 3.5, brandOut: 3 })
        assert.equal(t.clipStart, 3.5)
        assert.equal(t.total, t.brandOutStart + 3)
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
})
