import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { landscapeLayout, PORTRAIT, phoneLayout, portraitLayout } from '../skills/reelkit-compose/scripts/portrait.ts'
import { computeTimeline, type Markers } from '../skills/reelkit-compose/scripts/timeline.ts'
import { fixture } from './helpers.ts'

// The todo fixture (1440x900) plus what the demo worked on: a wide field, then a small button.
const withFocus = (): Markers => ({
    ...fixture('todo'),
    focus: [
        { at: 4, box: { x: 400, y: 190, width: 640, height: 60 }, area: { x: 380, y: 170, width: 680, height: 110 } },
        { at: 9, box: { x: 700, y: 300, width: 90, height: 36 }, area: { x: 690, y: 290, width: 110, height: 56 } },
    ],
})
const at = (camera: number[][], time: number) => camera.find((c) => c[0] >= time - 1e-9)!

describe('layouts', () => {
    it('landscape is the classic stage: the footage fills the frame and stays still', () => {
        const { timeline } = computeTimeline(fixture('todo'), { title: 'T', trim: { start: 2.6 } })
        const l = landscapeLayout(timeline)
        assert.deepEqual(l.stage, { width: 1920, height: 1080 })
        assert.deepEqual(l.footage, l.frame)
        assert.deepEqual(l.camera, [])
    })

    it('portrait without focus shows the full width, the frame no taller than the footage', () => {
        const { timeline } = computeTimeline(fixture('todo'), { title: 'T', trim: { start: 2.6 } })
        const { layout } = portraitLayout(timeline)
        assert.equal(layout.footage.width, PORTRAIT.frame.width)
        assert.ok(layout.camera.every(([, k, x, y, h]) => k === 1 && x === 0 && y === 0 && h === layout.footage.height))
    })

    it('frames what the demo works on — closer on a small button — and never cuts it', () => {
        const { timeline } = computeTimeline(withFocus(), { title: 'T', trim: { start: 2.6 } })
        const { layout } = portraitLayout(timeline)
        const fit = PORTRAIT.frame.width / 1440
        const field = at(layout.camera, timeline.toComposition(4) + PORTRAIT.ease + 0.1)
        const button = at(layout.camera, timeline.toComposition(9) + PORTRAIT.ease + 0.1)
        assert.ok(field[1] > 1 && button[1] > field[1], `the button is framed closer (${field[1]} → ${button[1]})`)
        for (const [shot, area] of [[field, withFocus().focus![0].area], [button, withFocus().focus![1].area]] as const) {
            const [, k, x, y, h] = shot
            const s = fit * k
            // The area (recording px) lands inside the frame (stage px).
            assert.ok(x + area.x * s >= -1 && x + (area.x + area.width) * s <= PORTRAIT.frame.width + 1, 'fits the width')
            assert.ok(y + area.y * s >= -1 && y + (area.y + area.height) * s <= h + 1, 'fits the height')
        }
        // After a quiet stretch it eases back to the full width.
        const end = layout.camera.at(-1)!
        assert.equal(end[1], 1)
    })

    it('shows a mobile recording whole, in a phone-shaped frame', () => {
        const phone = { ...fixture('todo'), viewport: { width: 390, height: 844 } }
        const { timeline } = computeTimeline(phone, { title: 'T', trim: { start: 2.6 } })
        const { layout, cursor } = phoneLayout(timeline)
        assert.deepEqual(layout.footage, layout.frame)
        assert.ok(layout.frame.height <= PORTRAIT.phone.maxHeight && layout.frame.width <= PORTRAIT.phone.maxWidth)
        assert.ok(Math.abs(layout.frame.width / layout.frame.height - 390 / 844) < 0.01)
        assert.deepEqual(layout.camera, [])
        assert.ok(Math.abs((cursor?.scale ?? 0) - layout.frame.width / 390) < 0.005)
        assert.equal(cursor?.touch, true, "a phone is tapped: ripples, no arrow")
    })
})
