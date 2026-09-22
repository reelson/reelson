import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeTimeline } from '../skills/reelkit-compose/scripts/timeline.ts'
import { checkZoom, compositionClicks, planZoom, zoomOverlaps, ZoomError, type Zoom } from '../skills/reelkit-compose/scripts/zooms.ts'
import { fixture } from './helpers.ts'

function setup(name: 'todo' | 'handoff' = 'todo', trimStart = 2.6) {
    const markers = fixture(name)
    const { timeline } = computeTimeline(markers, { title: 'T', trim: { start: trimStart } })
    return { timeline, clicks: compositionClicks(markers, timeline) }
}

describe('planZoom', () => {
    it('plans a click-anchored zoom that passes the checker', () => {
        const { timeline, clicks } = setup()
        const zoom = planZoom({ clicks: [3, 4], scale: 1.7 }, clicks, timeline)
        assert.deepEqual(checkZoom(zoom, clicks, timeline).problems, [])
        assert.deepEqual(
            checkZoom(zoom, clicks, timeline).framed.map((c) => c.index),
            [3, 4],
        )
    })

    it('plans a valid zoom for every single click in the recording', () => {
        const { timeline, clicks } = setup()
        for (const c of clicks) {
            const zoom = planZoom({ clicks: [c.index], scale: 1.8 }, clicks, timeline)
            assert.deepEqual(checkZoom(zoom, clicks, timeline).problems, [], `click ${c.index}`)
        }
    })

    it('finishes the zoom-in before the click and starts with the glide', () => {
        const { timeline, clicks } = setup()
        const zoom = planZoom({ clicks: [3], scale: 1.8 }, clicks, timeline)
        const click = clicks.find((c) => c.index === 3)!
        assert.ok(zoom.at + zoom.in <= click.comp - 0.1 + 1e-9)
        assert.ok(zoom.at >= click.glide - 0.35 - 1e-9)
    })

    it('keeps typing inside the hold', () => {
        const { timeline, clicks } = setup()
        const zoom = planZoom({ clicks: [1], scale: 2 }, clicks, timeline)
        const typing = clicks.find((c) => c.index === 1)!
        assert.equal(typing.kind, 'type')
        assert.ok(zoom.at + zoom.duration - zoom.out >= typing.until - 1e-9)
    })

    it('centres the focus on the clicks and keeps them all in view', () => {
        const { timeline, clicks } = setup()
        const zoom = planZoom({ clicks: [3, 4], scale: 1.7 }, clicks, timeline)
        assert.ok(zoom.x > 0.3 && zoom.x < 0.5, `x ${zoom.x}`)
    })

    it('refuses clicks too far apart for the scale', () => {
        const { timeline, clicks } = setup('handoff', 1)
        assert.throws(() => planZoom({ clicks: [1, 3], scale: 3 }, clicks, timeline), /too far apart/)
    })

    it('reports clicks outside the trimmed recording', () => {
        const { timeline, clicks } = setup('todo', 8)
        assert.throws(() => planZoom({ clicks: [1], scale: 1.5 }, clicks, timeline), /click 1 is not in the trimmed recording \(available: 3–4\)/)
    })

    it('stops before the recording leaves for a hand-off card', () => {
        const { timeline, clicks } = setup('handoff', 1)
        const zoom = planZoom({ clicks: [2], scale: 1.6 }, clicks, timeline)
        assert.ok(zoom.at + zoom.duration <= timeline.transitions[0].at - timeline.belt + 1e-9)
        assert.deepEqual(checkZoom(zoom, clicks, timeline).problems, [])
    })

    it('passes manual zooms through, converting recording time', () => {
        const { timeline, clicks } = setup()
        const zoom = planZoom({ at: 11, duration: 4, x: 0.4, y: 0.4, scale: 1.5 }, clicks, timeline)
        assert.equal(zoom.at, timeline.toComposition(11))
        assert.throws(() => planZoom({ scale: 1.5, at: 11 }, clicks, timeline), ZoomError)
        assert.throws(() => planZoom({ scale: 1.5, clicks: [3], at: 11 }, clicks, timeline), /timed automatically/)
    })
})

describe('checkZoom', () => {
    it('flags a zoom that is still easing in at the click, and suggests clicks', () => {
        const { timeline, clicks } = setup()
        const click = clicks.find((c) => c.index === 3)!
        const late: Zoom = { at: click.comp - 0.3, duration: 3, x: 0.4, y: 0.39, scale: 1.7, in: 0.8, out: 0.8 }
        const { problems } = checkZoom(late, clicks, timeline)
        assert.match(problems[0], /zoom-in not done before the click #3/)
        assert.match(problems[0], /"clicks": \[3/)
    })

    it('flags clicks outside the zoomed view', () => {
        const { timeline, clicks } = setup()
        const click = clicks.find((c) => c.index === 3)!
        const wrongPlace: Zoom = { at: click.glide, duration: 1.5, x: 1, y: 1, scale: 2.5, in: 0.4, out: 0.4 }
        assert.ok(checkZoom(wrongPlace, clicks, timeline).problems.some((p) => /frames no click|outside the zoomed view/.test(p)))
    })

    it('flags eases shorter than the minimum', () => {
        const { timeline, clicks } = setup()
        const zoom = { ...planZoom({ clicks: [3], scale: 1.7 }, clicks, timeline), in: 0.2 }
        assert.ok(checkZoom(zoom, clicks, timeline).problems.some((p) => /reads as a jump/.test(p)))
    })
})

describe('zoomOverlaps', () => {
    it('flags two zooms on screen at once, and only those', () => {
        const { timeline, clicks } = setup()
        const late = planZoom({ clicks: [3, 4], scale: 1.7 }, clicks, timeline)
        const early = planZoom({ at: 3, duration: 1.5, x: 0.5, y: 0.5, scale: 1.5 }, clicks, timeline)
        assert.deepEqual(zoomOverlaps([late, early]), [])
        const clash = { ...late, at: late.at - 1 }
        assert.deepEqual(zoomOverlaps([late, clash]).map((o) => o.index), [1])
        assert.match(zoomOverlaps([late, clash])[0].message, /overlaps zoom 1/)
    })
})
