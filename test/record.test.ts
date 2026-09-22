import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { frameSchedule } from '../skills/reelkit-record/scripts/capture.ts'
import { cursorOverlayScript, hideDevChromeScript } from '../skills/reelkit-record/scripts/cursor-overlay.ts'

/** The init scripts run in the recorded page: a syntax error there fails silently. */
const parses = (script: string): void => {
    assert.doesNotThrow(() => new Function(script), script)
}

describe('page init scripts', () => {
    it('hides dev chrome with a stylesheet built from the selectors', () => {
        const script = hideDevChromeScript(['.phpdebugbar', '.environment-indicator'])
        parses(script)
        assert.match(script, /"\.phpdebugbar \{ display: none !important; \}\\n\.environment-indicator \{ display: none !important; \}"/)
        assert.equal(hideDevChromeScript([]), '')
    })

    it('builds a valid cursor overlay for each mode', () => {
        for (const draw of [true, false]) {
            for (const report of [true, false]) {
                parses(cursorOverlayScript('#dc2626', { draw, report }))
            }
        }
        assert.match(cursorOverlayScript('#dc2626', { draw: false, report: true }), /if \(!false\) return;/)
    })
})

describe('frameSchedule', () => {
    const T0 = 1_000_000 // createDemo's clock start, epoch ms
    const frame = (file: string, s: number) => ({ file, t: T0 + s * 1000 })
    const total = (sched: { duration: number }[]) => sched.reduce((a, e) => a + e.duration, 0)
    const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)

    it('shows each frame from when it was painted until the next one', () => {
        const sched = frameSchedule([frame('b', 1), frame('a', 0.2), frame('c', 1.5)], T0, T0 + 3000, [])
        assert.deepEqual(sched.map((e) => e.file), ['a', 'b', 'c'])
        // The first frame also covers the start; the last one holds until the end.
        close(sched[0].duration, 1)
        close(sched[1].duration, 0.5)
        close(sched[2].duration, 1.5)
        close(total(sched), 3)
    })

    it('starts from the frame on screen at time 0 and removes cuts', () => {
        const frames = [frame('before', -0.5), frame('a', 0.5), frame('b', 2), frame('c', 4)]
        const sched = frameSchedule(frames, T0, T0 + 5000, [{ from: 1, to: 3 }])
        assert.deepEqual(sched.map((e) => e.file), ['before', 'a', 'b', 'c'])
        close(sched[0].duration, 0.5)
        close(sched[1].duration, 0.5) // 0.5–1, then cut
        close(sched[2].duration, 1) // 3–4: b is what was on screen when the cut ends
        close(sched[3].duration, 1)
        close(total(sched), 3)
    })

    it('merges a frame split by a cut', () => {
        const sched = frameSchedule([frame('a', 0), frame('b', 4)], T0, T0 + 5000, [{ from: 1, to: 2 }])
        assert.deepEqual(sched.map((e) => [e.file, Math.round(e.duration * 1000) / 1000]), [['a', 3], ['b', 1]])
    })
})
