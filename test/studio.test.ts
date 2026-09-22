import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { plan } from '../skills/reelkit-compose/scripts/build.ts'
import { studioData } from '../skills/reelkit-compose/scripts/studio.ts'
import type { VideoSpec } from '../skills/reelkit-compose/scripts/timeline.ts'
import { fixture, kitConfig } from './helpers.ts'

/** A demo folder holding a fixture's markers.json and the given video.json. */
function demo(name: 'todo' | 'handoff', spec: VideoSpec): string {
    const dir = mkdtempSync(join(tmpdir(), 'reelkit-studio-'))
    writeFileSync(join(dir, 'markers.json'), JSON.stringify(fixture(name)))
    writeFileSync(join(dir, 'video.json'), JSON.stringify(spec))
    return dir
}

const noAudio = { narration: false, music: false }

describe('studioData', () => {
    it('lays out every section back to back, ending at the total', () => {
        const dir = demo('todo', { title: 'Plan your day', trim: { start: 2.6 }, zooms: [{ clicks: [3, 4], scale: 1.7 }] })
        const d = studioData('todo', plan(dir, kitConfig()), noAudio)

        assert.deepEqual(d.sections.map((s) => [s.slot, s.name]), [
            ['intro', 'poster'],
            ['recording', 'recording'],
            ['recap', 'steps'],
            ['outro', 'wordmark'],
        ])
        assert.equal(d.sections[0].start, 0)
        assert.equal(d.sections.at(-1)?.end, d.total)
        assert.deepEqual(d.callouts.map((c) => c.n), [1, 2, 3, 4])
        assert.equal(d.zooms.length, 1)
        assert.deepEqual(d.zooms[0].problems, [])
        assert.deepEqual(d.clicks.map((c) => c.n), [1, 2, 3, 4])
        assert.ok(d.markers.every((m) => m.used))
        assert.deepEqual(d.audio, { narration: null, music: null })
        // Plain JSON: nothing is lost on the way to the page.
        assert.deepEqual(JSON.parse(JSON.stringify(d)), d)
    })

    it('shows hand-offs, unused markers, audio and a missing recap', () => {
        const dir = demo('handoff', {
            title: 'Hand it over',
            sections: { recap: 'none' },
            callouts: [{ marker: 'Open the document', text: 'Open it' }],
        })
        const d = studioData('handoff', plan(dir, kitConfig()), { narration: true, music: true })

        assert.deepEqual(d.sections.map((s) => s.slot), ['intro', 'recording', 'outro'])
        assert.equal(d.handOffs.length, 1)
        assert.ok(d.handOffs[0].at > d.handOffs[0].belt)
        assert.deepEqual(d.markers.map((m) => m.used), [true, false, false])
        assert.deepEqual(d.audio.narration, { start: d.sections[1].start, end: d.sections[1].end })
        assert.deepEqual(d.audio.music, { start: 0, end: d.total })
    })
})
