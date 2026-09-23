import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Markers, VideoSpec } from '../skills/reelson-compose/scripts/timeline.ts'
import { compareRecordings } from '../skills/reelson-compose/scripts/verify.ts'
import { fixture } from './helpers.ts'

describe('compareRecordings', () => {
    const before = fixture('todo')
    const spec: VideoSpec = {
        title: 'T',
        trim: { start: { marker: before.markers[0].label, offset: -0.8 } },
        callouts: before.markers.map((m) => ({ marker: m.label, text: m.label })),
        zooms: [{ clicks: [3, 4], scale: 1.7 }],
    }
    const retake = (change: (m: Markers) => void): Markers => {
        const m = structuredClone(before)
        change(m)
        return m
    }

    it('passes an identical take (a re-record that only shifts times)', () => {
        const later = retake((m) => {
            m.markers.forEach((x) => (x.at += 1.2))
            m.clicks!.forEach((c) => (c.at += 1.2))
        })
        assert.deepEqual(compareRecordings(before, later, spec), { problems: [], notes: [] })
    })

    it('flags a marker a callout or the trim still uses', () => {
        const gone = retake((m) => {
            m.markers[0].label = 'Renamed'
        })
        const { problems, notes } = compareRecordings(before, gone, spec)
        assert.equal(problems.length, 2)
        assert.match(problems[0], /callout ".*" is timed from marker/)
        assert.match(problems[1], /trim.start is tied to marker/)
        assert.ok(notes.some((n) => /new marker\(s\) "Renamed"/.test(n)))
    })

    it('flags clicks renumbered by a step added before them', () => {
        const extra = retake((m) => {
            m.clicks!.splice(1, 0, { move: 5, at: 5.5, x: 100, y: 100, kind: 'click' })
        })
        const { problems, notes } = compareRecordings(before, extra, spec)
        assert.ok(problems.some((p) => /zoom 1 uses click #3: it was a .* now a click at 100,100|zoom 1 uses click #3/.test(p)), problems.join('\n'))
        assert.ok(notes.includes('4 → 5 click(s)'))
    })

    it('flags clicks that are no longer there', () => {
        const fewer = retake((m) => {
            m.clicks = m.clicks!.slice(0, 2)
        })
        assert.match(compareRecordings(before, fewer, spec).problems.join(), /zoom 1 uses click #3, but the new take has 2 click\(s\)/)
    })

    it('ignores small moves of the same click', () => {
        const nudged = retake((m) => {
            m.clicks![2].x += 20
        })
        assert.deepEqual(compareRecordings(before, nudged, spec).problems, [])
    })
})
