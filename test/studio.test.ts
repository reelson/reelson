import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { plan } from '../skills/reelkit-compose/scripts/build.ts'
import { applyEdit, specRevision, studioData } from '../skills/reelkit-compose/scripts/studio.ts'
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
        assert.equal(d.cursor.state, 'layer')
        assert.equal(d.cursor.presses.length, 4)
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
        // No cursor log in this fixture: the cursor is part of the footage.
        assert.equal(d.cursor.state, 'filmed')
    })
})

describe('applyEdit (the studio saving video.json)', () => {
    const spec: VideoSpec = { title: 'Plan your day', trim: { start: 'auto' }, callouts: [{ marker: 'Type a task and press Enter', text: 'Type' }] }
    const read = (dir: string) => JSON.parse(readFileSync(join(dir, 'video.json'), 'utf8'))

    it('writes a valid edit the way the build would, $schema first', () => {
        const dir = demo('todo', spec)
        const result = applyEdit(dir, kitConfig(), { base: specRevision(dir), spec: { ...spec, title: 'New title' } })
        assert.equal(result.status, 200)
        assert.equal(read(dir).title, 'New title')
        assert.equal(Object.keys(read(dir))[0], '$schema')
        assert.equal(result.written, readFileSync(join(dir, 'video.json'), 'utf8'))
    })

    it('refuses an edit made on a stale copy (someone else saved first)', () => {
        const dir = demo('todo', spec)
        const base = specRevision(dir)
        writeFileSync(join(dir, 'video.json'), JSON.stringify({ ...spec, title: 'Edited elsewhere' }))
        const result = applyEdit(dir, kitConfig(), { base, spec: { ...spec, title: 'Mine' } })
        assert.equal(result.status, 409)
        assert.equal(read(dir).title, 'Edited elsewhere')
    })

    it('refuses what the schema or the plan rejects, and writes nothing', () => {
        const dir = demo('todo', spec)
        const before = readFileSync(join(dir, 'video.json'), 'utf8')
        const badSchema = applyEdit(dir, kitConfig(), { base: specRevision(dir), spec: { ...spec, title: 42 } })
        assert.equal(badSchema.status, 422)
        assert.match(badSchema.body.error ?? '', /title: expected string/)
        const badPlan = applyEdit(dir, kitConfig(), { base: specRevision(dir), spec: { ...spec, callouts: [{ marker: 'nope', text: 'x' }] } })
        assert.equal(badPlan.status, 422)
        assert.match(badPlan.body.error ?? '', /unknown markers/)
        assert.equal(readFileSync(join(dir, 'video.json'), 'utf8'), before)
    })
})
