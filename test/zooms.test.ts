import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeTimeline } from '../skills/reelkit-compose/scripts/timeline.ts'
import { checkZoom, compositionClicks, followPath, planZoom, zoomOverlaps, ZoomError, type CompClick, type Zoom } from '../skills/reelkit-compose/scripts/zooms.ts'
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

describe('zoom hold', () => {
    // Three clicks close together on screen: #2 follows #1 at once, #3 comes after a pause.
    const click = (index: number, comp: number, glide: number): CompClick => ({ index, kind: 'click', comp, glide, until: comp, fx: 0.5, fy: 0.5 })
    const clicks = [click(1, 5, 4.4), click(2, 6.4, 5.9), click(3, 12, 11.4)]
    const { timeline } = setup()
    const end = (z: Zoom) => z.at + z.duration

    it('holds a later click in view that follows right away', () => {
        const z = planZoom({ clicks: [1], scale: 1.6 }, clicks, timeline)
        assert.ok(end(z) > 6.4, 'click #2 is inside the hold')
        assert.ok(end(z) <= 12 - 0.1 + 1e-9, 'out before click #3')
    })

    it('ends at a pause instead of holding every click still in view', () => {
        const z = planZoom({ clicks: [1, 2], scale: 1.6 }, clicks, timeline)
        assert.ok(end(z) < 11.4 + 0.01, `zooms out with the glide to #3, not after it (ends ${end(z)})`)
        assert.ok(end(z) - z.at < 7.5)
        assert.deepEqual(checkZoom(z, clicks, timeline).problems, [])
    })

    it('holds through the pause when the range asks for it', () => {
        const z = planZoom({ clicks: [1, 3], scale: 1.6 }, clicks, timeline)
        assert.ok(end(z) > 12)
    })
})

describe('followPath', () => {
    const viewport = { width: 1000, height: 1000 }
    const cursorAt = (points: [number, number, number][]) => ({ size: 44, ripple: true, idle: 0, scale: 1, path: points, presses: [] })
    const zoom: Zoom = { at: 10, duration: 4, x: 0.5, y: 0.5, scale: 2, in: 0.8, out: 0.8 }

    it('starts on the planned focus and glides towards the cursor, never leaving the frame', () => {
        // The cursor jumps to the far right edge at t = 10.5 and stays there.
        const path = followPath(zoom, cursorAt([[0, 500, 500], [10.5, 1000, 500]]), viewport)
        assert.deepEqual(path[0], [10, 0.5, 0.5])
        assert.ok(path.at(-1)![0] >= 13.9)
        const xs = path.map((p) => p[1])
        assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-9), 'moves one way, no jitter')
        assert.ok(xs.at(-1)! > 0.95 && xs.at(-1)! <= 1, `ends near the right edge (${xs.at(-1)}), clamped to the frame`)
        assert.ok(path.every((p) => p[2] === 0.5))
    })

    it('makes check accept clicks that do not fit one view', () => {
        const clicks: CompClick[] = [
            { index: 1, kind: 'click', comp: 11, glide: 10.4, until: 11, fx: 0.05, fy: 0.5 },
            { index: 2, kind: 'click', comp: 12, glide: 11.4, until: 12, fx: 0.95, fy: 0.5 },
        ]
        const { timeline } = setup()
        assert.throws(() => planZoom({ clicks: [1, 2], scale: 2 }, clicks, timeline), ZoomError)
        const z = planZoom({ clicks: [1, 2], scale: 2, follow: true }, clicks, timeline)
        z.path = followPath(z, cursorAt([[0, 50, 500], [11.5, 950, 500]]), viewport)
        assert.deepEqual(checkZoom(z, clicks, timeline).problems, [])
    })
})
