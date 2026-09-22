import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { landscapeLayout, PORTRAIT, portraitLayout } from '../skills/reelkit-compose/scripts/portrait.ts'
import { computeTimeline } from '../skills/reelkit-compose/scripts/timeline.ts'
import { compositionClicks, planZoom } from '../skills/reelkit-compose/scripts/zooms.ts'
import { fixture } from './helpers.ts'

describe('layouts', () => {
    const markers = fixture('todo') // has a cursor log; viewport 1440x900
    const { timeline } = computeTimeline(markers, { title: 'T', trim: { start: 2.6 } })
    const zooms = [planZoom({ clicks: [3, 4], scale: 1.7 }, compositionClicks(markers, timeline), timeline)]

    it('landscape is the classic stage: the footage fills the frame, nothing pans', () => {
        const l = landscapeLayout(timeline)
        assert.deepEqual(l.stage, { width: 1920, height: 1080 })
        assert.deepEqual(l.footage, l.frame)
        assert.deepEqual(l.pan, [])
        assert.equal(l.bandZoom, 1)
    })

    it('portrait fills the tall frame with the footage and pans inside it, never past an edge', () => {
        const { layout, cursor } = portraitLayout(timeline, zooms)
        assert.deepEqual(layout.stage, PORTRAIT.stage)
        assert.equal(layout.footage.height, PORTRAIT.frame.height)
        assert.ok(layout.footage.width > PORTRAIT.frame.width)
        const maxX = layout.footage.width - layout.frame.width
        assert.ok(layout.pan.length > 10)
        assert.ok(layout.pan.every(([, x, y]) => x >= 0 && x <= maxX && y === 0))
        assert.equal(layout.pan[0][0], timeline.clipStart)
        assert.equal(layout.bandZoom, 1080 / 1920)
        assert.equal(cursor?.scale, Math.round((layout.footage.width / 1440) * 10000) / 10000)
    })

    it('makes zooms end at the size they reach in landscape, with the origin on the frame', () => {
        const { layout, zooms: moved } = portraitLayout(timeline, zooms)
        const landscapePx = (timeline.frame.width / 1440) * zooms[0].scale
        const portraitPx = (layout.footage.width / 1440) * moved[0].scale
        assert.ok(Math.abs(landscapePx - portraitPx) < 0.02, `${landscapePx} vs ${portraitPx}`)
        assert.ok(moved[0].x >= 0 && moved[0].x <= 1 && moved[0].y >= 0 && moved[0].y <= 1)
        assert.equal(moved[0].at, zooms[0].at)
    })
})
