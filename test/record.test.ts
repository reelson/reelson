import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cursorOverlayScript, hideDevChromeScript } from '../skills/reelkit-record/scripts/cursor-overlay.ts'

/** The init scripts run in the recorded page: a syntax error there fails silently. */
const parses = (script: string): void => {
    assert.doesNotThrow(() => new Function(script), script)
}

describe('page init scripts', () => {
    it('hides dev chrome with a stylesheet built from the selectors', () => {
        const script = hideDevChromeScript(['.phpdebugbar', '.environment-indicator'])
        parses(script)
        assert.match(script, /"\.phpdebugbar, \.environment-indicator \{ display: none !important; \}"/)
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
